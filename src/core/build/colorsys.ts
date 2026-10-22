// Python's colorsys HLS conversions (3.12+), with Python's float modulo.
const ONE_THIRD = 1.0 / 3.0, ONE_SIXTH = 1.0 / 6.0, TWO_THIRD = 2.0 / 3.0

export function pymod(a: number, b: number): number {
  let m = a % b
  if (m) {
    if (b < 0 !== m < 0) m += b
  } else {
    m = b < 0 ? -0 : 0
  }
  return m
}

export function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b)
  const sumc = maxc + minc, rangec = maxc - minc
  const l = sumc / 2.0
  if (minc === maxc) return [0.0, l, 0.0]
  const s = l <= 0.5 ? rangec / sumc : rangec / (2.0 - maxc - minc)
  const rc = (maxc - r) / rangec, gc = (maxc - g) / rangec, bc = (maxc - b) / rangec
  let h: number
  if (r === maxc) h = bc - gc
  else if (g === maxc) h = 2.0 + rc - bc
  else h = 4.0 + gc - rc
  return [pymod(h / 6.0, 1.0), l, s]
}

function v(m1: number, m2: number, hue: number): number {
  hue = pymod(hue, 1.0)
  if (hue < ONE_SIXTH) return m1 + (m2 - m1) * hue * 6.0
  if (hue < 0.5) return m2
  if (hue < TWO_THIRD) return m1 + (m2 - m1) * (TWO_THIRD - hue) * 6.0
  return m1
}

export function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0.0) return [l, l, l]
  const m2 = l <= 0.5 ? l * (1.0 + s) : l + s - l * s
  const m1 = 2.0 * l - m2
  return [v(m1, m2, h + ONE_THIRD), v(m1, m2, h), v(m1, m2, h - ONE_THIRD)]
}
