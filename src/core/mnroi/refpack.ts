// EA RefPack, ported from mnroi tools/refpack.py (commit a23c796).
// The compressor is mnroi's greedy hash-chain one, not EA's: its streams are a little larger and decompress to the same bytes.
import { LabError } from '../errors'

export function decompress(src: Uint8Array): Uint8Array {
  const flags = (src[0] << 8) | src[1]
  if (src[1] !== 0xfb) throw new LabError(`not RefPack: ${src[0]?.toString(16)} ${src[1]?.toString(16)}`)
  let p = 2 + (flags & 0x0100 ? 3 : 0)
  const n = flags & 0x8000 ? 4 : 3
  let size = 0
  for (let i = 0; i < n; i++) size = size * 256 + src[p + i]
  p += n
  const out = new Uint8Array(size)
  let o = 0
  for (;;) {
    if (p >= src.length) throw new LabError('RefPack stream ends early')
    const b0 = src[p]
    let lit: number, off: number, cnt: number
    if (b0 < 0x80) {
      const b1 = src[p + 1]
      p += 2
      lit = b0 & 3
      off = ((b0 & 0x60) << 3) + b1 + 1
      cnt = ((b0 & 0x1c) >> 2) + 3
    } else if (b0 < 0xc0) {
      const b1 = src[p + 1], b2 = src[p + 2]
      p += 3
      lit = b1 >> 6
      off = ((b1 & 0x3f) << 8) + b2 + 1
      cnt = (b0 & 0x3f) + 4
    } else if (b0 < 0xe0) {
      const b1 = src[p + 1], b2 = src[p + 2], b3 = src[p + 3]
      p += 4
      lit = b0 & 3
      off = ((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1
      cnt = ((b0 & 0x0c) << 6) + b3 + 5
    } else if (b0 < 0xfc) {
      lit = ((b0 & 0x1f) << 2) + 4
      if (o + lit > size) throw new LabError(`header says ${size} bytes, got more`)
      out.set(src.subarray(p + 1, p + 1 + lit), o)
      o += lit
      p += 1 + lit
      continue
    } else {
      lit = b0 & 3
      if (o + lit > size) throw new LabError(`header says ${size} bytes, got more`)
      out.set(src.subarray(p + 1, p + 1 + lit), o)
      o += lit
      break
    }
    if (o + lit + cnt > size) throw new LabError(`header says ${size} bytes, got more`)
    out.set(src.subarray(p, p + lit), o)
    o += lit
    p += lit
    const start = o - off
    if (start < 0) throw new LabError('back reference before the start of the output')
    for (let i = 0; i < cnt; i++) out[o + i] = out[start + i]
    o += cnt
  }
  if (o !== size) throw new LabError(`header says ${size} bytes, got ${o}`)
  return out
}

export function compress(data: Uint8Array, window = 0x4000, maxChain = 48): Uint8Array {
  const n = data.length
  if (n >= 1 << 24) throw new LabError('too large for a 3-byte size')
  const out = new Uint8Array(5 + n + Math.ceil(n / 112) + 16)
  let o = 0
  out[o++] = 0x10
  out[o++] = 0xfb
  out[o++] = (n >> 16) & 255
  out[o++] = (n >> 8) & 255
  out[o++] = n & 255
  const head = new Map<number, number>()
  const prev = new Int32Array(n)
  let litStart = 0
  let p = 0
  const key = (i: number) => (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  const at = (i: number) => (i < n ? data[i] : -1)

  const flushLiterals = (upto: number) => {
    while (upto - litStart >= 4) {
      const run = Math.min(112, (upto - litStart) & ~3)
      out[o++] = 0xe0 + (run - 4) / 4
      out.set(data.subarray(litStart, litStart + run), o)
      o += run
      litStart += run
    }
  }
  const insert = (i: number) => {
    if (i + 3 <= n) {
      const k = key(i)
      const h = head.get(k)
      prev[i] = h === undefined ? -1 : h
      head.set(k, i)
    }
  }

  while (p < n) {
    let bestLen = 0
    let bestOff = 0
    if (p + 3 <= n) {
      const h = head.get(key(p))
      let cand = h === undefined ? -1 : h
      let chain = maxChain
      const limit = Math.min(n - p, 67)
      while (cand >= 0 && chain && p - cand <= window) {
        if (at(cand + bestLen) === at(p + bestLen)) {
          let k = 0
          while (k < limit && data[cand + k] === data[p + k]) k++
          if (k > bestLen) {
            bestLen = k
            bestOff = p - cand
            if (k === limit) break
          }
        }
        cand = prev[cand]
        chain--
      }
    }
    if (bestLen >= 3 && (bestOff <= 1024 || bestLen >= 4)) {
      flushLiterals(p)
      const lit = p - litStart
      const off = bestOff - 1
      if (bestLen <= 10 && bestOff <= 1024) {
        out[o++] = ((off >> 8) << 5) | ((bestLen - 3) << 2) | lit
        out[o++] = off & 255
      } else {
        out[o++] = 0x80 | (bestLen - 4)
        out[o++] = (lit << 6) | (off >> 8)
        out[o++] = off & 255
      }
      out.set(data.subarray(litStart, p), o)
      o += p - litStart
      for (let i = p; i < p + bestLen; i++) insert(i)
      p += bestLen
      litStart = p
    } else {
      insert(p)
      p++
    }
  }
  flushLiterals(n)
  out[o++] = 0xfc + (n - litStart)
  out.set(data.subarray(litStart), o)
  o += n - litStart
  return out.slice(0, o)
}
