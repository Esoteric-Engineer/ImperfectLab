// Pillow's FASTOCTREE quantizer (libImaging/QuantOctree.c) for RGBA, without dithering.
import { RgbaImage } from './rgba'

const FINE = [3, 4, 3, 3]
const COARSE = [2, 2, 2, 2]

class Cube {
  bits: number[]
  offsets: number[]
  size: number
  count: Float64Array
  sums: Float64Array

  constructor(bits: number[]) {
    this.bits = bits
    this.offsets = [bits[1] + bits[2] + bits[3], bits[2] + bits[3], bits[3], 0]
    this.size = 1 << (bits[0] + bits[1] + bits[2] + bits[3])
    this.count = new Float64Array(this.size)
    this.sums = new Float64Array(this.size * 4)
  }

  pos(c: ArrayLike<number>): number {
    return (c[0] << this.offsets[0]) | (c[1] << this.offsets[1]) | (c[2] << this.offsets[2]) | (c[3] << this.offsets[3])
  }

  of(p: ArrayLike<number>): number {
    return this.pos([p[0] >> (8 - this.bits[0]), p[1] >> (8 - this.bits[1]), p[2] >> (8 - this.bits[2]), p[3] >> (8 - this.bits[3])])
  }

  used(): number {
    let n = 0
    for (let i = 0; i < this.size; i++) if (this.count[i] > 0) n++
    return n
  }
}

type Bucket = [number, number, number, number, number]

function bucket(cube: Cube, i: number): Bucket {
  return [cube.count[i], cube.sums[i * 4], cube.sums[i * 4 + 1], cube.sums[i * 4 + 2], cube.sums[i * 4 + 3]]
}

function avg(b: Bucket): number[] {
  const count = Math.fround(b[0])
  if (count === 0) return [0, 0, 0, 0]
  return [1, 2, 3, 4].map((k) => {
    const v = Math.trunc(Math.fround(Math.fround(b[k]) / count))
    return v <= 0 ? 0 : v < 256 ? v : 255
  })
}

function copyCube(cube: Cube, bits: number[]): Cube {
  const out = new Cube(bits)
  const src = [0, 0, 0, 0], dst = [0, 0, 0, 0], width = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    if (cube.bits[c] > bits[c]) {
      dst[c] = cube.bits[c] - bits[c]
      width[c] = 1 << cube.bits[c]
    } else {
      src[c] = bits[c] - cube.bits[c]
      width[c] = 1 << bits[c]
    }
  }
  for (let r = 0; r < width[0]; r++)
    for (let g = 0; g < width[1]; g++)
      for (let b = 0; b < width[2]; b++)
        for (let a = 0; a < width[3]; a++) {
          const sp = cube.pos([r >> src[0], g >> src[1], b >> src[2], a >> src[3]])
          const dp = out.pos([r >> dst[0], g >> dst[1], b >> dst[2], a >> dst[3]])
          out.count[dp] += cube.count[sp]
          for (let k = 0; k < 4; k++) out.sums[dp * 4 + k] += cube.sums[sp * 4 + k]
        }
  return out
}

function sorted(cube: Cube): Bucket[] {
  const out: Bucket[] = []
  for (let i = 0; i < cube.size; i++) out.push(bucket(cube, i))
  return out.sort((a, b) => b[0] - a[0])
}

function subtract(cube: Cube, buckets: Bucket[], from: number, n: number) {
  for (let i = from; i < from + n; i++) {
    const s = buckets[i]
    if (s[0] === 0) continue
    const m = cube.of(avg(s))
    cube.count[m] -= s[0]
    for (let k = 0; k < 4; k++) cube.sums[m * 4 + k] -= s[k + 1]
  }
}

export function quantizeOctree(im: RgbaImage, colors: number): [number[][], Uint8Array] {
  const px = im.data
  const n = im.width * im.height
  const pixels = new Uint8Array(n * 4)
  let first: number[] | null = null
  for (let i = 0; i < n; i++) {
    pixels.set(px.subarray(i * 4, i * 4 + 4), i * 4)
    if (px[i * 4 + 3] === 0) {
      if (first === null) first = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]
      else pixels.set(first, i * 4)
    }
  }
  const fine = new Cube(FINE)
  for (let i = 0; i < n; i++) {
    const b = fine.of(pixels.subarray(i * 4, i * 4 + 4))
    fine.count[b] += 1
    for (let k = 0; k < 4; k++) fine.sums[b * 4 + k] += pixels[i * 4 + k]
  }
  const coarse = copyCube(fine, COARSE)
  let nCoarse = Math.min(coarse.used(), colors)
  let nFine = colors - nCoarse
  const fineSorted = sorted(fine)
  subtract(coarse, fineSorted, 0, nFine)
  while (nCoarse > coarse.used()) {
    const done = nFine
    nCoarse = coarse.used()
    nFine = colors - nCoarse
    subtract(coarse, fineSorted, done, nFine - done)
  }
  const coarseSorted = sorted(coarse)
  const palette = [...coarseSorted.slice(0, nCoarse), ...fineSorted.slice(0, nFine)]
  while (palette.length < colors) palette.push([0, 0, 0, 0, 0])
  const coarseLookup = new Cube(COARSE)
  for (let i = nCoarse - 1; i >= 0; i--) coarseLookup.count[coarseLookup.of(avg(palette[i]))] = i
  const lookup = copyCube(coarseLookup, FINE)
  for (let i = nCoarse + nFine - 1; i >= nCoarse; i--) lookup.count[lookup.of(avg(palette[i]))] = i
  const index = new Uint8Array(n)
  for (let i = 0; i < n; i++) index[i] = lookup.count[lookup.of(pixels.subarray(i * 4, i * 4 + 4))]
  return [palette.map(avg), index]
}
