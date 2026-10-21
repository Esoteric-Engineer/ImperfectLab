import { LabError } from './errors'

export type Bytes = Uint8Array

const scratch = new DataView(new ArrayBuffer(8))

export const u8 = (d: Bytes, o: number) => d[o]
export const u16be = (d: Bytes, o: number) => (d[o] << 8) | d[o + 1]
export const u32be = (d: Bytes, o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0
export const i32be = (d: Bytes, o: number) => (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]
export const i16be = (d: Bytes, o: number) => (u16be(d, o) << 16) >> 16
export const u16le = (d: Bytes, o: number) => d[o] | (d[o + 1] << 8)
export const u32le = (d: Bytes, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0
export const i32le = (d: Bytes, o: number) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)
export const i8 = (d: Bytes, o: number) => (d[o] << 24) >> 24

export function f32be(d: Bytes, o: number): number {
  scratch.setUint32(0, u32be(d, o))
  return scratch.getFloat32(0)
}

export function f32le(d: Bytes, o: number): number {
  scratch.setUint32(0, u32le(d, o))
  return scratch.getFloat32(0)
}

export function putU16be(d: Bytes, o: number, v: number) {
  d[o] = (v >>> 8) & 255
  d[o + 1] = v & 255
}

export function putU32be(d: Bytes, o: number, v: number) {
  d[o] = (v >>> 24) & 255
  d[o + 1] = (v >>> 16) & 255
  d[o + 2] = (v >>> 8) & 255
  d[o + 3] = v & 255
}

export function putU32le(d: Bytes, o: number, v: number) {
  d[o] = v & 255
  d[o + 1] = (v >>> 8) & 255
  d[o + 2] = (v >>> 16) & 255
  d[o + 3] = (v >>> 24) & 255
}

export function putF32be(d: Bytes, o: number, v: number) {
  scratch.setFloat32(0, v)
  putU32be(d, o, scratch.getUint32(0))
}

export function putF32le(d: Bytes, o: number, v: number) {
  scratch.setFloat32(0, v)
  putU32le(d, o, scratch.getUint32(0))
}

export function f32bits(v: number): number {
  scratch.setFloat32(0, v)
  return scratch.getUint32(0)
}

export function roundF32(v: number): number {
  return Math.fround(v)
}

export function latin1(d: Bytes, start = 0, end = d.length): string {
  let s = ''
  for (let i = start; i < end; i += 8192) {
    s += String.fromCharCode(...d.subarray(i, Math.min(end, i + 8192)))
  }
  return s
}

export function encodeLatin1(s: string): Bytes {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 255) throw new LabError(`${JSON.stringify(s)} has a character outside latin-1`)
    out[i] = c
  }
  return out
}

export function utf8(s: string): Bytes {
  return new TextEncoder().encode(s)
}

export function cstring(d: Bytes, start = 0, end = d.length): string {
  const z = d.indexOf(0, start)
  return latin1(d, start, z < 0 || z > end ? end : z)
}

export function concat(parts: Bytes[]): Bytes {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function equal(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function startsWith(d: Bytes, prefix: Bytes | string, at = 0): boolean {
  const p = typeof prefix === 'string' ? encodeLatin1(prefix) : prefix
  if (d.length < at + p.length) return false
  for (let i = 0; i < p.length; i++) if (d[at + i] !== p[i]) return false
  return true
}

export function indexOfBytes(d: Bytes, needle: Bytes, from = 0): number {
  const first = needle[0]
  for (let i = d.indexOf(first, from); i >= 0 && i <= d.length - needle.length; i = d.indexOf(first, i + 1)) {
    let k = 1
    while (k < needle.length && d[i + k] === needle[k]) k++
    if (k === needle.length) return i
  }
  return -1
}

export function fromHex(s: string): Bytes {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16)
  return out
}

export function toHex(d: Bytes): string {
  let s = ''
  for (const b of d) s += b.toString(16).padStart(2, '0')
  return s
}

export class ByteWriter {
  private buf: Uint8Array
  length = 0

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity)
  }

  private reserve(n: number) {
    if (this.length + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.length + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
  }

  bytes(d: ArrayLike<number>) {
    this.reserve(d.length)
    this.buf.set(d, this.length)
    this.length += d.length
    return this
  }

  byte(v: number) {
    this.reserve(1)
    this.buf[this.length++] = v & 255
    return this
  }

  zeros(n: number) {
    if (n <= 0) return this
    this.reserve(n)
    this.buf.fill(0, this.length, this.length + n)
    this.length += n
    return this
  }

  u16be(v: number) {
    this.reserve(2)
    putU16be(this.buf, this.length, v)
    this.length += 2
    return this
  }

  u32be(v: number) {
    this.reserve(4)
    putU32be(this.buf, this.length, v)
    this.length += 4
    return this
  }

  u32le(v: number) {
    this.reserve(4)
    putU32le(this.buf, this.length, v)
    this.length += 4
    return this
  }

  f32be(v: number) {
    this.reserve(4)
    putF32be(this.buf, this.length, v)
    this.length += 4
    return this
  }

  f32le(v: number) {
    this.reserve(4)
    putF32le(this.buf, this.length, v)
    this.length += 4
    return this
  }

  latin1(s: string) {
    return this.bytes(encodeLatin1(s))
  }

  align(n: number) {
    return this.zeros((n - (this.length % n)) % n)
  }

  view(): Bytes {
    return this.buf.subarray(0, this.length)
  }

  finish(): Bytes {
    return this.buf.slice(0, this.length)
  }
}
