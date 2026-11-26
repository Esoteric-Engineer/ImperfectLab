// GameCube .ngb to Xbox .nnb: the same layout, little-endian.
import { LabError } from '../errors'
import { Rd, Wr } from './bin'

const HEAD = 0x50
const RAW_HEAD = new Set([0x30, 0x40, 0x48])  // header words holding tool-time pointers, stored as-is on both consoles

export function ngbToNnb(d: Uint8Array): Uint8Array {
  const r = new Rd(d, false); const w = new Wr(true, d.length + 64); let o = 0
  while (o + HEAD <= d.length) {
    const name = String.fromCharCode(...d.subarray(o, o + 32)).split('\0')[0]
    if (!name.toLowerCase().endsWith('.nad')) throw new LabError(`no animation record at 0x${o.toString(16)}`)
    const ntr = r.v.getUint32(o + 0x2c), nev = r.v.getUint32(o + 0x3c), nex = r.v.getUint32(o + 0x44)
    w.bytes(d.subarray(o, o + 32))
    for (let k = 0x20; k < HEAD; k += 4) { if (RAW_HEAD.has(k)) w.bytes(d.subarray(o + k, o + k + 4)); else w.u32(r.v.getUint32(o + k)) }
    let p = o + HEAD
    const counts: number[] = []
    for (let i = 0; i < ntr; i++) { const q = p + 16 * i; w.u32(r.v.getUint32(q)).u32(r.v.getUint32(q + 4)).u32(r.v.getUint32(q + 8)).u32(r.v.getUint32(q + 12)); counts.push(r.v.getUint32(q + 8)) }
    p += 16 * ntr
    for (const nk of counts) for (let k = 0; k < nk; k++, p += 12) { w.f32(r.v.getFloat32(p)); for (let j = 0; j < 4; j++) w.i16(r.v.getInt16(p + 4 + 2 * j)) }
    for (let k = 0; k < nev; k++, p += 12) w.f32(r.v.getFloat32(p)).u16(r.v.getUint16(p + 4)).u16(r.v.getUint16(p + 6)).u32(r.v.getUint32(p + 8))
    for (let k = 0; k < nex; k++, p += 0x50) { for (let j = 0; j < 0x4c; j += 4) w.u32(r.v.getUint32(p + j)); w.bytes(d.subarray(p + 0x4c, p + 0x50)) }
    const end = (p + 3) & ~3
    w.bytes(d.subarray(p, end))
    o = end
  }
  if (o !== d.length) throw new LabError(`.ngb parse ends at 0x${o.toString(16)} of 0x${d.length.toString(16)}`)
  return w.finish()
}