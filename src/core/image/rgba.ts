export class RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray

  constructor(width: number, height: number, data?: Uint8ClampedArray | Uint8Array) {
    this.width = width
    this.height = height
    this.data = data ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) : new Uint8ClampedArray(width * height * 4)
  }

  static filled(width: number, height: number, rgba: ArrayLike<number>): RgbaImage {
    const im = new RgbaImage(width, height)
    for (let i = 0; i < im.data.length; i += 4) im.data.set(rgba, i)
    return im
  }

  get size(): [number, number] {
    return [this.width, this.height]
  }

  copy(): RgbaImage {
    return new RgbaImage(this.width, this.height, this.data.slice())
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength)
  }

  crop(x0: number, y0: number, x1: number, y1: number): RgbaImage {
    const out = new RgbaImage(x1 - x0, y1 - y0)
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      const sx0 = Math.max(0, x0), sx1 = Math.min(this.width, x1)
      if (sx1 <= sx0) continue
      out.data.set(this.data.subarray((y * this.width + sx0) * 4, (y * this.width + sx1) * 4), ((y - y0) * out.width + (sx0 - x0)) * 4)
    }
    return out
  }

  paste(src: RgbaImage, dx: number, dy: number) {
    for (let y = Math.max(0, dy); y < Math.min(this.height, dy + src.height); y++) {
      const x0 = Math.max(0, dx), x1 = Math.min(this.width, dx + src.width)
      if (x1 <= x0) continue
      const sy = y - dy
      this.data.set(src.data.subarray((sy * src.width + (x0 - dx)) * 4, (sy * src.width + (x1 - dx)) * 4), (y * this.width + x0) * 4)
    }
  }

  pasteMasked(src: RgbaImage, dx: number, dy: number, mask: Uint8Array, maskWidth: number) {
    for (let y = Math.max(0, dy); y < Math.min(this.height, dy + src.height); y++) {
      for (let x = Math.max(0, dx); x < Math.min(this.width, dx + src.width); x++) {
        const s = ((y - dy) * src.width + (x - dx)) * 4
        const a = mask[(y - dy) * maskWidth + (x - dx)]
        const o = (y * this.width + x) * 4
        for (let c = 0; c < 4; c++) this.data[o + c] = blend(a, this.data[o + c], src.data[s + c])
      }
    }
  }

  channel(c: number): Uint8Array {
    const out = new Uint8Array(this.width * this.height)
    for (let i = 0; i < out.length; i++) out[i] = this.data[i * 4 + c]
    return out
  }

  alpha(): Uint8Array {
    return this.channel(3)
  }

  putAlpha(a: Uint8Array) {
    for (let i = 0; i < a.length; i++) this.data[i * 4 + 3] = a[i]
  }

  bbox(): [number, number, number, number] | null {
    let x0 = this.width, y0 = -1, x1 = 0, y1 = 0
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[(y * this.width + x) * 4 + 3]) {
          if (y0 < 0) y0 = y
          if (x < x0) x0 = x
          if (x + 1 > x1) x1 = x + 1
          y1 = y + 1
        }
      }
    }
    return y0 < 0 ? null : [x0, y0, x1, y1]
  }

  alphaComposite(src: RgbaImage) {
    const d = this.data, s = src.data
    for (let i = 0; i < d.length; i += 4) {
      const sa = s[i + 3]
      if (sa === 0) continue
      const blendA = d[i + 3] * (255 - sa)
      const outa255 = sa * 255 + blendA
      const coef1 = Math.floor((sa * 255 * 255 * 128) / outa255)
      const coef2 = 255 * 128 - coef1
      for (let c = 0; c < 3; c++) d[i + c] = shiftForDiv255(s[i + c] * coef1 + d[i + c] * coef2 + (0x80 << 7)) >> 7
      d[i + 3] = shiftForDiv255(outa255 + 0x80)
    }
  }
}

export function shiftForDiv255(a: number): number {
  return (((a >>> 8) + a) >>> 8)
}

export function div255(a: number): number {
  return shiftForDiv255(a + 128)
}

export function mulDiv255(a: number, b: number): number {
  return shiftForDiv255(a * b + 128)
}

export function blend(mask: number, in1: number, in2: number): number {
  return div255(in1 * (255 - mask) + in2 * mask)
}

export function multiply(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = Math.floor((a[i] * b[i]) / 255)
  return out
}

export function compositeL(a: Uint8Array, b: Uint8Array, mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(b)
  for (let i = 0; i < out.length; i++) out[i] = blend(mask[i], b[i], a[i])
  return out
}

export function premultiply(im: RgbaImage): RgbaImage {
  const out = new RgbaImage(im.width, im.height)
  const s = im.data, d = out.data
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]
    d[i] = mulDiv255(s[i], a)
    d[i + 1] = mulDiv255(s[i + 1], a)
    d[i + 2] = mulDiv255(s[i + 2], a)
    d[i + 3] = a
  }
  return out
}

export function unpremultiply(im: RgbaImage): RgbaImage {
  const out = new RgbaImage(im.width, im.height)
  const s = im.data, d = out.data
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]
    if (a === 255 || a === 0) {
      d[i] = s[i]
      d[i + 1] = s[i + 1]
      d[i + 2] = s[i + 2]
    } else {
      d[i] = Math.min(255, Math.floor((255 * s[i]) / a))
      d[i + 1] = Math.min(255, Math.floor((255 * s[i + 1]) / a))
      d[i + 2] = Math.min(255, Math.floor((255 * s[i + 2]) / a))
    }
    d[i + 3] = a
  }
  return out
}
