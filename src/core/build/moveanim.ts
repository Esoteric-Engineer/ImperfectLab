// A move's animation from a glTF clip, retargeted onto the base's skeleton through the model's fit.
//
// - The clip's joints are found by name.
// - Each mapped game bone turns as its joint turns from its rest, and the fit's re-pose of that bone is taken out.
// - Twist bones follow their limb; other bones keep the replaced record's tracks.
// - The replaced record's head, events and extras are kept, its events stretched to the clip's length.
import { LabError } from '../errors'
import { GLB, type Json, type Mat4 } from '../mnroi/gltf'
import * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import { Fit, type FitModel } from '../model/fit'
import { Joint, type Model, type Vec3 } from '../model/glb'
import { autoMap, type Mapping, type Overrides } from '../model/mapping'
import type { Skeleton } from '../model/skeleton'
import { mul, Scene, split, tr } from './cutanim'
import { type Retimed, retime } from './strikes'

type Mat3 = ngbtool.Mat3
type Quat = [number, number, number, number]

const IDENT: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const ROT_TOL = 1.5 / 16384
const POS_TOL = 1e-4
const TRAVEL = 0.01
const SPEED_SLACK = 1.5

export const ANIM_PREFIX = 'anim:'

export interface ClipInfo {
  name: string
  seconds: number
}

export type Timing = 'clip'
export type Travel = 'base'

export interface AnimPick {
  file: string
  clip: string
  timing?: Timing
  travel?: Travel
}

export interface FitParams {
  scale: number | null
  torso_squash?: boolean
  flip: boolean | null
  floor_from_mesh?: boolean
}

// What the model's fit needs: the model (null for none, when the clip's own rig is mapped), its mapping and fit.
export interface AnimRig {
  model: Model | null
  mapping: Mapping
  overrides: Overrides
  fit: FitParams
}

// The picks, the animation files they name, how far each file's clips turn, and the rig to retarget through.
export interface MoveAnims {
  picks: Record<string, AnimPick>
  files: Map<string, ClipFile>
  turns: Record<string, number>
  rig: AnimRig
}

export const TURNS = [0, -90, 90, 180]

// A move picker's value for a clip, and back.
export const animChoice = (p: AnimPick) => `${ANIM_PREFIX}${p.file}#${p.clip}`
export function parseChoice(v: string): AnimPick | null {
  if (!v.startsWith(ANIM_PREFIX)) return null
  const at = v.indexOf('#')
  return at < 0 ? null : { file: v.slice(ANIM_PREFIX.length, at), clip: v.slice(at + 1) }
}

// The skin's joints by the names the model import gives them: the node's name, made unique with .2, .3 ...
export function jointNodes(g: GLB): Map<string, number> {
  const nodes: Json[] = g.j.nodes ?? []
  const meshSkins = [...new Set(nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined).map((n) => n.skin as number))].sort((a, b) => a - b)
  const skin = meshSkins.length ? meshSkins[0] : (g.j.skins?.length ? 0 : null)
  const out = new Map<string, number>()
  if (skin === null) return out
  for (const n of g.j.skins[skin].joints as number[]) {
    const base = nodes[n].name || `joint_${n}`
    let name = base
    for (let k = 2; out.has(name); k++) name = `${base}.${k}`
    out.set(name, n)
  }
  return out
}

function clipRange(g: GLB, anim: Json): [number, number] {
  let start = Infinity, end = -Infinity
  for (const s of anim.samplers ?? []) {
    const a = g.j.accessors[s.input]
    if (a?.min?.length && a?.max?.length) {
      start = Math.min(start, a.min[0])
      end = Math.max(end, a.max[0])
    } else {
      const times = g.accessor(s.input).map((v) => v[0])
      start = Math.min(start, ...times)
      end = Math.max(end, ...times)
    }
  }
  return Number.isFinite(start) ? [start, end] : [0, 0]
}

// An animation file: its clips, its skin's joints, and each clip's poses.
export class ClipFile {
  g: GLB
  clips: ClipInfo[]
  joints: Map<string, number>
  private ranges: [number, number][]
  private scenes = new Map<number, Scene>()

  constructor(data: Uint8Array) {
    if (data.length < 20 || data[0] !== 0x67 || data[1] !== 0x6c || data[2] !== 0x54 || data[3] !== 0x46) throw new LabError('not a binary glTF (.glb) file')
    try {
      this.g = new GLB(data)
      const anims: Json[] = this.g.j.animations ?? []
      this.ranges = anims.map((a) => clipRange(this.g, a))
      this.clips = anims.map((a, i) => ({ name: a.name || `animation_${i}`, seconds: this.ranges[i][1] - this.ranges[i][0] }))
      this.joints = jointNodes(this.g)
    } catch (e) {
      if (e instanceof LabError) throw e
      throw new LabError(`the GLB could not be read: ${(e as Error).message}`)
    }
    if (!this.clips.length) throw new LabError('the GLB has no animations')
    if (!this.joints.size) throw new LabError('the GLB has no skin, so its animations have no skeleton to play on')
  }

  index(clip: string): number {
    const i = this.clips.findIndex((c) => c.name === clip)
    if (i < 0) throw new LabError(`the animation file has no clip ${clip}`)
    return i
  }

  scene(clip: string): [Scene, number, number] {
    const i = this.index(clip)
    let s = this.scenes.get(i)
    if (!s) {
      s = new Scene(this.g, i)
      this.scenes.set(i, s)
    }
    return [s, ...this.ranges[i]]
  }

  // The skin's joints at rest, as a model the mapping and the fit can take.
  rig(): FitModel {
    const world = this.g.world()
    const nodeName = new Map([...this.joints].map(([name, n]) => [n, name]))
    const joints = [...this.joints].map(([name, n]) => {
      let p = this.g.parent.get(n)
      while (p !== undefined && !nodeName.has(p)) p = this.g.parent.get(p)
      const m = world.get(n)!
      return new Joint(name, p !== undefined ? nodeName.get(p)! : null, [m[0][3], m[1][3], m[2][3]])
    })
    const byName = new Map(joints.map((j) => [j.name, j]))
    return {
      joints,
      prims: [],
      jointNames: () => joints.map((j) => j.name),
      // no mesh: every joint counts as weighted, so the presets' extra fingers still map
      weighted: () => new Map(joints.map((j) => [j.name, 1])),
      joint: (name: string) => {
        const j = byName.get(name)
        if (!j) throw new LabError(`the animation file has no joint ${name}`)
        return j
      },
    }
  }
}

// glTF (y up) to the game (z up, facing +y), as the fit turns the model.
const convMat = (flip: boolean): Mat3 => (flip ? [[1, 0, 0], [0, 0, -1], [0, 1, 0]] : [[-1, 0, 0], [0, 0, 1], [0, 1, 0]])
const apply = (a: Mat3, v: Vec3): Vec3 => [0, 1, 2].map((i) => a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2]) as Vec3
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const flagged = (bone: number) => bone > 0xffff
// each key has its own divisor, so decode before interpolating
const at = (keys: ngbtool.Key[], f: number): Vec3 => ngbtool.sample(keys.map(([g, v]): [number, Vec3] => [g, ngbtool.translation(v)]), f)
// a turn about the game's up axis, degrees counter-clockwise seen from above (to the character's left)
const turnMat = (deg: number): Mat3 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
}

function bindPositions(nodes: ngmtool.Node[]): Vec3[] {
  const out: Vec3[] = []
  nodes.forEach(([q, , parent], i) => {
    const local: Vec3 = [q[0], q[1], q[2]]
    out.push(parent >= 0 && parent < i ? add(out[parent], local) : local)
  })
  return out
}

// Drop the keys a straight line through their neighbours already gives.
export function reduce<T extends number[]>(keys: [number, T][], tol: number): [number, T][] {
  if (keys.length <= 2) return keys
  const out: [number, T][] = [keys[0]]
  let from = 0
  for (let i = 1; i < keys.length - 1; i++) {
    const [ta, a] = keys[from], [tb, b] = keys[i + 1]
    let fits = true
    for (let k = from + 1; k <= i && fits; k++) {
      const [t, v] = keys[k]
      const u = tb > ta ? (t - ta) / (tb - ta) : 0
      fits = v.every((x, c) => Math.abs(a[c] + (b[c] - a[c]) * u - x) <= tol)
    }
    if (!fits) {
      out.push(keys[i])
      from = i
    }
  }
  out.push(keys[keys.length - 1])
  return out
}

function quatKeys(frames: number[], rots: Mat3[]): ngbtool.Key[] {
  const qs: Quat[] = rots.map((r) => ngbtool.matQuat(r))
  for (let i = 1; i < qs.length; i++) if (qs[i].reduce((s, x, k) => s + x * qs[i - 1][k], 0) < 0) qs[i] = qs[i].map((x) => -x) as Quat
  return reduce(frames.map((f, i): [number, Quat] => [f, qs[i]]), ROT_TOL).map(([f, q]) => [f, ngbtool.encodeRotation(q)])
}

function posKeys(frames: number[], ps: Vec3[]): ngbtool.Key[] {
  return reduce(frames.map((f, i): [number, Vec3] => [f, ps[i]]), POS_TOL).map(([f, p]) => [f, ngbtool.encodeTranslation(p)])
}

// One animation file's clips onto one base skeleton.
export class Retarget {
  sk: Skeleton
  file: ClipFile
  fit: Fit
  C: Mat3
  // the clip's poses into the game's frame: C, then the file's turn
  private pre: Mat3
  notes: string[] = []
  // set by record(), for the notes
  timed: Retimed | null = null
  travelled: { distance: number; shortened: boolean } | null = null
  // game node -> [the clip's node, the turn after the joint's world delta]
  private targets = new Map<number, [number, Mat3]>()
  // twist node -> its limb's node
  private twists = new Map<number, number>()
  private pelvis: number
  private pelvisNode: number
  private pelvisRest: Vec3

  constructor(rig: AnimRig, sk: Skeleton, file: ClipFile, turn = 0) {
    this.sk = sk
    this.file = file
    let model: FitModel, mapping = rig.mapping, overrides = rig.overrides, params = rig.fit
    let restG: GLB
    if (rig.model) {
      model = rig.model
      restG = rig.model.g
      const missing = [...mapping].filter(([, j]) => !file.joints.has(j))
      if (missing.length) {
        const [node, joint] = missing[0]
        throw new LabError(`the animation's rig has no joint ${joint}, which the model maps to ${sk.nodes[node]?.name ?? `game bone ${node}`}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ''}: its clips have to be on the model's rig`)
      }
    } else {
      model = file.rig()
      restG = file.g
      const auto = autoMap(model, sk)
      mapping = auto.mapping
      overrides = auto.overrides
      params = { scale: null, torso_squash: true, flip: null }
      this.notes.push(`no custom model, so the animation's rig is mapped by ${auto.preset}`)
    }
    this.fit = new Fit(model, sk, mapping, overrides, params.scale, params.torso_squash ?? true, params.flip, params.floor_from_mesh ?? false)
    this.C = convMat(this.fit.flip)
    this.pre = mul(turnMat(turn), this.C)
    const restJoints = rig.model ? jointNodes(restG) : file.joints
    const restWorld = restG.world()
    const restOf = (joint: string) => {
      const n = restJoints.get(joint)
      if (n === undefined) throw new LabError(`the model has no joint ${joint}`)
      return split(restWorld.get(n)!)
    }
    for (const [node, joint] of mapping) {
      if (node >= sk.nodes.length) continue
      const at = file.joints.get(joint)
      if (at === undefined) continue
      // G = C Δ Cᵀ R⁻¹ with Δ = A B⁻¹: the post-turn is B⁻¹ Cᵀ R⁻¹
      const R = this.fit.geo(joint).R as Mat3
      this.targets.set(node, [at, mul(mul(tr(restOf(joint)[0]), tr(this.C)), tr(R))])
    }
    for (const [role, [twistRole]] of Object.entries(sk.twist)) {
      const limb = sk.node(role), twist = sk.node(twistRole)
      if (limb !== undefined && twist !== undefined && this.targets.has(limb) && !this.targets.has(twist)) this.twists.set(twist, limb)
    }
    this.pelvis = sk.node('pelvis')!
    const pj = mapping.get(this.pelvis)!
    this.pelvisNode = file.joints.get(pj)!
    this.pelvisRest = restOf(pj)[1]
  }

  // The template record moved by the clip.
  record(template: ngbtool.Record, clip: string, nodes: ngmtool.Node[], fps: number, timing: Timing | null = null, travel: Travel | null = null): ngbtool.Record {
    this.timed = null
    this.travelled = null
    const [scene, t0, t1] = this.file.scene(clip)
    const n = Math.max(1, Math.round((t1 - t0) * fps))
    const frames = Array.from({ length: n + 1 }, (_, f) => f)
    const k = template.length > 0 ? n / template.length : 1
    const N = nodes.length
    const parentOf = (i: number) => (nodes[i][2] >= 0 && nodes[i][2] < i ? nodes[i][2] : -1)
    const q = nodes.map(([o]) => [o[0], o[1], o[2]] as Vec3)
    const bind = bindPositions(nodes)
    const scaled = (keys: ngbtool.Key[]): ngbtool.Key[] => keys.map(([f, v]) => [Math.min(n, f * k), v])
    const tplRot = new Map<number, ngbtool.Key[]>(), tplPos = new Map<number, ngbtool.Key[]>()
    for (const [b, ch, keys] of template.tracks) if (!flagged(b) && b < N && keys.length) (ch === 0 ? tplRot : tplPos).set(b, scaled(keys))
    const rootKeys = tplPos.get(0)
    const travels = !!rootKeys && rootKeys.some(([, v]) => Math.hypot(...ngbtool.translation(v).slice(0, 2)) > TRAVEL)
    const baseTravel = travels && travel === 'base', clipTravel = travels && !baseTravel
    const driven = (i: number) => this.targets.has(i) || this.twists.has(i)
    // the Root marker (the camera follows it): kept with the base's travel, left out with the clip's
    const marker = (b: number, ch: number) => ch === 1 && b > 0 && b < N && parentOf(b) === 0 && !driven(b)

    const rots = new Map<number, Mat3[]>(), pos = new Map<number, Vec3[]>()
    const push = <T>(m: Map<number, T[]>, i: number, v: T) => {
      if (!m.has(i)) m.set(i, [])
      m.get(i)!.push(v)
    }
    const root0: Vec3 = rootKeys ? at(rootKeys, 0) : [0, 0, 0]
    let start: Vec3 | null = null
    for (const f of frames) {
      const world = scene.worlds(t0 + Math.min(f / fps, t1 - t0))
      const target = new Map<number, Mat3>()
      for (const [node, [at, post]] of this.targets) target.set(node, mul(mul(this.pre, split(world(at))[0]), post))
      for (const [twist, limb] of this.twists) target.set(twist, target.get(limb)!)
      const W: Mat3[] = []
      for (let i = 0; i < N; i++) {
        const up = parentOf(i), PW = up >= 0 ? W[up] : IDENT
        if (driven(i)) {
          W.push(target.get(i)!)
          push(rots, i, mul(tr(PW), target.get(i)!))
        } else {
          const keys = tplRot.get(i)
          W.push(mul(PW, keys ? ngbtool.qmat(ngbtool.quat(ngbtool.sample(keys, f))) : IDENT))
        }
      }
      const p = apply(this.pre, split(world(this.pelvisNode))[1])
      start ??= p
      let pelvisWorld = add(bind[this.pelvis], sub(p, apply(this.C, this.pelvisRest)).map((x) => x * this.fit.S) as Vec3)
      let rootKey: Vec3 = rootKeys ? at(rootKeys, f) : [0, 0, 0]
      if (baseTravel) pelvisWorld = add(pelvisWorld, sub(rootKey, root0))
      if (clipTravel) {
        const d = sub(p, start).map((x) => x * this.fit.S)
        rootKey = [d[0], d[1], 0]
        push(pos, 0, rootKey)
      }
      const up = parentOf(this.pelvis)
      if (up < 0) push(pos, this.pelvis, sub(pelvisWorld, q[this.pelvis]))
      else {
        // the pelvis's parent is Root, which has no other parent
        const rootPos = add(bind[up], rootKey)
        push(pos, this.pelvis, sub(apply(tr(W[up]), sub(pelvisWorld, rootPos)), q[this.pelvis]))
      }
    }

    const kept = (keys: ngbtool.Key[], time: (f: number) => number): ngbtool.Key[] => {
      const out: ngbtool.Key[] = []
      for (const [f, v] of keys) {
        const g = Math.min(n, time(f))
        if (out.length && out[out.length - 1][0] >= g - 1e-6) out[out.length - 1] = [out[out.length - 1][0], v]
        else out.push([g, v])
      }
      return out
    }
    const made = new Map<string, ngbtool.Key[]>()
    for (const [i, rs] of rots) made.set(`${i}.0`, quatKeys(frames, rs))
    for (const [i, ps] of pos) made.set(`${i}.1`, posKeys(frames, ps))
    const assemble = (time: (f: number) => number): ngbtool.Track[] => {
      const tracks: ngbtool.Track[] = []
      const done = new Set<string>()
      for (const [b, ch, keys] of template.tracks) {
        const key = `${b}.${ch}`
        if (flagged(b) || b >= N) tracks.push([b, ch, kept(keys, time)])
        else if (clipTravel && marker(b, ch)) continue
        else if (made.has(key)) {
          if (!done.has(key)) tracks.push([b, ch, made.get(key)!])
          done.add(key)
        } else if (!driven(b) && !(ch === 1 && b === this.pelvis)) tracks.push([b, ch, kept(keys, time)])
      }
      // a new track goes before the first of a later node, as the other generators add theirs
      for (const [key, keys] of made) {
        if (done.has(key)) continue
        const [b, ch] = key.split('.').map(Number)
        let i = tracks.findIndex(([tb, tc]) => (tb & 0xffff) > b || (tb === b && tc > ch))
        if (i < 0) i = tracks.length
        tracks.splice(i, 0, [b, ch, keys])
      }
      return tracks
    }
    const speed = (keys: ngbtool.Key[] | undefined, length: number) => {
      let top = 0
      if (keys?.length) for (let f = 0; f < length; f++) {
        const a = at(keys, f), b = at(keys, Math.min(f + 1, length))
        top = Math.max(top, Math.hypot(b[0] - a[0], b[1] - a[1]))
      }
      return top
    }
    const rootTrack = (tracks: ngbtool.Track[]) => tracks.find(([b, ch]) => b === 0 && ch === 1)?.[2]
    const capped = (tracks: ngbtool.Track[]): ngbtool.Track[] => {
      if (!baseTravel) return tracks
      const keys = rootTrack(tracks)!
      const far = (s: number) => {
        this.travelled = { distance: s * Math.max(...keys.map(([, v]) => Math.hypot(...sub(ngbtool.translation(v), ngbtool.translation(keys[0][1])).slice(0, 2)))), shortened: s < 1 }
      }
      const was = speed(template.tracks.find(([b, ch]) => b === 0 && ch === 1)?.[2], template.length), now = speed(keys, n)
      if (!(now > was * SPEED_SLACK) || was <= 0) {
        far(1)
        return tracks
      }
      const s = (was * SPEED_SLACK) / now
      far(s)
      const shrink = (keys: ngbtool.Key[]): ngbtool.Key[] => {
        const o = ngbtool.translation(keys[0][1])
        return keys.map(([f, v]) => {
          const t = ngbtool.translation(v)
          return [f, ngbtool.encodeTranslation([o[0] + (t[0] - o[0]) * s, o[1] + (t[1] - o[1]) * s, t[2]])]
        })
      }
      return tracks.map(([b, ch, keys]): ngbtool.Track => (keys.length && ((b === 0 && ch === 1) || marker(b, ch)) ? [b, ch, shrink(keys)] : [b, ch, keys]))
    }
    const tracks = capped(assemble((f) => f * k))
    const events = template.events.map(([f, t, p, v]): ngbtool.Event => [f > 0 ? Math.min(n, Math.round(f * k * 100) / 100) : f, t, p, v])
    const out = { ...template, head: template.head.slice(), length: n, pointers: [], tracks, events, extra: template.extra.map((x) => x.slice()) }
    if (timing !== 'clip') return out
    this.timed = retime(template, out, nodes, this.sk)
    // the template's tracks move with the hits, as its events do
    return this.timed ? { ...out, events: this.timed.events, tracks: capped(assemble((f) => Math.round(this.timed!.warp(f) * 100) / 100)) } : out
  }
}

const clipCache = new WeakMap<Uint8Array, ClipInfo[]>()

// The clips of an animation file (cached by its bytes), or none for a file that can't be read.
export function clipList(data: Uint8Array): ClipInfo[] {
  let clips = clipCache.get(data)
  if (!clips) {
    try {
      clips = new ClipFile(data).clips
    } catch {
      clips = []
    }
    clipCache.set(data, clips)
  }
  return clips
}

// An animation file as the project keeps it: the nodes, the skin and the animations, with no mesh or images.
export function animGlb(data: Uint8Array): Uint8Array {
  const file = new ClipFile(data)
  const g = file.g, j: Json = structuredClone(g.j)
  const nodes: Json[] = j.nodes ?? []
  const meshSkins = [...new Set(nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined).map((n) => n.skin as number))].sort((a, b) => a - b)
  const skin = j.skins[meshSkins.length ? meshSkins[0] : 0]
  for (const n of nodes) for (const k of ['mesh', 'skin', 'camera', 'weights']) delete n[k]
  for (const k of ['meshes', 'materials', 'textures', 'images', 'samplers', 'cameras', 'extensionsUsed', 'extensionsRequired']) delete j[k]
  j.skins = [skin]
  const used = new Set<number>()
  if (skin.inverseBindMatrices !== undefined) used.add(skin.inverseBindMatrices)
  for (const a of j.animations) for (const s of a.samplers) used.add(s.input).add(s.output)
  const order = [...used].sort((a, b) => a - b)
  const accMap = new Map(order.map((old, i) => [old, i]))
  const accessors: Json[] = order.map((i) => ({ ...j.accessors[i] }))
  if (accessors.some((a) => a.bufferView === undefined || a.sparse)) throw new LabError('the animation file has an accessor without data')
  const views = [...new Set(accessors.map((a) => a.bufferView as number))].sort((a, b) => a - b)
  const viewMap = new Map(views.map((old, i) => [old, i]))
  const parts: Uint8Array[] = []
  let at = 0
  j.bufferViews = views.map((v) => {
    const bv = { ...j.bufferViews[v] }
    at += (4 - (at % 4)) % 4
    const off = bv.byteOffset ?? 0
    parts.push(g.bin.subarray(off, off + bv.byteLength))
    const out = { ...bv, buffer: 0, byteOffset: at }
    at += bv.byteLength
    return out
  })
  const binLen = at + ((4 - (at % 4)) % 4)
  const bin = new Uint8Array(binLen)
  let k = 0
  for (const v of views) {
    const bv = j.bufferViews[k++]
    bin.set(parts[viewMap.get(v)!], bv.byteOffset)
  }
  for (const a of accessors) a.bufferView = viewMap.get(a.bufferView)
  if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accMap.get(skin.inverseBindMatrices)
  for (const a of j.animations) for (const s of a.samplers) {
    s.input = accMap.get(s.input)
    s.output = accMap.get(s.output)
  }
  j.accessors = accessors
  j.buffers = [{ byteLength: binLen }]
  const json = new TextEncoder().encode(JSON.stringify(j))
  const jsonLen = json.length + ((4 - (json.length % 4)) % 4)
  const total = 12 + 8 + jsonLen + 8 + binLen
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46])
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLen)
  out.set(json, 20)
  dv.setUint32(20 + jsonLen, binLen, true)
  dv.setUint32(24 + jsonLen, 0x004e4942, true)
  out.set(bin, 28 + jsonLen)
  return out
}

// The build's MoveAnims for a character's picks (null for none); `open` reads a file, so a caller can cache them.
export function animsOf(c: { moveAnims: Record<string, AnimPick>; moveAnimFiles: Record<string, { turn: number }>; files: Map<string, Uint8Array>; mapping: Mapping; overrides: Overrides; fit: FitParams },
  model: Model | null, open: (data: Uint8Array) => ClipFile = (d) => new ClipFile(d)): MoveAnims | null {
  const picks = Object.entries(c.moveAnims)
  if (!picks.length) return null
  const files = new Map<string, ClipFile>()
  for (const [, p] of picks) {
    if (files.has(p.file)) continue
    const data = c.files.get(p.file)
    if (!data) throw new LabError(`the animation file ${p.file} is missing`)
    files.set(p.file, open(data))
  }
  const turns = Object.fromEntries([...files.keys()].map((m) => [m, c.moveAnimFiles[m]?.turn ?? 0]))
  return { picks: c.moveAnims, files, turns, rig: { model, mapping: c.mapping, overrides: c.overrides, fit: c.fit } }
}

const REACHING = /attack|punch|kick|strike|jab|hit/i

// The turn (multiple of 90°) that brings a file's clips to face the model's front.
// Read from where the clips named as attacks reach furthest; 0 when none is, nothing reaches, or the rig can't be mapped.
export function guessTurn(file: ClipFile, sk: Skeleton, mapping: Mapping | null = null): number {
  const map = mapping && [...mapping.values()].every((j) => file.joints.has(j)) ? mapping : autoMap(file.rig(), sk).mapping
  const joint = (role: string) => {
    const n = sk.node(role)
    const j = n === undefined ? undefined : map.get(n)
    return j === undefined ? undefined : file.joints.get(j)
  }
  const pelvis = joint('pelvis'), right = joint('R.upper_arm'), left = joint('L.upper_arm')
  const ends = ['R.hand', 'L.hand', 'R.foot', 'L.foot'].map(joint).filter((n): n is number => n !== undefined)
  if (pelvis === undefined || right === undefined || left === undefined || !ends.length) return 0
  const rest = file.g.world()
  const at = (m: Mat4): Vec3 => [m[0][3], m[1][3], m[2][3]]
  // the fit's facing rule: the model's right arm on the game's right
  const C = convMat(apply(convMat(false), at(rest.get(right)!))[0] < apply(convMat(false), at(rest.get(left)!))[0])
  const clips = file.clips.filter((c) => REACHING.test(c.name))
  let x = 0, y = 0
  for (const clip of clips) {
    const [scene, t0, t1] = file.scene(clip.name)
    let best: [number, number, number] = [0, 0, 0]
    for (let t = t0; t <= t1 + 1e-6; t += 1 / 15) {
      const world = scene.worlds(Math.min(t, t1))
      const p = apply(C, at(world(pelvis)))
      for (const e of ends) {
        const d = sub(apply(C, at(world(e))), p), r = Math.hypot(d[0], d[1])
        if (r > best[0]) best = [r, d[0], d[1]]
      }
    }
    // the furthest reach, weighted by how far it goes
    x += best[1] * best[0]
    y += best[2] * best[0]
  }
  if (Math.hypot(x, y) < 1e-6) return 0
  const facing = (Math.atan2(-x, y) * 180) / Math.PI
  const turn = ((Math.round(-facing / 90) * 90) % 360 + 540) % 360 - 180
  return turn === -180 ? 180 : turn === 0 ? 0 : turn
}