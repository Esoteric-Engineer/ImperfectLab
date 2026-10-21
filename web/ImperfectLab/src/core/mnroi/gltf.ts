// Binary glTF reading, ported from mnroi tools/gltf.py (commit a23c796).
import { LabError } from '../errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any
export type Mat4 = number[][]

export const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
export const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const NORM: Record<number, number> = { 5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0 }

export function matMul(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = []
  for (let i = 0; i < 4; i++) {
    const row: number[] = []
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[i][k] * b[k][j]
      row.push(s)
    }
    out.push(row)
  }
  return out
}

export function matVec(m: Mat4, v: ArrayLike<number>, w = 1.0): [number, number, number] {
  const x = v[0], y = v[1], z = v[2]
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3] * w,
    m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3] * w,
    m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3] * w,
  ]
}

export function identity(): Mat4 {
  return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1.0 : 0.0)))
}

export function trs(t: number[] = [0, 0, 0], r: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = r
  const m = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), t[0]],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), t[1]],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), t[2]],
    [0.0, 0.0, 0.0, 1.0],
  ]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] *= s[j]
  return m
}

export function colMajor(v: ArrayLike<number>): Mat4 {
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => v[c * 4 + r]))
}

export class GLB {
  j: Json
  bin: Uint8Array = new Uint8Array(0)
  parent = new Map<number, number>()
  private worldCache: Map<number, Mat4> | null = null

  constructor(src: Uint8Array) {
    const dv = new DataView(src.buffer, src.byteOffset, src.byteLength)
    let o = 12
    let json: Json = undefined
    while (o + 8 <= src.length) {
      const n = dv.getUint32(o, true), t = dv.getUint32(o + 4, true)
      const chunk = src.subarray(o + 8, o + 8 + n)
      if (t === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk))
      else if (t === 0x004e4942) this.bin = chunk
      o += 8 + n
    }
    if (json === undefined || typeof json !== 'object' || json === null) throw new LabError('the GLB has no JSON chunk')
    this.j = json
  }

  view(i: number): [Uint8Array, number | undefined] {
    const bv = this.j.bufferViews[i]
    const o = bv.byteOffset ?? 0
    return [this.bin.subarray(o, o + bv.byteLength), bv.byteStride]
  }

  accessor(i: number): number[][] {
    const a = this.j.accessors[i]
    const nc = NCOMP[a.type]
    const ct: number = a.componentType
    const size = COMP_SIZE[ct]
    if (!nc || !size) throw new LabError(`accessor ${i} has an unknown type`)
    const [data, stride0] = this.view(a.bufferView)
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const base = a.byteOffset ?? 0
    const stride = stride0 || size * nc
    const norm = a.normalized && ct in NORM ? NORM[ct] : 0
    const get = (o: number): number => {
      switch (ct) {
        case 5120: return dv.getInt8(o)
        case 5121: return dv.getUint8(o)
        case 5122: return dv.getInt16(o, true)
        case 5123: return dv.getUint16(o, true)
        case 5125: return dv.getUint32(o, true)
        default: return dv.getFloat32(o, true)
      }
    }
    const out: number[][] = []
    for (let k = 0; k < a.count; k++) {
      const v: number[] = []
      for (let c = 0; c < nc; c++) {
        const x = get(base + k * stride + c * size)
        v.push(norm ? x / norm : x)
      }
      out.push(v)
    }
    return out
  }

  local(n: number): Mat4 {
    const node = this.j.nodes[n]
    if (node.matrix) return colMajor(node.matrix)
    return trs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1])
  }

  world(): Map<number, Mat4> {
    if (this.worldCache) return this.worldCache
    const nodes: Json[] = this.j.nodes ?? []
    this.parent = new Map()
    nodes.forEach((nd, i) => {
      for (const c of nd.children ?? []) this.parent.set(c, i)
    })
    const w = new Map<number, Mat4>()
    const get = (i: number, depth: number): Mat4 => {
      if (depth > nodes.length) throw new LabError('the GLB node hierarchy has a cycle')
      let m = w.get(i)
      if (!m) {
        const p = this.parent.get(i)
        m = p !== undefined ? matMul(get(p, depth + 1), this.local(i)) : this.local(i)
        w.set(i, m)
      }
      return m
    }
    for (let i = 0; i < nodes.length; i++) get(i, 0)
    this.worldCache = w
    return w
  }
}
