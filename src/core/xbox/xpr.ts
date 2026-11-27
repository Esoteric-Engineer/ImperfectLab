// XPR1 texture packs: a 2048-byte header of names and D3D resources, then the data.
import { LabError } from '../errors'
import { Rd } from './bin'

export interface XTex { name: string; format: number; data: Uint8Array }   // format: the D3D format dword
const BLOCK: Record<number, number> = { 0x0c: 8, 0x0e: 16, 0x0f: 16 }    // DXT1, DXT3, DXT5
const PIXEL: Record<number, number> = { 0x06: 4, 0x07: 4, 0x12: 4, 0x1e: 4, 0x05: 2, 0x04: 2, 0x02: 2, 0x00: 1, 0x0b: 1 }

export const fmtOf = (f: number) => (f >>> 8) & 0xff
export const mipsOf = (f: number) => (f >>> 16) & 0xf
export const widthOf = (f: number) => 1 << ((f >>> 20) & 0xf)
export const heightOf = (f: number) => 1 << ((f >>> 24) & 0xf)

export function texBytes(f: number): number {
  const fmt = fmtOf(f); let w = widthOf(f), h = heightOf(f), n = 0
  for (let i = 0; i < mipsOf(f); i++) {
    if (fmt in BLOCK) n += Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLOCK[fmt]
    else if (fmt in PIXEL) n += w * h * PIXEL[fmt]
    else throw new LabError(`XPR texture format 0x${fmt.toString(16)} is not supported`)
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1)
  }
  if (f & 4) return n * 6                                         // cube map
  if (((f >>> 4) & 0xf) === 3) return n * (1 << ((f >>> 28) & 0xf))  // volume texture
  return n
}

// the first 2048 bytes are enough
export function xprNames(head: Uint8Array): [string, number][] {
  if (String.fromCharCode(...head.subarray(0, 4)) !== 'XPR1') return []
  const r = new Rd(head, true); const n = r.v.getUint32(12, true); const out: [string, number][] = []
  for (let i = 0; i < n; i++) {
    const no = r.v.getUint32(16 + 8 * i, true), ro = r.v.getUint32(20 + 8 * i, true)
    if (12 + ro + 20 > head.length) break
    const e = head.indexOf(0, 12 + no); if (e < 0) break
    out.push([String.fromCharCode(...head.subarray(12 + no, e)), r.v.getUint32(12 + ro + 12, true)])
  }
  return out
}

export function readXpr(d: Uint8Array): XTex[] {
  if (String.fromCharCode(...d.subarray(0, 4)) !== 'XPR1') throw new LabError('not an XPR1 texture pack')
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength); const hdr = v.getUint32(8, true), n = v.getUint32(12, true); const out: XTex[] = []
  for (let i = 0; i < n; i++) {
    const no = v.getUint32(16 + 8 * i, true), ro = v.getUint32(20 + 8 * i, true)
    const name = String.fromCharCode(...d.subarray(12 + no, d.indexOf(0, 12 + no)))
    const off = v.getUint32(12 + ro + 4, true), fmt = v.getUint32(12 + ro + 12, true)
    out.push({ name, format: fmt, data: d.slice(hdr + off, hdr + off + texBytes(fmt)) })
  }
  return out
}

export function writeXpr(texs: XTex[]): Uint8Array {
  const n = texs.length, base = 4 + 8 * n + 4
  const enc = texs.map((t) => Uint8Array.from(t.name, (c) => c.charCodeAt(0)))
  const nameOff: number[] = []; let p = base
  for (const e of enc) { nameOff.push(p); p += e.length + 1 }
  const tbl = (p + 15) & ~15
  let body = 0; const offs: number[] = []
  for (const t of texs) { offs.push(body); body = (body + t.data.length + 127) & ~127 }
  const end = 2048 + (offs.length ? offs[n - 1] + texs[n - 1].data.length : 0)
  const total = (end + 2047) & ~2047
  const out = new Uint8Array(total).fill(0xad); const v = new DataView(out.buffer)
  out.set([0x58, 0x50, 0x52, 0x31]); v.setUint32(4, total, true); v.setUint32(8, 2048, true)
  out.fill(0, 12, 12 + tbl)
  v.setUint32(12, n, true)
  for (let i = 0; i < n; i++) { v.setUint32(16 + 8 * i, nameOff[i], true); v.setUint32(20 + 8 * i, tbl + 20 * i, true); out.set(enc[i], 12 + nameOff[i]); out[12 + nameOff[i] + enc[i].length] = 0 }
  for (let i = 0; i < n; i++) { const o = 12 + tbl + 20 * i; v.setUint32(o, 0x00040001, true); v.setUint32(o + 4, offs[i], true); v.setUint32(o + 8, 0, true); v.setUint32(o + 12, texs[i].format, true); v.setUint32(o + 16, 0, true) }
  v.setUint32(12 + tbl + 20 * n, 0xffffffff, true)
  if (12 + tbl + 20 * n + 4 > 2048) throw new LabError('too many textures for one XPR header')
  texs.forEach((t, i) => out.set(t.data, 2048 + offs[i]))
  return out
}

export function dxt1Format(w: number, h: number, mips: number): number {
  return (0x29 | (0x0c << 8) | (mips << 16) | (Math.log2(w) << 20) | (Math.log2(h) << 24)) >>> 0
}