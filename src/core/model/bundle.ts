// A character's model bundle (.ngm, .ngt, .tpl): the base's bundle with its render model replaced by the fitted mesh and its body textures replaced by the new ones.
// Everything else in the base's bundle (hit regions, shadow, extra models such as Magneto's MetalBall.nod, effect textures) is kept.
import { encodeLatin1, f32be, latin1, u16be } from '../bytes'
import { LabError } from '../errors'
import { resizeLanczos } from '../image/resample'
import type { RgbaImage } from '../image/rgba'
import * as gxtex from '../mnroi/gxtex'
import * as ngmtool from '../mnroi/ngmtool'
import type { Vec3 } from './glb'
import type { Tri } from './fit'

const MAX_PALETTE = 20
const UV_LIMIT = 32767

export function unit(a: ArrayLike<number>): Vec3 {
  const n = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1.0
  return [a[0] / n, a[1] / n, a[2] / n]
}

export function readNormals(ngn: Uint8Array): Vec3[] {
  const n = u16be(ngn, 0)
  return Array.from({ length: n }, (_, i) => [f32be(ngn, 2 + 12 * i), f32be(ngn, 6 + 12 * i), f32be(ngn, 10 + 12 * i)] as Vec3)
}

export class NormalIndex {
  t: Vec3[]
  c: number
  grid = new Map<string, number[]>()

  constructor(table: Vec3[], cells = 8) {
    this.t = table
    this.c = cells
    table.forEach((n, i) => {
      const k = this.cell(n).join(',')
      if (!this.grid.has(k)) this.grid.set(k, [])
      this.grid.get(k)!.push(i)
    })
  }

  private cell(n: Vec3): number[] {
    return n.map((x) => Math.floor(((x + 1) * this.c) / 2))
  }

  nearest(n: Vec3): number {
    const [cx, cy, cz] = this.cell(n)
    let best = -2, bi = 0
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const dz of [-1, 0, 1])
          for (const i of this.grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = n[0] * this.t[i][0] + n[1] * this.t[i][1] + n[2] * this.t[i][2]
            if (d > best) {
              best = d
              bi = i
            }
          }
    return bi
  }
}

export class Stats {
  clampedUvs = 0
}

function round4(x: number): string {
  const s = Number.isInteger(x * 32) && Math.abs(x * 32) % 2 === 1 ? (gxtex.roundHalfEven(x * 1e4) / 1e4).toFixed(4) : x.toFixed(4)
  return s === '-0.0000' ? '0.0000' : s
}

function compareLists(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

export function renderModel(base: ngmtool.Model, trisByMat: Map<number, Tri[]>, nidx: NormalIndex, name: string, materials: string[],
  meshFlags: [number, number, number], stats: Stats = new Stats()): ngmtool.Model {
  const verts: number[][] = []
  const dataOf = new Map<string, number>()
  const uvs: [number, number][] = []
  const uvOf = new Map<string, number>()
  const nrmOf = new Map<string, number>()
  const refs: [number, number, number][] = []
  const idx: number[] = []
  const meshes: ngmtool.Mesh[] = []
  let nmap = 0
  const allpos: Vec3[] = []
  for (const mat of [...trisByMat.keys()].sort((a, b) => a - b)) {
    const keyed = trisByMat.get(mat)!.map((t) => [t.flatMap((v) => v[3].map(([b]) => b)).sort((a, b) => a - b), t] as [number[], Tri])
    keyed.sort((a, b) => compareLists(a[0], b[0]))
    const tris = keyed.map((k) => k[1])
    const groups: [Tri[], Set<number>][] = []
    let cur: Tri[] = []
    let curB = new Set<number>()
    for (const t of tris) {
      const tb = new Set(t.flatMap((v) => v[3].map(([b]) => b)))
      if (new Set([...curB, ...tb]).size > MAX_PALETTE) {
        groups.push([cur, curB])
        cur = []
        curB = new Set()
      }
      cur.push(t)
      for (const b of tb) curB.add(b)
    }
    if (cur.length) groups.push([cur, curB])
    for (const [gtris, gbones] of groups) {
      const local = new Map<string, number>()
      const pidx: number[] = []
      for (const t of gtris) {
        for (const [pos, n, uv, w0] of t) {
          const w = [...w0].sort((a, b) => b[1] - a[1])
          const key = JSON.stringify([pos, w])
          if (!dataOf.has(key)) {
            const bones = [...w.map(([b]) => b), ...Array(3 - w.length).fill(w[0][0])]
            const ws = [...w.map(([, x]) => x), ...Array(3 - w.length).fill(0.0)]
            dataOf.set(key, verts.length)
            verts.push([...pos, ...ws, ...bones, 0])
            allpos.push(pos)
          }
          const pi = dataOf.get(key)!
          const nk = `${round4(n[0])},${round4(n[1])},${round4(n[2])}`
          if (!nrmOf.has(nk)) nrmOf.set(nk, nidx.nearest(unit(n)))
          const ni = nrmOf.get(nk)!
          const u = gxtex.roundHalfEven(uv[0] * 512), v = gxtex.roundHalfEven(uv[1] * 512)
          if (!(u >= -UV_LIMIT - 1 && u <= UV_LIMIT) || !(v >= -UV_LIMIT - 1 && v <= UV_LIMIT)) stats.clampedUvs++
          const tk: [number, number] = [Math.max(-32768, Math.min(32767, u)), Math.max(-32768, Math.min(32767, v))]
          const tks = `${tk[0]},${tk[1]}`
          if (!uvOf.has(tks)) {
            uvOf.set(tks, uvs.length)
            uvs.push(tk)
          }
          const mk = `${pi},${ni},${uvOf.get(tks)}`
          if (!local.has(mk)) {
            local.set(mk, nmap + local.size)
            refs.push([pi, ni, uvOf.get(tks)!])
          }
          pidx.push(local.get(mk)!)
        }
      }
      for (const i of pidx) idx.push(i)
      meshes.push([mat, 0, 0, pidx.length, local.size, meshFlags, Uint8Array.from([...gbones].sort((a, b) => a - b))])
      nmap += local.size
    }
  }
  if (nmap > 0xffff || verts.length > 0xffff || uvs.length > 0xffff) throw new LabError("the model has too many vertices for the game's 16-bit indices: simplify it")
  if (!allpos.length) throw new LabError('the model has no triangles left')
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of allpos) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < lo[i]) lo[i] = p[i]
      if (p[i] > hi[i]) hi[i] = p[i]
    }
  }
  const m = base.clone()
  m.name = name
  m.parts = [...materials]
  m.meshes = meshes
  m.bounds = [lo[0], lo[1], lo[2], 0.0, hi[0], hi[1], hi[2], 0.0]
  m.uvs = uvs
  m.indices = idx
  m.streams = [new ngmtool.Stream(2, refs, verts)]
  return m
}

function renamed(model: ngmtool.Model, name: string): ngmtool.Model {
  const m = model.clone()
  m.name = name
  return m
}

// The whole model s times its size about its origin: bones, vertices, attachments and bounds.
export function scaleModel(model: ngmtool.Model, s: number): ngmtool.Model {
  const xyz = <T extends number[]>(v: T): T => v.map((x, i) => (i < 3 ? x * s : x)) as T
  const m = model.clone()
  m.nodes = model.nodes.map(([a, b, parent, x]): ngmtool.Node => [xyz(a), xyz(b), parent, x])
  m.attachments = model.attachments.map(([node, kind, index, mat]): ngmtool.Attachment => [node, kind, index, mat.map((v, i) => (i >= 12 && i < 15 ? v * s : v))])
  m.streams = model.streams.map((st) => new ngmtool.Stream(st.kind, st.refs, st.vertices.map(xyz), st.extra))
  m.bounds = model.bounds.map((v, i) => (i % 4 < 3 ? v * s : v))
  return m
}

export function buildNgm(baseNgm: Uint8Array, render: ngmtool.Model, renames: Map<string, string>, size = 1): [Uint8Array, ngmtool.Model[]] {
  const [head, models] = ngmtool.read(baseNgm)
  let out = [render]
  for (const m of models.slice(1)) {
    const next = renames.get(m.name.toLowerCase())
    out.push(next ? renamed(m, next) : m)
  }
  if (size !== 1) out = out.map((m) => scaleModel(m, size))
  const h = [...head]
  let meshes = 0
  for (const m of out) meshes += m.meshes.length
  h[5] = ngmtool.dataSize(out) - 15 + 52 * meshes + 0x200
  const data = ngmtool.build(h, out)
  ngmtool.read(data)
  return [data, out]
}

export function textureHeader(template: gxtex.TplImage, w: number, h: number): number[] {
  const head = [...template.header]
  head[0] = h
  head[1] = w
  head[2] = gxtex.CMPR
  head[11] = 0
  if (head[6] > 1) head[6] = 1
  return head
}

export function encodeImage(im: RgbaImage, size: [number, number]): Uint8Array {
  const [w, h] = size
  for (const d of [w, h]) {
    if (d < 8 || d > 1024 || d & (d - 1)) throw new LabError(`texture sizes must be powers of two from 8 to 1024, not ${w}x${h}`)
  }
  if (im.width !== w || im.height !== h) im = resizeLanczos(im, w, h)
  return gxtex.encode(gxtex.CMPR, im.bytes(), w, h)
}

export function buildTpl(baseTpl: Uint8Array, baseNgt: Uint8Array, textures: [string, RgbaImage, [number, number]][], keep: string[],
  extra: [string, gxtex.TplImage][] = []): [Uint8Array, Uint8Array] {
  const [images] = gxtex.readTpl(baseTpl)
  const names = latin1(baseNgt).split(/\s+/).filter(Boolean)
  const template = images[0]
  const out: gxtex.TplImage[] = []
  const outNames: string[] = []
  for (const [name, im, size] of textures) {
    out.push(new gxtex.TplImage(textureHeader(template, size[0], size[1]), encodeImage(im, size)))
    outNames.push(name)
  }
  const keepSet = new Set(keep.map((k) => k.toLowerCase()))
  names.forEach((name, i) => {
    if (i < images.length && keepSet.has(name.toLowerCase()) && !outNames.includes(name)) {
      out.push(new gxtex.TplImage(images[i].header, images[i].data))
      outNames.push(name)
    }
  })
  for (const [name, im] of extra) {
    if (!outNames.includes(name)) {
      out.push(new gxtex.TplImage(im.header, im.data))
      outNames.push(name)
    }
  }
  const ngt = encodeLatin1(outNames.map((n) => n + '\r\n').join(''))
  return [gxtex.buildTpl(out), ngt]
}
