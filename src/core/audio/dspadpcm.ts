// GameCube DSP ADPCM, the codec of the game's sound banks, and the .dsp file. A frame is 8 bytes for 14 samples.
import { i16be, putU16be, putU32be, u16be, u32be } from '../bytes'
import { LabError } from '../errors'

export const FRAME_SAMPLES = 14
export const FRAME_BYTES = 8
export const DSP_HEADER = 0x60

export interface Adpcm {
  samples: number
  coefs: Int16Array // 16
  data: Uint8Array
}

export interface Context {
  ps: number
  hist1: number
  hist2: number
}

export interface DspFile extends Adpcm {
  rate: number
  // [start, end] in samples, end inclusive, or null
  loop: [number, number] | null
  loopContext: Context
}

export const dataSize = (samples: number) => Math.ceil(samples / FRAME_SAMPLES) * FRAME_BYTES
const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v)
// >> 11 on values past 32 bits.
const shr11 = (v: number) => Math.floor(v / 2048)

export function decode(a: Adpcm, start: Context = { ps: 0, hist1: 0, hist2: 0 }): Int16Array {
  const out = new Int16Array(a.samples)
  let h1 = start.hist1, h2 = start.hist2
  for (let f = 0, i = 0; i < a.samples; f++) {
    const ps = a.data[f * FRAME_BYTES]
    const c1 = a.coefs[(ps >> 4 & 7) * 2], c2 = a.coefs[(ps >> 4 & 7) * 2 + 1], scale = 1 << (ps & 15)
    for (let k = 0; k < FRAME_SAMPLES && i < a.samples; k++, i++) {
      const b = a.data[f * FRAME_BYTES + 1 + (k >> 1)]
      const nib = ((k & 1 ? b & 15 : b >> 4) << 28) >> 28
      const s = clamp16(shr11(nib * scale * 2048 + 1024 + c1 * h1 + c2 * h2))
      out[i] = s
      h2 = h1
      h1 = s
    }
  }
  return out
}

export function contextAt(a: Adpcm, at: number): Context {
  const ps = a.data[Math.floor(at / FRAME_SAMPLES) * FRAME_BYTES]
  if (at === 0) return { ps, hist1: 0, hist2: 0 }
  const pcm = decode({ ...a, samples: at })
  return { ps, hist1: pcm[at - 1], hist2: at > 1 ? pcm[at - 2] : 0 }
}

function correlate(pcm: Int16Array, f: number): Float64Array {
  const r = new Float64Array(6)
  const at = (i: number) => (i >= 0 && i < pcm.length ? pcm[i] : 0)
  for (let i = f * FRAME_SAMPLES; i < (f + 1) * FRAME_SAMPLES; i++) {
    const x0 = at(i), x1 = at(i - 1), x2 = at(i - 2)
    r[0] += x0 * x0; r[1] += x0 * x1; r[2] += x0 * x2
    r[3] += x1 * x1; r[4] += x1 * x2; r[5] += x2 * x2
  }
  return r
}

function solve(r: Float64Array): [number, number] {
  const eps = 1e-6 * (r[3] + r[5]) + 1e-9
  const a = r[3] + eps, b = r[4], d = r[5] + eps
  const det = a * d - b * b
  if (Math.abs(det) < 1e-12) return [a > 0 ? r[1] / a : 0, 0]
  return [(r[1] * d - r[2] * b) / det, (r[2] * a - r[1] * b) / det]
}

function residual(r: Float64Array, c1: number, c2: number): number {
  return r[0] - 2 * c1 * r[1] - 2 * c2 * r[2] + c1 * c1 * r[3] + 2 * c1 * c2 * r[4] + c2 * c2 * r[5]
}

const quantize = (c: number) => Math.max(-32768, Math.min(32767, Math.round(c * 2048)))

// Eight predictor pairs for a whole sample: a Lloyd clustering of the frames by their residual, splitting 1 -> 2 -> 4 -> 8.
export function predictors(pcm: Int16Array): Int16Array {
  const frames = Math.ceil(pcm.length / FRAME_SAMPLES)
  const rs = Array.from({ length: frames }, (_, f) => correlate(pcm, f)).filter((r) => r[0] > 0)
  const sum = (group: Float64Array[]) => group.reduce((acc, r) => { for (let k = 0; k < 6; k++) acc[k] += r[k]; return acc }, new Float64Array(6))
  let set: [number, number][] = [rs.length ? solve(sum(rs)) : [0, 0]]
  while (set.length < 8) {
    set = set.flatMap(([c1, c2]): [number, number][] => [[c1 * 1.01 + 0.01, c2 * 1.01], [c1 * 0.99 - 0.01, c2 * 0.99]])
    for (let iter = 0; iter < 8; iter++) {
      const groups: Float64Array[][] = set.map(() => [])
      for (const r of rs) {
        let best = 0, err = Infinity
        set.forEach(([c1, c2], k) => {
          const e = residual(r, c1, c2)
          if (e < err) { err = e; best = k }
        })
        groups[best].push(r)
      }
      set = set.map((p, k) => (groups[k].length ? solve(sum(groups[k])) : p))
    }
  }
  const out = new Int16Array(16)
  set.forEach(([c1, c2], k) => { out[2 * k] = quantize(c1); out[2 * k + 1] = quantize(c2) })
  return out
}

export function encode(pcm: Int16Array, coefs: Int16Array = predictors(pcm)): Adpcm {
  const frames = Math.ceil(pcm.length / FRAME_SAMPLES)
  const data = new Uint8Array(frames * FRAME_BYTES)
  const nibs = new Int8Array(FRAME_SAMPLES), bestNibs = new Int8Array(FRAME_SAMPLES)
  let h1 = 0, h2 = 0
  for (let f = 0; f < frames; f++) {
    const n = Math.min(FRAME_SAMPLES, pcm.length - f * FRAME_SAMPLES)
    let bestErr = Infinity, bestPs = 0, bestH1 = 0, bestH2 = 0
    for (let p = 0; p < 8; p++) {
      const c1 = coefs[2 * p], c2 = coefs[2 * p + 1]
      for (let s = 0; s < 12; s++) {
        const scale = 1 << s
        let a1 = h1, a2 = h2, err = 0
        for (let k = 0; k < n && err < bestErr; k++) {
          const x = pcm[f * FRAME_SAMPLES + k]
          const pred = c1 * a1 + c2 * a2
          let nib = Math.round((x * 2048 - pred - 1024) / (scale * 2048))
          nib = nib > 7 ? 7 : nib < -8 ? -8 : nib
          const y = clamp16(shr11(nib * scale * 2048 + 1024 + pred))
          nibs[k] = nib
          err += (x - y) * (x - y)
          a2 = a1
          a1 = y
        }
        if (err < bestErr) {
          bestErr = err; bestPs = p << 4 | s; bestH1 = a1; bestH2 = a2
          bestNibs.set(nibs)
        }
      }
    }
    const o = f * FRAME_BYTES
    data[o] = bestPs
    for (let k = 0; k < n; k++) data[o + 1 + (k >> 1)] |= (bestNibs[k] & 15) << (k & 1 ? 0 : 4)
    h1 = bestH1
    h2 = bestH2
  }
  return { samples: pcm.length, coefs, data }
}

// Nibble address of a sample, counting frame headers: what a .dsp header's loop and current addresses hold.
const nibbleAddress = (i: number) => Math.floor(i / FRAME_SAMPLES) * 16 + (i % FRAME_SAMPLES) + 2
const sampleOf = (addr: number) => Math.floor(addr / 16) * FRAME_SAMPLES + (addr % 16) - 2

export function writeDsp(d: DspFile): Uint8Array {
  const out = new Uint8Array(DSP_HEADER + d.data.length)
  putU32be(out, 0, d.samples)
  putU32be(out, 4, nibbleAddress(d.samples - 1) + 1)
  putU32be(out, 8, d.rate)
  putU16be(out, 0xc, d.loop ? 1 : 0)
  putU32be(out, 0x10, nibbleAddress(d.loop ? d.loop[0] : 0))
  putU32be(out, 0x14, nibbleAddress(d.loop ? d.loop[1] : d.samples - 1))
  putU32be(out, 0x18, 2)
  for (let k = 0; k < 16; k++) putU16be(out, 0x1c + 2 * k, d.coefs[k] & 0xffff)
  putU16be(out, 0x3e, d.data[0])
  if (d.loop) {
    putU16be(out, 0x44, d.loopContext.ps)
    putU16be(out, 0x46, d.loopContext.hist1 & 0xffff)
    putU16be(out, 0x48, d.loopContext.hist2 & 0xffff)
  }
  out.set(d.data, DSP_HEADER)
  return out
}

export const MIN_RATE = 8000
export const MAX_RATE = 32000

export function readDsp(body: Uint8Array, maxSeconds = Infinity): DspFile {
  if (body.length < DSP_HEADER) throw new LabError('a sound file is shorter than its header')
  const samples = u32be(body, 0), rate = u32be(body, 8), looped = u16be(body, 0xc)
  if (u16be(body, 0xe) !== 0) throw new LabError('a sound file is not DSP ADPCM')
  if (samples < 1 || u32be(body, 4) !== nibbleAddress(samples - 1) + 1) throw new LabError('a sound file has a bad sample count')
  if (rate < MIN_RATE || rate > MAX_RATE) throw new LabError(`a sound file's rate is outside ${MIN_RATE}-${MAX_RATE} Hz`)
  if (samples / rate > maxSeconds) throw new LabError(`a sound file is longer than ${maxSeconds} seconds`)
  if (looped > 1 || u32be(body, 0x18) !== 2) throw new LabError('a sound file has a bad header')
  if (body.length !== DSP_HEADER + dataSize(samples)) throw new LabError('a sound file\'s data does not match its sample count')
  const coefs = new Int16Array(16)
  for (let k = 0; k < 16; k++) coefs[k] = i16be(body, 0x1c + 2 * k)
  let loop: [number, number] | null = null
  if (looped) {
    loop = [sampleOf(u32be(body, 0x10)), sampleOf(u32be(body, 0x14))]
    if (loop[0] < 0 || loop[1] >= samples || loop[0] > loop[1]) throw new LabError('a sound file loops outside its samples')
  }
  const data = body.slice(DSP_HEADER)
  return { samples, rate, coefs, data, loop, loopContext: { ps: u16be(body, 0x44), hist1: i16be(body, 0x46), hist2: i16be(body, 0x48) } }
}
