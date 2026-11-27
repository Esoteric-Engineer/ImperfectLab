// Xbox UI image banks; a record's offset + 0x20 is 0x80-aligned.
import { LabError } from '../errors'
import { quantizeOctree } from '../image/quantize'
import { RgbaImage } from '../image'
import { decodeDxt1, encodeDxt1 } from './dxt'

export interface Bank { magic: Uint8Array; names: string[]; recs: Map<string, Uint8Array>; tag: Uint8Array; padEnd: boolean }
const be32 = (d: Uint8Array, o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0

export function readBank(d: Uint8Array): Bank {
  const n = be32(d, 8), head = be32(d, 12); let o = 16; const names: string[] = []; const recs = new Map<string, Uint8Array>()
  for (let i = 0; i < n; i++) { const off = be32(d, o), sz = be32(d, o + 4), e = d.indexOf(0, o + 8); const nm = String.fromCharCode(...d.subarray(o + 8, e)); names.push(nm); recs.set(nm, d.slice(off, off + sz)); o = e + 1 }
  return { magic: d.slice(0, 4), names, recs, tag: d.slice(o, head), padEnd: d.length % 0x20 === 0 }
}

export function buildBank(b: Bank): Uint8Array {
  let head = 16 + b.tag.length; for (const n of b.names) head += 8 + n.length + 1
  let pos = head; const offs: number[] = []
  for (const n of b.names) { pos = ((pos + 0x20 + 0x7f) & ~0x7f) - 0x20; offs.push(pos); pos += b.recs.get(n)!.length }
  const total = b.padEnd ? (pos + 0x1f) & ~0x1f : pos
  const out = new Uint8Array(total); const v = new DataView(out.buffer)
  out.set(b.magic); v.setUint32(4, total, true); v.setUint32(8, b.names.length); v.setUint32(12, head)
  let o = 16
  b.names.forEach((n, i) => { v.setUint32(o, offs[i]); v.setUint32(o + 4, b.recs.get(n)!.length); for (let k = 0; k < n.length; k++) out[o + 8 + k] = n.charCodeAt(k); o += 8 + n.length + 1 })
  out.set(b.tag, o); o += b.tag.length
  const PAD = [0x42, 0x75, 0x79, 0x20, 0x45, 0x52, 0x54, 0x53]   // 'Buy ERTS'
  b.names.forEach((n, i) => { out.set(PAD.slice(0, Math.min(8, offs[i] - o)), o); out.set(b.recs.get(n)!, offs[i]); o = offs[i] + b.recs.get(n)!.length })
  return out
}

export function addCopies(d: Uint8Array, copies: [string, string][]): Uint8Array {
  const b = readBank(d)
  for (const [name, tmpl] of copies) {
    if (b.recs.has(name)) continue
    const r = b.recs.get(tmpl)
    if (!r) throw new LabError(`the image bank has no ${tmpl}`)
    b.recs.set(name, r); b.names.push(name)
  }
  return buildBank(b)
}

interface Block { type: number; at: number; pixels: number; size: number; w: number; h: number }
function blocks(r: Uint8Array): Block[] {
  const v = new DataView(r.buffer, r.byteOffset, r.byteLength); const out: Block[] = []; let p = 0
  for (;;) {
    out.push({ type: r[p], at: p, pixels: p + v.getUint32(p + 8, true), size: v.getUint32(p + 12, true), w: v.getUint32(p + 0x18, true), h: v.getUint32(p + 0x1c, true) })
    const next = v.getUint32(p + 4, true)
    if (!next) return out
    p += next
  }
}
const pow2 = (v: number) => (v & (v - 1)) === 0
function morton(w: number, h: number): Int32Array {
  const lw = Math.log2(w), lh = Math.log2(h), m = Math.min(lw, lh); const out = new Int32Array(w * h)
  const spread = (v: number) => { let r = 0; for (let i = 0; i < m; i++) r |= ((v >> i) & 1) << (2 * i); return r }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lo = spread(x & ((1 << m) - 1)) | (spread(y & ((1 << m) - 1)) << 1), hi = lw > lh ? x >> m : y >> m
    out[y * w + x] = lo | (hi * (1 << (2 * m)))
  }
  return out
}

export function recordSize(r: Uint8Array): [number, number] { const b = blocks(r)[0]; return [b.w, b.h] }

export function decodeRecord(r: Uint8Array): RgbaImage {
  const bl = blocks(r), im = bl[0]
  if (im.type === 0x60) return new RgbaImage(im.w, im.h, decodeDxt1(r.subarray(im.pixels), im.w, im.h))
  if (im.type !== 0x7b) throw new LabError(`UI image type 0x${im.type.toString(16)} is not supported`)
  const pal = bl.find((b) => b.type === 0x2a)!; const out = new Uint8Array(im.w * im.h * 4)
  const idx = r.subarray(im.pixels, im.pixels + im.w * im.h); const sw = pow2(im.w) && pow2(im.h) ? morton(im.w, im.h) : null
  for (let i = 0; i < im.w * im.h; i++) {
    const c = idx[sw ? sw[i] : i], q = pal.pixels + 4 * c
    if (c < pal.w) out.set([r[q + 2], r[q + 1], r[q], r[q + 3]], 4 * i)
  }
  return new RgbaImage(im.w, im.h, out)
}

export function encodeRecord(template: Uint8Array, im: RgbaImage): Uint8Array {
  const r = template.slice(); const bl = blocks(r), b = bl[0]
  if (im.width !== b.w || im.height !== b.h) throw new LabError(`a ${im.width}x${im.height} picture for a ${b.w}x${b.h} image`)
  if (b.type === 0x60) { r.set(encodeDxt1(im.data, b.w, b.h), b.pixels); return r }
  if (b.type !== 0x7b) throw new LabError(`UI image type 0x${b.type.toString(16)} is not supported`)
  const pal = bl.find((x) => x.type === 0x2a)!
  const [colors, idx] = quantizeOctree(im, pal.w)
  for (let i = 0; i < pal.w; i++) { const c = colors[i] ?? [0, 0, 0, 0]; r.set([c[2], c[1], c[0], c[3] ?? 255], pal.pixels + 4 * i) }
  const sw = pow2(b.w) && pow2(b.h) ? morton(b.w, b.h) : null
  for (let i = 0; i < b.w * b.h; i++) r[b.pixels + (sw ? sw[i] : i)] = idx[i]
  return r
}

export function replaceImages(d: Uint8Array, pictures: Map<string, RgbaImage>): Uint8Array {
  const b = readBank(d)
  for (const [name, im] of pictures) {
    const t = b.recs.get(name)
    if (!t) throw new LabError(`the image bank has no ${name}`)
    b.recs.set(name, encodeRecord(t, im))
  }
  return buildBank(b)
}