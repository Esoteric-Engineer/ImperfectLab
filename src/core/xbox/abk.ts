// Xbox sound banks: mnroi/abktool.ts's layout little-endian (PT tag values stay big-endian), Xbox IMA ADPCM at 36000 Hz.
import { concat, latin1, putU32le, u16le, u32le } from '../bytes'
import { LabError } from '../errors'

const IMA_CODEC = 0x14
const ORDER = [0x06, 0x13, 0xfd, 0x80, 0x85, 0x82, 0xa0, 0x84, 0x86, 0x87, 0x8c, 0x88, 0x89]
const WORD_TAGS = new Set([0x88, 0x89])
export const XBOX_RATE = 36000

export interface Sample { raw: Uint8Array; tags: Map<number, Uint8Array>; data: Uint8Array }
export interface Bank { abk: Uint8Array; bnk: number; samples: Sample[] }

const num = (v: Uint8Array | undefined, def = 0) => (v === undefined ? def : v.reduce((acc, b) => acc * 256 + b, 0))
const align = (v: number, a: number) => Math.ceil(v / a) * a
export const imaSize = (samples: number) => Math.ceil(samples / 64) * 36

function parseTags(d: Uint8Array, at: number): [Map<number, Uint8Array>, number] {
  if (latin1(d, at, at + 2) !== 'PT') throw new LabError(`an Xbox sound bank has no PT header at 0x${at.toString(16)}`)
  const tags = new Map<number, Uint8Array>()
  let p = at + 4
  for (;;) {
    const t = d[p++]
    if (t === 0xff) break
    if (t === 0xfc || t === 0xfd || t === 0xfe) continue
    const n = d[p]
    tags.set(t, d.subarray(p + 1, p + 1 + n))
    p += 1 + n
  }
  return [tags, (p + 3) & ~3]
}

export function read(abk: Uint8Array): Bank {
  if (latin1(abk, 0, 4) !== 'ABKC') throw new LabError('not an ABKC sound bank')
  const b = u32le(abk, 0x20)
  if (!b || latin1(abk, b, b + 4) !== 'BNKl' || abk[b + 4] !== 5) throw new LabError('the Xbox sound bank has no BNKl v5 bank')
  const samples: Sample[] = []
  for (let i = 0; i < u16le(abk, b + 6) - 1; i++) {
    const slot = b + 0x18 + 4 * i
    const at = slot + u32le(abk, slot)
    const [tags, end] = parseTags(abk, at)
    const size = num(tags.get(0xa0)) === IMA_CODEC ? imaSize(num(tags.get(0x85))) : 0
    const data = [0x88, 0x89].filter((k) => tags.has(k)).map((k) => abk.slice(b + num(tags.get(k)), b + num(tags.get(k)) + size))
    samples.push({ raw: abk.slice(at, end), tags, data: concat(data) })
  }
  return { abk, bnk: b, samples }
}

export const rate = (s: Sample) => num(s.tags.get(0x84), 22050)
export const loops = (s: Sample) => s.tags.has(0x87)

const STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289,
  16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]
const IDX = [-1, -1, -1, -1, 2, 4, 6, 8]

function step(pred: number, idx: number, nib: number): [number, number] {
  const st = STEP[idx]
  let diff = st >> 3
  if (nib & 1) diff += st >> 2
  if (nib & 2) diff += st >> 1
  if (nib & 4) diff += st
  pred = Math.max(-32768, Math.min(32767, nib & 8 ? pred - diff : pred + diff))
  return [pred, Math.max(0, Math.min(88, idx + IDX[nib & 7]))]
}

export function imaDecode(data: Uint8Array, samples: number): Int16Array {
  const out = new Int16Array(samples)
  let o = 0
  for (let b = 0; b + 36 <= data.length && o < samples; b += 36) {
    let pred = ((data[b] | (data[b + 1] << 8)) << 16) >> 16, idx = Math.min(88, data[b + 2])
    for (let k = 4; k < 36 && o < samples; k++) {
      for (const nib of [data[b + k] & 15, data[b + k] >> 4]) { [pred, idx] = step(pred, idx, nib); if (o < samples) out[o++] = pred }
    }
  }
  return out
}

export function imaEncode(pcm: Int16Array): Uint8Array {
  const blocks = Math.ceil(pcm.length / 64), out = new Uint8Array(blocks * 36)
  let pred = 0, idx = 0
  for (let b = 0; b < blocks; b++) {
    const o = b * 36
    out[o] = pred & 255; out[o + 1] = (pred >> 8) & 255; out[o + 2] = idx; out[o + 3] = 0
    for (let k = 0; k < 64; k++) {
      const v = pcm[b * 64 + k] ?? 0
      const st = STEP[idx]
      let d = v - pred, nib = 0
      if (d < 0) { nib = 8; d = -d }
      if (d >= st) { nib |= 4; d -= st }
      if (d >= st >> 1) { nib |= 2; d -= st >> 1 }
      if (d >= st >> 2) nib |= 1
      ;[pred, idx] = step(pred, idx, nib)
      out[o + 4 + (k >> 1)] |= k & 1 ? nib << 4 : nib
    }
  }
  return out
}

export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm
  const n = Math.max(1, Math.round(pcm.length * to / from)), out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * from / to, j = Math.floor(x), f = x - j
    out[i] = Math.round((pcm[j] ?? 0) * (1 - f) + (pcm[Math.min(j + 1, pcm.length - 1)] ?? 0) * f)
  }
  return out
}

export type Replacement = { pcm: Int16Array; rate: number; loop: boolean } | { sample: Sample; loop: boolean }

// PT values are signed: one with its top bit set gets another byte, or the game reads 36000 Hz as negative
function value(v: number, size?: number): Uint8Array {
  let n = size ?? 1
  while (size === undefined && v >= 256 ** n / 2) n++
  const out = new Uint8Array(n)
  for (let i = n - 1; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 255
  return out
}

function writeHeader(tags: Map<number, Uint8Array>): Uint8Array {
  const out: number[] = [0x50, 0x54, 0x07, 0x00]
  for (const t of ORDER) {
    if (t === 0xfd) { out.push(0xfd); continue }
    const v = tags.get(t)
    if (v !== undefined) out.push(t, v.length, ...(WORD_TAGS.has(t) ? value(num(v), 4) : v))
  }
  out.push(0xff)
  while (out.length % 4) out.push(0)
  return new Uint8Array(out)
}

function replaced(old: Sample, r: Replacement): [Uint8Array, Uint8Array] {
  let samples: number, hz: number, data: Uint8Array
  if ('sample' in r) {
    if (num(r.sample.tags.get(0x82), 1) !== 1 || num(r.sample.tags.get(0xa0)) !== IMA_CODEC) throw new LabError('a borrowed Xbox sound is not a mono IMA ADPCM sound')
    samples = num(r.sample.tags.get(0x85)); hz = rate(r.sample); data = r.sample.data
  } else {
    const pcm = r.rate > XBOX_RATE ? resample(r.pcm, r.rate, XBOX_RATE) : r.pcm
    samples = pcm.length; hz = Math.min(r.rate, XBOX_RATE); data = imaEncode(pcm)
  }
  const tags = new Map<number, Uint8Array>()
  for (const k of [0x06, 0x13, 0x80]) if (old.tags.has(k)) tags.set(k, old.tags.get(k)!)
  tags.set(0x85, value(samples))
  tags.set(0xa0, value(IMA_CODEC))
  tags.set(0x84, value(hz))
  if (r.loop) { tags.set(0x86, value(0)); tags.set(0x87, value(samples - 1)) }
  tags.set(0x8c, old.tags.get(0x8c) ?? value(1024, 2))
  tags.set(0x88, new Uint8Array(4))
  return [writeHeader(tags), data]
}

function offsetFields(h: Uint8Array): number[] {
  const out: number[] = []
  let p = 4
  for (;;) {
    const t = h[p++]
    if (t === 0xff) return out
    if (t === 0xfc || t === 0xfd || t === 0xfe) continue
    if (t === 0x88 || t === 0x89) out.push(p + 1)
    p += 1 + h[p]
  }
}
const putU32be = (d: Uint8Array, o: number, v: number) => { d[o] = v >>> 24; d[o + 1] = (v >>> 16) & 255; d[o + 2] = (v >>> 8) & 255; d[o + 3] = v & 255 }

export function build(bank: Bank, reps: Map<number, Replacement>): Uint8Array {
  const { abk, bnk } = bank
  for (const i of reps.keys()) if (!(i >= 0 && i < bank.samples.length)) throw new LabError(`the Xbox sound bank has no sample ${i + 1}`)
  if (!reps.size) return abk
  const oldHsz = u32le(abk, bnk + 8), oldSize = u32le(abk, 0x24)
  const headers: Uint8Array[] = [], chans: Uint8Array[][] = [], keys: (number | Uint8Array)[] = []
  bank.samples.forEach((s, i) => {
    const r = reps.get(i)
    if (r) { const [h, d] = replaced(s, r); headers.push(h); chans.push([d]); keys.push(d) } else {
      headers.push(s.raw.slice())
      const one = imaSize(num(s.tags.get(0x85)))
      chans.push([0x88, 0x89].filter((k) => s.tags.has(k)).map((_, c) => s.data.subarray(c * one, (c + 1) * one)))
      keys.push(num(s.tags.get(0x88)))
    }
  })
  let p = 0x18 + 4 * headers.length
  const at = headers.map((h) => { const o = p; p += h.length; return o })
  const hsz = p <= oldHsz ? oldHsz : align(p, 0x40)
  let d = hsz, end = hsz
  const shared = new Map<number | Uint8Array, number[]>()
  const dataAt = chans.map((cs, i) => {
    if (shared.has(keys[i])) return shared.get(keys[i])!
    const offs = cs.map((c) => { const o = d; d = align(d + c.length, 0x20); end = o + c.length; return o })
    shared.set(keys[i], offs)
    return offs
  })
  const dsz = align(end, 0x20) - hsz
  const size = align(hsz + dsz, 0x80)
  const out = new Uint8Array(size)
  out.set(abk.subarray(bnk, bnk + Math.min(size, oldHsz)))
  putU32le(out, 8, hsz)
  putU32le(out, 12, dsz)
  headers.forEach((h, i) => {
    offsetFields(h).forEach((off, c) => putU32be(h, off, dataAt[i][c]))
    putU32le(out, 0x18 + 4 * i, at[i] - (0x18 + 4 * i))
    out.set(h, at[i])
  })
  chans.forEach((cs, i) => cs.forEach((c, k) => out.set(c, dataAt[i][k])))
  const delta = size - oldSize
  const head = abk.slice(0, bnk)
  putU32le(head, 0x14, u32le(abk, 0x14) + delta)
  putU32le(head, 0x24, size)
  for (const o of [0x30, 0x34, 0x38]) if (u32le(abk, o)) putU32le(head, o, u32le(abk, o) + delta)
  const tail = abk.slice(bnk + oldSize)
  if (u32le(abk, 0x38)) {
    const t = u32le(abk, 0x38) - (bnk + oldSize)
    for (let k = 0; k < u32le(tail, t); k++) putU32le(tail, t + 8 + 12 * k, u32le(tail, t + 8 + 12 * k) + delta)
  }
  return concat([head, out, tail])
}