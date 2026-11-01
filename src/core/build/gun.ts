// A gun (manifest `z_button.gun`): holstered at the hip, drawn while Z is held, when attacks shoot it instead (game/gun.s).
import { LabError } from '../errors'
import { GUN_FIELD, GUN_PICK_VALUE, type GunCharacter } from '../game/dol'
import type * as R from '../game/roster'
import * as nfxtool from '../mnroi/nfxtool'
import * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import * as nottool from '../mnroi/nottool'
import type { Tri } from '../model/fit'
import { Skeleton } from '../model/skeleton'
import type { Effects } from './effects'
import { OWN_EFFECTS } from './effectslots'
import * as holster from './holster'
import { PICK, FIRE } from './projectiles'
import { HIT_ON } from './reach'
import * as templates from './templates'

type Vec3 = ngbtool.Vec3
type Mat3 = ngbtool.Mat3

export const DONOR = 'elektra'
export const DONOR_GROUND = 'superrangedattack'
export const DONOR_AIR = 'superjumpattack'
export const TEMPLATE = 'proj_elektraThrowStar'
export const FIELD = GUN_FIELD
export const DAMAGE: [number, number] = [1, 1000]
export const DEFAULT_DAMAGE = 10
export const ENERGY: [number, number] = [0, 100]
export const DEFAULT_ENERGY = 5
export const BULLETS: [number, number] = [1, 10]
export const DEFAULT_BULLETS = 2
export const THROW_SOUND = 21
export const MUZZLE_KIND = 21
export const MUZZLE_INDEX = 3
const SPAWN = 0x4f
const P_MODEL = 0x0a, P_EFFECT1 = 0x28, P_OBJECT_SOUNDID = 0x70, P_DAMAGE = 0x4b
const RECOIL = 14
const AIM_OUT = 5
const SPACING = 3
const TAIL = 10
const HELD_FIRST = 2

const sideName = (side: holster.Side) => (side === 'R' ? 'right' : 'left')

// A forearm prop bone that nothing is attached to, else a new bone on the hand, appended to the model.
export function bone(model: Pick<ngmtool.Model, 'nodes' | 'attachments'>, body: string, side: holster.Side): [number, boolean] {
  const sk = new Skeleton(model, body)
  const prop = sk.nodes.find((n) => n.name === `${side} Forearm prop`)
  if (prop && !model.attachments.some(([n]) => n === prop.index)) return [prop.index, false]
  if (sk.node(`${side}.hand`) === undefined) throw new LabError(`${body} bases have no ${sideName(side)} hand bone to hold a gun`)
  return [model.nodes.length, true]
}

// The node bone() appends, or none: on the hand, where it is.
export function extraNode(model: Pick<ngmtool.Model, 'nodes' | 'attachments'>, body: string, side: holster.Side): ngmtool.Node[] {
  const [, added] = bone(model, body, side)
  if (!added) return []
  const hand = new Skeleton(model, body).node(`${side}.hand`)!
  const [, b, , x] = model.nodes[hand]
  return [[[0, 0, 0, 0], [...b] as ngmtool.Vec4, hand, x]]
}

export function rig<M extends ngmtool.Model>(model: M, body: string, side: holster.Side): M {
  const extra = extraNode(model, body, side)
  if (!extra.length) return model
  const m = model.clone() as M
  m.nodes = [...model.nodes, ...extra]
  return m
}

// model: the base's, before rig().
export function prop(model: Pick<ngmtool.Model, 'nodes' | 'attachments'>, body: string, side: holster.Side): holster.Prop {
  const sk = new Skeleton(model, body)
  const [anchor, hand] = [`${side}.thigh`, `${side}.hand`].map((r) => sk.node(r))
  if (anchor === undefined || hand === undefined) throw new LabError(`the skeleton has no ${sideName(side)} thigh or hand for the gun`)
  return { bone: bone(model, body, side)[0], anchor, side, hand }
}

// The gun at bind: its muzzle, the barrel's direction out of it, and the gun's up.
export interface Geometry {
  muzzle: Vec3
  barrel: Vec3
  up: Vec3
}

export function sized(g: Geometry, size: number): Geometry {
  return { ...g, muzzle: holster.scale(g.muzzle, size) }
}

// The direction the points spread most along, ignoring any spread along not.
function principal(points: Vec3[], mean: Vec3, not: Vec3 = [0, 0, 0]): Vec3 {
  const flat = points.map((p) => {
    const d = holster.sub(p, mean)
    return holster.sub(d, holster.scale(not, holster.dot(d, not)))
  })
  const c = [0, 1, 2].map((i) => [0, 1, 2].map((j) => flat.reduce((s, d) => s + d[i] * d[j], 0)))
  let v: Vec3 = holster.unit(holster.sub([1, 0.5, 0.25], holster.scale(not, holster.dot([1, 0.5, 0.25], not))))
  for (let k = 0; k < 64; k++) v = holster.unit([0, 1, 2].map((i) => c[i][0] * v[0] + c[i][1] * v[1] + c[i][2] * v[2]) as Vec3)
  return v
}

// The long side of the smallest rectangle around the points' outline in the plane of e1 and e2, as a direction.
function longSide(points: Vec3[], mean: Vec3, e1: Vec3, e2: Vec3): Vec3 {
  const flat = points.map((p): [number, number] => [holster.dot(holster.sub(p, mean), e1), holster.dot(holster.sub(p, mean), e2)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: [number, number][]) => {
    const out: [number, number][] = []
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    return out.slice(0, -1)
  }
  const hull = [...half(flat), ...half([...flat].reverse())]
  let best: [number, number] = [1, 0], area = Infinity
  hull.forEach((p, i) => {
    const q = hull[(i + 1) % hull.length], n = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (n < 1e-9) return
    const d: [number, number] = [(q[0] - p[0]) / n, (q[1] - p[1]) / n]
    const along = hull.map((h) => h[0] * d[0] + h[1] * d[1]), across = hull.map((h) => h[1] * d[0] - h[0] * d[1])
    const [w, h] = [Math.max(...along) - Math.min(...along), Math.max(...across) - Math.min(...across)]
    if (w * h < area) [best, area] = [w >= h ? d : [-d[1], d[0]], w * h]
  })
  return holster.unit(holster.add(holster.scale(e1, best[0]), holster.scale(e2, best[1])))
}

// The barrel runs along the long side of the gun's outline, out of the end farther from the hand; the grip hangs below it.
export function geometry(tris: Iterable<Tri[]>, gunBone: number, hand: Vec3): Geometry {
  const seen = new Set<string>(), points: Vec3[] = []
  for (const list of tris) {
    for (const tri of list) {
      for (const [p, , , w] of tri) {
        if (!w.some(([b, x]) => b === gunBone && x > 0)) continue
        const k = p.join(',')
        if (!seen.has(k)) {
          seen.add(k)
          points.push([p[0], p[1], p[2]])
        }
      }
    }
  }
  if (points.length < 3) throw new LabError(`nothing is fixed to game bone ${gunBone} to be the gun`)
  const mean = holster.scale(points.reduce((s, p) => holster.add(s, p), [0, 0, 0] as Vec3), 1 / points.length)
  const e1 = principal(points, mean), e2 = principal(points, mean, e1)
  let axis = longSide(points, mean, e1, e2)
  if (holster.dot(holster.sub(hand, mean), axis) > 0) axis = holster.scale(axis, -1)
  const along = (p: Vec3) => holster.dot(holster.sub(p, mean), axis)
  const tip = Math.max(...points.map(along))
  const end = points.filter((p) => along(p) > tip - 0.02)
  const muzzle = holster.scale(end.reduce((s, p) => holster.add(s, p), [0, 0, 0] as Vec3), 1 / end.length)
  const toMean = holster.sub(mean, muzzle)
  const down = holster.sub(toMean, holster.scale(axis, holster.dot(toMean, axis)))
  const up = holster.norm(down) > 1e-6 ? holster.unit(holster.scale(down, -1)) : holster.unit(holster.cross(holster.cross(axis, [0, 0, 1]), axis))
  return { muzzle, barrel: axis, up }
}

export function muzzleAttachment(gunBone: number, model: Pick<ngmtool.Model, 'nodes'>, g: Geometry): ngmtool.Attachment {
  const off = holster.sub(g.muzzle, ngbtool.pose(model, null, 0)[gunBone][1])
  return [gunBone, MUZZLE_KIND, MUZZLE_INDEX, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, off[0], off[1], off[2], 1]]
}

const basis = (a: Vec3, b: Vec3): Mat3 => {
  const c = holster.cross(a, b)
  return [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]]
}

const about = (axis: Vec3, deg: number): Mat3 => ngbtool.qmat([Math.cos((deg * Math.PI) / 360), ...holster.scale(holster.unit(axis), Math.sin((deg * Math.PI) / 360))])

export function shotsOf(rec: ngbtool.Record): number[] {
  return rec.events.filter(([, t]) => t === FIRE).map(([f]) => f)
}

// How far the muzzle kicks up after the shots, in degrees.
export function recoil(shots: number[], t: number): number {
  return shots.reduce((sum, s) => {
    const u = t - s
    if (u < 0) return sum
    return sum + RECOIL * (u < 1 ? u : Math.max(0, 1 - (u - 1) / 4))
  }, 0)
}

// The gun arm held out ahead at shoulder height, kicking up after each shot; steady keeps it aimed throughout, for a machine gun.
export function aim(rec: ngbtool.Record, model: Pick<ngmtool.Model, 'nodes'>, prop: holster.Prop, g: Geometry, arm: holster.Arm, steady = false): ngbtool.Record {
  const shots = shotsOf(rec)
  if (!shots.length) throw new LabError(`${rec.name} fires no shot to aim`)
  const L = rec.length, into = Math.max(1, Math.min(3, shots[0] - 1))
  const w = (t: number) => (steady ? 1 : Math.min(holster.smooth(t / into), holster.smooth((L - t) / AIM_OUT)))
  const bind = ngbtool.pose(model, null, 0)
  const reach = holster.norm(holster.sub(bind[arm.fore][1], bind[arm.upper][1])) + holster.norm(holster.sub(bind[arm.hand][1], bind[arm.fore][1]))
  const inward = prop.side === 'R' ? -1 : 1
  const times = holster.frameList(0, L)
  const bent = holster.bendArm(rec, model, arm, times, (posed) => holster.add(posed[arm.upper][1], [inward * 0.06, 0.92 * reach, -0.04]), w)
  const level = basis([0, 1, 0], [0, 0, 1])
  const held = holster.tr(basis(g.barrel, g.up))
  const parent = model.nodes[arm.hand][2]
  const keys: ngbtool.Key[] = []
  let prev: [number, number, number, number] | null = null
  for (const t of times) {
    const posed = ngbtool.pose(model, bent, t)
    const target = holster.mul(about([1, 0, 0], recoil(shots, t)), holster.mul(level, held))
    const ownQ = ngbtool.matQuat(posed[arm.hand][0])
    const world = ngbtool.qmat(holster.nlerp(ownQ, ngbtool.matQuat(target), w(t)))
    prev = holster.near(ngbtool.matQuat(holster.mul(holster.tr(posed[parent][0]), world)), prev)
    keys.push([t, ngbtool.encodeRotation(prev)])
  }
  return withRotation(bent, arm.hand, keys)
}

function withRotation(rec: ngbtool.Record, bone: number, keys: ngbtool.Key[]): ngbtool.Record {
  const tracks = [...rec.tracks], pointers = [...rec.pointers]
  const at = tracks.findIndex(([b, c]) => (b & 0xffff) === bone && c === 0)
  if (at >= 0) tracks[at] = [tracks[at][0], 0, keys]
  else {
    let i = tracks.findIndex(([b, c]) => (b & 0xffff) > bone || ((b & 0xffff) === bone && c > 0))
    if (i < 0) i = tracks.length
    tracks.splice(i, 0, [bone, 0, keys])
    pointers.splice(i, 0, 0)
  }
  return { ...rec, tracks, pointers }
}

export function shotEvents(events: ngbtool.Event[], sound: number, bullets: number, length: number, grow = false, held = false): [ngbtool.Event[], number] {
  const fire = events.find(([, t]) => t === FIRE)
  if (!fire || fire[0] <= 1) throw new LabError("Elektra's throw has no shot to time the gun's from")
  const voice = events.find(([, t, p]) => t === 0x17 && p === THROW_SOUND)?.[3] ?? 0
  const drop = new Set([...OWN_EFFECTS, ...HIT_ON, FIRE, SPAWN, PICK])
  const kept = events.filter(([, t, p]) => !drop.has(t) && !(t === 0x17 && p === THROW_SOUND))
  const spacing = grow || bullets < 2 ? SPACING : Math.max(1, Math.min(SPACING, Math.floor((length - TAIL - fire[0]) / (bullets - 1))))
  const first = held ? HELD_FIRST : fire[0]
  const frames = Array.from({ length: bullets }, (_, i) => first + i * spacing)
  const out: ngbtool.Event[] = [...kept, [1, PICK, GUN_PICK_VALUE, 0], [1, SPAWN, MUZZLE_INDEX, 0],
    ...frames.flatMap((f): ngbtool.Event[] => [[f, 0x17, sound, voice], [f, FIRE, fire[2], fire[3]]])]
  const last = frames[frames.length - 1]
  return [out.sort((x, y) => x[0] - y[0]), grow && held ? last + SPACING : grow ? Math.max(length, last + TAIL) : length]
}

export function bullet(T: R.Templates, internal: string, damage: number, effect: string): nottool.Template {
  if (!T.has(TEMPLATE)) throw new LabError(`Global.not has no ${TEMPLATE} to make the gun's bullet from`)
  const t = templates.clone(T.get(TEMPLATE), bulletName(internal))
  t.props = t.props.filter(([p]) => p !== P_MODEL && p !== P_OBJECT_SOUNDID)
  t.set(P_DAMAGE, nottool.vInt(Math.round(damage)))
  t.set(P_EFFECT1, nottool.vStr(effect))
  return t
}

export const bulletName = (internal: string) => `proj_${internal}Gun`

const TRAIL = nfxtool.TYPES.indexOf('trail'), PARTSYS = nfxtool.TYPES.indexOf('partsys'), CONTROLLER = nfxtool.TYPES.indexOf('controller')

function add(fx: Effects, type: number, body: string[], prefix: string): string {
  const same = fx.same(type, body)
  if (same) return same
  const [name] = fx.fresh(prefix)
  fx.append([new nfxtool.Block(type, name, [`${nfxtool.TYPES[type]} ${name}`, ...body, 'end'], true)])
  return name
}

// A short warm streak with a glow at its head, on the textures every match loads (Bundles/global).
export function tracer(fx: Effects, internal: string): string {
  const prefix = `${internal.slice(0, 2).toLowerCase()}gn`
  const streak = add(fx, TRAIL, ['startcol (220,255,236,170)', 'endcol (0,255,190,90)', 'startsize 0.08', 'endsize 0', 'part_life 0.12',
    'sampledelay 0.01', 'renderradius 20', 'max_particles 14'], prefix)
  const glow = add(fx, PARTSYS, ['max_particles 1', 'part_size0 0.45', 'part_size1 0.3', 'type_flags2 0x80001', 'material GE_PAR_lensFlare_01_BW',
    'startcol (230,255,230,160)', 'turbulence 0.0', 'gravity 0.0', 'partfadein 0.0', 'spawn_delay 0.0', 'duration 0.0', 'part_life 0.4'], prefix)
  return add(fx, CONTROLLER, [`effectname ${streak}`, `effectname ${glow}`, 'renderradius -1', 'flags 0x400'], prefix)
}

export interface Plan {
  holster: holster.Plan
  geometry: Geometry
  sound: number
  bullets: number
  automatic: boolean
}

// The gun's entry in gun.s's table; K takes a vertex at bind to where the thigh's skin matrix puts it: R p + thigh + position - R center.
export function entry(internal: string, model: Pick<ngmtool.Model, 'nodes'>, plan: holster.Plan, energy: number, automatic: boolean): GunCharacter {
  const p = plan.prop!
  const bind = ngbtool.pose(model, null, 0)
  const R = holster.turn(plan.rotation)
  const kt = holster.add(holster.sub(bind[p.anchor][1], holster.apply(R, plan.center)), plan.position)
  return {
    internal, bone: p.bone, hand: p.hand!, thigh: p.anchor, nodes: Math.max(p.bone, p.hand!, p.anchor) + 1, automatic, energy,
    bind: bind[p.bone][1], k: [...[0, 1, 2].flatMap((i) => [R[0][i], R[1][i], R[2][i]]), ...kt],
  }
}
