// A prop carried in a holster outside power mode: Daredevil's club on the back (manifest `base_moves.holster`) or a gun at the hip (`gun`).
import { LabError } from '../errors'
import * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Tri } from '../model/fit'
import type { Skeleton } from '../model/skeleton'
import { CATCH, CLUB } from './basemoves'
import { withKeys } from './reach'

type Vec3 = ngbtool.Vec3
type Mat3 = ngbtool.Mat3
type Quat = [number, number, number, number]
type Model = Pick<ngmtool.Model, 'nodes'>
type Posed = [Mat3, Vec3][]

export const CHEST = 3
// power-on's and power-off's reach as fractions of the animation: [arm leaves, hand at the club, arm back]
const ON: [number, number, number] = [0, 0.45, 0.9]
const OFF: [number, number, number] = [0.1, 0.55, 1]
// frames the club takes to jump between the back and the hand
const SWITCH = 0.01
// frames the club takes after the baton throw's catch to turn from Daredevil's reversed grip to the power-stand one
const REGRIP = 4

export interface Prop {
  bone: number
  anchor: number
  side: Side
  hand: number | null
}

export type Side = 'R' | 'L'

export const CLUB_PROP: Prop = { bone: CLUB, anchor: CHEST, side: 'R', hand: null }

export interface Plan {
  position: Vec3
  rotation: Vec3
  center: Vec3
  drawn?: Record<string, boolean>
  prop?: Prop
}

const propOf = (plan: Plan) => plan.prop ?? CLUB_PROP

export function sized(plan: Plan, size: number): Plan {
  const k = (v: Vec3) => v.map((x) => x * size) as Vec3
  return { ...plan, position: k(plan.position), center: k(plan.center) }
}

export interface Arm {
  upper: number
  fore: number
  hand: number
}

export type Role = 'stowed' | 'drawn' | 'on' | 'off' | 'free'

const DRAWN = ['powerstand', 'rangedattack', 'dodgeexitsuperattack']

export function role(state: string): Role | null {
  const s = state.toLowerCase()
  // IKClaws plays over every animation (events 0x40/0x41), so it must not key the club
  if (s === 'ikclaws') return 'free'
  if (s.includes('victim') || s.startsWith('ik')) return null
  if (s === 'poweron') return 'on'
  if (s === 'poweroff') return 'off'
  return s.startsWith('super') || DRAWN.includes(s) ? 'drawn' : 'stowed'
}

export const CLUB_MOVES = ['SuperAttackFar', 'RangedAttack', 'DodgeExitSuperAttack', 'SuperRiseAttack']

export function defaultDrawn(states: string[]): boolean | null {
  const roles = states.map(role).filter((r) => r !== null)
  if (!roles.length || roles.some((r) => r !== 'stowed' && r !== 'drawn')) return null
  return roles.every((r) => r === 'drawn')
}

export function armOf(sk: Skeleton, side: Side = 'R'): Arm {
  const [upper, fore, hand] = ['upper_arm', 'forearm', 'hand'].map((r) => sk.node(`${side}.${r}`))
  if (upper === undefined || fore === undefined || hand === undefined) throw new LabError(`the skeleton has no ${side === 'R' ? 'right' : 'left'} arm to reach for the holster with`)
  return { upper, fore, hand }
}

export function center(tris: Iterable<Tri[]>, bone = CLUB): Vec3 {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const list of tris) {
    for (const tri of list) {
      for (const [p, , , w] of tri) {
        if (!w.some(([b, x]) => b === bone && x > 0) || w.some(([b, x]) => b !== bone && x > 0)) continue
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k])
          hi[k] = Math.max(hi[k], p[k])
        }
      }
    }
  }
  if (lo[0] > hi[0]) throw new LabError(`nothing is fixed to game bone ${bone} for the holster to carry`)
  return [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: Vec3) => Math.hypot(...a)
export const unit = (a: Vec3): Vec3 => scale(a, 1 / (norm(a) || 1))
export const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c])) as Mat3
export const tr = (a: Mat3): Mat3 => [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[c][r])) as Mat3
export const apply = (m: Mat3, v: Vec3): Vec3 => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as Vec3

// Degrees about X, Y and Z, applied X first.
export function turn([x, y, z]: Vec3): Mat3 {
  const [cx, sx, cy, sy, cz, sz] = [x, y, z].flatMap((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)])
  const rx: Mat3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
  const ry: Mat3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
  const rz: Mat3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
  return mul(rz, mul(ry, rx))
}

export function arc(a: Vec3, b: Vec3): Mat3 {
  const u = unit(a), v = unit(b)
  const c = Math.max(-1, Math.min(1, dot(u, v)))
  let axis = cross(u, v)
  if (norm(axis) < 1e-9) {
    if (c > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    axis = cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
  }
  const [x, y, z] = unit(axis), s = Math.sqrt(1 - c * c), k = 1 - c
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ]
}

export const near = (q: Quat, prev: Quat | null): Quat => (prev && q.reduce((s, v, i) => s + v * prev[i], 0) < 0 ? q.map((v) => -v) as Quat : q)

export function nlerp(a: Quat, b: Quat, w: number): Quat {
  const bb = near(b, a)
  const q = a.map((v, i) => v + (bb[i] - v) * w) as Quat
  const n = Math.hypot(...q) || 1
  return q.map((v) => v / n) as Quat
}

export const smooth = (u: number) => {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

export function frameList(a: number, b: number): number[] {
  const out = [a]
  for (let f = Math.floor(a) + 1; f < b; f++) out.push(f)
  if (b > a) out.push(b)
  return out
}

// The prop's world rotation and place in its holster for a posed skeleton.
export function stowedAt(model: Model, plan: Plan): (posed: Posed) => [Mat3, Vec3] {
  const { bone, anchor } = propOf(plan)
  const bind = ngbtool.pose(model, null, 0)
  const R = turn(plan.rotation)
  const local = add(plan.position, apply(R, sub(bind[bone][1], plan.center)))
  return (posed) => {
    const [CR, CT] = posed[anchor]
    return [mul(CR, R), add(CT, apply(CR, local))]
  }
}

// The prop's world rotation and place in the hand, held as at bind.
export function heldAt(model: Model, prop: Prop): (posed: Posed) => [Mat3, Vec3] {
  const bind = ngbtool.pose(model, null, 0)
  const off = sub(bind[prop.bone][1], bind[prop.hand!][1])
  return (posed) => {
    const [HR, HT] = posed[prop.hand!]
    return [HR, add(HT, apply(HR, off))]
  }
}

function propKeys(rec: ngbtool.Record, model: Model, bone: number, at: (posed: Posed) => [Mat3, Vec3], times: number[]): [ngbtool.Key[], ngbtool.Key[]] {
  const parent = model.nodes[bone][2]
  const rot: ngbtool.Key[] = [], pos: ngbtool.Key[] = []
  let prev: Quat | null = null
  for (const t of times) {
    const posed = ngbtool.pose(model, rec, t)
    const [R, T] = at(posed)
    prev = near(ngbtool.matQuat(mul(tr(posed[parent][0]), R)), prev)
    rot.push([t, ngbtool.encodeRotation(prev)])
    pos.push([t, ngbtool.placeAt(model, rec, bone, t, T, posed)])
  }
  return [rot, pos]
}

const clubKeys = (rec: ngbtool.Record, model: Model, plan: Plan, times: number[]) => propKeys(rec, model, propOf(plan).bone, stowedAt(model, plan), times)

// The prop's keys in the hand: the record's own, or pinned to the hand for a prop it doesn't key.
const own = (rec: ngbtool.Record, ch: number, model: Model, prop: Prop) => {
  if (prop.hand !== null) {
    const held = heldAt(model, prop)
    const at = (t: number): ngbtool.Packed => propKeys(rec, model, prop.bone, held, [t])[ch][0][1]
    return { keys: frameList(0, rec.length).map((t): ngbtool.Key => [t, at(t)]), at }
  }
  const keys = rec.tracks.find(([b, c]) => b === prop.bone && c === ch)?.[2] ?? []
  const at = (t: number): ngbtool.Packed => {
    if (ch === 1) return ngbtool.encodeTranslation(keys.length ? ngbtool.sample(keys.map(([f, v]): [number, Vec3] => [f, ngbtool.translation(v)]), t) : [0, 0, 0])
    return keys.length ? ngbtool.sample(keys, t).map(Math.round) as ngbtool.Packed : [16384, 0, 0, 0]
  }
  return { keys, at }
}

// The record without the prop's tracks.
export function free(rec: ngbtool.Record, bone = CLUB): ngbtool.Record {
  const keep = rec.tracks.map((t, i) => [t, rec.pointers[i] ?? 0] as const).filter(([[b]]) => (b & 0xffff) !== bone)
  return { ...rec, tracks: keep.map(([t]) => t), pointers: keep.map(([, p]) => p) }
}

function withClub(rec: ngbtool.Record, rot: ngbtool.Key[], pos: ngbtool.Key[], bone = CLUB): ngbtool.Record {
  return withKeys(withKeys(free(rec, bone), bone, rot, 0), bone, pos, 1)
}

export function stow(rec: ngbtool.Record, model: Model, plan: Plan): ngbtool.Record {
  const [rot, pos] = clubKeys(rec, model, plan, frameList(0, rec.length))
  return withClub(rec, rot, pos, propOf(plan).bone)
}

export function hold(rec: ngbtool.Record, model: Model, plan: Plan): ngbtool.Record {
  const prop = propOf(plan)
  const [rot, pos] = propKeys(rec, model, prop.bone, heldAt(model, prop), frameList(0, rec.length))
  return withClub(rec, rot, pos, prop.bone)
}

// The club's place in the hand in a posed skeleton: rotation and offset in the hand's frame.
export function grip(posed: Posed, hand: number): [Mat3, Vec3] {
  const [HR, HT] = posed[hand], [CR, CT] = posed[CLUB]
  return [mul(tr(HR), CR), apply(tr(HR), sub(CT, HT))]
}

// After the baton throw's catch, turns the club into the stand record's grip and holds it there.
export function regrip(rec: ngbtool.Record, model: Model, stand: ngbtool.Record, hand: number): ngbtool.Record {
  const [GR, GT] = grip(ngbtool.pose(model, stand, 0), hand)
  const parent = model.nodes[CLUB][2]
  const [ownRot, ownPos] = [0, 1].map((ch) => own(rec, ch, model, CLUB_PROP))
  const rot: ngbtool.Key[] = ownRot.keys.filter(([f]) => f < CATCH), pos: ngbtool.Key[] = ownPos.keys.filter(([f]) => f < CATCH)
  let prev: Quat | null = null
  for (const t of frameList(CATCH, rec.length)) {
    const posed = ngbtool.pose(model, rec, t)
    const [HR, HT] = posed[hand], w = smooth((t - CATCH) / REGRIP)
    const target = ngbtool.matQuat(mul(tr(posed[parent][0]), mul(HR, GR)))
    prev = near(nlerp(ngbtool.quat(ownRot.at(t)), target, w), prev)
    rot.push([t, ngbtool.encodeRotation(prev)])
    const T = posed[CLUB][1]
    pos.push([t, ngbtool.placeAt(model, rec, CLUB, t, add(T, scale(sub(add(HT, apply(HR, GT)), T), w)), posed)])
  }
  return withClub(rec, rot, pos)
}

// Bends the arm from frame a to c so the hand reaches the prop in its holster, blended in by w(t).
function reachArm(rec: ngbtool.Record, model: Model, plan: Plan, arm: Arm, a: number, c: number, w: (t: number) => number): ngbtool.Record {
  const at = stowedAt(model, plan)
  const bind = ngbtool.pose(model, null, 0)
  const grip = sub(bind[arm.hand][1], bind[propOf(plan).bone][1])
  return bendArm(rec, model, arm, frameList(a, c), (posed) => {
    const [R, T] = at(posed)
    return add(T, apply(R, grip))
  }, w)
}

export function bendArm(rec: ngbtool.Record, model: Model, arm: Arm, times: number[], target: (posed: Posed, t: number) => Vec3, w: (t: number) => number): ngbtool.Record {
  const up = model.nodes[arm.upper][2], foreParent = model.nodes[arm.fore][2]
  const upper: ngbtool.Key[] = [], fore: ngbtool.Key[] = []
  let pu: Quat | null = null, pf: Quat | null = null
  for (const t of times) {
    const posed = ngbtool.pose(model, rec, t)
    const S = posed[arm.upper][1], E = posed[arm.fore][1], W = posed[arm.hand][1]
    const la = norm(sub(E, S)), lb = norm(sub(W, E))
    const toTarget = sub(target(posed, t), S)
    const d = Math.max(Math.abs(la - lb) + 1e-4, Math.min(la + lb - 1e-4, norm(toTarget)))
    const dir = unit(toTarget)
    let side = sub(sub(E, S), scale(dir, dot(sub(E, S), dir)))
    if (norm(side) < 1e-6) side = sub([0, 0, -1], scale(dir, -dir[2]))
    const n = unit(side)
    const cosA = Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d)))
    const E2 = add(S, add(scale(dir, la * cosA), scale(n, la * Math.sqrt(1 - cosA * cosA))))
    const d1 = arc(sub(E, S), sub(E2, S))
    const d2 = arc(apply(d1, sub(W, E)), sub(add(S, scale(dir, d)), E2))
    const upperIk = mul(tr(posed[up][0]), mul(d1, posed[arm.upper][0]))
    const foreIk = mul(tr(mul(d1, posed[foreParent][0])), mul(d2, mul(d1, posed[arm.fore][0])))
    const upperOwn = ngbtool.matQuat(mul(tr(posed[up][0]), posed[arm.upper][0]))
    const foreOwn = ngbtool.matQuat(mul(tr(posed[foreParent][0]), posed[arm.fore][0]))
    pu = near(nlerp(upperOwn, ngbtool.matQuat(upperIk), w(t)), pu)
    pf = near(nlerp(foreOwn, ngbtool.matQuat(foreIk), w(t)), pf)
    upper.push([t, ngbtool.encodeRotation(pu)])
    fore.push([t, ngbtool.encodeRotation(pf)])
  }
  return withKeys(withKeys(rec, arm.upper, upper, 0), arm.fore, fore, 0)
}

export function draw(rec: ngbtool.Record, model: Model, plan: Plan, arm: Arm, kind: 'on' | 'off'): ngbtool.Record {
  const L = rec.length
  const [a, g, c] = (kind === 'on' ? ON : OFF).map((u) => u * L)
  const w = (t: number) => (t <= g ? smooth((t - a) / (g - a || 1)) : smooth(1 - (t - g) / (c - g || 1)))
  const reached = reachArm(rec, model, plan, arm, a, c, w)
  const bone = propOf(plan).bone
  const [rot, pos] = [0, 1].map((ch) => own(reached, ch, model, propOf(plan)))
  if (kind === 'on') {
    const [sr, sp] = clubKeys(reached, model, plan, frameList(0, g))
    const after = (o: typeof rot): ngbtool.Key[] => {
      const keys: ngbtool.Key[] = [[g + SWITCH, o.at(g + SWITCH)], ...o.keys.filter(([f]) => f > g + SWITCH)]
      return keys[keys.length - 1][0] < L ? [...keys, [L, o.at(L)]] : keys
    }
    return withClub(reached, [...sr, ...after(rot)], [...sp, ...after(pos)], bone)
  }
  const [sr, sp] = clubKeys(reached, model, plan, frameList(g + SWITCH, L))
  const before = (o: typeof rot): ngbtool.Key[] => [[0, o.at(0)], ...o.keys.filter(([f]) => f > 0 && f < g), [g, o.at(g)]]
  return withClub(reached, [...before(rot), ...sr], [...before(pos), ...sp], bone)
}