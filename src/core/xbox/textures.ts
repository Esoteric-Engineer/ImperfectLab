import { LabError } from '../errors'
import * as gxtex from '../mnroi/gxtex'
import type { XboxDisc } from './disc'
import { encodeDxt1 } from './dxt'
import { dxt1Format, fmtOf, readXpr, writeXpr, xprNames, type XTex } from './xpr'

// the stock Xbox textures by name, so a GameCube texture the Xbox already has is taken from there
export class XboxTextures {
  private index: Map<string, string> | null = null
  private cache = new Map<string, XTex[]>()
  private x: XboxDisc
  constructor(x: XboxDisc) { this.x = x }
  find(name: string): XTex | null {
    if (!this.index) {
      this.index = new Map()
      for (const f of this.x.list('Bundles/')) if (f.toLowerCase().endsWith('.xpr')) for (const [n] of xprNames(this.x.head(f, 2048))) if (!this.index.has(n.toLowerCase())) this.index.set(n.toLowerCase(), f)
    }
    const f = this.index.get(name.toLowerCase()); if (!f) return null
    if (!this.cache.has(f)) this.cache.set(f, readXpr(this.x.entry(f)))
    return this.cache.get(f)!.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null
  }
}

export function tplToXpr(ngt: Uint8Array, tpl: Uint8Array, textures: XboxTextures, bundle: string): Uint8Array {
  const names = String.fromCharCode(...ngt).split(/\r?\n/).filter((s) => s.length)
  const [images] = gxtex.readTpl(tpl)
  if (images.length !== names.length) throw new LabError(`${bundle}: ${names.length} texture names for ${images.length} pictures`)
  const out: XTex[] = []
  names.forEach((name, i) => {
    const stock = textures.find(name)
    if (stock) { out.push({ ...stock, name }); return }
    const im = images[i]; const w = im.width, h = im.height
    if ((w & (w - 1)) || (h & (h - 1))) throw new LabError(`${bundle}: texture ${name} is ${w}x${h}, not a power of two`)
    let rgba = gxtex.decode(im.format, im.base(), w, h)
    const mips = Math.log2(Math.min(w, h)) + 1; const parts: Uint8Array[] = []
    let cw = w, ch = h
    for (let m = 0; m < mips; m++) {
      parts.push(encodeDxt1(rgba, cw, ch))
      if (m + 1 < mips) { const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1); rgba = halve(rgba, cw, ch, nw, nh); cw = nw; ch = nh }
    }
    const data = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { data.set(p, o); o += p.length }
    out.push({ name, format: dxt1Format(w, h, mips), data })
  })
  return writeXpr(out)
}
// a DXT1 or DXT5 texture as DXT5 with one alpha everywhere
export function ghostTexture(t: XTex, name: string, alpha: number): XTex | null {
  const fmt = fmtOf(t.format)
  if (fmt !== 0x0c && fmt !== 0x0f) return null
  const n = fmt === 0x0c ? t.data.length / 8 : t.data.length / 16
  const data = new Uint8Array(n * 16), src = new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength), dst = new DataView(data.buffer)
  for (let i = 0; i < n; i++) {
    const o = i * 16; data[o] = alpha; data[o + 1] = alpha
    if (fmt === 0x0f) { data.set(t.data.subarray(o + 8, o + 16), o + 8); continue }
    const c0 = src.getUint16(i * 8, true), c1 = src.getUint16(i * 8 + 2, true); let idx = src.getUint32(i * 8 + 4, true)
    if (c0 > c1) { dst.setUint16(o + 8, c0, true); dst.setUint16(o + 10, c1, true) }
    else {
      let x = 0
      for (let k = 0; k < 16; k++) { const v = (idx >>> (2 * k)) & 3; x |= (v === 0 ? 1 : v === 1 ? 0 : 2) << (2 * k) }
      idx = x >>> 0
      dst.setUint16(o + 8, c1, true); dst.setUint16(o + 10, c0, true)
    }
    dst.setUint32(o + 12, idx, true)
  }
  return { name, format: ((t.format & ~0xff00) | 0x0f00) >>> 0, data }
}
export function halve(px: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let k = 0; k < 4; k++) {
    let s = 0, n = 0
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const sx = Math.min(w - 1, 2 * x + dx), sy = Math.min(h - 1, 2 * y + dy); s += px[(sy * w + sx) * 4 + k]; n++ }
    out[(y * nw + x) * 4 + k] = Math.round(s / n)
  }
  return out
}