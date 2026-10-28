// Limbs that stretch out and back within a move's animation (manifest `move_reach`): an arm by its forearm twist, a leg by its foot.
import { LabError } from '../errors'
import * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Skeleton } from '../model/skeleton'
import { HIT_REACH, MIRROR_EVENT, RETURN_EVENT } from './basemoves'

type Vec3 = ngbtool.Vec3
type Model = Pick<ngmtool.Model, 'nodes' | 'attachments'>

export const LIMBS = ['right_arm', 'left_arm', 'right_leg', 'left_leg'] as const
export type Limb = (typeof LIMBS)[number]
export const LIMB_LABELS: Record<Limb, string> = { right_arm: 'right arm', left_arm: 'left arm', right_leg: 'right leg', left_leg: 'left leg' }
const ROLES: Record<Limb, string> = { right_arm: 'R.forearm_twist', left_arm: 'L.forearm_twist', right_leg: 'R.foot', left_leg: 'L.foot' }
export const DISTANCE: [number, number] = [1, 35]
export const JUMP_DISTANCE: [number, number] = [0.25, 3]
export const JUMPS = ['Jump', 'RunJump', 'SuperJump', 'SuperRunJump']
// With RETURN_ABILITY a hit in these skips ahead to event 0x53 (fn_800E7A4C).
export const RETURNS = ['SuperAttackFar', 'SuperRiseAttack']
export const RETURN_ABILITY = 0x20000000
// A ranged pickup's wire ends at the object (fn_800D73F0), so the limb goes out to distance.
export const PULLS = ['WirePull', 'WirePullFly']

// hit volumes 2 to 5 switched on and off (fn_800E1788)
const VOLUMES: [number, number, Limb][] = [[0x18, 0x19, 'left_arm'], [0x39, 0x3a, 'right_arm'], [0x3c, 0x3d, 'left_leg'], [0x3e, 0x3f, 'right_leg']]
// Volume 6 (attachments 43 and 44) is the baton's long hit; a far reach's arm gets it too.
const FAR_ON = 0x56, FAR_OFF = 0x57
export const HIT_ON = [...VOLUMES.map(([on]) => on), FAR_ON]
const FAR_KINDS = [43, 44]
export const WIRE_ON = 0x23
const WIRE_OFF = 0x24
// a pickup's wire reaches the object, which it then pulls in until 0x24
const CATCH = 0x05
// Event 0x05 throws the object at this tuning field's speed in m/s (35, Iron Man 40).
export const PULL_SPEED_FIELD = 113
const PULL_SPEED = 35
const FPS = 30
export const WIRE_FIELD = 168
export const EFFECT_ON = 0x48
const EFFECT_OFF = 0x49
const FOREARM = 21
// event 0x23 puts the wire's end 3 m ahead of the actor and 10 m up
export const WIRE_END: Vec3 = [0, 3, 10]
// meters a frame: faster passes targets between frames
export const STEP = 1.0
// meters a frame out to the wire's end or a grab's victim
const FLY = 2.0
// share of a held jump stretch's animation spent growing, and again shrinking
const JUMP_RAMP = 0.2

export type Kind = 'hit' | 'wire' | 'line' | 'jump'

export interface Window {
  limb: Limb
  from: number
  to: number
  // the line's end on the victim: attachment (kind, index)
  end: [number, number] | null
  caught?: number
}

export interface Plan {
  kind: Kind
  windows: Window[]
}

export interface Summary {
  kind: Kind
  limbs: Limb[]
}

export interface Line {
  start: [number, number] | null
  end: [number, number] | null
}

export interface Victim {
  rec: ngbtool.Record
  model: Model
}

export interface Reach {
  distance: number
  limbs: Limb[]
  returns: boolean
  // the arm that carries volume 6 (farVolume)
  far?: Limb | null
  // m/s a pickup's object flies back at
  pull?: number
  // a jump's legs stay at full length through the middle of the animation
  hold?: boolean
}

export const limbsOf = (p: Plan): Limb[] => LIMBS.filter((l) => p.windows.some((w) => w.limb === l))
export const summary = (p: Plan): Summary => ({ kind: p.kind, limbs: limbsOf(p) })

export const jumpSummary: Summary = { kind: 'jump', limbs: ['right_leg', 'left_leg'] }
export const jumpPlan = (length: number): Plan => ({ kind: 'jump', windows: (['right_leg', 'left_leg'] as Limb[]).map((limb) => ({ limb, from: 0, to: length, end: null })) })

// A pickup reaches out to the object as a grab does to the opponent.
export function forMove<T extends Plan | Summary>(id: string, p: T): T {
  if (p.kind !== 'wire' || !PULLS.includes(id)) return p
  return 'windows' in p ? { ...p, kind: 'line', windows: p.windows.map((w) => ({ ...w, end: null })) } : { ...p, kind: 'line' }
}

export function bonesOf(sk: Skeleton): Record<Limb, number> {
  return Object.fromEntries(LIMBS.map((l) => {
    const n = sk.node(ROLES[l])
    if (n === undefined) throw new LabError(`the skeleton has no ${LIMB_LABELS[l]} to stretch`)
    return [l, n]
  })) as Record<Limb, number>
}

function merged(ws: Window[]): Window[] {
  const out: Window[] = []
  for (const w of [...ws].sort((a, b) => a.from - b.from)) {
    const last = out.findLast((o) => o.limb === w.limb)
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to)
    else out.push({ ...w })
  }
  return out
}

// The wire first, then hits, then lines; null when none. lines(k) gives the lines effect k draws.
export function plan(events: ngbtool.Event[], length: number, lines: (k: number) => Line[] = () => []): Plan | null {
  const evs = [...events].sort((a, b) => a[0] - b[0])
  const until = (from: number, done: (e: ngbtool.Event) => boolean) => evs.find((e) => e[0] >= from && done(e))?.[0] ?? length
  const wire = evs.filter(([, t]) => t === WIRE_ON).map(([f, , , v]): Window => {
    const to = until(f, ([, t]) => t === WIRE_OFF)
    const caught = evs.find(([g, t]) => t === CATCH && f < g && g < to)?.[0]
    return { limb: v === 1 ? 'left_arm' : 'right_arm', from: f, to, end: null, ...(caught !== undefined && { caught }) }
  })
  if (wire.length) return { kind: 'wire', windows: merged(wire) }
  const hits = VOLUMES.flatMap(([on, off, limb]) => evs.filter(([, t]) => t === on).map(([f]): Window => ({ limb, from: f, to: until(f, ([, t]) => t === off), end: null })))
  if (hits.length) return { kind: 'hit', windows: merged(hits) }
  const drawn = evs.filter(([, t]) => t === EFFECT_ON).flatMap(([f, , k]) => lines(k).flatMap((l): Window[] => {
    if (!l.start || l.start[0] !== FOREARM) return []
    return [{ limb: l.start[1] === 2 ? 'left_arm' : 'right_arm', from: f, to: until(f, ([, t, p]) => t === EFFECT_OFF && p === k), end: l.end }]
  }))
  return drawn.length ? { kind: 'line', windows: merged(drawn) } : null
}

const mix = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function frames(a: number, b: number, also: number[]): number[] {
  const out = [a]
  for (let f = Math.floor(a) + 1; f < b; f++) out.push(f)
  if (b > a) out.push(b)
  return [...new Set([...out, ...also.filter((f) => a < f && f < b)])].sort((x, y) => x - y)
}

// Replaces the bone's keys on channel ch (translation by default) from the first key's frame to the last's, or adds a track.
export function withKeys(rec: ngbtool.Record, bone: number, keys: ngbtool.Key[], ch = 1): ngbtool.Record {
  const lo = keys[0][0], hi = keys[keys.length - 1][0]
  const tracks = [...rec.tracks], pointers = [...rec.pointers]
  const at = tracks.findIndex(([b, c]) => b === bone && c === ch)
  if (at >= 0) {
    const old = tracks[at][2]
    tracks[at] = [bone, ch, [...old.filter(([f]) => f < lo), ...keys, ...old.filter(([f]) => f > hi)]]
  } else {
    let i = tracks.findIndex(([b, c]) => (b & 0xffff) > bone || (b === bone && c > ch))
    if (i < 0) i = tracks.length
    tracks.splice(i, 0, [bone, ch, keys])
    pointers.splice(i, 0, 0)
  }
  return { ...rec, tracks, pointers, length: Math.max(rec.length, hi) }
}

// Keys putting the bone at to(t, its own place) each frame from a to b and at those in also; to must give its own place back at both ends.
function solve(rec: ngbtool.Record, model: Model, bone: number, a: number, b: number, also: number[], to: (t: number, own: Vec3, posed: ReturnType<typeof ngbtool.pose>) => Vec3): ngbtool.Record {
  const keys = frames(a, b, also).map((t): ngbtool.Key => {
    const posed = ngbtool.pose(model, rec, t)
    return [t, ngbtool.placeAt(model, rec, bone, t, to(t, posed[bone][1], posed), posed)]
  })
  return withKeys(rec, bone, keys)
}

function attachment(model: Model, [kind, index]: [number, number]): Vec3 | null {
  const a = model.attachments.find(([, k, i]) => k === kind && i === index)
  if (!a || a[0] >= model.nodes.length) return null
  const b = model.nodes[a[0]][1]
  return [a[3][12] - b[0], a[3][13] - b[1], a[3][14] - b[2]]
}

const retimed = (rec: ngbtool.Record, remap: (f: number) => number, shift: number): ngbtool.Record => ({
  ...rec,
  length: rec.length + shift,
  tracks: rec.tracks.map(([bone, ch, keys]): ngbtool.Track => [bone, ch, keys.map(([f, v]): ngbtool.Key => [remap(f), v])]),
  events: rec.events.map(([f, t, p, v]): ngbtool.Event => [remap(f), t, p, v]),
})

// Slows each window until the limb can go distance further and back within STEP a frame, as longThrow does for the baton.
function hits(rec: ngbtool.Record, model: Model, bones: Record<Limb, number>, ws: Window[], r: Reach): ngbtool.Record {
  const n = Math.ceil(r.distance / STEP)
  const spans: { from: number; to: number; ws: Window[] }[] = []
  for (const w0 of [...ws].sort((a, b) => a.from - b.from)) {
    const w = { ...w0, to: Math.max(w0.to, w0.from + 1) }
    const last = spans[spans.length - 1]
    if (last && w.from <= last.to) {
      last.to = Math.max(last.to, w.to)
      last.ws.push(w)
    } else spans.push({ from: w.from, to: w.to, ws: [w] })
  }
  let out = rec
  const placed: Window[] = []
  for (const s of spans.reverse()) {
    const len = (s.to - s.from) * Math.max(1, ...s.ws.map((w) => (2 * n) / (w.to - w.from)))
    const shift = len - (s.to - s.from)
    const remap = (f: number) => (f <= s.from ? f : f >= s.to ? f + shift : s.from + ((f - s.from) * len) / (s.to - s.from))
    out = retimed(out, remap, shift)
    for (const p of placed) {
      p.from += shift
      p.to += shift
    }
    placed.push(...s.ws.map((w) => ({ ...w, from: remap(w.from), to: remap(w.to) })))
  }
  placed.sort((a, b) => a.from - b.from)
  for (const w of placed) {
    const mid = (w.from + w.to) / 2
    out = solve(out, model, bones[w.limb], w.from, w.to, [mid], (t, own) => {
      const u = t <= mid ? (t - w.from) / (mid - w.from) : (w.to - t) / (w.to - mid)
      return [own[0], own[1] + r.distance * u, own[2]]
    })
  }
  if (r.returns && placed.length) {
    const turn = (placed[0].from + placed[0].to) / 2
    const events = out.events.filter(([, t]) => t !== RETURN_EVENT && t !== MIRROR_EVENT && (!r.far || (t !== FAR_ON && t !== FAR_OFF)))
    events.push([turn, RETURN_EVENT, 0, 0], [turn, MIRROR_EVENT, 0, 0])
    const far = placed.find((w) => w.limb === r.far)
    if (far) events.push([far.from, FAR_ON, 0, 0], [far.to, FAR_OFF, 0, 0])
    out = { ...out, events: events.sort((a, b) => a[0] - b[0]) }
  }
  return out
}

// Puts volume 6 on an arm's bone: the fist's segment, HIT_REACH longer each way. Returns whether the model had one.
export function farVolume(m: ngmtool.Model, limb: Limb, bone: number): boolean {
  const index = limb === 'left_arm' ? 2 : 1
  const at = (kind: number) => m.attachments.find(([n, k, i]) => n === bone && k === kind && i === index)
  const a = at(21), b = at(23)
  const side = limb === 'left_arm' ? -1 : 1
  const from: Vec3 = a ? [a[3][12], a[3][13], a[3][14]] : [0.14 * side, 0, 0]
  const to: Vec3 = b ? [b[3][12], b[3][13], b[3][14]] : [0.52 * side, 0, 0]
  const d = dist(from, to) || 1
  const along = (p: Vec3, k: number): number[] => {
    const mat = [...(a ?? b)?.[3] ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]]
    for (let i = 0; i < 3; i++) mat[12 + i] = p[i] + ((to[i] - from[i]) / d) * k
    return mat
  }
  const had = m.attachments.some(([, k]) => FAR_KINDS.includes(k))
  m.attachments = [...m.attachments.filter(([, k]) => !FAR_KINDS.includes(k)), [bone, FAR_KINDS[0], 0, along(to, HIT_REACH)], [bone, FAR_KINDS[1], 0, along(from, -HIT_REACH)]]
  return had
}

// Out to the wire's end, held there until the wire lets go, and back; the record grows when it ends first.
function wire(rec: ngbtool.Record, model: Model, bone: number, w: Window): ngbtool.Record {
  const at = (t: number) => ngbtool.pose(model, rec, t)[bone][1]
  const up = Math.max(1, Math.ceil(dist(at(w.from), WIRE_END) / FLY)), down = Math.max(1, Math.ceil(dist(at(w.to), WIRE_END) / FLY))
  const end = w.to + down
  return solve(rec, model, bone, w.from, end, [w.from + up, w.to], (t, own) => mix(own, WIRE_END, Math.min(1, (t - w.from) / up, (end - t) / down)))
}

// Where the victim's attachment is at frame t, in the thrower's model space; null when their model lacks it.
// A long grab doesn't pull the victim in: their animation plays where they stood, facing the thrower.
function victimAt(v: Victim, [kind, index]: [number, number], distance: number): ((t: number) => Vec3) | null {
  const a = v.model.attachments.find(([n, k, i]) => k === kind && i === index && n < v.model.nodes.length)
  if (!a) return null
  return (t) => {
    const [r, p] = ngbtool.pose(v.model, v.rec, t)[a[0]]
    const q = [0, 1, 2].map((i) => p[i] + r[i][0] * a[3][12] + r[i][1] * a[3][13] + r[i][2] * a[3][14])
    return [-q[0], distance - q[1], q[2]]
  }
}

// Out to the victim, on them until the line ends, then back; the record grows when it ends first.
function grab(rec: ngbtool.Record, model: Model, bone: number, w: Window, on: (t: number) => Vec3): ngbtool.Record {
  const at = (t: number) => ngbtool.pose(model, rec, t)[bone][1]
  const out = Math.min(w.to, w.from + Math.max(1, Math.ceil(dist(at(w.from), on(w.from)) / FLY)))
  const down = Math.max(1, Math.ceil(dist(at(w.to), on(w.to)) / FLY))
  const end = w.to + down
  return solve(rec, model, bone, w.from, end, [out, w.to], (t, own) => {
    if (t <= out) return mix(own, on(t), (t - w.from) / (out - w.from))
    if (t <= w.to) return on(t)
    return mix(own, on(w.to), (end - t) / down)
  })
}

// The foot goes distance further along its shin and back; the record keeps its length.
function jump(rec: ngbtool.Record, model: Model, bone: number, w: Window, r: Reach): ngbtool.Record {
  const knee = model.nodes[bone][2]
  const span = w.to - w.from
  const ramp = Math.max(1, span * JUMP_RAMP)
  return solve(rec, model, bone, w.from, w.to, [(w.from + w.to) / 2], (t, own, posed) => {
    const u = r.hold ? Math.min(1, (t - w.from) / ramp, (w.to - t) / ramp) : Math.sin((Math.PI * (t - w.from)) / span)
    const shin = posed[knee][1]
    const d = dist(own, shin) || 1
    return mix(own, [0, 1, 2].map((i) => own[i] + ((own[i] - shin[i]) / d) * r.distance) as Vec3, Math.max(0, u))
  })
}

// Out to distance and back: with the wire and the thrown object for a pickup, held on the victim for a grab, else by the middle of the line's time.
function line(rec: ngbtool.Record, model: Model, bone: number, w: Window, r: Reach, victim: Victim | null): ngbtool.Record {
  const distance = r.distance
  const on = victim && w.end ? victimAt(victim, w.end, distance) : null
  if (on) return grab(rec, model, bone, w, on)
  const start = ngbtool.pose(model, rec, w.from)[bone][1]
  const far: Vec3 = [0, distance, (w.end && attachment(model, w.end)?.[2]) ?? start[2]]
  const c = w.caught
  if (c !== undefined) {
    const back = c + Math.max(1, (distance / (r.pull ?? PULL_SPEED)) * FPS)
    return solve(rec, model, bone, w.from, back, [c], (t, own) => mix(own, far, Math.min(1, (t - w.from) / (c - w.from), (back - t) / (back - c))))
  }
  const up = Math.max(1, Math.ceil(dist(start, far) / FLY))
  const back = Math.max(w.from + up + 1, (w.from + w.to) / 2)
  return solve(rec, model, bone, w.from, back, [w.from + up], (t, own) => mix(own, far, Math.min(1, (t - w.from) / up, (back - t) / (back - w.from - up))))
}

// The record with each chosen limb stretched out and back in its windows; victim is the opponent's side of a grab.
export function stretch(rec: ngbtool.Record, model: Model, bones: Record<Limb, number>, p: Plan, r: Reach, victim: Victim | null = null): ngbtool.Record {
  const ws = p.windows.filter((w) => r.limbs.includes(w.limb))
  if (p.kind === 'hit') return hits(rec, model, bones, ws, r)
  let out = rec
  for (const w of ws) {
    const bone = bones[w.limb]
    out = p.kind === 'wire' ? wire(out, model, bone, w) : p.kind === 'jump' ? jump(out, model, bone, w, r) : line(out, model, bone, w, r, victim)
  }
  return out
}
