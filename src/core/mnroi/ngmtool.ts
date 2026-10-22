// Model bundles (Bundles/<name>.ngm), ported from mnroi tools/ngmtool.py (commit a23c796).
// Big-endian. Per model: a prefix record, then name, streams of render vertices (vertex, normal,
// UV indices) and vertices, UVs (s16 with 9 fraction bits), indices, part (material) names, nodes
// (offset a, position -b, parent), meshes and attachments.
import { ByteWriter, cstring, f32be, i8, i16be, i32be, u16be, u32be } from '../bytes'
import { LabError } from '../errors'

export const STRIDE = [0xc, 0x10, 0x1c, 0xc, 0x10, 0x1c, 0, 0]

export type Vec4 = [number, number, number, number]
export type Node = [Vec4, Vec4, number, number]
export type Mesh = [number, number, number, number, number, [number, number, number], Uint8Array]
export type Attachment = [number, number, number, number[]]

export class Stream {
  kind: number
  refs: [number, number, number][]
  vertices: number[][]
  extra: Uint8Array | null

  constructor(kind: number, refs: [number, number, number][], vertices: number[][], extra: Uint8Array | null = null) {
    this.kind = kind
    this.refs = refs
    this.vertices = vertices
    this.extra = extra
  }
}

export class Model {
  index = -1
  name = ''
  flags = 0
  bounds: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  streams: Stream[] = []
  uvs: [number, number][] = []
  indices: number[] = []
  parts: string[] = []
  nodes: Node[] = []
  chains: [number, number] = [0, 0]
  meshes: Mesh[] = []
  attachments: Attachment[] = []

  clone(): Model {
    return Object.assign(new Model(), this)
  }
}

class Reader {
  data: Uint8Array
  off: number

  constructor(data: Uint8Array, off: number) {
    this.data = data
    this.off = off
  }

  need(n: number) {
    if (this.off + n > this.data.length) throw new LabError('body runs past the end of the file')
  }

  u8() { this.need(1); return this.data[this.off++] }
  s8() { this.need(1); return i8(this.data, this.off++) }
  u16() { this.need(2); const v = u16be(this.data, this.off); this.off += 2; return v }
  s16() { this.need(2); const v = i16be(this.data, this.off); this.off += 2; return v }
  u32() { this.need(4); const v = u32be(this.data, this.off); this.off += 4; return v }
  s32() { this.need(4); const v = i32be(this.data, this.off); this.off += 4; return v }
  f32() { this.need(4); const v = f32be(this.data, this.off); this.off += 4; return v }
  name() { this.need(32); const s = cstring(this.data, this.off, this.off + 32); this.off += 32; return s }
  bytes(n: number) { this.need(n); const v = this.data.slice(this.off, this.off + n); this.off += n; return v }
}

function readVertex(r: Reader, kind: number): number[] {
  const k = kind % 3
  const v = [r.f32(), r.f32(), r.f32()]
  if (k === 1) v.push(r.u32())
  if (k === 2) v.push(r.f32(), r.f32(), r.f32(), r.u8(), r.u8(), r.u8(), r.u8())
  return v
}

function writeVertex(out: ByteWriter, kind: number, v: number[]) {
  const k = kind % 3
  out.f32be(v[0]).f32be(v[1]).f32be(v[2])
  if (k === 1) out.u32be(v[3])
  if (k === 2) out.f32be(v[3]).f32be(v[4]).f32be(v[5]).byte(v[6]).byte(v[7]).byte(v[8]).byte(v[9])
}

function readModel(r: Reader): Model {
  const m = new Model()
  m.index = r.s32()
  const parts = r.u8(), nodes = r.u8(), meshes = r.u8(), attachments = r.u16()
  m.name = r.name()
  const streams = r.u8()
  m.flags = r.u32()
  m.bounds = Array.from({ length: 8 }, () => r.f32())
  for (let s = 0; s < streams; s++) {
    const kind = r.u8(), n = r.u32()
    const refs: [number, number, number][] = []
    for (let i = 0; i < n; i++) refs.push([r.u16(), r.u16(), r.u16()])
    const nv = r.u16()
    const verts: number[][] = []
    for (let i = 0; i < nv; i++) verts.push(readVertex(r, kind))
    m.streams.push(new Stream(kind, refs, verts, kind > 2 ? r.bytes(n * 6) : null))
  }
  const nuv = r.u16()
  for (let i = 0; i < nuv; i++) m.uvs.push([r.s16(), r.s16()])
  const ni = r.u32()
  r.need(ni * 2)
  for (let i = 0; i < ni; i++) m.indices.push(r.u16())
  for (let i = 0; i < parts; i++) m.parts.push(r.name())
  for (let i = 0; i < nodes; i++) {
    const a: Vec4 = [r.f32(), r.f32(), r.f32(), r.f32()]
    const b: Vec4 = [r.f32(), r.f32(), r.f32(), r.f32()]
    m.nodes.push([a, b, r.s8(), r.u8()])
  }
  m.chains = [r.u16(), r.u16()]
  for (let i = 0; i < meshes; i++) {
    const part = r.s32(), stream = r.u8(), strips = r.u16(), lists = r.u16(), render = r.u16()
    const flags: [number, number, number] = [r.u8(), r.u8(), r.u8()]
    m.meshes.push([part, stream, strips, lists, render, flags, r.bytes(r.u8())])
  }
  for (let i = 0; i < attachments; i++) {
    const node = r.u8(), kind = r.u8(), index = r.u16()
    m.attachments.push([node, kind, index, Array.from({ length: 16 }, () => r.f32())])
  }
  return m
}

function writeName(out: ByteWriter, s: string) {
  const b = new Uint8Array(32)
  for (let i = 0; i < Math.min(32, s.length); i++) b[i] = s.charCodeAt(i) & 255
  out.bytes(b)
}

function writeModel(out: ByteWriter, m: Model) {
  out.u32be(m.index >>> 0).byte(m.parts.length).byte(m.nodes.length).byte(m.meshes.length).u16be(m.attachments.length)
  writeName(out, m.name)
  out.byte(m.streams.length).u32be(m.flags)
  for (const v of m.bounds) out.f32be(v)
  for (const st of m.streams) {
    out.byte(st.kind).u32be(st.refs.length)
    for (const [a, b, c] of st.refs) out.u16be(a).u16be(b).u16be(c)
    out.u16be(st.vertices.length)
    for (const v of st.vertices) writeVertex(out, st.kind, v)
    if (st.extra) out.bytes(st.extra)
  }
  out.u16be(m.uvs.length)
  for (const [u, v] of m.uvs) out.u16be(u & 0xffff).u16be(v & 0xffff)
  out.u32be(m.indices.length)
  for (const i of m.indices) out.u16be(i)
  for (const p of m.parts) writeName(out, p)
  for (const [a, b, parent, x] of m.nodes) {
    for (const v of a) out.f32be(v)
    for (const v of b) out.f32be(v)
    out.byte(parent).byte(x)
  }
  out.u16be(m.chains[0]).u16be(m.chains[1])
  for (const [part, stream, strips, lists, render, flags, nodes] of m.meshes) {
    out.u32be(part >>> 0).byte(stream).u16be(strips).u16be(lists).u16be(render)
    out.byte(flags[0]).byte(flags[1]).byte(flags[2]).byte(nodes.length).bytes(nodes)
  }
  for (const [node, kind, i, mat] of m.attachments) {
    out.byte(node).byte(kind).u16be(i)
    for (const v of mat) out.f32be(v)
  }
}

export function read(data: Uint8Array): [number[], Model[]] {
  const head = Array.from({ length: 6 }, (_, i) => u32be(data, 4 * i))
  const r = new Reader(data, 24)
  const models: Model[] = []
  for (let i = 0; i < head[3]; i++) models.push(readModel(r))
  if (r.off !== data.length) throw new LabError(`parse ends at 0x${r.off.toString(16)} of 0x${data.length.toString(16)}`)
  return [head, models]
}

export function build(head: number[], models: Model[]): Uint8Array {
  const out = new ByteWriter(1 << 16)
  const h = [...head.slice(0, 3), models.length, ...head.slice(4)]
  for (const v of h) out.u32be(v)
  for (const m of models) writeModel(out, m)
  return out.finish()
}

export function dataSize(models: Model[]): number {
  const a16 = (x: number) => (x + 15) & ~15
  let size = 0
  for (const m of models) {
    size = a16(size) + 0x190
    size = a16(size) + m.attachments.length * 0x50
    size = a16(size) + m.nodes.length * 0x30 + m.meshes.length * 0x5c + m.parts.length * 4
  }
  return size + 15
}
