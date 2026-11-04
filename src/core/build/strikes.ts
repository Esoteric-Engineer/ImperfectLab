// Strikes in an animation: where a hand or foot reaches furthest toward the opponent.
// Imported clips use them to put the base move's hit windows where the clip's own punches land.
import * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Skeleton } from '../model/skeleton'
import * as reach from './reach'
import { type Limb, LIMBS } from './reach'

const ENDS: Record<Limb, string> = { right_arm: 'R.hand', left_arm: 'L.hand', right_leg: 'R.foot', left_leg: 'L.foot' }
// in leg lengths: a strike reaches at least PEAK, and RISE more than since the limb's last strike
export const PEAK = 0.4
export const RISE = 0.2
const NEAR = 1
const HEIGHT = 0.5
// bonus for a strike of the base's kind (arm for arm, leg for leg)
const SAME_KIND = 0.1

export interface Strike {
  limb: Limb
  frame: number
  height: number
}

export type Curves = Record<Limb, number[]>

export function legLength(nodes: ngmtool.Node[], sk: Skeleton): number {
  const pose = ngbtool.pose({ nodes }, null, 0)
  const at = (role: string) => pose[sk.node(role)!][1]
  const a = at('R.thigh'), b = at('R.foot')
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// Each end's reach per whole frame: ahead of the pelvis (+y), plus HEIGHT times above it.
export function reachCurves(nodes: ngmtool.Node[], rec: ngbtool.Record, sk: Skeleton): Curves {
  const pelvis = sk.node('pelvis')!
  const ends = LIMBS.map((l) => sk.node(ENDS[l])!)
  const out = Object.fromEntries(LIMBS.map((l) => [l, [] as number[]])) as Curves
  const last = Math.ceil(rec.length)
  for (let f = 0; f <= last; f++) {
    const P = ngbtool.pose({ nodes }, rec, Math.min(f, rec.length))
    const p = P[pelvis][1]
    LIMBS.forEach((l, i) => {
      const e = P[ends[i]][1]
      out[l].push(Math.max(e[1] - p[1], 0) + HEIGHT * Math.max(e[2] - p[2], 0))
    })
  }
  return out
}

export function strikes(curves: Curves, leg: number): Strike[] {
  const out: Strike[] = []
  for (const limb of LIMBS) {
    const r = curves[limb]
    let low = r[0] ?? 0
    for (let f = 0; f < r.length; f++) {
      low = Math.min(low, r[f])
      const peak = (f === 0 || r[f] > r[f - 1]) && (f === r.length - 1 || r[f] >= r[f + 1])
      if (!peak || r[f] < PEAK * leg || r[f] - low < RISE * leg) continue
      out.push({ limb, frame: f, height: r[f] - low })
      low = r[f]
    }
  }
  return out.sort((a, b) => a.frame - b.frame || b.height - a.height)
}

export interface Aim {
  limb: Limb
  peak: number
}

// For each base window, the clip's strike that takes its place (strong, near the stretched base peak, in order), or null.
export function pair(aims: Aim[], found: Strike[], k: number, length: number, leg: number): (Strike | null)[] {
  const out: (Strike | null)[] = []
  const used = new Set<Strike>()
  let after = -Infinity
  for (const a of aims) {
    const want = a.peak * k
    let best: Strike | null = null, score = -Infinity
    for (const s of found) {
      if (used.has(s) || s.frame < after) continue
      const v = s.height / leg - (NEAR * Math.abs(s.frame - want)) / Math.max(length, 1) + (s.limb.endsWith(a.limb.slice(-4)) ? SAME_KIND : 0)
      if (v > score) {
        score = v
        best = s
      }
    }
    out.push(best)
    if (best) {
      used.add(best)
      after = best.frame
    }
  }
  return out
}

export function peaksOf(windows: { limb: Limb; from: number; to: number }[], found: Strike[]): number[] {
  return windows.map((w) => {
    const inside = found.filter((s) => s.limb === w.limb && s.frame >= w.from - 2 && s.frame <= w.to + 2).sort((a, b) => b.height - a.height)[0]
    return inside ? inside.frame : (w.from + w.to) / 2
  })
}

export interface Retimed {
  events: ngbtool.Event[]
  moved: { limb: Limb; from: number; to: number; was: { limb: Limb; from: number; to: number } }[]
  matched: number
  warp: (f: number) => number
}

const round = (f: number) => Math.round(f * 100) / 100

// The template's events on the clip's record. Null when the template has no hit windows.
export function retime(template: ngbtool.Record, rec: ngbtool.Record, nodes: ngmtool.Node[], sk: Skeleton): Retimed | null {
  const p = reach.plan(template.events, template.length)
  if (!p || p.kind !== 'hit' || template.length <= 0) return null
  const n = rec.length, k = n / template.length
  const leg = legLength(nodes, sk)
  const peaks = peaksOf(p.windows, strikes(reachCurves(nodes, template, sk), leg))
  const got = pair(p.windows.map((w, i) => ({ limb: w.limb, peak: peaks[i] })), strikes(reachCurves(nodes, rec, sk), leg), k, n, leg)
  const clamp = (f: number) => Math.max(0, Math.min(n, f))
  const moved = p.windows.map((w, i) => {
    const s = got[i]
    if (!s) return { limb: w.limb, from: w.from * k, to: Math.min(n, w.to * k), was: w }
    return { limb: s.limb, from: clamp(s.frame - (peaks[i] - w.from) * k), to: clamp(s.frame + (w.to - peaks[i]) * k), was: w }
  })
  // other events follow a warp through the windows' ends
  const anchors: [number, number][] = [[0, 0]]
  for (const m of [...moved].sort((a, b) => a.was.from - b.was.from)) anchors.push([m.was.from, m.from], [m.was.to, m.to])
  anchors.push([template.length, n])
  anchors.sort((a, b) => a[0] - b[0])
  const kept: [number, number][] = []
  for (const a of anchors) if (!kept.length || (a[0] >= kept[kept.length - 1][0] && a[1] >= kept[kept.length - 1][1])) kept.push(a)
  const warp = (f: number) => {
    if (f <= 0) return f
    for (let i = 0; i + 1 < kept.length; i++) {
      const [a0, b0] = kept[i], [a1, b1] = kept[i + 1]
      if (f <= a1) return a1 > a0 ? b0 + ((f - a0) * (b1 - b0)) / (a1 - a0) : b1
    }
    return n
  }
  const types = new Map(reach.VOLUMES.flatMap(([on, off, limb]): [number, [Limb, boolean]][] => [[on, [limb, true]], [off, [limb, false]]]))
  const pairOf = (limb: Limb, on: boolean) => {
    const v = reach.VOLUMES.find(([, , l]) => l === limb)!
    return on ? v[0] : v[1]
  }
  const events = template.events.map(([f, t, prm, v], i): [ngbtool.Event, number] => {
    const vol = types.get(t)
    const m = vol && moved.find((x) => x.was.limb === vol[0] && x.was.from - 1e-6 <= f && f <= x.was.to + 1e-6)
    if (vol && m) {
      const span = m.was.to - m.was.from
      const g = span > 0 ? m.from + ((f - m.was.from) * (m.to - m.from)) / span : m.from
      return [[f > 0 ? round(clamp(g)) : f, pairOf(m.limb, vol[1]), prm, v], i]
    }
    return [[f > 0 ? round(clamp(warp(f))) : f, t, prm, v], i]
  })
  events.sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1])
  return { events: events.map(([e]) => e), moved, matched: got.filter((s) => s !== null).length, warp: (f) => clamp(warp(f)) }
}