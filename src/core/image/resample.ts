import { premultiply, RgbaImage, unpremultiply } from './rgba'

const PRECISION_BITS = 32 - 8 - 2
const f = Math.fround

function sinc(x: number): number {
  if (x === 0.0) return 1.0
  x = x * Math.PI
  return Math.sin(x) / x
}

function lanczos(x: number): number {
  return -3.0 <= x && x < 3.0 ? sinc(x) * sinc(x / 3) : 0.0
}

function clip8(v: number): number {
  const i = v >> PRECISION_BITS
  return i < 0 ? 0 : i > 255 ? 255 : i
}

function coeffs(inSize: number, in0: number, in1: number, outSize: number): [number, Int32Array, Int32Array] {
  let filterscale = (f(in1 - in0)) / outSize
  const scale = filterscale
  if (filterscale < 1.0) filterscale = 1.0
  const support = 3.0 * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const kk = new Int32Array(outSize * ksize)
  const bounds = new Int32Array(outSize * 2)
  const pre = new Float64Array(ksize)
  for (let xx = 0; xx < outSize; xx++) {
    const center = in0 + (xx + 0.5) * scale
    let ww = 0.0
    const ss = 1.0 / filterscale
    let xmin = Math.trunc(center - support + 0.5)
    if (xmin < 0) xmin = 0
    let xmax = Math.trunc(center + support + 0.5)
    if (xmax > inSize) xmax = inSize
    xmax -= xmin
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss)
      pre[x] = w
      ww += w
    }
    for (let x = 0; x < ksize; x++) {
      let v = x < xmax ? pre[x] : 0
      if (x < xmax && ww !== 0.0) v /= ww
      kk[xx * ksize + x] = v < 0 ? Math.trunc(-0.5 + v * (1 << PRECISION_BITS)) : Math.trunc(0.5 + v * (1 << PRECISION_BITS))
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return [ksize, bounds, kk]
}

function horizontal(src: RgbaImage, outW: number, rows: number, offset: number, ksize: number, bounds: Int32Array, kk: Int32Array): RgbaImage {
  const out = new RgbaImage(outW, rows)
  const s = src.data, d = out.data
  const half = 1 << (PRECISION_BITS - 1)
  for (let yy = 0; yy < rows; yy++) {
    const row = (yy + offset) * src.width * 4
    for (let xx = 0; xx < outW; xx++) {
      const xmin = bounds[xx * 2], xmax = bounds[xx * 2 + 1], k = xx * ksize
      let s0 = half, s1 = half, s2 = half, s3 = half
      for (let x = 0; x < xmax; x++) {
        const p = row + (x + xmin) * 4, w = kk[k + x]
        s0 = (s0 + s[p] * w) | 0
        s1 = (s1 + s[p + 1] * w) | 0
        s2 = (s2 + s[p + 2] * w) | 0
        s3 = (s3 + s[p + 3] * w) | 0
      }
      const o = (yy * outW + xx) * 4
      d[o] = clip8(s0)
      d[o + 1] = clip8(s1)
      d[o + 2] = clip8(s2)
      d[o + 3] = clip8(s3)
    }
  }
  return out
}

function vertical(src: RgbaImage, outH: number, ksize: number, bounds: Int32Array, kk: Int32Array): RgbaImage {
  const out = new RgbaImage(src.width, outH)
  const s = src.data, d = out.data, w4 = src.width * 4
  const half = 1 << (PRECISION_BITS - 1)
  for (let yy = 0; yy < outH; yy++) {
    const ymin = bounds[yy * 2], ymax = bounds[yy * 2 + 1], k = yy * ksize
    for (let xx = 0; xx < src.width; xx++) {
      let s0 = half, s1 = half, s2 = half, s3 = half
      for (let y = 0; y < ymax; y++) {
        const p = (y + ymin) * w4 + xx * 4, w = kk[k + y]
        s0 = (s0 + s[p] * w) | 0
        s1 = (s1 + s[p + 1] * w) | 0
        s2 = (s2 + s[p + 2] * w) | 0
        s3 = (s3 + s[p + 3] * w) | 0
      }
      const o = (yy * src.width + xx) * 4
      d[o] = clip8(s0)
      d[o + 1] = clip8(s1)
      d[o + 2] = clip8(s2)
      d[o + 3] = clip8(s3)
    }
  }
  return out
}

function resampleRaw(im: RgbaImage, xsize: number, ysize: number, box: number[]): RgbaImage {
  const [b0, b1, b2, b3] = box.map(f)
  if (b0 - Math.trunc(b0) === 0 && b2 - b0 === xsize && b1 - Math.trunc(b1) === 0 && b3 - b1 === ysize) {
    return im.crop(b0, b1, b2, b3)
  }
  const needH = xsize !== im.width || b0 !== 0 || b2 !== xsize
  const needV = ysize !== im.height || b1 !== 0 || b3 !== ysize
  const [ksH, boundsH, kkH] = coeffs(im.width, b0, b2, xsize)
  const [ksV, boundsV, kkV] = coeffs(im.height, b1, b3, ysize)
  const first = boundsV[0]
  const last = boundsV[ysize * 2 - 2] + boundsV[ysize * 2 - 1]
  let cur = im
  if (needH) {
    for (let i = 0; i < ysize; i++) boundsV[i * 2] -= first
    cur = horizontal(im, xsize, last - first, first, ksH, boundsH, kkH)
  }
  if (needV) cur = vertical(cur, ysize, ksV, boundsV, kkV)
  return cur === im ? im.copy() : cur
}

export function resizeLanczos(im: RgbaImage, width: number, height: number, box?: number[]): RgbaImage {
  const b = box ?? [0, 0, im.width, im.height]
  if (im.width === width && im.height === height && b[0] === 0 && b[1] === 0 && b[2] === im.width && b[3] === im.height) return im.copy()
  return unpremultiply(resampleRaw(premultiply(im), width, height, b))
}

export function resizeNearest(im: RgbaImage, width: number, height: number): RgbaImage {
  const out = new RgbaImage(width, height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(im.height - 1, Math.floor(((y + 0.5) * im.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(im.width - 1, Math.floor(((x + 0.5) * im.width) / width))
      out.data.set(im.data.subarray((sy * im.width + sx) * 4, (sy * im.width + sx) * 4 + 4), (y * width + x) * 4)
    }
  }
  return out
}
