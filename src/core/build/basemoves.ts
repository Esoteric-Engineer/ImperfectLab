// Base-specific moves (manifest `base_moves`); the files they go in are built with the other moves (moves.ts, motionFiles).
import { LabError } from '../errors'
import * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'

export const CLUB = 39
export const THROW = 'daredevil_rangedattack.nad'
// the club leaves at frame 13 and is back at 24
const FLIGHT: [number, number] = [13, 24]
// meters per frame; faster passes targets between frames
const STEP = 2.0
// how far each end of the club's hit segment (attachment kinds 43 and 44) moves out
export const HIT_REACH = 1.25
const HIT_KINDS = [43, 44]
// On a hit the game skips to event 0x53; at the turn beside a 0x7E, main.dol mirrors that skip (dol.ts, mirrorSkip).
export const RETURN_EVENT = 0x53
export const MIRROR_EVENT = 0x7e

export function longThrow(rec: ngbtool.Record, model: Pick<ngmtool.Model, 'nodes'>, reach: number): ngbtool.Record {
  const [a, b] = FLIGHT
  const n = Math.max(Math.ceil(reach / STEP), Math.floor((b - a + 1) / 2))
  const shift = 2 * n - (b - a)
  const remap = (f: number) => (f <= a ? f : f >= b ? f + shift : a + ((f - a) * 2 * n) / (b - a))
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
