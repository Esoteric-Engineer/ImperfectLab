import { LabError } from '../errors'

export class Rd {
  readonly v: DataView
  o: number
  readonly d: Uint8Array
  readonly le: boolean
  constructor(d: Uint8Array, le: boolean, o = 0) {
    this.d = d; this.le = le
    this.v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    this.o = o
  }
  u8() { return this.d[this.o++] }
  i8() { const x = this.v.getInt8(this.o); this.o += 1; return x }
  u16() { const x = this.v.getUint16(this.o, this.le); this.o += 2; return x }
  i16() { const x = this.v.getInt16(this.o, this.le); this.o += 2; return x }
  u32() { const x = this.v.getUint32(this.o, this.le); this.o += 4; return x }
  i32() { const x = this.v.getInt32(this.o, this.le); this.o += 4; return x }
  f32() { const x = this.v.getFloat32(this.o, this.le); this.o += 4; return x }
  raw(n: number) { if (this.o + n > this.d.length) throw new LabError('unexpected end of data'); const x = this.d.subarray(this.o, this.o + n); this.o += n; return x }
  name32() { const b = this.raw(32); let e = b.indexOf(0); if (e < 0) e = 32; return String.fromCharCode(...b.subarray(0, e)) }
}

export class Wr {
  private buf: Uint8Array
  private v: DataView
  length = 0
  readonly le: boolean
  constructor(le: boolean, size = 1 << 16) {
    this.le = le
    this.buf = new Uint8Array(size)
    this.v = new DataView(this.buf.buffer)
  }
  private need(n: number) {
    if (this.length + n <= this.buf.length) return
    let s = this.buf.length * 2
    while (s < this.length + n) s *= 2
    const b = new Uint8Array(s); b.set(this.buf.subarray(0, this.length)); this.buf = b; this.v = new DataView(b.buffer)
  }
  u8(x: number) { this.need(1); this.buf[this.length++] = x & 255; return this }
  i8(x: number) { this.need(1); this.v.setInt8(this.length, x); this.length += 1; return this }
  u16(x: number) { this.need(2); this.v.setUint16(this.length, x, this.le); this.length += 2; return this }
  i16(x: number) { this.need(2); this.v.setInt16(this.length, x, this.le); this.length += 2; return this }
  u32(x: number) { this.need(4); this.v.setUint32(this.length, x >>> 0, this.le); this.length += 4; return this }
  i32(x: number) { this.need(4); this.v.setInt32(this.length, x, this.le); this.length += 4; return this }
  f32(x: number) { this.need(4); this.v.setFloat32(this.length, x, this.le); this.length += 4; return this }
  bytes(b: ArrayLike<number>) { this.need(b.length); this.buf.set(b, this.length); this.length += b.length; return this }
  zeros(n: number) { this.need(n); this.buf.fill(0, this.length, this.length + n); this.length += n; return this }
  fill(n: number, v: number) { this.need(n); this.buf.fill(v, this.length, this.length + n); this.length += n; return this }
  name32(s: string) { const b = new Uint8Array(32); for (let i = 0; i < Math.min(32, s.length); i++) b[i] = s.charCodeAt(i); return this.bytes(b) }
  finish() { return this.buf.slice(0, this.length) }
}