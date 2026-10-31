// A cutscene's animation as glTF: each performer an armature on its skeleton, each nis_camera a glTF camera.
// The chunks lie end to end on one timeline at RATE frames a second, so each frame is a whole frame in Blender at its default 30.
// 
// - A chunk's last key sits EPS frames before the next chunk's first, so a cut at a chunk boundary survives.
// - Reading back re-keys the template's chunks from the glTF's world poses, taking each joint's rest from the nodes' own transforms.
// - Bones rotate with their rest frame, and camera keeps its local axes (M R).
import { ByteWriter, putU32le, u32le, utf8 } from '../bytes'
import { LabError } from '../errors'
import type { BaseCharacter } from '../game/roster'
import * as cuttool from '../mnroi/cuttool'
import { colMajor, GLB, type Json, type Mat4, matMul, trs } from '../mnroi/gltf'
import * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import { conv } from '../model/fit'
import { Skeleton } from '../model/skeleton'

type Vec3 = ngbtool.Vec3
type Mat3 = ngbtool.Mat3
type Quat = [number, number, number, number]

export const CAMERA = /^nis_camera/i
export const RATE = 30
const EPS = 0.01
const TOL = 1e-3
const MARK = 0.02

export interface Rig {
  nodes: ngmtool.Node[]
  names: string[]
}

export type Rigs = Map<string, Rig> // Actor name, lowercased

export function rig(base: BaseCharacter): Rig {
  const model = ngmtool.read(base.bundleFiles()[0])[1][0]
  let names: string[]
  try {
    names = new Skeleton(model, base.body).nodes.map((n) => n.name)
  } catch {
    names = model.nodes.map((_, i) => `Node ${i}`)
  }
  const seen = new Set<string>()
  names = names.map((n, i) => {
    const u = seen.has(n) ? `${n} ${i}` : n
    seen.add(u)
    return u
  })
  return { nodes: model.nodes, names }
}

const M: Mat3 = [[-1, 0, 0], [0, 0, 1], [0, 1, 0]]
const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Mat3
const tr = (a: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[j][i])) as Mat3
const apply = (a: Mat3, v: Vec3): Vec3 => [0, 1, 2].map((i) => a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2]) as Vec3
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
// glTF's quaternions are (x, y, z, w), ngbtool's are (w, x, y, z)
const toGltf = ([w, x, y, z]: Quat) => [x, y, z, w]
const kind = (t: cuttool.Track) => u32le(t.head, 4)
// A performer's bone word with flags in its high half is a second track on its node. Those tracks stay as they are.
const flagged = (t: cuttool.Track) => cuttool.bone(t) > 0xffff
const actorIn = (ch: cuttool.Chunk, name: string) => ch.actors.find((a) => cuttool.recordName(a.record).toLowerCase() === name.toLowerCase()) ?? null

function rest(nodes: ngmtool.Node[]): Vec3[] {
  const out: Vec3[] = []
  nodes.forEach(([q, , parent], i) => {
    const local: Vec3 = [q[0], q[1], q[2]]
    out.push(parent >= 0 && parent < i ? add(out[parent], local) : local)
  })
  return out
}

class Writer {
  json: Json = { asset: { version: '2.0', generator: 'ImperfectLab' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], cameras: [], animations: [], accessors: [], bufferViews: [], buffers: [] }
  bin = new ByteWriter(1 << 16)

  node(n: Json): number {
    return this.json.nodes.push(n) - 1
  }

  private view(put: () => void): number {
    this.bin.align(4)
    const at = this.bin.length
    put()
    return this.json.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: this.bin.length - at }) - 1
  }

  floats(rows: number[][], type: string): number {
    const n = rows[0].length
    const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity)
    for (const r of rows) r.forEach((v, k) => { min[k] = Math.min(min[k], Math.fround(v)); max[k] = Math.max(max[k], Math.fround(v)) })
    const view = this.view(() => { for (const r of rows) for (const v of r) this.bin.f32le(v) })
    return this.json.accessors.push({ bufferView: view, componentType: 5126, count: rows.length, type, min, max }) - 1
  }

  shorts(rows: number[][], type: string): number {
    const view = this.view(() => { for (const r of rows) for (const v of r) this.bin.bytes([v & 255, v >> 8]) })
    return this.json.accessors.push({ bufferView: view, componentType: 5123, count: rows.length, type }) - 1
  }

  finish(): Uint8Array {
    for (const k of Object.keys(this.json)) if (Array.isArray(this.json[k]) && !this.json[k].length) delete this.json[k]
    this.bin.align(4)
    this.json.buffers = [{ byteLength: this.bin.length }]
    const json = utf8(JSON.stringify(this.json))
    const pad = (4 - (json.length % 4)) % 4
    const out = new ByteWriter(28 + json.length + pad + this.bin.length)
    out.latin1('glTF').u32le(2).u32le(28 + json.length + pad + this.bin.length)
    out.u32le(json.length + pad).u32le(0x4e4f534a).bytes(json).bytes(Array(pad).fill(0x20))
    return out.u32le(this.bin.length).u32le(0x004e4942).bytes(this.bin.view()).finish()
  }
}

function timeline(cut: cuttool.Cut, actor: string, bone: number, ch: number, value: (p: ngbtool.Packed) => number[], still: number[]): [number, number[]][] {
  const out: [number, number[]][] = []
  let start = 0
  cut.chunks.forEach((chunk, i) => {
    const len = cuttool.frames(chunk), last = i === cut.chunks.length - 1
    const t = actorIn(chunk, actor)?.tracks.find((t) => cuttool.bone(t) === bone && kind(t) === ch)
    const keys: [number, number[]][] = t ? cuttool.keys(t).map(([f, p]) => [f, value(p)]) : [[0, still]]
    if (keys[0][0] > 0) keys.unshift([0, keys[0][1]])
    if (keys[keys.length - 1][0] < len) keys.push([len, keys[keys.length - 1][1]])
    for (const [f, v] of keys) {
      const s = (start + (f >= len && !last ? len - EPS : Math.min(f, len))) / RATE
      if (!out.length || s > out[out.length - 1][0]) out.push([s, v])
    }
    start += len
  })
  return out
}

function hemisphere(keys: [number, number[]][]) {
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1][1], b = keys[i][1]
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) keys[i][1] = b.map((x) => -x)
  }
}

// The cutscene's cameras and the actors with a rig, animated; the others are left out.
export function toGlb(cut: cuttool.Cut, rigs: Rigs): Uint8Array {
  const g = new Writer()
  const samplers: Json[] = [], channels: Json[] = []
  const animate = (node: number, path: string, keys: [number, number[]][]) => {
    if (path === 'rotation') hemisphere(keys)
    const input = g.floats(keys.map(([s]) => [s]), 'SCALAR')
    const output = g.floats(keys.map(([, v]) => v), path === 'rotation' ? 'VEC4' : 'VEC3')
    channels.push({ sampler: samplers.push({ input, output, interpolation: 'LINEAR' }) - 1, target: { node, path } })
  }
  const used = (name: string, ch: number) => {
    const bones = new Set<number>()
    for (const chunk of cut.chunks) for (const t of actorIn(chunk, name)?.tracks ?? []) if (kind(t) === ch) bones.add(cuttool.bone(t))
    return bones
  }
  for (const r of cut.records) {
    const name = cuttool.recordName(r)
    if (CAMERA.test(name)) {
      // the game's field of view is across the width of its 4:3 frame
      const fov = cuttool.fov(cut.chunks.find((c) => actorIn(c, name)) ?? cut.chunks[0])
      const yfov = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 0.75)
      const camera = g.json.cameras.push({ name, type: 'perspective', perspective: { yfov, znear: 0.05, aspectRatio: 4 / 3 } }) - 1
      const node = g.node({ name, camera })
      g.json.scenes[0].nodes.push(node)
      for (const bone of used(name, 0)) animate(node, 'rotation', timeline(cut, name, bone, 0, (p) => toGltf(ngbtool.matQuat(mul(M, ngbtool.qmat(ngbtool.quat(p))))), [0, 0, 0, 1]))
      for (const bone of used(name, 1)) animate(node, 'translation', timeline(cut, name, bone, 1, (p) => conv(ngbtool.translation(p)), [0, 0, 0]))
      continue
    }
    const rg = rigs.get(name.toLowerCase())
    if (!rg) continue
    const root = g.node({ name, children: [] })
    g.json.scenes[0].nodes.push(root)
    const joints = rg.nodes.map(([q], i) => g.node({ name: rg.names[i], translation: conv(q) }))
    rg.nodes.forEach(([, , parent], i) => (parent >= 0 && parent < i ? (g.json.nodes[joints[parent]].children ??= []) : g.json.nodes[root].children).push(joints[i]))
    const at = rest(rg.nodes).map((p) => conv(p))
    const ibm = g.floats(at.map(([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]), 'MAT4')
    const skin = g.json.skins.push({ name, joints, inverseBindMatrices: ibm }) - 1
    const pos: number[][] = [], jnt: number[][] = [], wgt: number[][] = [], idx: number[][] = []
    at.forEach((p, i) => {
      const b = pos.length
      for (const d of [[MARK, 0, 0], [0, MARK, 0], [0, 0, MARK], [0, 0, 0]]) pos.push(add(p, d as Vec3))
      for (let k = 0; k < 4; k++) {
        jnt.push([i, 0, 0, 0])
        wgt.push([1, 0, 0, 0])
      }
      idx.push([b, b + 1, b + 2], [b, b + 3, b + 1], [b + 1, b + 3, b + 2], [b, b + 2, b + 3])
    })
    const prim = { attributes: { POSITION: g.floats(pos, 'VEC3'), JOINTS_0: g.shorts(jnt, 'VEC4'), WEIGHTS_0: g.floats(wgt, 'VEC4') }, indices: g.shorts(idx.flat().map((v) => [v]), 'SCALAR') }
    if (pos.length > 0xffff) throw new LabError(`${name}'s skeleton has too many bones to export`)
    const mesh = g.json.meshes.push({ name: `${name}_joints`, primitives: [prim] }) - 1
    g.json.nodes[root].children.push(g.node({ name: `${name}_joints`, mesh, skin }))
    for (const bone of used(name, 0)) if (bone < joints.length) animate(joints[bone], 'rotation', timeline(cut, name, bone, 0, (p) => toGltf(ngbtool.matQuat(mul(mul(M, ngbtool.qmat(ngbtool.quat(p))), M))), [0, 0, 0, 1]))
    for (const bone of used(name, 1)) if (bone < joints.length) animate(joints[bone], 'translation', timeline(cut, name, bone, 1, (p) => conv(add(ngbtool.translation(p), rg.nodes[bone][0].slice(0, 3) as Vec3)), conv(rg.nodes[bone][0])))
  }
  if (channels.length) g.json.animations.push({ name: 'cutscene', samplers, channels })
  g.json.scenes[0].extras = { imperfectlab: { fps: cuttool.fps(cut), chunks: cut.chunks.map((c) => ({ frames: cuttool.frames(c), fov: cuttool.fov(c) })) } }
  return g.finish()
}

interface Sampler {
  times: number[]
  values: number[][]
  interp: string
}

function slerp(a: number[], b: number[], u: number): number[] {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const s = d < 0 ? -1 : 1
  d *= s
  if (d > 0.9995) {
    const v = a.map((x, k) => x + (s * b[k] - x) * u), n = Math.hypot(...v)
    return v.map((x) => x / n)
  }
  const th = Math.acos(d), sn = Math.sin(th)
  const ka = Math.sin((1 - u) * th) / sn, kb = (s * Math.sin(u * th)) / sn
  return a.map((x, k) => ka * x + kb * b[k])
}

function sample(s: Sampler, t: number, rotation: boolean): number[] {
  const n = s.times.length, cubic = s.interp === 'CUBICSPLINE'
  const v = (k: number) => (cubic ? s.values[3 * k + 1] : s.values[k])
  if (t <= s.times[0]) return v(0)
  if (t >= s.times[n - 1]) return v(n - 1)
  let lo = 0, hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s.times[mid] <= t) lo = mid
    else hi = mid
  }
  const dt = s.times[hi] - s.times[lo], u = dt > 0 ? (t - s.times[lo]) / dt : 0
  if (s.interp === 'STEP') return v(lo)
  if (cubic) {
    const a = v(lo), b = v(hi), m0 = s.values[3 * lo + 2], m1 = s.values[3 * hi]
    const u2 = u * u, u3 = u2 * u
    const out = a.map((x, k) => (2 * u3 - 3 * u2 + 1) * x + (u3 - 2 * u2 + u) * dt * m0[k] + (-2 * u3 + 3 * u2) * b[k] + (u3 - u2) * dt * m1[k])
    if (!rotation) return out
    const nn = Math.hypot(...out)
    return out.map((x) => x / nn)
  }
  return rotation ? slerp(v(lo), v(hi), u) : v(lo).map((x, k) => x + (v(hi)[k] - x) * u)
}

const PATHS = ['translation', 'rotation', 'scale'] as const
type Path = (typeof PATHS)[number]

class Scene {
  g: GLB
  nodes: Json[]
  parent: Map<number, number>
  channels = new Map<number, Partial<Record<Path, Sampler>>>()
  private rest: Map<number, Mat4>

  constructor(data: Uint8Array) {
    this.g = new GLB(data)
    this.nodes = this.g.j.nodes ?? []
    this.rest = this.g.world()
    this.parent = this.g.parent
    for (const anim of this.g.j.animations ?? []) {
      for (const ch of anim.channels ?? []) {
        const node = ch.target?.node, path = ch.target?.path
        if (node === undefined || !PATHS.includes(path)) continue
        const s = anim.samplers[ch.sampler]
        const entry = this.channels.get(node) ?? {}
        entry[path as Path] = { times: this.g.accessor(s.input).map((v) => v[0]), values: this.g.accessor(s.output), interp: s.interpolation ?? 'LINEAR' }
        this.channels.set(node, entry)
      }
    }
  }

  find(name: string, under: number | null = null): number[] {
    const out: number[] = []
    this.nodes.forEach((n, i) => {
      if ((n.name ?? '').toLowerCase() !== name.toLowerCase()) return
      if (under !== null) {
        let p: number | undefined = i
        while (p !== undefined && p !== under) p = this.parent.get(p)
        if (p === undefined) return
      }
      out.push(i)
    })
    return out
  }

  // Key times on the nodes and their ancestors.
  times(nodes: number[]): number[] {
    const seen = new Set<number>(), out: number[] = []
    for (const n of nodes) {
      for (let p: number | undefined = n; p !== undefined && !seen.has(p); p = this.parent.get(p)) {
        seen.add(p)
        for (const s of Object.values(this.channels.get(p) ?? {})) out.push(...s.times)
      }
    }
    return [...new Set(out)].sort((a, b) => a - b)
  }

  restWorld(n: number): Mat4 {
    return this.rest.get(n)!
  }

  worlds(t: number): (n: number) => Mat4 {
    const memo = new Map<number, Mat4>()
    const get = (n: number): Mat4 => {
      let m = memo.get(n)
      if (m) return m
      const node = this.nodes[n], ch = this.channels.get(n)
      if (node.matrix && !ch) m = colMajor(node.matrix)
      else {
        const T = ch?.translation ? sample(ch.translation, t, false) : node.translation ?? [0, 0, 0]
        const R = ch?.rotation ? sample(ch.rotation, t, true) : node.rotation ?? [0, 0, 0, 1]
        const S = ch?.scale ? sample(ch.scale, t, false) : node.scale ?? [1, 1, 1]
        m = trs(T, R, S)
      }
      const p = this.parent.get(n)
      if (p !== undefined) m = matMul(get(p), m)
      memo.set(n, m)
      return m
    }
    return get
  }
}

// The rotation of a world matrix, scale removed, and its translation.
function split(m: Mat4): [Mat3, Vec3] {
  const cols = [0, 1, 2].map((c) => {
    const n = Math.hypot(m[0][c], m[1][c], m[2][c]) || 1
    return [m[0][c] / n, m[1][c] / n, m[2][c] / n]
  })
  return [[0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]]) as Mat3, [m[0][3], m[1][3], m[2][3]]]
}

function sampleTimes(keys: number[], start: number, len: number): [number, number][] {
  const out: [number, number][] = []
  for (const s of keys) {
    const g = s * RATE
    if (g < start - TOL || g >= start + len - TOL) continue
    let f = Math.max(0, g - start)
    if (f >= len - 2 * EPS) f = len
    else if (Math.abs(f - Math.round(f)) < TOL) f = Math.round(f)
    else f = Math.round(f * 1000) / 1000
    if (!out.length || f > out[out.length - 1][0]) out.push([f, s])
  }
  const have = (f: number) => out.some(([k]) => Math.abs(k - f) < TOL)
  for (let f = 0; f < len; f++) if (!have(f)) out.push([f, (start + f) / RATE])
  if (!have(len)) out.push([len, (start + len) / RATE])
  return out.sort((a, b) => a[0] - b[0])
}

function keyBytes(keys: [number, ngbtool.Packed][]): Uint8Array {
  const out = new Uint8Array(12 * keys.length), v = new DataView(out.buffer)
  keys.forEach(([f, p], k) => {
    v.setFloat32(12 * k, f, true)
    p.forEach((x, j) => v.setInt16(12 * k + 4 + 2 * j, x, true))
  })
  return out
}

function trackHead(bone: number, ch: number, like?: cuttool.Track): Uint8Array {
  const head = like ? like.head.slice() : new Uint8Array(16)
  putU32le(head, 0, bone)
  putU32le(head, 4, ch)
  return head
}

function rotations(qs: Quat[]): ngbtool.Packed[] {
  for (let i = 1; i < qs.length; i++) if (qs[i].reduce((s, x, k) => s + x * qs[i - 1][k], 0) < 0) qs[i] = qs[i].map((x) => -x) as Quat
  return qs.map(ngbtool.encodeRotation)
}

const angle = (r: Mat3) => Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2)))

// A chunk's record holds where its actor starts, and the game shows the actor there as the chunk starts.
// Re-keyed actors' records follow their keys.
function place(a: cuttool.Actor, offset: Vec3, camera = false) {
  const first = (ch: number) => {
    const t = a.tracks.find((t) => (camera || cuttool.bone(t) === 0) && kind(t) === ch)
    return t?.keys.length ? cuttool.keys(t)[0][1] : null
  }
  const r = first(0), p = first(1)
  const R: Mat3 = r ? ngbtool.qmat(ngbtool.quat(r)) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  cuttool.setPlacement(a.record, R, add(p ? ngbtool.translation(p) : [0, 0, 0], offset))
}

function placeAll(cut: cuttool.Cut, name: string, offset: Vec3, camera = false) {
  const actors = cut.chunks.map((c) => actorIn(c, name)).filter((a) => a !== null)
  for (const a of actors) place(a, offset, camera)
  const own = cut.records.find((r) => cuttool.recordName(r).toLowerCase() === name.toLowerCase())
  if (own && actors.length) own.set(actors[actors.length - 1].record.subarray(0x50, 0x90), 0x50)
}

export interface Imported {
  cut: cuttool.Cut
  keyed: string[]
  notes: string[]
}

// The template with its cameras' and rigged actors' tracks keyed from glTF.
export function fromGlb(data: Uint8Array, template: cuttool.Cut, rigs: Rigs): Imported {
  if (data.length < 20 || data[0] !== 0x67 || data[1] !== 0x6c || data[2] !== 0x54 || data[3] !== 0x46) throw new LabError('not a binary glTF (.glb) file')
  const scene = new Scene(data)
  const cut = cuttool.read(cuttool.build(template))
  const notes: string[] = [], keyed: string[] = []
  const total = cut.chunks.reduce((s, c) => s + cuttool.frames(c), 0)
  const end = Math.max(0, ...[...scene.channels.values()].flatMap((c) => Object.values(c).map((s) => s.times[s.times.length - 1])))
  const frames = end * RATE
  if (frames > total + 1) notes.push(`the glTF's animation runs ${frames.toFixed(0)} frames, the cutscene ${total}: the rest is left out`)
  else if (frames < total - 1) notes.push(`the glTF's animation runs ${frames.toFixed(0)} frames, the cutscene ${total}: its last pose is held`)

  for (const r of cut.records) {
    const name = cuttool.recordName(r)
    if (CAMERA.test(name)) {
      const found = scene.find(name)
      if (found.length !== 1) {
        notes.push(`${name}: ${found.length ? 'more than one node' : 'no node'} of that name, so it is kept as it was`)
        continue
      }
      const node = found[0], keys = scene.times([node])
      keyed.push(name)
      let start = 0
      cut.chunks.forEach((chunk) => {
        const a = actorIn(chunk, name), len = cuttool.frames(chunk)
        if (a) {
          const times = sampleTimes(keys, start, len)
          const poses = times.map(([, s]) => split(scene.worlds(s)(node)))
          a.tracks = a.tracks.map((t) => {
            const packed = kind(t) === 0 ? rotations(poses.map(([R]) => ngbtool.matQuat(mul(M, R)))) : poses.map(([, p]) => ngbtool.encodeTranslation(conv(p)))
            return { head: trackHead(cuttool.bone(t), kind(t), t), keys: keyBytes(times.map(([f], k) => [f, packed[k]])) }
          })
        }
        start += len
      })
      placeAll(cut, name, [0, 0, 0], true)
      continue
    }
    const rg = rigs.get(name.toLowerCase())
    if (!rg) continue
    const roots = scene.find(name)
    const under = roots.length === 1 ? roots[0] : null
    const joints = rg.names.map((n) => scene.find(n, under))
    const missing = rg.names.filter((_, i) => joints[i].length !== 1)
    if (missing.length) {
      notes.push(`${name}: ${missing.length} of its ${rg.names.length} bones (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}) are missing or not unique, so it is kept as it was`)
      continue
    }
    const nodes = joints.map((j) => j[0])
    keyed.push(name)
    const q = rg.nodes.map(([o]) => [o[0], o[1], o[2]] as Vec3)
    const parentOf = (i: number) => (rg.nodes[i][2] >= 0 && rg.nodes[i][2] < i ? rg.nodes[i][2] : -1)
    const restTurn = nodes.map((n) => tr(mul(mul(M, split(scene.restWorld(n))[0]), M)))
    const keys = scene.times(nodes)
    let start = 0
    cut.chunks.forEach((chunk) => {
      const a = actorIn(chunk, name), len = cuttool.frames(chunk)
      if (a) {
        const times = sampleTimes(keys, start, len)
        const local = times.map(([, s]) => {
          const world = scene.worlds(s)
          const G = nodes.map((n, k) => {
            const [R, p] = split(world(n))
            return [mul(mul(mul(M, R), M), restTurn[k]), conv(p)] as [Mat3, Vec3]
          })
          return G.map(([R, p], k) => {
            const up = parentOf(k)
            if (up < 0) return [R, sub(p, q[k])] as [Mat3, Vec3]
            const [PR, pp] = G[up]
            return [mul(tr(PR), R), sub(apply(tr(PR), sub(p, pp)), q[k])] as [Mat3, Vec3]
          })
        })
        const rekey = (b: number, ch: number, like?: cuttool.Track): cuttool.Track => {
          const packed = ch === 0 ? rotations(local.map((l) => ngbtool.matQuat(l[b][0]))) : local.map((l) => ngbtool.encodeTranslation(l[b][1]))
          return { head: trackHead(b, ch, like), keys: keyBytes(times.map(([f], j) => [f, packed[j]])) }
        }
        // the bones the glTF moves that had no track get one
        const had = new Set(a.tracks.filter((t) => !flagged(t)).map((t) => `${cuttool.bone(t)}.${kind(t)}`))
        const added: [number, number][] = []
        for (let b = 0; b < rg.nodes.length; b++) {
          if (!had.has(`${b}.0`) && local.some((l) => angle(l[b][0]) > TOL)) added.push([b, 0])
          if (!had.has(`${b}.1`) && local.some((l) => Math.hypot(...l[b][1]) > TOL)) added.push([b, 1])
        }
        a.tracks = [
          ...a.tracks.map((t) => (flagged(t) || cuttool.bone(t) >= rg.nodes.length ? t : rekey(cuttool.bone(t), kind(t), t))),
          ...added.map(([b, ch]) => rekey(b, ch)),
        ]
      }
      start += len
    })
    placeAll(cut, name, rg.nodes[0][0].slice(0, 3) as Vec3)
  }
  cut.chunks.forEach((c, i) => {
    const n = cuttool.buildChunk(c).length
    if (n > cuttool.LIMIT) throw new LabError(`chunk ${i + 1} of the cutscene is ${n} bytes, more than the ${cuttool.LIMIT} the game streams`)
  })
  return { cut, keyed, notes }
}
