import { ByteWriter, encodeLatin1, latin1, u32be } from '../bytes'
import { LabError } from '../errors'
import { CHUNK, type Sink } from './disc'
import { Entry, type GameSource } from './source'

const ALIGN = 0x20

export function nameHash(name: string): number {
  let h = 5381
  for (const c of encodeLatin1(name.toLowerCase())) h = (Math.imul(h, 33) + c) >>> 0
  return h
}

export function unpackedSize(data: Uint8Array): number {
  if (data.length >= 5 && data[0] === 0x10 && data[1] === 0xfb) return (data[2] << 16) | (data[3] << 8) | data[4]
  return 0
}

function readBh(d: Uint8Array): [number, number, number, number][] {
  if (latin1(d, 0, 4) !== 'Viv4') throw new LabError('CLASH.BH is not a Viv4 index')
  const count = u32be(d, 8)
  return Array.from({ length: count }, (_, i) => [u32be(d, 16 + 16 * i), u32be(d, 20 + 16 * i), u32be(d, 24 + 16 * i), u32be(d, 28 + 16 * i)])
}

export type Plan = [Entry, number, number][]

export interface Repack {
  plan: Plan
  index: Uint8Array
  total: number
  bh: Uint8Array
}

export function planRepack(source: GameSource, sets: Map<string, Uint8Array>, adds: Map<string, Uint8Array>): Repack {
  const idx = source.index
  const entries = idx.entries.map((e) => new Entry(e.offset, e.size, e.name))
  const rows = readBh(source.bh())
  if (rows.length !== entries.length) throw new LabError('CLASH.BH and CLASH.BIG disagree')
  entries.forEach((e, i) => {
    const r = rows[i]
    if (r[0] !== e.offset || r[1] !== e.size) throw new LabError(`CLASH.BH and CLASH.BIG disagree at ${e.name}`)
    e.hash = r[3]
    e.usize = r[2]
  })
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]))
  for (const [name, data] of sets) {
    const key = name.toLowerCase()
    if (idx.dups.has(key)) throw new LabError(`${name} appears more than once in CLASH.BIG; replacing it is not supported`)
    const e = byName.get(key)
    if (!e) throw new LabError(`CLASH.BIG has no entry ${name} to replace`)
    e.data = data
    e.usize = unpackedSize(data)
  }
  for (const [name, data] of adds) {
    if (byName.has(name.toLowerCase())) throw new LabError(`CLASH.BIG already has an entry ${name}`)
    const e = new Entry(0, 0, name, nameHash(name))
    e.data = data
    e.usize = unpackedSize(data)
    entries.push(e)
    byName.set(name.toLowerCase(), e)
  }

  let newIndexSize = 16 + idx.tail.length
  for (const e of entries) newIndexSize += 8 + e.name.length + 1
  let pos = (newIndexSize + idx.slack.length + ALIGN - 1) & ~(ALIGN - 1)
  const plan: Plan = []
  for (const e of entries) {
    const size = e.data !== null ? e.data.length : e.size
    plan.push([e, pos, size])
    pos = (pos + size + ALIGN - 1) & ~(ALIGN - 1)
  }
  const total = pos

  const index = new ByteWriter(newIndexSize + idx.slack.length)
  index.latin1('BIG4').u32le(total).u32be(entries.length).u32be(newIndexSize)
  for (const [e, off, size] of plan) index.u32be(off).u32be(size).latin1(e.name).byte(0)
  index.bytes(idx.tail).bytes(idx.slack)

  const n = entries.length
  const bhSize = 16 + 16 * n + 16
  const bh = new ByteWriter(bhSize)
  bh.latin1('Viv4').u32le(bhSize).u32be(n).u32be(bhSize)
  for (const [e, off, size] of plan) bh.u32be(off).u32be(size).u32be(e.usize).u32be(e.hash)
  bh.u32be(total).u32be(0).u32be(0).u32be(0)
  return { plan, index: index.finish(), total, bh: bh.finish() }
}

export async function writeBig(source: GameSource, r: Repack, sink: Sink, progress?: (n: number) => void): Promise<number> {
  let at = 0
  const put = async (d: Uint8Array) => {
    await sink.write(d)
    at += d.length
  }
  await put(r.index)
  for (const [e, off, size] of r.plan) {
    if (off > at) await put(new Uint8Array(off - at))
    if (e.data !== null) {
      await put(e.data)
    } else {
      for (let p = 0; p < size; p += CHUNK) await put(source.readBig(e.offset + p, Math.min(CHUNK, size - p)))
    }
    progress?.(size)
  }
  if (r.total > at) await put(new Uint8Array(r.total - at))
  return r.total
}

