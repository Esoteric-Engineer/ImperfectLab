// GameCube textures and TPL files, ported from mnroi tools/gxtex.py (commit a23c796).
import { ByteWriter, f32be, putF32be, putU16be, putU32be, u16be, u32be } from '../bytes'
import { LabError } from '../errors'

export const TPL_MAGIC = 0x0020af30
export const I4 = 0, I8 = 1, IA4 = 2, IA8 = 3, RGB565 = 4, RGB5A3 = 5, RGBA8 = 6, C4 = 8, C8 = 9, CMPR = 14
export const BLOCK: Record<number, [number, number, number]> = {
  [I4]: [8, 8, 4], [I8]: [8, 4, 8], [IA4]: [8, 4, 8], [IA8]: [4, 4, 16], [RGB565]: [4, 4, 16],
  [RGB5A3]: [4, 4, 16], [RGBA8]: [4, 4, 32], [C4]: [8, 8, 4], [C8]: [8, 4, 8], [CMPR]: [8, 8, 4],
}

export type Rgba = [number, number, number, number]

export function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

export function dataSize(fmt: number, w: number, h: number): number {
  const [bw, bh, bits] = BLOCK[fmt]
  return (Math.ceil(w / bw) * Math.ceil(h / bh) * bw * bh * bits) >> 3
}

export function levels(w: number, h: number, count: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < count; i++) {
    out.push([w, h])
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
  }
  return out
}

export function rgb565(c: number): Rgba {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255]
}

export function rgb5a3(c: number): Rgba {
  if (c & 0x8000) {
    const r = (c >> 10) & 31, g = (c >> 5) & 31, b = c & 31
    return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 255]
  }
  const a = (c >> 12) & 7
  return [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17, (a << 5) | (a << 2) | (a >> 1)]
}

export function toRgb565(p: ArrayLike<number>): number {
  return (
    (Math.floor((p[0] * 31 + 127) / 255) << 11) |
    (Math.floor((p[1] * 63 + 127) / 255) << 5) |
    Math.floor((p[2] * 31 + 127) / 255)
  )
}

export function toRgb5a3(p: ArrayLike<number>): number {
  const [r, g, b, a] = [p[0], p[1], p[2], p[3]]
  if (a >= 224) return 0x8000 | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  return ((a >> 5) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
}

export function gray(p: ArrayLike<number>): number {
  return Math.floor((p[0] * 299 + p[1] * 587 + p[2] * 114 + 500) / 1000)
}

export function toColor(fmt: number, p: ArrayLike<number>): number {
  if (fmt === IA8) return (p[3] << 8) | gray(p)
  return fmt === RGB565 ? toRgb565(p) : toRgb5a3(p)
}

export function blocks(fmt: number, w: number, h: number): Int32Array {
  const [bw, bh] = BLOCK[fmt]
  const W = Math.ceil(w / bw) * bw, H = Math.ceil(h / bh) * bh
  const out = new Int32Array(W * H * 2)
  let k = 0
  for (let ty = 0; ty < h; ty += bh)
    for (let tx = 0; tx < w; tx += bw)
      for (let y = ty; y < ty + bh; y++)
        for (let x = tx; x < tx + bw; x++) {
          out[k++] = x
          out[k++] = y
        }
  return out
}

function texelValues(fmt: number, data: Uint8Array, w: number, h: number): number[] {
  const bits = BLOCK[fmt][2]
  const n = dataSize(fmt, w, h)
  const out: number[] = []
  if (bits === 4) {
    for (let i = 0; i < n; i++) out.push(data[i] >> 4, data[i] & 15)
  } else if (bits === 8) {
    for (let i = 0; i < n; i++) out.push(data[i])
  } else if (bits === 16) {
    for (let i = 0; i < n; i += 2) out.push(u16be(data, i))
  } else {
    for (let p = 0; p < n; p += 64)
      for (let i = 0; i < 16; i++)
        out.push(((data[p + 2 * i] << 24) | (data[p + 2 * i + 1] << 16) | (data[p + 32 + 2 * i] << 8) | data[p + 33 + 2 * i]) >>> 0)
  }
  return out
}

export function texel(fmt: number, v: number, palette?: Rgba[]): Rgba {
  switch (fmt) {
    case I4: return [v * 17, v * 17, v * 17, 255]
    case I8: return [v, v, v, 255]
    case IA4: return [(v & 15) * 17, (v & 15) * 17, (v & 15) * 17, (v >> 4) * 17]
    case IA8: return [v & 255, v & 255, v & 255, v >> 8]
    case RGB565: return rgb565(v)
    case RGB5A3: return rgb5a3(v)
    case RGBA8: return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255, v >>> 24]
  }
  return palette && v < palette.length ? palette[v] : [0, 0, 0, 0]
}

function decodeCmpr(data: Uint8Array, w: number, h: number, out: Uint8Array) {
  let p = 0
  for (let ty = 0; ty < h; ty += 8)
    for (let tx = 0; tx < w; tx += 8)
      for (let sub = 0; sub < 4; sub++) {
        const c0 = u16be(data, p), c1 = u16be(data, p + 2)
        const a = rgb565(c0), b = rgb565(c1)
        const pal: Rgba[] = c0 > c1
          ? [a, b, a.map((v, i) => Math.floor((2 * v + b[i]) / 3)) as Rgba, a.map((v, i) => Math.floor((v + 2 * b[i]) / 3)) as Rgba]
          : [a, b, a.map((v, i) => (v + b[i]) >> 1) as Rgba, [0, 0, 0, 0]]
        const bx = tx + (sub & 1) * 4, by = ty + (sub >> 1) * 4
        for (let row = 0; row < 4; row++) {
          const bits = data[p + 4 + row]
          for (let col = 0; col < 4; col++) {
            const x = bx + col, y = by + row
            if (x < w && y < h) out.set(pal[(bits >> (6 - 2 * col)) & 3], (y * w + x) * 4)
          }
        }
        p += 8
      }
}

export function decode(fmt: number, data: Uint8Array, w: number, h: number, palette?: Rgba[]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  if (fmt === CMPR) {
    decodeCmpr(data, w, h, out)
  } else if (fmt in BLOCK) {
    const pos = blocks(fmt, w, h)
    const vals = texelValues(fmt, data, w, h)
    for (let k = 0; k < vals.length; k++) {
      const x = pos[2 * k], y = pos[2 * k + 1]
      if (x < w && y < h) out.set(texel(fmt, vals[k], palette), (y * w + x) * 4)
    }
  } else {
    throw new LabError(`GX format ${fmt} is not supported`)
  }
  return out
}

function encodeBlock(px: number[][]): number[] {
  const mean = [0, 1, 2].map((i) => {
    let s = 0
    for (const p of px) s += p[i]
    return s / 16
  })
  const d = px.map((p) => [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]])
  const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
    let s = 0
    for (const v of d) s += v[i] * v[j]
    return s
  }))
  let axis = [1.0, 1.0, 1.0]
  for (let it = 0; it < 6; it++) {
    const nxt = [0, 1, 2].map((i) => {
      let s = 0
      for (let j = 0; j < 3; j++) s += cov[i][j] * axis[j]
      return s
    })
    const norm = Math.max(...nxt.map(Math.abs)) || 1.0
    axis = nxt.map((x) => x / norm)
  }
  const proj = d.map((v) => {
    let s = 0
    for (let i = 0; i < 3; i++) s += v[i] * axis[i]
    return s
  })
  let lo = Math.min(...proj), hi = Math.max(...proj)
  if (hi - lo < 1e-6) lo = hi = 0.0
  const ends = [lo, hi].map((t) => [0, 1, 2].map((i) => Math.max(0, Math.min(255, roundHalfEven(mean[i] + axis[i] * t)))))
  let a = toRgb565(ends[0]), b = toRgb565(ends[1])
  if (b > a) [a, b] = [b, a]
  if (a === b) {
    if (a < 0xffff) a += 1
    else b -= 1
  }
  const ca = rgb565(a), cb = rgb565(b)
  const pal = [ca, cb, [0, 1, 2].map((i) => Math.floor((2 * ca[i] + cb[i]) / 3)), [0, 1, 2].map((i) => Math.floor((ca[i] + 2 * cb[i]) / 3))]
  const out = [a >> 8, a & 255, b >> 8, b & 255]
  for (let row = 0; row < 4; row++) {
    let byte = 0
    for (let col = 0; col < 4; col++) {
      const p = px[row * 4 + col]
      let best = 0, bestD = Infinity
      for (let j = 0; j < 4; j++) {
        const e = (p[0] - pal[j][0]) ** 2 + (p[1] - pal[j][1]) ** 2 + (p[2] - pal[j][2]) ** 2
        if (e < bestD) {
          bestD = e
          best = j
        }
      }
      byte |= best << (6 - 2 * col)
    }
    out.push(byte)
  }
  return out
}

export function encode(fmt: number, rgba: Uint8Array, w: number, h: number): Uint8Array {
  const pixel = (x: number, y: number) => {
    const i = (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * 4
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
  }
  if (fmt === CMPR) {
    const out = new ByteWriter(dataSize(CMPR, w, h))
    for (let ty = 0; ty < h; ty += 8)
      for (let tx = 0; tx < w; tx += 8)
        for (let sub = 0; sub < 4; sub++) {
          const bx = tx + (sub & 1) * 4, by = ty + (sub >> 1) * 4
          const px: number[][] = []
          for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) px.push(pixel(bx + c, by + r))
          out.bytes(encodeBlock(px))
        }
    return out.finish()
  }
  const pos = blocks(fmt, w, h)
  const at = (k: number) => pixel(pos[2 * k], pos[2 * k + 1])
  const n = pos.length / 2
  if (fmt === RGBA8) {
    const out = new ByteWriter(n * 4)
    for (let b = 0; b < n; b += 16) {
      const ps = Array.from({ length: Math.min(16, n - b) }, (_, k) => at(b + k))
      for (const p of ps) out.byte(p[3]).byte(p[0])
      for (const p of ps) out.byte(p[1]).byte(p[2])
    }
    return out.finish()
  }
  const vals: number[] = []
  for (let k = 0; k < n; k++) {
    const p = at(k)
    if (fmt === I4) vals.push(gray(p) >> 4)
    else if (fmt === I8) vals.push(gray(p))
    else if (fmt === IA4) vals.push(((p[3] >> 4) << 4) | (gray(p) >> 4))
    else if (fmt === IA8 || fmt === RGB565 || fmt === RGB5A3) vals.push(toColor(fmt, p))
    else throw new LabError(`cannot encode GX format ${fmt}`)
  }
  const bits = BLOCK[fmt][2]
  if (bits === 4) {
    const out = new Uint8Array(vals.length / 2)
    for (let i = 0; i < vals.length; i += 2) out[i / 2] = (vals[i] << 4) | vals[i + 1]
    return out
  }
  if (bits === 8) return Uint8Array.from(vals)
  const out = new Uint8Array(vals.length * 2)
  vals.forEach((v, i) => putU16be(out, 2 * i, v))
  return out
}

export class TplImage {
  header: number[]
  data: Uint8Array
  pad: Uint8Array

  constructor(header: number[], data: Uint8Array, pad: Uint8Array = new Uint8Array(0)) {
    this.header = [...header]
    this.data = data
    this.pad = pad
  }

  get height() { return this.header[0] }
  get width() { return this.header[1] }
  get format() { return this.header[2] }
  get mipmaps() { return this.header[11] + 1 }

  size(): number {
    let n = 0
    for (const [w, h] of levels(this.width, this.height, this.mipmaps)) n += dataSize(this.format, w, h)
    return n
  }

  base(): Uint8Array {
    return this.data.subarray(0, dataSize(this.format, this.width, this.height))
  }
}

function readHeader(d: Uint8Array, o: number): number[] {
  return [
    u16be(d, o), u16be(d, o + 2), u32be(d, o + 4), u32be(d, o + 8), u32be(d, o + 12), u32be(d, o + 16),
    u32be(d, o + 20), u32be(d, o + 24), f32be(d, o + 28), d[o + 32], d[o + 33], d[o + 34], d[o + 35],
  ]
}

function writeHeader(out: ByteWriter, h: number[]) {
  const b = new Uint8Array(0x24)
  putU16be(b, 0, h[0])
  putU16be(b, 2, h[1])
  for (let i = 2; i < 8; i++) putU32be(b, 4 + (i - 2) * 4, h[i])
  putF32be(b, 28, h[8])
  b.set([h[9], h[10], h[11], h[12]], 32)
  out.bytes(b)
}

export function readTpl(data: Uint8Array): [TplImage[], number] {
  const magic = u32be(data, 0), count = u32be(data, 4), table = u32be(data, 8)
  if (magic !== TPL_MAGIC) throw new LabError('not a TPL file')
  const images: TplImage[] = []
  let end = table === 0xc ? 0xc + 8 * count + 0x24 * count : 0x30
  for (let i = 0; i < count; i++) {
    const head = u32be(data, table + 8 * i), palette = u32be(data, table + 8 * i + 4)
    if (palette) throw new LabError(`image ${i} has a palette`)
    const h = readHeader(data, head)
    const gap = data.subarray(end, Math.max(end, h[3]))
    const im = new TplImage(h, new Uint8Array(0), gap.some((b) => b !== 0) ? gap.slice() : new Uint8Array(0))
    im.data = data.subarray(h[3], h[3] + im.size())
    end = h[3] + im.data.length
    images.push(im)
  }
  return [images, table]
}

export function buildTpl(images: TplImage[], tableLast = false): Uint8Array {
  const n = images.length
  if (tableLast && n !== 1) throw new LabError('a table after the data holds one image')
  const heads = tableLast ? [0xc] : images.map((_, i) => 0xc + 8 * n + 0x24 * i)
  let pos = heads[heads.length - 1] + 0x24
  const offsets: number[] = []
  for (const im of images) {
    pos += (0x20 - (pos % 0x20)) % 0x20
    offsets.push(pos)
    pos += im.data.length
  }
  const out = new ByteWriter(pos + 16)
  out.u32be(TPL_MAGIC).u32be(n).u32be(tableLast ? pos : 0xc)
  if (!tableLast) for (const h of heads) out.u32be(h).u32be(0)
  images.forEach((im, i) => writeHeader(out, [...im.header.slice(0, 3), offsets[i], ...im.header.slice(4)]))
  images.forEach((im, i) => {
    const gap = offsets[i] - out.length
    if (im.pad.length === gap) out.bytes(im.pad)
    else out.zeros(gap)
    out.bytes(im.data)
  })
  if (tableLast) out.u32be(heads[0]).u32be(0)
  return out.finish()
}
