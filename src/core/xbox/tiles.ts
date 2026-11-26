import { LabError } from '../errors'
import { RgbaImage } from '../image'
import { Apt as AptBE } from '../mnroi/apt'
import * as gshtool from '../mnroi/gshtool'
import * as nbig from '../mnroi/nbig'
import { Apt } from './aptle'
import { type ArchiveFile, parseBig, saveBig } from './big'
import * as SX from './shpx'

export interface Movie { files: ArchiveFile[]; tag: Uint8Array; d: Map<string, Uint8Array>; apt: Apt }
export function openTiles(data: Uint8Array): Movie {
  const [files, tag] = parseBig(data)
  const d = new Map<string, Uint8Array>()
  for (const [n, b] of files) d.set(n.split('.').pop()!.toLowerCase(), b)
  if (!d.get('apt') || !d.get('const')) throw new LabError('the movie archive has no .apt or .const')
  return { files, tag, d, apt: new Apt(d.get('apt')!, d.get('const')!) }
}
export function saveTiles(m: Movie): Uint8Array {
  const [a, c] = m.apt.build()
  return saveBig(m.files.map(([n, b]) => { const e = n.split('.').pop()!.toLowerCase(); return [n, e === 'apt' ? a : e === 'const' ? c : b] }), m.tag)
}

// a select-screen tile's two picture records
export function tileImages(data: Uint8Array, id: number): [number, number] {
  const m = openTiles(data), apt = m.apt, ex = new Map(apt.exports())
  if (!ex.has(`char${id}`)) throw new LabError(`no tile char${id}`)
  const recs = gshtool.readGeo(m.d.get('geo')!), sprite = apt.character(ex.get(`char${id}`)!), out: number[] = [], seen = new Set<number>()
  for (let f = 0; f < apt.u32(sprite + 8); f++) for (const [it] of apt.framePlaces(sprite, f)) {
    const sh = apt.u32(it + 12); if (seen.has(sh)) continue; seen.add(sh)
    const geoId = apt.u32(apt.character(sh) + 24), rec = recs.find(([r]) => r === geoId)
    const tex = rec?.[1].flat().find((x) => x.kind === 'texture') as { tex: number } | undefined
    if (!tex) throw new LabError(`tile ${id}: a shape without a picture`)
    out.push(tex.tex)
  }
  if (out.length !== 2) throw new LabError(`tile ${id}: ${out.length} pictures, expected 2`)
  return [out[0], out[1]]
}
export function tileRecord(data: Uint8Array, imageId: number): Uint8Array { return SX.readBank(openTiles(data).d.get('xsh')!).recs.get(String(imageId))! }

export function tilePictures(thumbs: Uint8Array, id: number): [RgbaImage, RgbaImage] {
  const m = openTiles(thumbs), apt = m.apt, ex = new Map(apt.exports())
  const recs = gshtool.readGeo(m.d.get('geo')!), bank = SX.readBank(m.d.get('xsh')!)
  const f32 = (o: number) => new DataView(apt.d.buffer, apt.d.byteOffset).getFloat32(o, true)
  type Piece = { inv: number[]; tris: number[][][]; solid?: number[]; tex?: { im: RgbaImage; sx: number; sy: number } }
  const frame = (sprite: number, f: number): Piece[] => {
    const out: Piece[] = []
    for (const [it] of apt.framePlaces(sprite, f)) {
      const shp = apt.character(apt.u32(it + 12)); if (apt.u32(shp) !== 1) continue
      const [a, b, c, d, tx, ty] = [16, 20, 24, 28, 32, 36].map((o) => f32(it + o)), det = a * d - b * c
      if (!det) continue
      const inv = [d / det, -b / det, -c / det, a / det, tx, ty]   // sprite point -> shape point
      const rec = recs.find(([r]) => r === apt.u32(shp + 24)); if (!rec) continue
      for (const piece of rec[1]) {
        const tris = piece.filter((x) => x.kind === 'triangle').map((x) => (x as { points: number[][] }).points)
        const solid = piece.find((x) => x.kind === 'solid') as { color: number } | undefined
        const tex = piece.find((x) => x.kind === 'texture') as { tex: number; matrix: number[] } | undefined
        if (tex) out.push({ inv, tris, tex: { im: SX.decodeRecord(bank.recs.get(String(tex.tex))!), sx: tex.matrix[0], sy: tex.matrix[5] } })
        else if (solid) out.push({ inv, tris, solid: [(solid.color >>> 16) & 255, (solid.color >>> 8) & 255, solid.color & 255, solid.color >>> 24] })
      }
    }
    return out
  }
  const inTri = (t: number[][], x: number, y: number) => {
    const s = (i: number, j: number) => (t[j][0] - t[i][0]) * (y - t[i][1]) - (t[j][1] - t[i][1]) * (x - t[i][0])
    const a = s(0, 1), b = s(1, 2), c = s(2, 0)
    return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)
  }
  const sample = (im: RgbaImage, u: number, v: number): number[] => {
    const x = Math.min(Math.max(u - 0.5, 0), im.width - 1), y = Math.min(Math.max(v - 0.5, 0), im.height - 1)
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, im.width - 1), y1 = Math.min(y0 + 1, im.height - 1), fx = x - x0, fy = y - y0
    const px = (xx: number, yy: number, k: number) => im.data[4 * (yy * im.width + xx) + k]
    return [0, 1, 2, 3].map((k) => (px(x0, y0, k) * (1 - fx) + px(x1, y0, k) * fx) * (1 - fy) + (px(x0, y1, k) * (1 - fx) + px(x1, y1, k) * fx) * fy)
  }
  
  const mold = frame(apt.character(ex.get('char4')!), 0).find((p) => p.tex)
  if (!mold?.tex) throw new LabError('the select screen: the mold tile (char4) has no picture')
  const W = mold.tex.im.width, H = mold.tex.im.height
  if (!ex.has(`char${id}`)) throw new LabError(`no tile char${id}`)
  const sprite = apt.character(ex.get(`char${id}`)!)
  const draw = (f: number): RgbaImage => {
    const pieces = frame(sprite, f), out = new RgbaImage(W, H)
    const [ma, mb, mc, md, mtx, mty] = mold.inv
    const mdet = ma * md - mb * mc
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const qx = (x + 0.5) / mold.tex!.sx, qy = (y + 0.5) / mold.tex!.sy
      const px = (md * qx - mb * qy) / mdet + mtx, py = (-mc * qx + ma * qy) / mdet + mty
      let r = 0, g = 0, b = 0, a = 0
      for (const p of pieces) {
        const dx = px - p.inv[4], dy = py - p.inv[5], sx = p.inv[0] * dx + p.inv[1] * dy, sy = p.inv[2] * dx + p.inv[3] * dy
        if (!p.tris.some((t) => inTri(t, sx, sy))) continue
        const c = p.tex ? sample(p.tex.im, sx * p.tex.sx, sy * p.tex.sy) : p.solid!
        const sa = c[3] / 255, na = sa + a * (1 - sa)
        if (na > 0) { r = (c[0] * sa + r * a * (1 - sa)) / na; g = (c[1] * sa + g * a * (1 - sa)) / na; b = (c[2] * sa + b * a * (1 - sa)) / na }
        a = na
      }
      out.data.set([Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)], 4 * (y * W + x))
    }
    return out
  }
  return [draw(0), draw(1)]
}

export function gcArchive(d: Uint8Array): Map<string, Uint8Array> { return new Map(nbig.load(d).map(([n, b]) => [n.split('.').pop()!.toLowerCase(), b])) }
export function gcPictures(gsh: Uint8Array, only?: (n: string) => boolean): Map<string, RgbaImage> {
  const bank = gshtool.readGsh(gsh); const out = new Map<string, RgbaImage>()
  for (const n of bank.names) { if (only && !only(n)) continue; const p = new gshtool.Picture(bank.record(n)); out.set(n, new RgbaImage(p.width, p.height, p.decode(bank.record(n)))) }
  return out
}

export function gcTilePictures(thumbs: Uint8Array, id: number, baseSelect: number): [RgbaImage, RgbaImage] | null {
  const g = gcArchive(thumbs); const apt = new AptBE(g.get('apt')!, g.get('const')!)
  const ex = new Map(apt.exports())
  if (ex.get(`char${id}`) === ex.get(`char${baseSelect}`)) return null
  const recs = gshtool.readGeo(g.get('geo')!); const bank = gshtool.readGsh(g.get('gsh')!)
  const sprite = apt.character(ex.get(`char${id}`)!); const pics: RgbaImage[] = []; const seen = new Set<number>()
  for (let f = 0; f < apt.u32(sprite + 8); f++) for (const [it] of apt.framePlaces(sprite, f)) {
    const sh = apt.u32(it + 12); if (seen.has(sh)) continue; seen.add(sh)
    const geoId = apt.u32(apt.character(sh) + 24); const rec = recs.find(([r]) => r === geoId)
    const tex = rec?.[1].flat().find((x) => x.kind === 'texture') as { tex: number } | undefined
    if (!tex) throw new LabError(`tile ${id}: shape without a texture`)
    const p = new gshtool.Picture(bank.record(String(tex.tex))); pics.push(new RgbaImage(p.width, p.height, p.decode(bank.record(String(tex.tex)))))
  }
  if (pics.length !== 2) throw new LabError(`tile ${id}: ${pics.length} pictures`)
  return [pics[0], pics[1]]
}