// EA-XA ADPCM, the codec of the cutscene streams: 28 samples in a 15-byte frame, or a 61-byte raw frame (0xEE).
import { i16be } from '../bytes'

export const FRAME_SAMPLES = 28
export const FRAME_BYTES = 15
const RAW_BYTES = 61
const RAW = 0xee
const C1 = [0, 240, 460, 392]
const C2 = [0, 0, -208, -220]

export interface History {
  h1: number
  h2: number
}

const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v)

// Returns the offset after the last frame read.
export function decode(d: Uint8Array, at: number, count: number, h: History, out: Int16Array, pos: number): number {
  for (let done = 0; done < count; done += FRAME_SAMPLES) {
    const k = Math.min(FRAME_SAMPLES, count - done)
    if (d[at] === RAW) {
      for (let i = 0; i < k; i++) out[pos++] = i16be(d, at + 5 + 2 * i)
      h.h1 = out[pos - 1]
      h.h2 = k > 1 ? out[pos - 2] : h.h1
      at += RAW_BYTES
      continue
    }
    const f = d[at] >> 4, sh = (d[at] & 15) + 8, c1 = C1[f & 3], c2 = C2[f & 3]
    for (let i = 0; i < k; i++) {
      const b = d[at + 1 + (i >> 1)]
      const nib = (i & 1 ? b << 28 : (b & 0xf0) << 24) >> sh
      const s = clamp16((nib + c1 * h.h1 + c2 * h.h2 + 128) >> 8)
      out[pos++] = s
      h.h2 = h.h1
      h.h1 = s
    }
    at += FRAME_BYTES
  }
  return at
}

function encodeFrame(x: Int16Array, from: number, k: number, h: History, out: Uint8Array, at: number) {
  let best = Infinity, bestF = 0, bestS = 0
  const nibs = new Int8Array(FRAME_SAMPLES), bestNibs = new Int8Array(FRAME_SAMPLES)
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s <= 12; s++) {
      const step = 1 << (20 - s), sh = s + 8
      let h1 = h.h1, h2 = h.h2, err = 0
      for (let i = 0; i < k && err < best; i++) {
        const pred = C1[f] * h1 + C2[f] * h2
        let n = Math.round((x[from + i] * 256 - pred) / step)
        n = n > 7 ? 7 : n < -8 ? -8 : n
        const y = clamp16((((n << 28) >> sh) + pred + 128) >> 8)
        const e = y - x[from + i]
        err += e * e
        nibs[i] = n
        h2 = h1
        h1 = y
      }
      if (err < best) {
        best = err
        bestF = f
        bestS = s
        bestNibs.set(nibs)
      }
    }
  }
  out[at] = (bestF << 4) | bestS
  for (let i = 0; i < FRAME_SAMPLES; i += 2) out[at + 1 + (i >> 1)] = ((i < k ? bestNibs[i] : 0) & 15) << 4 | ((i + 1 < k ? bestNibs[i + 1] : 0) & 15)
  decode(out, at, k, h, new Int16Array(k), 0)
}

export function encode(x: Int16Array, from: number, count: number, h: History): Uint8Array {
  const out = new Uint8Array(Math.ceil(count / FRAME_SAMPLES) * FRAME_BYTES)
  for (let done = 0, at = 0; done < count; done += FRAME_SAMPLES, at += FRAME_BYTES) {
    encodeFrame(x, from + done, Math.min(FRAME_SAMPLES, count - done), h, out, at)
  }
  return out
}
