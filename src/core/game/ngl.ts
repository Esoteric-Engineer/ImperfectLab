// Level files as fn_800B271C reads them, and an upgrade for the four from an older exporter (vec3 not vec4, big-endian plane distance, 0x50 lights).
import { ByteWriter, f32be, u16be, u32be } from '../bytes'
import { LabError } from '../errors'

const LE_ONE = [0x00, 0x00, 0x80, 0x3f]
const ZERO4 = [0, 0, 0, 0]
const FLAG_EXTRA = 0x20000
const GRAPH_VERSION = 2

export type Vec3 = [number, number, number]

class Reader {
  p = 0
  readonly d: Uint8Array

  constructor(d: Uint8Array) {
    this.d = d
  }

  take(n: number): Uint8Array {
    if (n < 0 || this.p + n > this.d.length) throw new LabError(`the level file ends at 0x${this.d.length.toString(16)}, reading ${n} bytes at 0x${this.p.toString(16)}`)
    const b = this.d.subarray(this.p, this.p + n)
    this.p += n
    return b
  }

  u8(): number {
    return this.take(1)[0]
  }

  u16(): number {
    return u16be(this.take(2), 0)
  }

  u32(): number {
    return u32be(this.take(4), 0)
  }
}

// Vertex streams, then the position, texture coordinate and colour arrays.
function streams(r: Reader, w: ByteWriter | null) {
  const n = r.u8()
  w?.byte(n)
  for (let i = 0; i < n; i++) {
    const idx = r.u8(), count = r.u16()
    const recs = r.take(8 * count), extra = idx === 1 ? r.take(6 * count) : null
    w?.byte(idx)
    w?.u16be(count)
    w?.bytes(recs)
    if (extra) w?.bytes(extra)
  }
  for (const size of [12, 8, 4]) {
    const count = r.u16()
    const items = r.take(size * count)
    w?.u16be(count)
    w?.bytes(items)
  }
}

function currentSector(r: Reader) {
  const flags = r.u32()
  r.take(16)
  r.take(16 * r.u8())
  streams(r, null)
  r.take(55 * r.u16())
  r.take(2 * r.u32())
  r.take(88 * r.u8())
  r.take(0x60 * r.u16())
  r.take(8)
  if (flags & FLAG_EXTRA) {
    const size = r.u32()
    r.u32()
    r.take(size)
  }
}

function graphNodes(r: Reader, vec: number, each?: (verts: Uint8Array, nv: number, ind: Uint8Array) => void) {
  for (;;) {
    const tag = r.u8()
    if (tag === 0) return
    if (tag !== 1) throw new LabError(`unknown collision graph entry ${tag} at 0x${(r.p - 1).toString(16)}`)
    const nv = r.u16()
    const verts = r.take(vec * nv)
    const ind = r.take(2 * r.u32())
    r.take(8 * r.u16())
    r.take(16)
    r.take(r.u32())
    r.take(4)
    each?.(verts, nv, ind)
  }
}

export function check(d: Uint8Array) {
  const r = new Reader(d)
  r.take(8 + 0x60 + 0x10)
  r.take(0x20 * r.u32())
  r.take(0x20 * r.u16())
  const sectors = r.u32()
  for (let i = 0; i < sectors; i++) currentSector(r)
  if (r.u16()) throw new LabError('level objects are not supported')
  r.take(2 + 32)
  const version = r.u16()
  if (version !== GRAPH_VERSION) throw new LabError(`collision graph version ${version}, not ${GRAPH_VERSION}`)
  graphNodes(r, 16)
  r.take(0x70 * r.u32())
  if (r.p !== d.length) throw new LabError(`the level file has 0x${(d.length - r.p).toString(16)} bytes after its end`)
}

export function isCurrent(d: Uint8Array): boolean {
  try {
    check(d)
    return true
  } catch (e) {
    if (e instanceof LabError) return false
    throw e
  }
}

export function readNormals(ngn: Uint8Array): Vec3[] {
  const n = u16be(ngn, 0)
  const out: Vec3[] = []
  for (let i = 0; i < n; i++) out.push([f32be(ngn, 2 + 12 * i), f32be(ngn, 6 + 12 * i), f32be(ngn, 10 + 12 * i)])
  return out
}

function vec4(w: ByteWriter, v3: Uint8Array, last: number[] = LE_ONE) {
  w.bytes(v3)
  w.bytes(last)
}

interface OldSector {
  head: Uint8Array
  body: Uint8Array | null
  rest: Uint8Array
}

function oldSector(r: Reader, geometry: boolean): OldSector {
  const h = new ByteWriter()
  const flags = r.u32()
  h.u32be(flags)
  vec4(h, r.take(12), ZERO4)
  const planes = r.u8()
  h.byte(planes)
  for (let i = 0; i < planes; i++) {
    const p = r.take(16)
    h.bytes(p.subarray(0, 12))
    h.bytes([p[15], p[14], p[13], p[12]])
  }
  let body: ByteWriter | null = null
  if (geometry) {
    body = new ByteWriter()
    streams(r, body)
  } else if (r.u8() !== 1) {
    throw new LabError('unexpected sector without geometry')
  }
  const meshes = r.u16()
  body?.u16be(meshes)
  for (let i = 0; i < meshes; i++) {
    const m = r.take(23), lo = r.take(12), hi = r.take(12)
    if (body) {
      body.bytes(m)
      vec4(body, lo)
      vec4(body, hi)
    }
  }
  const ni = r.u32()
  const ind = r.take(2 * ni)
  body?.u32be(ni)
  body?.bytes(ind)
  if (r.u8()) throw new LabError('old sector records of an unknown size')
  r.take(0x50 * r.u16())
  const rest = new ByteWriter()
  rest.byte(0)
  rest.u16be(0)
  rest.bytes(r.take(8))
  if (flags & FLAG_EXTRA) {
    const size = r.u32(), count = r.u32()
    rest.u32be(size)
    rest.u32be(count)
    rest.bytes(r.take(size))
  }
  return { head: h.finish(), body: body?.finish() ?? null, rest: rest.finish() }
}

export interface Upgraded {
  data: Uint8Array
  rebuilt: boolean
  oldGraphVersion: number
  lightsDropped: number
}

const LIGHT: Vec3 = (() => {
  const v: Vec3 = [0.4, 0.8, 0.45]
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
})()

// One stream and one mesh, flat-shaded into the vertex colours.
function drawTriangles(tris: Vec3[][], normals: Vec3[], grey = 150): Uint8Array {
  const pos: Vec3[] = [], posIndex = new Map<string, number>()
  const recs: number[][] = []
  const colors: number[] = [], colorIndex = new Map<number, number>()
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const len = Math.hypot(...n) || 1
    n = [n[0] / len, n[1] / len, n[2] / len]
    let best = 0, bestDot = -Infinity
    normals.forEach((m, k) => {
      const dot = m[0] * n[0] + m[1] * n[1] + m[2] * n[2]
      if (dot > bestDot) {
        bestDot = dot
        best = k
      }
    })
    const level = Math.round(31 * (0.45 + 0.55 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])))
    if (!colorIndex.has(level)) {
      colorIndex.set(level, colors.length)
      colors.push(level)
    }
    for (const p of [a, b, c]) {
      const key = p.join(',')
      if (!posIndex.has(key)) {
        posIndex.set(key, pos.length)
        pos.push(p)
      }
      recs.push([posIndex.get(key)!, best, 0, colorIndex.get(level)!])
    }
  }
  if (recs.length > 0xffff || pos.length > 0xffff) throw new LabError('too many collision triangles to draw as one mesh')
  const flat = tris.flat()
  const lo = [0, 1, 2].map((i) => Math.min(...flat.map((p) => p[i])))
  const hi = [0, 1, 2].map((i) => Math.max(...flat.map((p) => p[i])))
  const w = new ByteWriter()
  w.byte(1)
  w.byte(0)
  w.u16be(recs.length)
  for (const r of recs) for (const x of r) w.u16be(x)
  w.u16be(pos.length)
  for (const p of pos) for (const x of p) w.f32be(x)
  w.u16be(1)
  w.f32be(0)
  w.f32be(0)
  w.u16be(colors.length)
  for (const q of colors) {
    const c = Math.min(255, Math.round((grey * q) / 31))
    w.bytes([c, c, c, 255])
  }
  w.u16be(1)
  w.u32be(0) // shader
  w.u32be(0) // first index
  w.u32be(0)
  w.u16be(0) // strip vertices
  w.u16be(recs.length) // triangle-list vertices
  w.u32be(recs.length)
  w.u16be(0)
  w.byte(0) // stream
  for (const x of lo) w.f32be(x)
  w.bytes(LE_ONE)
  for (const x of hi) w.f32be(x)
  w.bytes(LE_ONE)
  w.u32be(recs.length)
  for (let i = 0; i < recs.length; i++) w.u16be(i)
  return w.finish()
}

function tryUpgrade(d: Uint8Array, geometry: boolean, normals: Vec3[]): Upgraded {
  const r = new Reader(d)
  const w = new ByteWriter(d.length * 2)
  w.bytes(r.take(8))
  w.bytes(r.take(0x50))
  w.zeros(0x10)
  vec4(w, r.take(12), ZERO4)
  const shaders = r.u32()
  w.u32be(shaders)
  w.bytes(r.take(0x20 * shaders))
  const envs = r.u16()
  w.u16be(envs)
  w.bytes(r.take(0x20 * envs))
  const count = r.u32()
  if (!geometry && count !== 1) throw new LabError('drawing the collision needs a level of one sector')
  w.u32be(count)
  const sectors: OldSector[] = []
  let lightsDropped = 0
  for (let i = 0; i < count; i++) {
    const at = r.p
    sectors.push(oldSector(r, geometry))
    lightsDropped += countLights(d, at, geometry)
  }
  if (r.u16()) throw new LabError('level objects are not supported')
  const post = new ByteWriter()
  post.u16be(0)
  post.bytes(r.take(2))
  vec4(post, r.take(12))
  vec4(post, r.take(12))
  const oldGraphVersion = r.u16()
  post.u16be(GRAPH_VERSION)
  const tris: Vec3[][] = []
  const g = new ByteWriter()
  const start = r.p
  graphNodes(r, 12, (verts, nv, ind) => {
    const pts: Vec3[] = []
    for (let i = 0; i < nv; i++) pts.push([f32be(verts, 12 * i), f32be(verts, 12 * i + 4), f32be(verts, 12 * i + 8)])
    for (let i = 0; i + 2 < ind.length / 2; i += 3) tris.push([pts[u16be(ind, 2 * i)], pts[u16be(ind, 2 * i + 2)], pts[u16be(ind, 2 * i + 4)]])
  })
  const end = r.p
  copyGraph(new Reader(d.subarray(start, end)), g)
  const tail = r.take(4 + 0x70 * u32be(d, r.p))
  if (r.p !== d.length) throw new LabError('the old level file has bytes after its end')
  for (const s of sectors) {
    w.bytes(s.head)
    w.bytes(s.body ?? drawTriangles(tris, normals))
    w.bytes(s.rest)
  }
  w.bytes(post.finish())
  w.bytes(g.finish())
  w.bytes(tail)
  const data = w.finish()
  check(data)
  return { data, rebuilt: !geometry, oldGraphVersion, lightsDropped }
}

function copyGraph(r: Reader, w: ByteWriter) {
  for (;;) {
    const tag = r.u8()
    w.byte(tag)
    if (tag === 0) return
    const nv = r.u16()
    w.u16be(nv)
    for (let i = 0; i < nv; i++) vec4(w, r.take(12))
    const ni = r.u32()
    w.u32be(ni)
    w.bytes(r.take(2 * ni))
    const ne = r.u16()
    w.u16be(ne)
    w.bytes(r.take(8 * ne))
    w.bytes(r.take(16))
    const size = r.u32()
    w.u32be(size)
    w.bytes(r.take(size))
    w.bytes(r.take(4))
  }
}

function countLights(d: Uint8Array, at: number, geometry: boolean): number {
  const r = new Reader(d)
  r.p = at
  r.u32()
  r.take(12)
  r.take(16 * r.u8())
  if (geometry) streams(r, null)
  else r.u8()
  r.take(47 * r.u16())
  r.take(2 * r.u32())
  r.u8()
  return r.u16()
}

export function upgrade(old: Uint8Array, normals: Vec3[]): Upgraded {
  try {
    return tryUpgrade(old, true, normals)
  } catch (e) {
    if (!(e instanceof LabError)) throw e
    return tryUpgrade(old, false, normals)
  }
}