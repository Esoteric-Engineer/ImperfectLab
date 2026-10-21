// Paletted UI images (.gsh records), encoded with Pillow's octree quantizer and cached.
import { sha1 } from '@noble/hashes/legacy.js'
import { putU16be, toHex } from '../bytes'
import { LabError } from '../errors'
import { quantizeOctree } from '../image/quantize'
import { resizeLanczos } from '../image/resample'
import { RgbaImage } from '../image/rgba'
import * as gshtool from '../mnroi/gshtool'
import * as gxtex from '../mnroi/gxtex'

const cache = new Map<string, Uint8Array>()

export function encode(record: Uint8Array, im: RgbaImage): Uint8Array {
  const key = `${toHex(sha1(record))}:${im.width}x${im.height}:${toHex(sha1(im.bytes()))}`
  const hit = cache.get(key)
  if (hit) return hit
  const pic = new gshtool.Picture(record)
  if ((pic.format !== gxtex.C4 && pic.format !== gxtex.C8) || pic.paletteFormat === null) throw new LabError('only C4 and C8 images with a palette are encoded')
  const w = pic.width, h = pic.height
  if (im.width !== w || im.height !== h) throw new LabError(`an image is ${im.width}x${im.height}, not ${w}x${h}`)
  const rgba = im.copy()
  for (let i = 0; i < rgba.data.length; i += 4) if (rgba.data[i + 3] === 0) rgba.data.fill(0, i, i + 4)
  const [pal, idx] = quantizeOctree(rgba, pic.colors)
  const pos = gxtex.blocks(pic.format, w, h)
  const vals: number[] = []
  for (let k = 0; k < pos.length; k += 2) {
    const x = pos[k], y = pos[k + 1]
    vals.push(x < w && y < h ? idx[y * w + x] : 0)
  }
  const data = pic.format === gxtex.C4
    ? Uint8Array.from({ length: vals.length / 2 }, (_, i) => (vals[2 * i] << 4) | vals[2 * i + 1])
    : Uint8Array.from(vals)
  const colors = pal.slice(0, pic.colors).map((c) => gxtex.toColor(pic.paletteFormat!, c))
  while (colors.length < pic.colors) colors.push(0)
  const out = record.slice()
  out.set(data, pic.pixelOff)
  colors.forEach((c, i) => putU16be(out, pic.paletteOff! + 2 * i, c))
  cache.set(key, out)
  return out
}

export function cropResize(im: RgbaImage, box: [number, number, number, number], size: [number, number]): RgbaImage {
  const [x0, y0, x1, y1] = box
  const ix0 = Math.floor(x0), iy0 = Math.floor(y0), ix1 = Math.ceil(x1), iy1 = Math.ceil(y1)
  const region = im.crop(ix0, iy0, Math.max(ix1, ix0 + 1), Math.max(iy1, iy0 + 1))
  return resizeLanczos(region, size[0], size[1], [x0 - ix0, y0 - iy0, x1 - ix0, y1 - iy0])
}

export function add(bank: gshtool.Bank, added: Map<string, [string, RgbaImage]>): gshtool.Bank {
  const sort = isSorted(bank.names)
  for (const [name, [template, im]] of added) {
    if (bank.records.has(name)) throw new LabError(`image ${name} exists`)
    bank.records.set(name, encode(bank.record(template), im))
    bank.names.push(name)
  }
  if (sort) bank.names.sort(compareStrings)
  return bank
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function isSorted(names: string[]): boolean {
  for (let i = 1; i < names.length; i++) if (names[i - 1] > names[i]) return false
  return true
}
