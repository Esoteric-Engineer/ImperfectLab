import { decode, encode } from 'fast-png'
import { LabError } from '../errors'
import { RgbaImage } from './rgba'

export function pngSize(body: Uint8Array): [number, number] {
  if (body.length < 24) return [0, 0]
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength)
  return [dv.getUint32(16), dv.getUint32(20)]
}

export function decodePng(body: Uint8Array): RgbaImage {
  const png = decode(body)
  const { width, height, channels, depth } = png
  const src = depth < 8 ? unpack(png.data as Uint8Array, width, height, channels, depth) : png.data
  const n = width * height
  const out = new RgbaImage(width, height)
  const d = out.data
  const to8 = depth === 16 ? (v: number) => v >> 8 : depth < 8 && !png.palette ? (v: number) => (v * 255) / ((1 << depth) - 1) : (v: number) => v
  const trns = png.transparency
  if (png.palette) {
    const pal = png.palette
    for (let i = 0; i < n; i++) {
      const c = pal[src[i]] ?? [0, 0, 0]
      d[i * 4] = c[0]
      d[i * 4 + 1] = c[1]
      d[i * 4 + 2] = c[2]
      d[i * 4 + 3] = c.length > 3 ? c[3] : 255
    }
    return out
  }
  for (let i = 0; i < n; i++) {
    const p = i * channels
    let r: number, g: number, b: number, a = 255
    if (channels <= 2) {
      r = g = b = to8(src[p])
      if (channels === 2) a = to8(src[p + 1])
      else if (trns && trns.length >= 1 && src[p] === trns[0]) a = 0
    } else {
      r = to8(src[p])
      g = to8(src[p + 1])
      b = to8(src[p + 2])
      if (channels === 4) a = to8(src[p + 3])
      else if (trns && trns.length >= 3 && src[p] === trns[0] && src[p + 1] === trns[1] && src[p + 2] === trns[2]) a = 0
    }
    d[i * 4] = r
    d[i * 4 + 1] = g
    d[i * 4 + 2] = b
    d[i * 4 + 3] = a
  }
  return out
}

function unpack(data: Uint8Array, width: number, height: number, channels: number, depth: number): Uint8Array {
  const per = width * channels
  const stride = Math.ceil((per * depth) / 8)
  const out = new Uint8Array(per * height)
  const mask = (1 << depth) - 1
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < per; i++) {
      const bit = i * depth
      out[y * per + i] = (data[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask
    }
  }
  return out
}

export function encodePng(im: RgbaImage): Uint8Array {
  if (!im.width || !im.height) throw new LabError('an empty image cannot be saved')
  return encode({ width: im.width, height: im.height, data: new Uint8Array(im.data.buffer, im.data.byteOffset, im.data.byteLength), channels: 4, depth: 8 })
}
