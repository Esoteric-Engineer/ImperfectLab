// DXT1: principal-axis endpoints and one least-squares refit; blocks with transparency use the 3-color mode.
const to565 = (r: number, g: number, b: number) => {
  const c = (v: number) => Math.min(255, Math.max(0, v))
  return (Math.round((c(r) * 31) / 255) << 11) | (Math.round((c(g) * 63) / 255) << 5) | Math.round((c(b) * 31) / 255)
}
const from565 = (c: number): [number, number, number] => [Math.floor((((c >> 11) & 31) * 255) / 31), Math.floor((((c >> 5) & 63) * 255) / 63), Math.floor(((c & 31) * 255) / 31)]

function axisOf(px: number[][]): [number[], number[]] {
  const n = px.length, m = [0, 0, 0]
  for (const p of px) for (let k = 0; k < 3; k++) m[k] += p[k] / n
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const p of px) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (p[i] - m[i]) * (p[j] - m[j])
  let ax = [1, 1, 1].map((v) => v / Math.sqrt(3))
  for (let it = 0; it < 8; it++) {
    const nx = [0, 1, 2].map((i) => cov[i][0] * ax[0] + cov[i][1] * ax[1] + cov[i][2] * ax[2])
    const l = Math.hypot(nx[0], nx[1], nx[2])
    if (l < 1e-9) break
    ax = nx.map((v) => v / l)
  }
  return [m, ax]
}

function encodeBlock(px: number[][], alpha: boolean[], out: DataView, o: number) {
  const opaque = px.filter((_, i) => alpha[i])
  const transparent = opaque.length < 16
  if (opaque.length === 0) { out.setUint16(o, 0, true); out.setUint16(o + 2, 0xffff, true); out.setUint32(o + 4, 0xffffffff, true); return }
  const [m, ax] = axisOf(opaque)
  let lo = Infinity, hi = -Infinity
  for (const p of opaque) { const t = (p[0] - m[0]) * ax[0] + (p[1] - m[1]) * ax[1] + (p[2] - m[2]) * ax[2]; lo = Math.min(lo, t); hi = Math.max(hi, t) }
  const e0 = m.map((v, k) => v + ax[k] * hi), e1 = m.map((v, k) => v + ax[k] * lo)
  const fit = (a: number[], b: number[]) => {
    let c0 = to565(a[0], a[1], a[2]), c1 = to565(b[0], b[1], b[2])
    if (transparent ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0]
    if (!transparent && c0 === c1) { if (c0 < 0xffff) c0++; else c1-- }
    const p0 = from565(c0), p1 = from565(c1)
    const pal = transparent
      ? [p0, p1, p0.map((v, k) => (v + p1[k]) >> 1)]
      : [p0, p1, p0.map((v, k) => Math.floor((2 * v + p1[k]) / 3)), p0.map((v, k) => Math.floor((v + 2 * p1[k]) / 3))]
    let idx = 0, err = 0; const sel: number[] = []
    for (let i = 0; i < 16; i++) {
      if (!alpha[i]) { idx |= 3 << (2 * i); sel.push(3); continue }
      let best = 0, bd = Infinity
      pal.forEach((q, j) => { const d = (px[i][0] - q[0]) ** 2 + (px[i][1] - q[1]) ** 2 + (px[i][2] - q[2]) ** 2; if (d < bd) { bd = d; best = j } })
      idx |= best << (2 * i); err += bd; sel.push(best)
    }
    return { c0, c1, idx: idx >>> 0, err, sel }
  }
  let r = fit(e0, e1)
  if (!transparent) {
    const wHi = [1, 0, 2 / 3, 1 / 3]
    let aa = 0, bb = 0, ab = 0; const ax2 = [0, 0, 0], bx2 = [0, 0, 0]
    for (let i = 0; i < 16; i++) { const a = wHi[r.sel[i]], b = 1 - a; aa += a * a; bb += b * b; ab += a * b; for (let k = 0; k < 3; k++) { ax2[k] += a * px[i][k]; bx2[k] += b * px[i][k] } }
    const det = aa * bb - ab * ab
    if (Math.abs(det) > 1e-9) {
      const h2 = [0, 1, 2].map((k) => (bb * ax2[k] - ab * bx2[k]) / det), l2 = [0, 1, 2].map((k) => (aa * bx2[k] - ab * ax2[k]) / det)
      const r2 = fit(h2, l2)
      if (r2.err < r.err) r = r2
    }
  }
  out.setUint16(o, r.c0, true); out.setUint16(o + 2, r.c1, true); out.setUint32(o + 4, r.idx, true)
}

// sides below 4 are padded by edge repeat
export function encodeDxt1(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4))
  const out = new Uint8Array(bw * bh * 8); const dv = new DataView(out.buffer)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const px: number[][] = [], al: boolean[] = []
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const sx = Math.min(w - 1, bx * 4 + x), sy = Math.min(h - 1, by * 4 + y), p = (sy * w + sx) * 4
      px.push([rgba[p], rgba[p + 1], rgba[p + 2]]); al.push(rgba[p + 3] >= 128)
    }
    encodeBlock(px, al, dv, (by * bw + bx) * 8)
  }
  return out
}

export function decodeDxt1(d: Uint8Array, w: number, h: number): Uint8Array {
  const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4))
  const out = new Uint8Array(w * h * 4); const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * 8, c0 = dv.getUint16(o, true), c1 = dv.getUint16(o + 2, true), idx = dv.getUint32(o + 4, true)
    const p0 = from565(c0), p1 = from565(c1), four = c0 > c1
    const pal = [[...p0, 255], [...p1, 255],
      four ? [...p0.map((v, k) => Math.floor((2 * v + p1[k]) / 3)), 255] : [...p0.map((v, k) => (v + p1[k]) >> 1), 255],
      four ? [...p0.map((v, k) => Math.floor((v + 2 * p1[k]) / 3)), 255] : [0, 0, 0, 0]]
    for (let k = 0; k < 16; k++) {
      const x = bx * 4 + (k & 3), y = by * 4 + (k >> 2)
      if (x < w && y < h) out.set(pal[(idx >>> (2 * k)) & 3], (y * w + x) * 4)
    }
  }
  return out
}