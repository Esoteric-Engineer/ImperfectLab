// Auto-fit a model onto a base character's skeleton.
// The game's animations carry the base's bone offsets, so the mesh is moved onto the base's bind pose:
// - one scale makes the legs the base's length
// - each limb bone is turned and stretched so its joints land on the base's
// - the torso is squashed to the base's shoulder height
// - the weights are renamed to the base's nodes (three per vertex)
import { LabError } from '../errors'
import type { Model, Skin, Vec3 } from './glb'
import { effective, type Mapping, type Overrides } from './mapping'
import { SIDES, type Skeleton } from './skeleton'

const TORSO_ROLES = ['pelvis', 'spine', 'chest', 'neck', 'head']

type Mat3 = number[][]
export type Weights = [number, number][]
export type Vertex = [Vec3, Vec3, [number, number], Weights]
export type Tri = [Vertex, Vertex, Vertex]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: Vec3) => Math.sqrt(dot(a, a))
export const unit = (a: Vec3): Vec3 => mul(a, 1.0 / (length(a) || 1.0))
const matApply = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)]

function matMul3(a: Mat3, b: Mat3): Mat3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
    let s = 0
    for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j]
    return s
  }))
}

const IDENT: Mat3 = [[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]]

function rotBetween(a: Vec3, b: Vec3): Mat3 {
  a = unit(a)
  b = unit(b)
  const v = cross(a, b), c = dot(a, b)
  if (c < -0.999999) throw new LabError('a mapped bone points the opposite way from its game bone; check the mapping')
  const k = 1.0 / (1.0 + c)
  const vx = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]
  const vx2 = matMul3(vx, vx)
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => IDENT[i][j] + vx[i][j] + vx2[i][j] * k))
}

export function conv(v: ArrayLike<number>, flip = false): Vec3 {
  return flip ? [v[0], -v[2], v[1]] : [-v[0], v[2], v[1]]
}

interface VertexMap {
  R: Mat3
  apply(v: Vec3): Vec3
}

class Bone implements VertexMap {
  P: Vec3
  Q: Vec3
  s: number
  R: Mat3
  axis: Vec3 | null
  k: number

  constructor(P: Vec3, Q: Vec3, s: number, R: Mat3 = IDENT, axis: Vec3 | null = null, k = 1.0) {
    this.P = P
    this.Q = Q
    this.s = s
    this.R = R
    this.axis = axis
    this.k = k
  }

  apply(v: Vec3): Vec3 {
    let d = mul(sub(v, this.P), this.s)
    if (this.axis !== null && this.k !== 1.0) d = add(d, mul(this.axis, (this.k - 1.0) * dot(d, this.axis)))
    return add(this.Q, matApply(this.R, d))
  }
}

class Torso implements VertexMap {
  P: Vec3
  Q: Vec3
  s: number
  zs: number
  ku: number
  kd: number
  R: Mat3 = IDENT

  constructor(P: Vec3, Q: Vec3, s: number, zShoulder: number, kzUp: number, kzDown: number) {
    this.P = P
    this.Q = Q
    this.s = s
    this.zs = zShoulder
    this.ku = kzUp
    this.kd = kzDown
  }

  z(z: number): number {
    const dz = z - this.P[2]
    if (dz < 0) return this.kd * dz
    if (z <= this.zs) return this.ku * dz
    return this.ku * (this.zs - this.P[2]) + (z - this.zs)
  }

  apply(v: Vec3): Vec3 {
    const s = this.s
    return [this.Q[0] + s * (v[0] - this.P[0]), this.Q[1] + s * (v[1] - this.P[1]), this.Q[2] + s * this.z(v[2])]
  }
}

// keep the three strongest bones per vertex and renormalise
export function top3(weights: Weights): Weights {
  const acc = new Map<number, number>()
  for (const [b, w] of weights) if (w > 0) acc.set(b, (acc.get(b) ?? 0) + w)
  const best = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  let tot = 0
  for (const [, w] of best) tot += w
  return best.map(([b, w]) => [b, w / tot])
}

export type MaterialSlots = Map<number, [number | null, boolean, (number | null)?]>

export class Fit {
  model: Model
  sk: Skeleton
  mapping: Mapping
  overrides: Overrides
  J: Vec3[]
  roleJoint = new Map<string, string>()
  flip: boolean
  D = new Map<string, Vec3>()
  target: Map<string, number | null>
  direct = new Map<string, number>()
  maps = new Map<string, VertexMap>()
  S = 1
  torso!: Torso
  private geoCache = new Map<string, VertexMap>()
  private wfn = new Map<string, (v: Vec3) => Weights>()

  constructor(model: Model, skeleton: Skeleton, mapping: Mapping, overrides: Overrides = new Map(), scale: number | null = null,
    torsoSquash = true, flip: boolean | null = null, floorFromMesh = false) {
    this.model = model
    this.sk = skeleton
    this.mapping = new Map(mapping)
    this.overrides = new Map(overrides)
    this.J = skeleton.positions()
    for (const [node, joint] of this.mapping) {
      const role = node < skeleton.nodes.length ? skeleton.nodes[node].role : null
      if (role) this.roleJoint.set(role, joint)
    }
    const missing = skeleton.requiredRoles().filter((r) => !this.roleJoint.has(r))
    if (missing.length) throw new LabError(`map these game bones first: ${missing.map((r) => skeleton.nodes[skeleton.node(r)!].name).join(', ')}`)
    const R = this.roleJoint
    if (flip === null) {
      const right = model.joint(R.get('R.upper_arm')!).pos, left = model.joint(R.get('L.upper_arm')!).pos
      flip = conv(right)[0] < conv(left)[0]
    }
    this.flip = flip
    for (const j of model.joints) this.D.set(j.name, conv(j.pos, flip))
    this.target = effective(model, this.mapping, this.overrides)
    for (const [node, joint] of [...this.mapping].sort((a, b) => a[0] - b[0])) if (!this.direct.has(joint)) this.direct.set(joint, node)
    for (const [j, n] of this.overrides) if (n !== null && n !== undefined) this.direct.set(j, n)
    this.build(scale, torsoSquash, floorFromMesh)
  }

  private node(role: string): number {
    return this.sk.node(role)!
  }

  private d(joint: string): Vec3 {
    const v = this.D.get(joint)
    if (!v) throw new LabError(`the model has no joint ${joint}`)
    return v
  }

  // the model's lowest point (its up axis is y)
  private lowest(): number {
    let low = Infinity
    for (const prim of this.model.prims) for (const p of prim.pos) low = Math.min(low, p[1])
    return Number.isFinite(low) ? low : 0
  }

  private build(scale: number | null, torsoSquash: boolean, floorFromMesh: boolean) {
    const J = this.J, R = this.roleJoint, maps = this.maps
    const avg = (role: string) => mul(add(this.d(R.get('L.' + role)!), this.d(R.get('R.' + role)!)), 0.5)
    // one scale: the model's thigh-to-foot height becomes the base's
    let S = (J[this.node('R.thigh')][2] - J[this.node('R.foot')][2]) / (avg('thigh')[2] - avg('foot')[2])
    if (scale) S = Number(scale)
    if (!(S > 0)) throw new LabError("the model's legs point upwards: check the thigh and foot mapping")
    this.S = S
    // torso squash: kzUp lands the shoulders on the base's shoulder height, kzDown does the same for the pelvis above the ankles
    const pelvis = this.d(R.get('pelvis')!)
    const zSh = avg('upper_arm')[2]
    // the ankle's height is measured from z = 0, or from the model's lowest point for a model whose origin isn't on its floor
    const ankleZ = S * (avg('foot')[2] - (floorFromMesh ? this.lowest() : 0))
    let kzUp = (J[this.node('R.upper_arm')][2] - J[this.node('pelvis')][2]) / (S * (zSh - pelvis[2]))
    let kzDown = (J[this.node('pelvis')][2] - ankleZ) / (S * (pelvis[2] - avg('foot')[2]))
    if (!torsoSquash) kzUp = kzDown = 1.0
    this.torso = new Torso(pelvis, J[this.node('pelvis')], S, zSh, kzUp, kzDown)
    for (const role of TORSO_ROLES) if (R.has(role)) maps.set(R.get(role)!, this.torso)

    // limb bone: turn it so it points at its child's place on the base, and stretch it to that length
    const seg = (b: string, childP: Vec3, Q: Vec3, Qc: Vec3): Mat3 => {
      const d = sub(childP, this.d(b))
      const Rm = rotBetween(d, sub(Qc, Q))
      maps.set(b, new Bone(this.d(b), Q, S, Rm, unit(d), length(sub(Qc, Q)) / (S * length(d))))
      return Rm
    }

    for (const s of SIDES) {
      const n = (role: string) => R.get(`${s}.${role}`)
      const node = (role: string) => this.sk.node(`${s}.${role}`)!
      const chain = ['clavicle', 'upper_arm', 'forearm', 'hand'].filter((r) => n(r)).map((r) => [n(r)!, node(r)] as [string, number])
      for (let i = 0; i + 1 < chain.length; i++) seg(chain[i][0], this.d(chain[i + 1][0]), J[chain[i][1]], J[chain[i + 1][1]])
      const hand = n('hand')!
      const fa = this.sk.chain(s, 'finger_a'), fb = this.sk.chain(s, 'finger_b')
      const knuckJoint = R.get(`${s}.finger_a.0`) || R.get(`${s}.finger_b.0`)
      let Rhand: Mat3
      if (knuckJoint && fa.length && fb.length) {
        const knuck = this.d(knuckJoint)
        const joKnuck = mul(add(J[fa[0]], J[fb[0]]), 0.5)
        Rhand = seg(hand, knuck, J[node('hand')], add(J[node('hand')], mul(unit(sub(joKnuck, J[node('hand')])), S * length(sub(knuck, this.d(hand))))))
      } else {
        Rhand = maps.get(n('forearm')!)!.R
        maps.set(hand, new Bone(this.d(hand), J[node('hand')], S, Rhand))
      }
      for (const name of ['finger_a', 'finger_b', 'thumb']) {
        const nodes = this.sk.chain(s, name)
        const joints: string[] = []
        for (let k = 0; k < nodes.length; k++) {
          const j = R.get(`${s}.${name}.${k}`)
          if (j === undefined) break
          joints.push(j)
        }
        if (!joints.length) continue
        const dirs = joints.map((_, k) => (k + 1 < nodes.length ? sub(J[nodes[k + 1]], J[nodes[k]]) : sub(J[nodes[k]], J[nodes[k - 1]])))
        this.fk(joints, maps.get(hand)!, Rhand, dirs, hand)
      }
      // legs: the joints land on the base's hip, knee and ankle (the ankle's height follows the leg scale)
      const hip = J[node('thigh')], knee = J[node('calf')]
      const ankle: Vec3 = [J[node('foot')][0], J[node('foot')][1], ankleZ]
      seg(n('thigh')!, this.d(n('calf')!), hip, knee)
      seg(n('calf')!, this.d(n('foot')!), knee, ankle)
      const foot = new Bone(this.d(n('foot')!), ankle, S)
      maps.set(n('foot')!, foot)
      if (n('toe')) maps.set(n('toe')!, new Bone(this.d(n('toe')!), foot.apply(this.d(n('toe')!)), S))
    }
  }

  private fk(bones: string[], parentMap: VertexMap, Rparent: Mat3, dirs: Vec3[], hand: string) {
    let Rm = Rparent
    bones.forEach((b, i) => {
      let d: Vec3
      if (i + 1 < bones.length) d = sub(this.d(bones[i + 1]), this.d(b))
      else if (bones.length > 1) d = sub(this.d(b), this.d(bones[i - 1]))
      else d = sub(this.d(b), this.d(hand))
      Rm = matMul3(rotBetween(matApply(Rm, d), dirs[i]), Rm)
      const bone = new Bone(this.d(b), parentMap.apply(this.d(b)), this.S, Rm)
      this.maps.set(b, bone)
      parentMap = bone
    })
  }

  geo(joint: string): VertexMap {
    let m = this.geoCache.get(joint)
    if (!m) {
      let name: string | null = joint
      while (name !== null && !this.maps.has(name)) name = this.model.joint(name).parent
      m = name !== null ? this.maps.get(name)! : this.torso
      this.geoCache.set(joint, m)
    }
    return m
  }

  // rename a model joint's weight to the base's node (walking up to the nearest mapped joint)
  weights(joint: string, v: Vec3): Weights {
    let fn = this.wfn.get(joint)
    if (!fn) {
      let name: string | null = joint
      while (name !== null && !this.direct.has(name)) name = this.model.joint(name).parent
      fn = this.weightFn(name)
      this.wfn.set(joint, fn)
    }
    return fn(v)
  }

  private weightFn(joint: string | null): (v: Vec3) => Weights {
    if (joint === null) {
      const node = this.node('pelvis')
      return () => [[node, 1.0]]
    }
    const node = this.direct.get(joint)!
    if (node >= this.sk.nodes.length) throw new LabError(`game bone ${node} does not exist on this base`)
    const role = this.sk.nodes[node].role
    const twist = role && this.roleJoint.get(role) === joint ? this.sk.twist[role] : undefined
    if (twist && this.roleJoint.get(twist[1])) {
      const twistNode = this.node(twist[0]), child = this.roleJoint.get(twist[1])!
      const [, , t0, t1] = twist
      const P = this.d(joint)
      const d = sub(this.d(child), P)
      const dd = dot(d, d) || 1.0
      return (v) => {
        const t = dot(sub(v, P), d) / dd
        const f = Math.max(0.0, Math.min(1.0, (t - t0) / (t1 - t0)))
        return [[node, 1.0 - f], [twistNode, f]]
      }
    }
    return () => [[node, 1.0]]
  }

  vertex(pos: Vec3, nrm: Vec3, skin: Skin): [Vec3, Vec3, Weights] {
    const p = conv(pos, this.flip), n = unit(conv(nrm, this.flip))
    let q: Vec3 = [0.0, 0.0, 0.0], nn: Vec3 = [0.0, 0.0, 0.0]
    const jw: Weights = []
    // move the vertex by each bone's map and blend by skin weight; the weights come out on the base's nodes, cut to three
    for (const [b, w] of skin) {
      const m = this.geo(b)
      q = add(q, mul(m.apply(p), w))
      nn = add(nn, mul(matApply(m.R, n), w))
      for (const [jb, f] of this.weights(b, p)) jw.push([jb, w * f])
    }
    return [q, unit(nn), top3(jw)]
  }

  triangles(materials: MaterialSlots): Map<number, Tri[]> {
    const out = new Map<number, Tri[]>()
    for (const prim of this.model.prims) {
      const spec = prim.material !== null ? (materials.get(prim.material) ?? [0, false]) : [0, false]
      const slot = spec[0] as number | null, twoSided = spec[1] as boolean, bind = (spec[2] ?? null) as number | null
      if (slot === null) continue
      const verts: Vertex[] = prim.pos.map((pos, i) => {
        const [q, nn, w] = this.vertex(pos, prim.nrm[i], prim.skin[i])
        return [q, nn, prim.uv[i], bind !== null ? [[bind, 1.0]] : w]
      })
      if (!out.has(slot)) out.set(slot, [])
      const lst = out.get(slot)!
      const flipped = (v: Vertex): Vertex => [v[0], mul(v[1], -1), v[2], v[3]]
      for (const [a, b, c] of prim.tris) {
        lst.push([verts[a], verts[b], verts[c]])
        if (twoSided) lst.push([flipped(verts[a]), flipped(verts[c]), flipped(verts[b])])
      }
    }
    return out
  }
}
