// In-engine cutscenes (Cutscenes/*.cut), ported from mnroi tools/cuttool.py, which documents the layout.
// Little-endian. Actors' animations are .ngb-style tracks {u32 bone, u32 channel, u32 key count, u32 pointer} with 12-byte keys.
import { ByteWriter, cstring, encodeLatin1, f32le, putU32le, u32le } from '../bytes'
import { LabError } from '../errors'
import type * as ngbtool from './ngbtool'

export const MAGIC = 0x2715
export const LIMIT = 0x4b001
const HEADER = 0x198
const RECORD = 0x90
const ANIM = 0x50
const STREAMS = 0x14
const NAME = 0x20

export interface Track {
  head: Uint8Array
  keys: Uint8Array
}

export interface Actor {
  record: Uint8Array
  animPtr: number
  header: Uint8Array
  tracks: Track[]
  events: Uint8Array
  eventWord: Uint8Array
}

export interface Chunk {
  head: Uint8Array
  actors: Actor[]
}

export interface Cut {
  header: Uint8Array
  records: Uint8Array[]
  chunkWords: number[]
  chunks: Chunk[]
  sizes: number[]
}

export const recordName = (r: Uint8Array) => cstring(r, 8, 0x50)
export const bone = (t: Track) => u32le(t.head, 0)

// An actor's animation as an .ngb record, without its events.
export function record(a: Actor): ngbtool.Record {
  const tracks = a.tracks.map((t): ngbtool.Track => {
    const v = new DataView(t.keys.buffer, t.keys.byteOffset, t.keys.length)
    const keys = Array.from({ length: t.keys.length / 12 }, (_, k): ngbtool.Key => [v.getFloat32(12 * k, true), [4, 6, 8, 10].map((j) => v.getInt16(12 * k + j, true)) as ngbtool.Packed])
    return [bone(t), u32le(t.head, 4), keys]
  })
  return { name: cstring(a.header, 0, 0x20), length: f32le(a.header, 0x28), head: a.header.slice(0x20), pointers: a.tracks.map((t) => u32le(t.head, 12)), tracks, events: [], extra: [] }
}

// Replaces an actor's tracks with a record's.
export function setRecord(a: Actor, rec: ngbtool.Record) {
  a.tracks = rec.tracks.map(([b, ch, keys], i) => {
    const head = new Uint8Array(16)
    putU32le(head, 0, b)
    putU32le(head, 4, ch)
    putU32le(head, 8, keys.length)
    putU32le(head, 12, rec.pointers[i] ?? 0)
    const out = new Uint8Array(12 * keys.length), v = new DataView(out.buffer)
    keys.forEach(([f, p], k) => {
      v.setFloat32(12 * k, f, true)
      p.forEach((x, j) => v.setInt16(12 * k + 4 + 2 * j, x, true))
    })
    return { head, keys: out }
  })
}

function readChunk(d: Uint8Array, b: number): [Chunk, number] {
  const n = u32le(d, b + 4)
  let p = b + 0x18
  const records = Array.from({ length: n }, (_, i) => d.slice(p + i * RECORD, p + (i + 1) * RECORD))
  p += n * RECORD
  const ptrs = Array.from({ length: n }, (_, i) => u32le(d, p + 4 * i))
  p += 4 * n
  const anims: [Uint8Array, Track[]][] = []
  for (let i = 0; i < n; i++) {
    const header = d.slice(p, p + ANIM)
    const count = u32le(header, 0x2c)
    p += ANIM
    const heads = Array.from({ length: count }, (_, t) => d.slice(p + 16 * t, p + 16 * (t + 1)))
    p += 16 * count
    const tracks = heads.map((head) => {
      const size = 12 * u32le(head, 8)
      const keys = d.slice(p, p + size)
      p += size
      return { head, keys }
    })
    anims.push([header, tracks])
  }
  const counts = Array.from({ length: n }, (_, i) => d.slice(p + 4 * i, p + 4 * i + 4))
  p += 4 * n
  const actors = records.map((record, i): Actor => {
    const events = d.slice(p, p + 12 * counts[i][0])
    p += events.length
    return { record, animPtr: ptrs[i], header: anims[i][0], tracks: anims[i][1], events, eventWord: counts[i].slice(1) }
  })
  if (p > d.length) throw new LabError(`a cutscene chunk at 0x${b.toString(16)} runs past the end`)
  return [{ head: d.slice(b, b + 0x18), actors }, p - b]
}

export function read(d: Uint8Array): Cut {
  if (d.length < HEADER || u32le(d, 0) !== MAGIC) throw new LabError('not a cutscene the game can play')
  const nchunks = u32le(d, 8), nrecords = u32le(d, 0xc)
  let p = HEADER
  const sizes = Array.from({ length: nchunks }, (_, i) => u32le(d, p + 4 * i))
  p += 4 * nchunks
  const records = Array.from({ length: nrecords }, (_, i) => d.slice(p + i * RECORD, p + (i + 1) * RECORD))
  p += nrecords * RECORD
  const chunkWords = Array.from({ length: nchunks }, (_, i) => u32le(d, p + 4 * i))
  p += 4 * nchunks
  const chunks: Chunk[] = []
  for (let i = 0; i < nchunks; i++) {
    const [c, size] = readChunk(d, p)
    chunks.push(c)
    p += size
  }
  if (p !== d.length) throw new LabError(`the cutscene has ${d.length - p} bytes after its last chunk`)
  return { header: d.slice(0, HEADER), records, chunkWords, chunks, sizes }
}

export function buildChunk(c: Chunk): Uint8Array {
  const out = new ByteWriter(1 << 16)
  const head = c.head.slice()
  putU32le(head, 4, c.actors.length)
  out.bytes(head)
  for (const a of c.actors) out.bytes(a.record)
  for (const a of c.actors) out.u32le(a.animPtr)
  for (const a of c.actors) {
    const header = a.header.slice()
    putU32le(header, 0x2c, a.tracks.length)
    out.bytes(header)
    for (const t of a.tracks) {
      const h = t.head.slice()
      putU32le(h, 8, t.keys.length / 12)
      out.bytes(h)
    }
    for (const t of a.tracks) out.bytes(t.keys)
  }
  for (const a of c.actors) out.byte(a.events.length / 12).bytes(a.eventWord)
  for (const a of c.actors) out.bytes(a.events)
  return out.finish()
}

// `sizes` overrides the computed chunk sizes (mov_8.cut's table is off).
export function build(cut: Cut, sizes?: number[]): Uint8Array {
  const chunks = cut.chunks.map(buildChunk)
  const header = cut.header.slice()
  putU32le(header, 8, chunks.length)
  putU32le(header, 0xc, cut.records.length)
  const out = new ByteWriter(1 << 20).bytes(header)
  for (const [i, c] of chunks.entries()) out.u32le(sizes?.[i] ?? c.length)
  for (const r of cut.records) out.bytes(r)
  for (const w of cut.chunkWords) out.u32le(w)
  for (const c of chunks) out.bytes(c)
  return out.finish()
}

export function streams(cut: Cut): string[] {
  return [0, 1, 2].map((i) => cstring(cut.header, STREAMS + NAME * i, STREAMS + NAME * (i + 1)))
}

export function setStream(cut: Cut, i: number, name: string) {
  if (name.length >= NAME) throw new LabError(`the audio stream name ${name} is longer than ${NAME - 1} characters`)
  const at = STREAMS + NAME * i
  cut.header.fill(0, at, at + NAME)
  cut.header.set(encodeLatin1(name), at)
}
