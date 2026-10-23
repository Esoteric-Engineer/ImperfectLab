// Animation bundles (Bundles/<name>.ngb).
// Big-endian records of tracks (keys {f32 frame, s16 a, b, c, d}), events and 0x50-byte extras, each 4-aligned.
// Channel 0 is a rotation (w = a/16384, (x, y, z) = -(c, d, b)/16384), channel 1 a translation from the bind offset ((a, b, c)/d, d unsigned).
import { ByteWriter, cstring, f32be, i16be, putF32be, putU32be, u16be, u32be } from '../bytes'
import { LabError } from '../errors'
import { roundHalfEven } from './gxtex'
import type { Model } from './ngmtool'

const HEAD = 0x50

export type Packed = [number, number, number, number]
export type Key = [number, Packed]
export type Track = [number, number, Key[]]
export type Event = [number, number, number, number]
export type Vec3 = [number, number, number]
export type Mat3 = [Vec3, Vec3, Vec3]

export interface Record {
  name: string
  length: number
  head: Uint8Array
  pointers: number[]
  tracks: Track[]
  events: Event[]
  extra: Uint8Array[]
}

export function parse(d: Uint8Array): Record[] {
  const recs: Record[] = []
  let o = 0
  while (o + HEAD <= d.length) {
    const name = cstring(d, o, o + 0x20)
    if (!name.toLowerCase().endsWith('.nad')) throw new LabError(`no animation record at 0x${o.toString(16).toUpperCase()}`)
    const ntr = u32be(d, o + 0x2c), nev = u32be(d, o + 0x3c), nex = u32be(d, o + 0x44)
    let p = o + HEAD
    if (p + 16 * ntr > d.length) throw new LabError(`animation ${name} runs past the end of the file`)
    const table = Array.from({ length: ntr }, (_, i) => [0, 4, 8, 12].map((k) => u32be(d, p + 16 * i + k)))
    p += 16 * ntr
    const tracks: Track[] = []
    for (const [bone, ch, nk] of table) {
      if (p + 12 * nk > d.length) throw new LabError(`animation ${name} runs past the end of the file`)
      const keys: Key[] = []
      for (let k = 0; k < nk; k++, p += 12) keys.push([f32be(d, p), [0, 2, 4, 6].map((j) => i16be(d, p + 4 + j)) as Packed])
      tracks.push([bone, ch, keys])
    }
    if (p + 12 * nev + 0x50 * nex > d.length) throw new LabError(`animation ${name} runs past the end of the file`)
    const events: Event[] = []
    for (let e = 0; e < nev; e++, p += 12) events.push([f32be(d, p), u16be(d, p + 4), u16be(d, p + 6), u32be(d, p + 8)])
    const extra: Uint8Array[] = []
    for (let x = 0; x < nex; x++, p += 0x50) extra.push(d.slice(p, p + 0x50))
    recs.push({ name, length: f32be(d, o + 0x28), head: d.slice(o + 0x20, o + HEAD), pointers: table.map((t) => t[3]), tracks, events, extra })
    o = (p + 3) & ~3
  }
  return recs
}

// The records' names only, without reading their keys.
export function names(d: Uint8Array): string[] {
  const out: string[] = []
  let o = 0
  while (o + HEAD <= d.length) {
    out.push(cstring(d, o, o + 0x20))
    const ntr = u32be(d, o + 0x2c), nev = u32be(d, o + 0x3c), nex = u32be(d, o + 0x44)
    if (o + HEAD + 16 * ntr > d.length) throw new LabError(`animation ${out[out.length - 1]} runs past the end of the file`)
    let keys = 0
    for (let i = 0; i < ntr; i++) keys += u32be(d, o + HEAD + 16 * i + 8)
    o = (o + HEAD + 16 * ntr + 12 * keys + 12 * nev + 0x50 * nex + 3) & ~3
  }
  return out
}

// Whether two records move the same bones the same way, with the same events and extras (the pointer fields are fixed up at load).
export function sameMotion(a: Record, b: Record): boolean {
  if (a.length !== b.length || a.tracks.length !== b.tracks.length || a.events.length !== b.events.length || a.extra.length !== b.extra.length) return false
  const flat = (r: Record) => JSON.stringify([r.tracks, r.events])
  return flat(a) === flat(b) && a.extra.every((x, i) => x.length === b.extra[i].length && x.every((v, k) => v === b.extra[i][k]))
}

export function writeRecord(r: Record): Uint8Array {
  const out = new ByteWriter(HEAD + 16 * r.tracks.length)
  const name = new Uint8Array(0x20)
  for (let i = 0; i < Math.min(0x20, r.name.length); i++) name[i] = r.name.charCodeAt(i) & 255
  const head = r.head.slice()
  putF32be(head, 8, r.length)
  putU32be(head, 12, r.tracks.length)
  putU32be(head, 28, r.events.length)
  putU32be(head, 36, r.extra.length)
  out.bytes(name).bytes(head)
  r.tracks.forEach(([bone, ch, keys], i) => out.u32be(bone).u32be(ch).u32be(keys.length).u32be(r.pointers[i] ?? 0))
  for (const [, , keys] of r.tracks) {
    for (const [t, v] of keys) {
      out.f32be(t)
      for (const x of v) out.u16be(x & 0xffff)
    }
  }
  for (const [t, type, param, value] of r.events) out.f32be(t).u16be(type).u16be(param).u32be(value >>> 0)
  for (const x of r.extra) out.bytes(x)
  return out.align(4).finish()
}

export function build(recs: Record[]): Uint8Array {
  const out = new ByteWriter(1 << 16)
  for (const r of recs) out.bytes(writeRecord(r))
  return out.finish()
}

// unit quaternion (w, x, y, z), Z up, facing +Y
export function quat(v: Packed): [number, number, number, number] {
  const [w, b, c, d] = v.map((x) => x / 16384.0)
  const q: [number, number, number, number] = [w, -c, -d, -b]
  const n = Math.hypot(...q) || 1.0
  return q.map((x) => x / n) as [number, number, number, number]
}

export function translation(v: Packed): Vec3 {
  const k = 1.0 / (v[3] & 0xffff)
  return [v[0] * k, v[1] * k, v[2] * k]
}

export function encodeTranslation(t: Vec3): Packed {
  const m = Math.max(...t.map(Math.abs))
  if (m * 32768 < 32767) return [...t.map((x) => roundHalfEven(x * 32768)), -32768] as Packed
  const d = Math.floor(32767 / m)
  if (d < 1) throw new LabError(`translation too large to encode: ${t.join(', ')}`)
  return [...t.map((x) => roundHalfEven(x * d)), d] as Packed
}

function qmat([w, x, y, z]: number[]): Mat3 {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ]
}

function sample<T extends number[]>(keys: [number, T][], t: number): T {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 0; i + 1 < keys.length; i++) {
    const [t0, a] = keys[i], [t1, b] = keys[i + 1]
    if (t0 <= t && t <= t1) {
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0
      return a.map((x, k) => x + (b[k] - x) * f) as T
    }
  }
  return keys[keys.length - 1][1]
}

// World [rotation, translation] of every node at frame t (rec null: the bind pose).
export function pose(model: Pick<Model, 'nodes'>, rec: Record | null, t: number): [Mat3, Vec3][] {
  const nodes = model.nodes
  const rot = new Map<number, Mat3>(), dt = new Map<number, Vec3>()
  for (const [bone, ch, keys] of rec?.tracks ?? []) {
    if (bone >= nodes.length || !keys.length) continue
    if (ch === 0) rot.set(bone, qmat(quat(sample(keys, t))))
    else dt.set(bone, sample(keys.map(([f, v]): [number, Vec3] => [f, translation(v)]), t))
  }
  const ident: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const out: [Mat3, Vec3][] = []
  nodes.forEach(([q, , parent], i) => {
    const R = rot.get(i) ?? ident
    const d = dt.get(i) ?? [0, 0, 0]
    const T: Vec3 = [q[0] + d[0], q[1] + d[1], q[2] + d[2]]
    if (parent < 0 || parent >= i) {
      out.push([R, T])
      return
    }
    const [PR, PT] = out[parent]
    const row = (r: number) => [0, 1, 2].map((c) => PR[r][0] * R[0][c] + PR[r][1] * R[1][c] + PR[r][2] * R[2][c]) as Vec3
    out.push([[row(0), row(1), row(2)], [0, 1, 2].map((r) => PT[r] + PR[r][0] * T[0] + PR[r][1] * T[1] + PR[r][2] * T[2]) as Vec3])
  })
  return out
}
