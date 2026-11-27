// GameCube .ngm (big-endian, indexed) to Xbox .nmb (little-endian, expanded vertices).
import { LabError } from '../errors'
import { Rd, Wr } from './bin'

interface GcStream { kind: number; refs: Uint16Array; verts: number[][]; extra: Uint8Array | null }
interface Mesh { part: number; stream: number; strips: number; lists: number; render: number; fl: number[]; nodes: Uint8Array }
interface GcModel {
  index: number; name: string; flags: number; bounds: number[]; bRaw: Uint8Array; streams: GcStream[]; uvs: Int16Array; indices: Uint16Array
  parts: string[]; nodes: [Uint8Array, number, number][]; chains: [number, number]; meshes: Mesh[]; attachments: [number, number, number, Uint8Array][]
}

function readGc(d: Uint8Array): [number[], GcModel[]] {
  const r = new Rd(d, false); const head = Array.from({ length: 6 }, () => r.u32()); const models: GcModel[] = []
  for (let mi = 0; mi < head[3]; mi++) {
    const index = r.i32(), nparts = r.u8(), nnodes = r.u8(), nmeshes = r.u8(), natt = r.u16()
    const name = r.name32(), ns = r.u8(), flags = r.u32(), bounds = Array.from({ length: 8 }, () => r.f32())
    const bRaw = d.subarray(r.o - 32, r.o)
    const streams: GcStream[] = []
    for (let s = 0; s < ns; s++) {
      const kind = r.u8(), n = r.u32(); const refs = new Uint16Array(3 * n)
      for (let i = 0; i < 3 * n; i++) refs[i] = r.u16()
      const nv = r.u16(); const verts: number[][] = []
      for (let i = 0; i < nv; i++) {
        const k = kind % 3; const v = [r.f32(), r.f32(), r.f32()]
        if (k === 1) v.push(r.u32())
        if (k === 2) v.push(r.f32(), r.f32(), r.f32(), r.u8(), r.u8(), r.u8(), r.u8())
        verts.push(v)
      }
      streams.push({ kind, refs, verts, extra: kind > 2 ? r.raw(6 * n) : null })
    }
    const nuv = r.u16(); const uvs = new Int16Array(2 * nuv)
    for (let i = 0; i < 2 * nuv; i++) uvs[i] = r.i16()
    const ni = r.u32(); const indices = new Uint16Array(ni)
    for (let i = 0; i < ni; i++) indices[i] = r.u16()
    const parts = Array.from({ length: nparts }, () => r.name32())
    const nodes: [Uint8Array, number, number][] = Array.from({ length: nnodes }, () => [r.raw(32), r.i8(), r.u8()])
    const chains: [number, number] = [r.u16(), r.u16()]
    const meshes: Mesh[] = []
    for (let i = 0; i < nmeshes; i++) {
      const part = r.i32(), stream = r.u8(), strips = r.u16(), lists = r.u16(), render = r.u16(); const fl = [r.u8(), r.u8(), r.u8()]; const nn = r.u8()
      meshes.push({ part, stream, strips, lists, render, fl, nodes: r.raw(nn) })
    }
    const attachments: [number, number, number, Uint8Array][] = Array.from({ length: natt }, () => [r.u8(), r.u8(), r.u16(), r.raw(64)])
    models.push({ index, name, flags, bounds, bRaw, streams, uvs, indices, parts, nodes, chains, meshes, attachments })
  }
  if (r.o !== d.length) throw new LabError(`.ngm parse ends at 0x${r.o.toString(16)} of 0x${d.length.toString(16)}`)
  return [head, models]
}

export function readNormalTable(ngn: Uint8Array): Float32Array {
  const r = new Rd(ngn, false); const n = r.u16(); const out = new Float32Array(3 * n)
  for (let i = 0; i < 3 * n; i++) out[i] = r.f32()
  return out
}

// nodes: x,y,z swapped, w copied raw (GameCube stores it little-endian already)
function swapVec4s(raw: Uint8Array): Uint8Array {
  const o = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 16) {
    for (let k = 0; k < 12; k += 4) for (let b = 0; b < 4; b++) o[i + k + b] = raw[i + k + 3 - b]
    o.set(raw.subarray(i + 12, i + 16), i + 12)
  }
  return o
}
const swapAll = (raw: Uint8Array) => { const o = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 4) for (let b = 0; b < 4; b++) o[i + b] = raw[i + 3 - b]; return o }
const xflags = (f: number) => ((f & 0xff) | 0xa00 | (f & 0x4000)) >>> 0

export function ngmToNmb(gc: Uint8Array, normals: Float32Array, rename?: (name: string) => string): Uint8Array {
  const [head, models] = readGc(gc)
  const w = new Wr(true, gc.length * 3)
  const runtime = models.reduce((s, m) => s + 408 + 80 * m.attachments.length + 48 * m.nodes.length + 84 * m.meshes.length + 4 * m.parts.length, 0)
  for (const v of [head[0], head[1], head[2], models.length, head[4], runtime]) w.u32(v)
  for (const m of models) {
    for (const s of m.streams) if (s.kind > 2) throw new LabError(`${m.name}: tangent-space (bump) streams are not converted`)
    w.i32(m.index).u8(m.parts.length).u8(m.nodes.length).u8(m.meshes.length).u16(m.attachments.length)
    w.name32(rename ? rename(m.name) : m.name).u8(m.streams.length).u32(xflags(m.flags))
    // bounds: the GameCube's little-endian 1.0 in each w becomes 0
    const bRaw = m.bRaw
    for (let i = 0; i < 8; i++) {
      const isLeOne = i % 4 === 3 && bRaw[4 * i] === 0 && bRaw[4 * i + 1] === 0 && bRaw[4 * i + 2] === 0x80 && bRaw[4 * i + 3] === 0x3f
      w.f32(isLeOne ? 0 : m.bounds[i])
    }
    // each stream's vertices belong to its meshes in order; a mesh's bones are indices into its node palette
    const pal = new Map<number, Uint8Array[]>()
    for (const me of m.meshes) { const l = pal.get(me.stream) ?? []; for (let i = 0; i < me.render; i++) l.push(me.nodes); pal.set(me.stream, l) }
    m.streams.forEach((s, si) => {
      const n = s.refs.length / 3; const palette = pal.get(si) ?? []
      w.u8(s.kind).u32(n)
      for (let vi = 0; vi < n; vi++) {
        const v = s.verts[s.refs[3 * vi]], ni = s.refs[3 * vi + 1], ui = s.refs[3 * vi + 2]
        w.f32(v[0]).f32(v[1]).f32(v[2]).f32(normals[3 * ni]).f32(normals[3 * ni + 1]).f32(normals[3 * ni + 2]).f32(m.uvs[2 * ui] / 512).f32(m.uvs[2 * ui + 1] / 512)
        const p = palette[vi] ?? new Uint8Array(0); const local = (b: number) => { const k = p.indexOf(b); return k < 0 ? 0 : k }
        if (s.kind % 3 === 1) w.u32(local(v[3]))
        if (s.kind % 3 === 2) {
          const ws = [v[3], v[4], v[5], 1 - v[3] - v[4] - v[5]]
          w.f32(v[3]).f32(v[4]).f32(v[5])
          for (let j = 0; j < 4; j++) w.u8(j === 0 || ws[j] !== 0 ? local(v[6 + j]) : 0)
        }
      }
    })
    w.u32(m.indices.length)
    let pos = 0; const base = new Map<number, number>()
    for (const me of m.meshes) {
      const b = base.get(me.stream) ?? 0, n = me.strips + me.lists
      for (let i = 0; i < n; i++) w.u16(m.indices[pos + i] - b)
      pos += n; base.set(me.stream, b + me.render)
    }
    if (pos !== m.indices.length) throw new LabError(`${m.name}: the meshes do not cover the index list`)
    for (const p of m.parts) w.name32(p)
    for (const [a, parent, x] of m.nodes) w.bytes(swapVec4s(a)).i8(parent).u8(x)
    w.u16(m.chains[0]).u16(m.chains[1])
    for (const me of m.meshes) { w.i32(me.part).u8(me.stream).u16(me.strips).u16(me.lists).u16(me.render); me.fl.forEach((f) => w.u8(f)); w.u8(me.nodes.length).bytes(me.nodes) }
    for (const [node, kind, i, mat] of m.attachments) w.u8(node).u8(kind).u16(i).bytes(swapAll(mat))
    w.u8(0)
  }
  return w.finish()
}