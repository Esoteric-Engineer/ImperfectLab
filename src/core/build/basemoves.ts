// Base-specific moves (manifest `base_moves`); the files they go in are built with the other moves (moves.ts, motionFiles).
import { LabError } from '../errors'
import * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import { isRoot } from './size'

export const CLUB = 39
export const LEFT_CLUB = 59 // if club is swapped to left hand
export const THROW = 'daredevil_rangedattack.nad'
// the club leaves at frame 13 and is back at 24
const FLIGHT: [number, number] = [13, 24]
export const RELEASE = FLIGHT[0]
export const CATCH = FLIGHT[1]
export const THROW_MOVES = ['SuperAttackFar', 'RangedAttack', 'DodgeExitSuperAttack'] // DD baton throw states
// meters per frame; faster passes targets between frames
const STEP = 2.0
// how far each end of the club's hit segment (attachment kinds 43 and 44) moves out
export const HIT_REACH = 1.25
const HIT_KINDS = [43, 44]
// On a hit the game skips to event 0x53; at the turn beside a 0x7E, main.dol mirrors that skip (dol.ts, mirrorSkip).
export const RETURN_EVENT = 0x53
export const MIRROR_EVENT = 0x7e

export function throwHold(reach: number, [a, b]: [number, number] = FLIGHT) {
  const n = Math.max(Math.ceil(reach / STEP), Math.floor((b - a + 1) / 2))
  const shift = 2 * n - (b - a)
  return { n, shift, remap: (f: number) => (f <= a ? f : f >= b ? f + shift : a + ((f - a) * 2 * n) / (b - a)) }
}

export function longThrow(rec: ngbtool.Record, model: Pick<ngmtool.Model, 'nodes'>, reach: number, flight: [number, number] = FLIGHT): ngbtool.Record {
  const [a] = flight
  const { n, shift, remap } = throwHold(reach, flight)
  const tracks: ngbtool.Track[] = rec.tracks.map(([bone, ch, keys]) => [bone, ch, keys.map(([f, v]): ngbtool.Key => [remap(f), v])])
  const out: ngbtool.Record = { ...rec, tracks, length: rec.length + shift }
  const i39 = tracks.findIndex(([bone, ch]) => bone === CLUB && ch === 1)
  if (i39 < 0) throw new LabError(`${rec.name} has no translation track on the club bone ${CLUB}`)
  const start = ngbtool.pose(model, out, a)[CLUB][1]
  const old = tracks[i39][2]
  const keys: ngbtool.Key[] = old.filter(([f]) => f <= a)
  for (let i = 1; i < 2 * n; i++) {
    const u = (i <= n ? i : 2 * n - i) / n
    keys.push([a + i, ngbtool.placeAt(model, out, CLUB, a + i, [start[0], start[1] + reach * u, start[2]])])
  }
  keys.push(...old.filter(([f]) => f >= a + 2 * n))
  tracks[i39] = [CLUB, 1, keys]
  out.events = rec.events.map(([f, t, p, v]): ngbtool.Event => [t === RETURN_EVENT ? a + n : remap(f), t, p, v])
  out.events.push([a + n, MIRROR_EVENT, 0, 0])
  out.events.sort((x, y) => x[0] - y[0])
  return out
}

export function hitSegment(m: ngmtool.Model) {
  let moved = 0
  m.attachments = m.attachments.map(([node, kind, index, mat]) => {
    if (node !== CLUB || !HIT_KINDS.includes(kind)) return [node, kind, index, mat]
    moved++
    const next = [...mat]
    next[12] += kind === HIT_KINDS[0] ? HIT_REACH : -HIT_REACH
    return [node, kind, index, next]
  })
  if (moved !== 2) throw new LabError(`expected the two ends of the club's hit segment on bone ${CLUB}, found ${moved}`)
}

export const AIR_STATE = 'SuperJumpAttack'
export const AIR_NAME = 'Daredevil_AirThrow.nad'
export const CLEAR_AIM_EVENT = 0x7f
export const AIM_FROM = 1.75
export const AIM_AT = 0.9
const CAMERA_EVENTS = [0x44, 0x45, 0x46, 0x47, 0x6e, 0x6f, 0x70, 0x71]
const ROOT_MARKER = 70
const DRIFT = 0.6
const HOVER = 0.5
const DROP = 18
// m/frame²
const FALL = 0.1

// legs hold the jump's top pose; dive supplies the camera events
export function airThrow(rec: ngbtool.Record, caught: number, jump: ngbtool.Record, legs: number[], dive: ngbtool.Record, size = 1): ngbtool.Record {
  const rootKeys = (r: ngbtool.Record) => r.tracks.find(([bone, ch]) => isRoot(bone, ch))?.[2] ?? []
  const rise = rootKeys(jump)
  if (!rise.length) throw new LabError(`${jump.name} has no root travel to find the top of the jump`)
  const top = rise.reduce((best, [f, v]) => (ngbtool.translation(v)[2] > ngbtool.translation(best[1])[2] ? [f, v] : best))[0]
  const hover = (RELEASE + caught) / 2
  const peak = HOVER * size
  const length = Math.max(rec.length, hover + Math.sqrt((2 * (DROP + peak)) / FALL))
  const root: ngbtool.Key[] = []
  for (let f = 0; f <= Math.ceil(length); f++) {
    const t = Math.min(f, length)
    const z = t <= hover ? peak * Math.sin((Math.PI / 2) * (t / hover)) : peak - 0.5 * FALL * (t - hover) ** 2
    root.push([t, ngbtool.encodeTranslation([0, DRIFT * size * (t / length), z])])
  }
  const held = new Set(legs)
  const tracks: ngbtool.Track[] = rec.tracks.filter(([bone, ch]) => !held.has(bone & 0xffff) && !isRoot(bone, ch) && (bone & 0xffff) !== ROOT_MARKER)
  tracks.push([0, 1, root])
  for (const [bone, ch, keys] of jump.tracks) {
    if (!held.has(bone & 0xffff) || !keys.length) continue
    const v = ch === 0 ? ngbtool.encodeRotation(ngbtool.quat(ngbtool.sample(keys, top))) : ngbtool.encodeTranslation(ngbtool.sample(keys.map(([f, k]): [number, ngbtool.Vec3] => [f, ngbtool.translation(k)]), top))
    tracks.push([bone, ch, [[0, v], [length, v]]])
  }
  tracks.sort((a, b) => (a[0] & 0xffff) - (b[0] & 0xffff) || a[1] - b[1])
  const events: ngbtool.Event[] = [
    ...rec.events.filter(([, t]) => !CAMERA_EVENTS.includes(t)),
    ...dive.events.filter(([, t]) => CAMERA_EVENTS.includes(t)).map(([f, t, p, v]): ngbtool.Event => [Math.min(f * (length / dive.length), length), t, p, v]),
    [caught, CLEAR_AIM_EVENT, 0, 0],
  ]
  events.sort((x, y) => x[0] - y[0])
  return { ...rec, name: AIR_NAME, tracks, events, length }
}
