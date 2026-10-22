// Pillow's HSV conversions (libImaging/Convert.c) and Gaussian blur (libImaging/BoxBlur.c).
import { RgbaImage } from './rgba'

const f = Math.fround

function clip8(v: number): number {
  return v <= 0 ? 0 : v < 256 ? v : 255
}

function cRound(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

function fmod(a: number, b: number): number {
  return a % b
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b)
  if (minc === maxc) return [0, 0, maxc]
  const cr = f(maxc - minc)
  const s = f(cr / maxc)
  const rc = f((maxc - r) / cr), gc = f((maxc - g) / cr), bc = f((maxc - b) / cr)
  let h: number
  if (r === maxc) h = f(bc - gc)
  else if (g === maxc) h = f(2.0 + rc - bc)
  else h = f(4.0 + gc - rc)
  h = f(fmod(h / 6.0 + 1.0, 1.0))
  return [clip8(Math.trunc(h * 255.0)), clip8(Math.trunc(s * 255.0)), maxc]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s === 0) return [v, v, v]
  const i = Math.floor((h * 6.0) / 255.0)
  const fr = f((h * 6.0) / 255.0 - i)
  const fs = f(s / 255.0)
  const p = clip8(cRound(v * (1.0 - fs)))
  const q = clip8(cRound(v * (1.0 - f(fs * fr))))
  const t = clip8(cRound(v * (1.0 - fs * (1.0 - fr))))
  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

export function hueShift(im: RgbaImage, degrees: number): RgbaImage {
  const out = new RgbaImage(im.width, im.height)
  const lut = new Uint8Array(256)
  for (let x = 0; x < 256; x++) lut[x] = ((Math.trunc(x + (degrees * 255) / 360) % 256) + 256) % 256
  const s = im.data, d = out.data
  for (let i = 0; i < s.length; i += 4) {
    const [h, sat, v] = rgbToHsv(s[i], s[i + 1], s[i + 2])
    const [r, g, b] = hsvToRgb(lut[h], sat, v)
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    d[i + 3] = s[i + 3]
  }
  return out
}

function gaussianRadius(radius: number, passes: number): number {
  const sigma2 = f(f(radius * radius) / passes)
  const L = f(Math.sqrt(12.0 * sigma2 + 1.0))
  const l = f(Math.floor((L - 1.0) / 2.0))
  let a = f(f(2 * l + 1) * f(f(l * f(l + 1)) - f(3 * sigma2)))
  a = f(a / f(6 * f(sigma2 - f(f(l + 1) * f(l + 1)))))
  return f(l + a)
}

function lineBlur(line: Float64Array | number[], n: number, out: number[], radius: number, ww: number, fw: number) {
  const lastx = n - 1
  const edgeA = Math.min(radius + 1, n), edgeB = Math.max(n - radius - 1, 0)
  const at = (i: number) => line[i]
  let acc = at(0) * (radius + 1)
  for (let x = 0; x < edgeA - 1; x++) acc += at(x)
  acc += at(lastx) * (radius - edgeA + 1)
  const save = (x: number, left: number, right: number) => {
    const bulk = acc * ww + (at(left) + at(right)) * fw
    out[x] = Math.floor((bulk + (1 << 23)) / (1 << 24)) & 255
  }
  if (edgeA <= edgeB) {
    for (let x = 0; x < edgeA; x++) { acc += at(x + radius) - at(0); save(x, 0, x + radius + 1) }
    for (let x = edgeA; x < edgeB; x++) { acc += at(x + radius) - at(x - radius - 1); save(x, x - radius - 1, x + radius + 1) }
    for (let x = edgeB; x <= lastx; x++) { acc += at(lastx) - at(x - radius - 1); save(x, x - radius - 1, lastx) }
  } else {
    for (let x = 0; x < edgeB; x++) { acc += at(x + radius) - at(0); save(x, 0, x + radius + 1) }
    for (let x = edgeB; x < edgeA; x++) { acc += at(lastx) - at(0); save(x, 0, lastx) }
    for (let x = edgeA; x <= lastx; x++) { acc += at(lastx) - at(x - radius - 1); save(x, x - radius - 1, lastx) }
  }
}

function boxBlurPass(data: Uint8Array, w: number, h: number, floatRadius: number, horizontal: boolean) {
  const radius = Math.trunc(floatRadius)
  const ww = Math.trunc(f(16777216 / f(f(floatRadius * 2) + 1)))
  const fw = Math.trunc((16777216 - (radius * 2 + 1) * ww) / 2)
  const n = horizontal ? w : h, lines = horizontal ? h : w
  const line = new Float64Array(n)
  const out: number[] = new Array(n)
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < n; i++) line[i] = data[horizontal ? l * w + i : i * w + l]
    lineBlur(line, n, out, radius, ww, fw)
    for (let i = 0; i < n; i++) data[horizontal ? l * w + i : i * w + l] = out[i]
  }
}

export function gaussianBlurL(channel: Uint8Array, w: number, h: number, radius: number, passes = 3): Uint8Array {
  const out = new Uint8Array(channel)
  if (radius === 0 || w === 0 || h === 0) return out
  const r = gaussianRadius(radius, passes)
  if (r !== 0) {
    for (let i = 0; i < passes; i++) boxBlurPass(out, w, h, r, true)
    for (let i = 0; i < passes; i++) boxBlurPass(out, w, h, r, false)
  }
  return out
}
