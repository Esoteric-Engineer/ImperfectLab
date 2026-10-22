// Select-screen and loading-screen portraits for a new select-screen id (18 to 26, one per new character). Johnny Ohm's portrait movies (id 4) are the template regardless of base due to their sizing.
import { f32be } from '../bytes'
import { LabError } from '../errors'
import { gaussianBlurL } from '../image/filters'
import { resizeLanczos } from '../image/resample'
import { compositeL, multiply, RgbaImage } from '../image/rgba'
import { Apt } from '../mnroi/apt'
import * as gshtool from '../mnroi/gshtool'
import * as nbig from '../mnroi/nbig'
import type { GameSource } from '../game/source'
import { roundHalfEven } from '../mnroi/gxtex'
import * as images from './images'
import { type Archive, loadArchive, NEW_ID, P, renameArchive } from './ui'

const TEMPLATE_ID = 4
// each select-screen pose (REST, READY, READYALT) is its own texture and draws its own picture
const POSE_TEX: Record<string, string> = { '1': 'rest', '6': 'ready', '10': 'readyalt' }
export const POSES = ['rest', 'ready', 'readyalt'] as const
// where the picture's anchor pixel (the face) lands on the READY canvas
const FACE_AT = [138, 90]
// the canvases start mid-panel, so this many top rows fade in
export const FADE = 36

export type Rgba = [number, number, number, number]

export function archiveName(kind: 'c' | 'cvs', selectId: number, alt = false): string {
  return kind === 'cvs' ? `${P}portraits/cvs${selectId}${alt ? '_alt' : ''}.big` : `${P}portraits/c${selectId}_p0.big`
}

interface Piece {
  rid: number
  tex: string
  s: number
  t: [number, number]
  x0: number
  y0: number
  x1: number
  y1: number
}

function geoPieces(geo: Uint8Array): Piece[][] {
  const out: Piece[][] = []
  for (const [rid, shapes] of gshtool.readGeo(geo)) {
    const pieces: Piece[] = []
    for (const items of shapes) {
      const tex = items.find((it) => it.kind === 'texture')
      const pts = items.filter((it) => it.kind === 'triangle').flatMap((it) => (it as { points: number[][] }).points.map((p) => p.slice(0, 2)))
      if (!tex || tex.kind !== 'texture' || !pts.length) continue
      const m = tex.matrix
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
      pieces.push({ rid, tex: String(tex.tex), s: m[0], t: [m[12], m[13]], x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    }
    if (pieces.length) out.push(pieces)
  }
  return out
}

function shapeOffsets(aptBytes: Uint8Array, constBytes: Uint8Array): Map<number, [number, number]> {
  const apt = new Apt(aptBytes, constBytes)
  const movie = apt.aptOff
  const out = new Map<number, [number, number]>()
  for (let f = 0; f < apt.u32(movie + 8); f++) {
    for (const [it] of apt.framePlaces(movie, f)) {
      const c = apt.u32(it + 12)
      if (c === 0xffffffff || apt.u32(apt.character(c)) !== 5) continue
      for (const [it2] of apt.framePlaces(apt.character(c), 0)) {
        const shp = apt.character(apt.u32(it2 + 12))
        if (apt.u32(shp) === 1) {
          const x = f32be(apt.d, it + 32), y = f32be(apt.d, it + 36)
          const x2 = f32be(apt.d, it2 + 32), y2 = f32be(apt.d, it2 + 36)
          const key = apt.u32(shp + 24)
          if (!out.has(key)) out.set(key, [x + x2, y + y2])
        }
      }
    }
  }
  return out
}

export function canvasOf(pieces: Piece[]): [number, number, number, number, number] {
  const s = pieces[0].s
  const X0 = Math.min(...pieces.map((p) => p.x0)), Y0 = Math.min(...pieces.map((p) => p.y0))
  const X1 = Math.max(...pieces.map((p) => p.x1)), Y1 = Math.max(...pieces.map((p) => p.y1))
  return [s, X0, Y0, roundHalfEven((X1 - X0) * s), roundHalfEven((Y1 - Y0) * s)]
}

const fileMap = (files: Archive) => new Map(files)

export class SelectLayout {
  files: Archive
  src: string
  records: Piece[][]
  offsets: Map<number, [number, number]>
  bank: gshtool.Bank
  sR: number
  X0R: number
  Y0R: number
  face: [number, number]

  constructor(source: GameSource) {
    this.src = `c${TEMPLATE_ID}_p0`
    this.files = loadArchive(source.entry(archiveName('c', TEMPLATE_ID)))
    const f = fileMap(this.files)
    this.records = geoPieces(f.get(this.src + '.geo')!)
    this.offsets = shapeOffsets(f.get(this.src + '.apt')!, f.get(this.src + '.const')!)
    this.bank = gshtool.readGsh(f.get(this.src + '.gsh')!)
    const ready = this.records.find((r) => r.some((p) => p.tex === '6'))!
    ;[this.sR, this.X0R, this.Y0R] = this.screenBox(ready)
    // FACE_AT on the READY canvas, in panel units, so every pose puts the face in the same place
    this.face = [this.X0R + FACE_AT[0] / this.sR, this.Y0R + FACE_AT[1] / this.sR]
  }

  screenBox(pieces: Piece[]): [number, number, number, number, number] {
    const [s, X0, Y0, W, H] = canvasOf(pieces)
    const [ox, oy] = this.offsets.get(pieces[0].rid) ?? [0.0, 0.0]
    return [s, X0 + ox, Y0 + oy, W, H]
  }

  poseOf(pieces: Piece[]): string | null {
    const p = pieces.find((x) => x.tex in POSE_TEX)
    return p ? POSE_TEX[p.tex] : null
  }

  canvases(): [number, string, [number, number]][] {
    const out: [number, string, [number, number]][] = []
    this.records.forEach((pieces, i) => {
      const pose = this.poseOf(pieces)
      if (pose) {
        const c = canvasOf(pieces)
        out.push([i, pose, [c[3], c[4]]])
      }
    })
    return out
  }

  original(pose: string): RgbaImage | null {
    for (const pieces of this.records) {
      if (this.poseOf(pieces) !== pose) continue
      const [s, X0, Y0, W, H] = canvasOf(pieces)
      const canvas = new RgbaImage(W, H)
      for (const p of pieces) {
        const rec = this.bank.record(p.tex)
        const pic = new gshtool.Picture(rec)
        const im = new RgbaImage(pic.width, pic.height, pic.decode(rec))
        canvas.pasteMasked(im, -roundHalfEven(p.t[0] + X0 * s), -roundHalfEven(p.t[1] + Y0 * s), im.alpha(), im.width)
      }
      return canvas
    }
    return null
  }

  compose(i: number, picture: RgbaImage, scale: number, anchor: [number, number], glow: Rgba | null = null, fade = FADE): RgbaImage {
    const [s, X0, Y0, W, H] = this.screenBox(this.records[i])
    // scale the picture by `scale`
    const perPx = scale / this.sR
    const w = Math.max(1, roundHalfEven(picture.width * perPx * s)), h = Math.max(1, roundHalfEven(picture.height * perPx * s))
    const pic = resizeLanczos(picture, w, h)
    // place it so its anchor pixel lands on the face point
    let canvas = new RgbaImage(W, H)
    canvas.paste(pic, roundHalfEven((this.face[0] - anchor[0] * perPx - X0) * s), roundHalfEven((this.face[1] - anchor[1] * perPx - Y0) * s))
    if (glow) {
      const a = gaussianBlurL(canvas.alpha(), W, H, 6)
      const g = RgbaImage.filled(W, H, glow)
      g.putAlpha(a.map((v) => Math.min(255, v * 2)))
      g.alphaComposite(canvas)
      canvas = g
    }
    // fade in the top rows with a linear alpha ramp
    const n = roundHalfEven((fade * s) / this.sR)
    if (n > 0) {
      const ramp = new Uint8Array(W * H).fill(255)
      for (let y = 0; y < Math.min(n, H); y++) ramp.fill(Math.floor((255 * y) / n), y * W, (y + 1) * W)
      canvas.putAlpha(multiply(canvas.alpha(), ramp))
    }
    return canvas
  }

  build(poses: Map<string, [RgbaImage, number, [number, number], Rgba | null]>, fade = FADE, id = NEW_ID): Uint8Array {
    const bank = gshtool.readGsh(fileMap(this.files).get(this.src + '.gsh')!)
    this.records.forEach((pieces, i) => {
      const pose = this.poseOf(pieces)
      if (pose === null || !poses.has(pose)) return
      // redraw this pose's canvas from its own picture, then write it back over the template's textures in place
      const [picture, scale, anchor, glow] = poses.get(pose)!
      const canvas = this.compose(i, picture, scale, anchor, glow, fade)
      const [s, X0, Y0] = canvasOf(pieces)
      for (const p of pieces) {
        const pic = new gshtool.Picture(bank.record(p.tex))
        const img = new RgbaImage(pic.width, pic.height)
        img.paste(canvas, roundHalfEven(p.t[0] + X0 * s), roundHalfEven(p.t[1] + Y0 * s))
        bank.records.set(p.tex, images.encode(bank.record(p.tex), img))
      }
    })
    const out: nbig.ArchiveFile[] = this.files.map(([n, b]) => [n, n.toLowerCase().endsWith('.gsh') ? gshtool.buildGsh(bank) : b])
    // rename the archive's files to the new select-screen id
    const name = `c${id}_p0`
    return nbig.save(out.map(([n, b]) => [name + n.slice(this.src.length), b]), true, this.files.tag)
  }
}

function stripBank(source: GameSource, alt: boolean): [Archive, gshtool.Bank, string] {
  const src = `cvs${TEMPLATE_ID}${alt ? '_alt' : ''}`
  const files = loadArchive(source.entry(archiveName('cvs', TEMPLATE_ID, alt)))
  return [files, gshtool.readGsh(fileMap(files).get(src + '.gsh')!), src]
}

export function stripSizes(source: GameSource, alt = false): [number, number][] {
  const [, bank] = stripBank(source, alt)
  return bank.names.map((n) => new gshtool.Picture(bank.record(n))).map((p) => [p.width, p.height] as [number, number]).sort((a, b) => b[0] - a[0])
}

export function stripCrop(source: GameSource, picture: RgbaImage, anchor: [number, number], scale: number, alt = false): RgbaImage[] {
  const [, bank] = stripBank(source, alt)
  const pics = bank.names.map((n) => [n, new gshtool.Picture(bank.record(n))] as [string, gshtool.Picture]).sort((a, b) => b[1].width - a[1].width)
  const outlines = pics.map(([n, p]) => new RgbaImage(p.width, p.height, p.decode(bank.record(n))))
  let W = 0
  for (const o of outlines) W += o.width
  const H = outlines[0].height
  const bw = W / scale, bh = H / scale
  const box: [number, number, number, number] = [anchor[0] - bw * 0.5, anchor[1] - bh * 0.45, anchor[0] + bw * 0.5, anchor[1] + bh * 0.55]
  const face = images.cropResize(picture, box, [W, H])
  const out: RgbaImage[] = []
  let x = 0
  for (const o of outlines) {
    const part = face.crop(x, 0, x + o.width, H)
    part.putAlpha(compositeL(part.alpha(), new Uint8Array(o.width * H), o.alpha()))
    out.push(part)
    x += o.width
  }
  return out
}

export function loadingArchive(source: GameSource, strips: RgbaImage[], alt = false, id = NEW_ID): Uint8Array {
  const [files, bank, src] = stripBank(source, alt)
  const names = [...bank.names].sort((a, b) => new gshtool.Picture(bank.record(b)).width - new gshtool.Picture(bank.record(a)).width)
  names.forEach((n, i) => {
    const im = strips[i]
    if (!im) return
    const pic = new gshtool.Picture(bank.record(n))
    if (im.width !== pic.width || im.height !== pic.height) throw new LabError(`a loading-screen strip is ${im.width}x${im.height}, not ${pic.width}x${pic.height}`)
    bank.records.set(n, images.encode(bank.record(n), im))
  })
  // strips are redrawn in place, then the archive is renamed to the new select-screen id
  const out: nbig.ArchiveFile[] = files.map(([n, b]) => [n, n.toLowerCase().endsWith('.gsh') ? gshtool.buildGsh(bank) : b])
  const name = `cvs${id}${alt ? '_alt' : ''}`
  return nbig.save(out.map(([n, b]) => [name + n.slice(src.length), b]), true, files.tag)
}

// the base's own portrait archives, untouched but renamed to the new select-screen id
export function renamed(source: GameSource, selectId: number, id = NEW_ID): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  for (const [kind, alt, old] of [['c', false, `c${selectId}_p0`], ['cvs', false, `cvs${selectId}`], ['cvs', true, `cvs${selectId}_alt`]] as ['c' | 'cvs', boolean, string][]) {
    const data = source.entry(archiveName(kind, selectId, alt))
    const next = kind === 'c' ? `c${id}_p0` : `cvs${id}${alt ? '_alt' : ''}`
    out.set(archiveName(kind, id, alt), renameArchive(data, old, next))
  }
  return out
}
