// EA AEMS sound banks (Sounds/*.abk), big-endian.
// PT header tags: 82 channels, 84 rate, 85 sample count, 86/87 loop (end inclusive), 88/89 data offsets, 8D/8E loop contexts, 8F/90 coefficients, A0 codec.
// Samples may share data (SFX_Devil's 12 and 32).
import { concat, equal, i16be, latin1, putU32be, u16be, u32be } from '../bytes'
import * as dsp from '../audio/dspadpcm'
import { LabError } from '../errors'

// The rate of a sample with no 84 tag: fn_80258188, the PT parser, stores 24000 before it reads the tags.
export const DEFAULT_RATE = 24000
const DSP_CODEC = 0x12
// The tags a rebuilt header writes, in the game's order.
const ORDER = [0x06, 0x13, 0xfd, 0x80, 0x85, 0x82, 0xa0, 0x84, 0x86, 0x87, 0x88, 0x8f, 0x8d, 0x89, 0x90, 0x8e, 0x8a]
const WORD_TAGS = new Set([0x88, 0x89, 0x8a])

export interface Module {
  id: number
  entries: number
}

export interface Sample {
  raw: Uint8Array
  tags: Map<number, Uint8Array>
  data: Uint8Array[]
}

export interface Bank {
  abk: Uint8Array
  modules: Module[]
  bnk: number
  samples: Sample[]
}

const num = (v: Uint8Array | undefined, def = 0) => (v === undefined ? def : v.reduce((acc, b) => acc * 256 + b, 0))

function parseTags(d: Uint8Array, at: number): [Map<number, Uint8Array>, number] {
  if (latin1(d, at, at + 2) !== 'PT') throw new LabError(`a sound bank has no PT header at 0x${at.toString(16)}`)
  const tags = new Map<number, Uint8Array>()
  let p = at + 4
  for (;;) {
    const t = d[p++]
    if (t === 0xff) break
    if (t === 0xfc || t === 0xfd) continue
    const n = d[p]
    tags.set(t, d.subarray(p + 1, p + 1 + n))
    p += 1 + n
  }
  return [tags, (p + 3) & ~3]
}

export function read(abk: Uint8Array): Bank {
  if (latin1(abk, 0, 4) !== 'ABKC') throw new LabError('not an ABKC sound bank')
  const modules: Module[] = []
  let t = u32be(abk, 0x1c)
  for (let i = 0; i < u16be(abk, 0xa); i++) {
    const n = abk[t + 0x24] === 0xff ? 0 : abk[t + 0x24]
    modules.push({ id: u32be(abk, t), entries: n })
    t += 0x3c + 4 * n
  }
  const b = u32be(abk, 0x20)
  if (latin1(abk, b, b + 4) !== 'BNKb' || abk[b + 4] !== 5) throw new LabError('the sound bank has no BNKb v5 bank')
  const count = u16be(abk, b + 6) - 1
  const samples: Sample[] = []
  for (let i = 0; i < count; i++) {
    const slot = b + 0x18 + 4 * i
    const at = slot + u32be(abk, slot)
    const [tags, end] = parseTags(abk, at)
    if (num(tags.get(0xa0)) !== DSP_CODEC) throw new LabError(`sample ${i} of the sound bank is not DSP ADPCM`)
    const size = dsp.dataSize(num(tags.get(0x85))) * channelsOf(tags)
    const data = [0x88, 0x89].filter((k) => tags.has(k)).map((k) => abk.slice(b + num(tags.get(k)), b + num(tags.get(k)) + size))
    samples.push({ raw: abk.slice(at, end), tags, data })
  }
  return { abk, modules, bnk: b, samples }
}

const channelsOf = (tags: Map<number, Uint8Array>) => num(tags.get(0x82), 1)

export interface Info {
  rate: number
  samples: number
  channels: number
  loop: [number, number] | null
  bytes: number
}

export function info(s: Sample): Info {
  const t = s.tags
  return {
    rate: num(t.get(0x84), DEFAULT_RATE),
    samples: num(t.get(0x85)),
    channels: channelsOf(t),
    loop: t.has(0x87) ? [num(t.get(0x86)), num(t.get(0x87))] : null,
    bytes: s.data[0].length,
  }
}

export function channel0(s: Sample): dsp.Adpcm {
  const n = num(s.tags.get(0x85))
  const coefs = new Int16Array(16)
  for (let k = 0; k < 16; k++) coefs[k] = i16be(s.tags.get(0x8f)!, 2 * k)
  return { samples: n, coefs, data: s.data[0].slice(0, dsp.dataSize(n)) }
}

export interface Replacement extends dsp.Adpcm {
  rate: number
  loop: boolean
}

function value(v: number, size?: number): Uint8Array {
  let n = size ?? 1
  while (size === undefined && v >= 256 ** n) n++
  const out = new Uint8Array(n)
  for (let i = n - 1; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 255
  return out
}

function header(old: Map<number, Uint8Array>, r: Replacement): Map<number, Uint8Array> {
  const tags = new Map<number, Uint8Array>()
  for (const k of [0x06, 0x13, 0x80, 0xa0, 0x8a]) tags.set(k, old.get(k)!)
  tags.set(0x85, value(r.samples))
  if (r.rate !== DEFAULT_RATE) tags.set(0x84, value(r.rate))
  if (r.loop) {
    tags.set(0x86, new Uint8Array(0))
    tags.set(0x87, value(r.samples - 1))
    const c = dsp.contextAt(r, 0)
    tags.set(0x8d, new Uint8Array([(c.hist1 >> 8) & 255, c.hist1 & 255, (c.hist2 >> 8) & 255, c.hist2 & 255, c.ps]))
  }
  const coefs = new Uint8Array(33)
  r.coefs.forEach((c, k) => { coefs[2 * k] = (c >> 8) & 255; coefs[2 * k + 1] = c & 255 })
  coefs[32] = r.data[0]
  tags.set(0x8f, coefs)
  tags.set(0x88, new Uint8Array(4))
  return tags
}

function writeHeader(tags: Map<number, Uint8Array>): Uint8Array {
  const out: number[] = [0x50, 0x54, 0x06, 0x00]
  for (const t of ORDER) {
    if (t === 0xfd) {
      out.push(0xfd)
      continue
    }
    const v = tags.get(t)
    if (v === undefined) continue
    if (t === 0x8a) while (out.length % 4 !== 2) out.push(0xfc)
    out.push(t, v.length, ...(WORD_TAGS.has(t) ? value(num(v), 4) : v))
  }
  out.push(0xff)
  while (out.length % 4) out.push(0)
  return new Uint8Array(out)
}

function offsetFields(h: Uint8Array): Map<number, number> {
  const out = new Map<number, number>()
  let p = 4
  for (;;) {
    const t = h[p++]
    if (t === 0xff) return out
    if (t === 0xfc || t === 0xfd) continue
    if (t === 0x88 || t === 0x89) out.set(t, p + 1)
    p += 1 + h[p]
  }
}

const align = (v: number, a: number) => Math.ceil(v / a) * a

// With no replacements the file comes back unchanged unless `relayout`.
export function build(bank: Bank, replacements: Map<number, Replacement>, relayout = false): Uint8Array {
  const { abk, bnk } = bank
  for (const i of replacements.keys()) if (!(i >= 0 && i < bank.samples.length)) throw new LabError(`the sound bank has no sample ${i}`)
  if (!replacements.size && !relayout) return abk
  const oldHsz = u32be(abk, bnk + 8), oldSize = u32be(abk, 0x24)
  const headers: Uint8Array[] = [], blocks: Uint8Array[] = []
  bank.samples.forEach((s, i) => {
    const r = replacements.get(i)
    headers.push(r ? writeHeader(header(s.tags, r)) : s.raw.slice())
    blocks.push(r ? r.data : s.data[0])
  })
  const table = 0x18 + 4 * headers.length
  let p = table
  const at = headers.map((h) => { const o = p; p += h.length; return o })
  const hsz = p <= oldHsz ? oldHsz : align(p, 0x40)
  let d = hsz, end = hsz
  const shared = new Map<number | Uint8Array, number>()
  const dataAt = blocks.map((b, i) => {
    const key = replacements.has(i) ? b : num(bank.samples[i].tags.get(0x88))
    if (shared.has(key)) return shared.get(key)!
    const o = d
    d = align(d + b.length, 0x20)
    end = o + b.length
    shared.set(key, o)
    return o
  })
  const dsz = align(end, 0x20) - hsz
  const size = align(hsz + dsz, 0x80)
  const out = new Uint8Array(size)
  out.set(abk.subarray(bnk, bnk + Math.min(size, oldSize)))
  putU32be(out, 8, hsz)
  putU32be(out, 12, dsz)
  headers.forEach((h, i) => {
    for (const off of offsetFields(h).values()) putU32be(h, off, dataAt[i])
    putU32be(out, 0x18 + 4 * i, at[i] - (0x18 + 4 * i))
    out.set(h, at[i])
  })
  blocks.forEach((b, i) => out.set(b, dataAt[i]))
  const delta = size - oldSize
  const head = abk.slice(0, bnk)
  putU32be(head, 0x14, u32be(abk, 0x14) + delta)
  putU32be(head, 0x24, size)
  for (const o of [0x30, 0x34, 0x38]) if (u32be(abk, o)) putU32be(head, o, u32be(abk, o) + delta)
  const tail = abk.slice(bnk + oldSize)
  const t38 = u32be(abk, 0x38) - (bnk + oldSize)
  if (u32be(abk, 0x38)) for (let k = 0; k < u32be(tail, t38); k++) putU32be(tail, t38 + 8 + 12 * k, u32be(tail, t38 + 8 + 12 * k) + delta)
  return concat([head, out, tail])
}

export function sameSample(a: Sample, b: Sample): boolean {
  return equal(a.data[0], b.data[0]) && [...a.tags].every(([k, v]) => k === 0x88 || k === 0x89 || equal(v, b.tags.get(k) ?? new Uint8Array(0)))
}
