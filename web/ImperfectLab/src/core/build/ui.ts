// The versus character-select UI for select-screen id 18: the select screen's lists and grid, the tile, the hero name and color, and the in-match HUD portraits.
import { f32be, i32be, putF32be, putU32be } from '../bytes'
import { LabError } from '../errors'
import type { RgbaImage } from '../image/rgba'
import { Apt, type ConstValue } from '../mnroi/apt'
import * as gshtool from '../mnroi/gshtool'
import * as nbig from '../mnroi/nbig'
import * as images from './images'

export const NEW_ID = 18
export const P = 'Apt/clash/'
const TILE_TEMPLATE = 4

export class Archive extends Array<nbig.ArchiveFile> {
  tag: Uint8Array = nbig.TAG
}

export function loadArchive(data: Uint8Array): Archive {
  const [files, tag] = nbig.parse(data)
  const out = new Archive()
  out.push(...files)
  out.tag = tag
  return out
}

function split(files: nbig.ArchiveFile[]): Map<string, nbig.ArchiveFile> {
  const out = new Map<string, nbig.ArchiveFile>()
  for (const [n, b] of files) out.set(n.split('.').pop()!.toLowerCase(), [n, b])
  return out
}

function rebuild(files: Archive, aptBytes: Uint8Array, constBytes: Uint8Array, other: Record<string, Uint8Array> = {}): Uint8Array {
  const o: Record<string, Uint8Array> = { ...other, apt: aptBytes, const: constBytes }
  return nbig.save(files.map(([n, b]) => [n, o[n.split('.').pop()!.toLowerCase()] ?? b]), true, files.tag)
}

function openMovie(data: Uint8Array): [Archive, Map<string, nbig.ArchiveFile>, Apt] {
  const files = loadArchive(data)
  const d = split(files)
  const apt = d.get('apt'), cst = d.get('const')
  if (!apt || !cst) throw new LabError('the movie archive has no .apt or .const')
  return [files, d, new Apt(apt[1], cst[1])]
}

const last = (v: ConstValue[]) => v[v.length - 1]
const same = (a: ConstValue[], b: ConstValue[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function patchCharselect(data: Uint8Array, voice: number | null = null): Uint8Array {
  const [files, , apt] = openMovie(data)
  const block = apt.frameActions(apt.aptOff, 0)[0]

  let at = apt.findPush(block, (v) => v[0] === 'aObject' && last(v) === 18 && v.includes('thumb17'))
  let items = apt.getPush(at)
  const thumb = apt.pushStr(block, `thumb${NEW_ID}`)
  apt.setPush(at, [items[0], thumb, ...items.slice(1, -1), apt.constInt(NEW_ID + 1)])

  at = apt.findPush(block, (v) => v[0] === 'aCharObject' && last(v) === 18)
  items = apt.getPush(at)
  apt.setPush(at, [items[0], ...new Array(27).fill(items[1]), apt.constInt(27)])

  at = apt.findPush(block, (v) => v[0] === 'g_aCharacterOrder' && last(v) === 18 && v[1] === 17)
  items = apt.getPush(at)
  apt.setPush(at, [items[0], apt.constInt(NEW_ID), ...items.slice(1, -1), apt.constInt(NEW_ID + 1)])

  if (voice !== null) addVoice(apt, block, voice)
  const [a, c] = apt.build()
  return rebuild(files, a, c)
}

function addVoice(apt: Apt, block: number, voice: number) {
  const pool = apt.pool(block)
  const ops = apt.walk(block)
  const vals = (at: number) => apt.getPush(at).map((i) => apt.constValue(i, pool))
  const start = ops.findIndex(([at, op]) => op === 0x96 && same(vals(at), ['g_aCharacterAudio', '_global']))
  if (start < 0) throw new LabError("the select screen's voice list was not found")
  let count = -1
  for (let k = start; k < Math.min(ops.length - 1, start + 120); k++) {
    if (ops[k][1] === 0x96 && ops[k + 1][1] === 0x42 && same(vals(ops[k][0]), [18])) {
      count = k
      break
    }
  }
  if (count < 0) throw new LabError("the select screen's voice list has an unexpected shape")
  const at = ops[start][0]
  const items = apt.getPush(at)
  apt.setPush(at, [items[0], apt.constInt(voice), items[1]])
  apt.setPush(ops[count][0], [apt.constInt(NEW_ID + 1)])
}

export function sfxValues(mainData: Uint8Array): Map<string, number> {
  const [, , apt] = openMovie(mainData)
  const out = new Map<string, number>()
  const movie = apt.aptOff
  for (let f = 0; f < apt.u32(movie + 8); f++) {
    for (const block of apt.frameActions(movie, f)) {
      if (apt.d[block] !== 0x88) continue
      const pool = apt.pool(block)
      for (const [at, op] of apt.walk(block)) {
        if (op !== 0x96) continue
        const vals = apt.getPush(at).map((i) => apt.constValue(i, pool))
        if (vals.length === 2 && typeof vals[0] === 'string' && vals[0].startsWith('FE_SFX_') && typeof vals[1] === 'number' && !out.has(vals[0])) {
          out.set(vals[0], vals[1])
        }
      }
    }
  }
  return out
}

export function patchThumbs(data: Uint8Array, aliasId: number, pics: [RgbaImage, RgbaImage] | null = null): Uint8Array {
  const [files, d, apt] = openMovie(data)
  const exports = new Map(apt.exports())
  let holder: number | null = null
  for (let n = 0; n < apt.u32(apt.aptOff + 20); n++) {
    const c = apt.character(n)
    if (c && apt.u32(c) === 5 && apt.framePlaces(c, 0).some(([, nm]) => nm === 'thumb17')) holder = c
  }
  if (holder === null) throw new LabError("the select screen's thumbnail holder was not found")
  const places = new Map<string, number>()
  for (const [it, nm] of apt.framePlaces(holder, 0)) if (nm) places.set(nm, it)

  const src0 = places.get('thumb0')!, src9 = places.get('thumb9')!
  const y0 = f32be(apt.d, src0 + 36), y9 = f32be(apt.d, src9 + 36)
  const rec = apt.slice(src9, src9 + 64)
  putF32be(rec, 36, y9 + (y9 - y0))
  const depths = apt.framePlaces(holder, 0).map(([it]) => i32be(apt.d, it + 8))
  putU32be(rec, 8, (Math.max(...depths) + 2) >>> 0)
  putU32be(rec, 52, apt.appendStr(`thumb${NEW_ID}`))
  apt.addFrameItem(holder, 0, apt.append(rec))

  for (const block of apt.frameActions(holder, 0)) {
    const pool = apt.pool(block)
    for (const [at, op] of apt.walk(block)) {
      if (op === 0x96 && same(apt.getPush(at).map((i) => apt.constValue(i, pool)), [18])) apt.setPush(at, [apt.constInt(NEW_ID + 1)])
    }
  }

  let replaced: Record<string, Uint8Array> = {}
  if (pics) {
    const [sprite, geo, gsh] = addTile(apt, exports.get(`char${TILE_TEMPLATE}`)!, d.get('geo')![1], d.get('gsh')![1], pics)
    apt.addExport(`char${NEW_ID}`, sprite)
    replaced = { geo, gsh }
  } else {
    const alias = exports.get(`char${aliasId}`)
    if (alias === undefined) throw new LabError(`the select screen has no tile char${aliasId}`)
    apt.addExport(`char${NEW_ID}`, alias)
  }
  const [a, c] = apt.build()
  return rebuild(files, a, c, replaced)
}

export function tileSizes(data: Uint8Array): [number, number][] {
  const [, d, apt] = openMovie(data)
  const sprite = apt.character(new Map(apt.exports()).get(`char${TILE_TEMPLATE}`)!)
  const records = gshtool.readGeo(d.get('geo')![1])
  const bank = gshtool.readGsh(d.get('gsh')![1])
  const out: [number, number][] = []
  const seen = new Set<number>()
  for (let f = 0; f < apt.u32(sprite + 8); f++) {
    for (const [it] of apt.framePlaces(sprite, f)) {
      const sh = apt.u32(it + 12)
      if (seen.has(sh)) continue
      seen.add(sh)
      const pic = new gshtool.Picture(bank.record(String(geoTexture(records, apt.u32(apt.character(sh) + 24)))))
      out.push([pic.width, pic.height])
    }
  }
  return out
}

function addTile(apt: Apt, spriteId: number, geo: Uint8Array, gsh: Uint8Array, pics: [RgbaImage, RgbaImage]): [number, Uint8Array, Uint8Array] {
  const movie = apt.aptOff
  const nchars = apt.u32(movie + 20), chars = apt.u32(movie + 24)
  const src = apt.character(spriteId)
  const nframes = apt.u32(src + 8)
  const table = Array.from({ length: nchars }, (_, i) => apt.u32(chars + 4 * i))
  const records = gshtool.readGeo(geo)
  const bank = gshtool.readGsh(gsh)
  const shapeMap = new Map<number, number>(), imageMap = new Map<number, number>()
  const geoNew = new Map<number, [number, Map<number, number>]>()
  const imgNew = new Map<string, [string, RgbaImage]>()
  const order: number[] = []
  for (let f = 0; f < nframes; f++) {
    for (const [it] of apt.framePlaces(src, f)) {
      const sh = apt.u32(it + 12)
      if (shapeMap.has(sh)) continue
      const shp = apt.character(sh)
      if (apt.u32(shp) !== 1) throw new LabError('the tile sprite places a non-shape')
      const geoId = apt.u32(shp + 24)
      const newShape = table.length
      table.push(apt.append(apt.slice(shp, shp + 28)))
      apt.put32(table[table.length - 1] + 24, newShape)
      shapeMap.set(sh, newShape)
      const oldTex = geoTexture(records, geoId)
      const img = apt.character(oldTex)
      const newImg = table.length
      table.push(apt.append(apt.slice(img, img + 12)))
      apt.put32(table[table.length - 1] + 8, newImg)
      imageMap.set(oldTex, newImg)
      geoNew.set(newShape, [geoId, new Map([[oldTex, newImg]])])
      order.push(oldTex)
    }
  }
  if (order.length !== 2) throw new LabError(`expected two tile pictures (unselected, selected), found ${order.length}`)
  order.forEach((t, i) => {
    const im = pics[i]
    const pic = new gshtool.Picture(bank.record(String(t)))
    if (im.width !== pic.width || im.height !== pic.height) throw new LabError(`the tile picture is ${im.width}x${im.height}, not ${pic.width}x${pic.height}`)
    imgNew.set(String(imageMap.get(t)), [String(t), im])
  })
  const sizes: Record<number, number> = { 1: 8, 2: 16, 3: 64, 4: 8 }
  const newFrames: number[] = []
  for (let f = 0; f < nframes; f++) {
    const [n, items] = apt.frame(src, f)
    const ptrs: number[] = []
    for (let i = 0; i < n; i++) {
      const it = apt.u32(items + 4 * i)
      const kind = apt.u32(it)
      if (!(kind in sizes)) throw new LabError(`tile sprite frame item type ${kind} is not copied`)
      const rec = apt.slice(it, it + sizes[kind])
      if (kind === 1) putU32be(rec, 4, copyAction(apt, apt.u32(it + 4)))
      else if (kind === 3) {
        if (apt.u32(it + 52) || apt.u32(it + 60)) throw new LabError('tile PlaceObject with a name or clip actions is not copied')
        putU32be(rec, 12, shapeMap.get(apt.u32(it + 12))!)
      }
      ptrs.push(apt.append(rec))
    }
    newFrames.push(n, apt.appendU32s(ptrs))
  }
  const frameBytes = new Uint8Array(4 * newFrames.length)
  newFrames.forEach((v, i) => putU32be(frameBytes, 4 * i, v))
  const spr = apt.slice(src, src + 20)
  putU32be(spr, 12, apt.append(frameBytes))
  const newSprite = table.length
  table.push(apt.append(spr))
  apt.put32(movie + 24, apt.appendU32s(table))
  apt.put32(movie + 20, table.length)
  const newGeo = gshtool.buildGeo(gshtool.addShapes(records, geoNew))
  const newGsh = gshtool.buildGsh(images.add(bank, imgNew))
  return [newSprite, newGeo, newGsh]
}

function copyAction(apt: Apt, block: number): number {
  let end = block
  for (const [at, op] of apt.walk(block)) {
    if (op === 0x8e || op === 0x9b) throw new LabError(`action block 0x${block.toString(16).toUpperCase()} defines a function: not copied`)
    end = at + 1
  }
  apt.pad((((block - apt.length) % 4) + 4) % 4)
  const next = apt.append(apt.slice(block, end), 1)
  for (const [at, op] of apt.walk(next)) {
    if (op === 0x88 || op === 0x96) {
      const o = (at + 4) & ~3
      const n = apt.u32(o), arr = apt.u32(o + 4)
      apt.put32(o + 4, apt.appendU32s(Array.from({ length: n }, (_, k) => apt.u32(arr + 4 * k))))
    }
  }
  return next
}

export function geoTexture(records: gshtool.GeoRecord[], rid: number): number {
  for (const [r, shapes] of records) {
    if (r === rid) {
      const tex = shapes.flat().filter((it) => it.kind === 'texture')
      if (shapes.length !== 1 || tex.length !== 1) throw new LabError(`.geo record ${rid} is not one textured piece`)
      return (tex[0] as { tex: number }).tex
    }
  }
  throw new LabError(`no .geo record ${rid}`)
}

export function patchMain(data: Uint8Array, name: string, color = 0xffffff): Uint8Array {
  const [files, , apt] = openMovie(data)
  const movie = apt.aptOff
  const done = new Set<string>()
  for (let f = 0; f < apt.u32(movie + 8); f++) {
    for (const block of apt.frameActions(movie, f)) {
      if (apt.d[block] !== 0x88) continue
      const pool = apt.pool(block)
      for (const [at, op] of apt.walk(block)) {
        if (op !== 0x96) continue
        const items = apt.getPush(at)
        const vals = items.map((i) => apt.constValue(i, pool))
        const n = vals.length
        if (n >= 19 && vals[n - 1] === 18 && vals[n - 2] === '~kT_THING' && vals[n - 19] === '~kT_VANROEKEL') {
          apt.setPush(at, [...items.slice(0, -19), apt.pushStr(block, name), ...items.slice(-19, -1), apt.constInt(19)])
          done.add('names')
        } else if (n >= 19 && vals[n - 1] === 18 && vals[n - 2] === 11897431 && vals[n - 19] === 9484461) {
          apt.setPush(at, [...items.slice(0, -19), apt.constInt(color), ...items.slice(-19, -1), apt.constInt(19)])
          done.add('colors')
        } else if (n >= 2 && vals[n - 2] === 'kGlobal_Max_NumChar' && vals[n - 1] === 18) {
          apt.setPush(at, [...items.slice(0, -1), apt.constInt(NEW_ID + 1)])
          done.add('max')
        }
      }
    }
  }
  const missing = ['colors', 'max', 'names'].filter((k) => !done.has(k))
  if (missing.length) throw new LabError(`main movie: lists not found: [${missing.map((m) => `'${m}'`).join(', ')}]`)
  const [a, c] = apt.build()
  return rebuild(files, a, c)
}

export function renameArchive(data: Uint8Array, old: string, next: string): Uint8Array {
  const files = loadArchive(data)
  const out: nbig.ArchiveFile[] = files.map(([n, b]) => {
    if (!n.toLowerCase().startsWith(old.toLowerCase() + '.')) throw new LabError(`unexpected file ${n} in ${old}`)
    return [next + n.slice(old.length), b]
  })
  return nbig.save(out, true, files.tag)
}

export function addBankImages(data: Uint8Array, pictures: Map<string, [string, RgbaImage]> = new Map(), copies: Map<string, string> = new Map()): Uint8Array {
  const bank = gshtool.readGsh(data)
  images.add(bank, pictures)
  const sort = images.isSorted(bank.names)
  for (const [name, template] of copies) {
    if (bank.records.has(name)) throw new LabError(`image ${name} exists`)
    bank.records.set(name, bank.record(template))
    bank.names.push(name)
  }
  if (sort) bank.names.sort(images.compareStrings)
  return gshtool.buildGsh(bank)
}

export function bankImageSize(data: Uint8Array, name: string): [number, number] | null {
  const bank = gshtool.readGsh(data)
  const rec = bank.records.get(name)
  if (!rec) return null
  const pic = new gshtool.Picture(rec)
  return [pic.width, pic.height]
}
