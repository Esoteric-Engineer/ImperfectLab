import { describe, expect, it } from 'vitest'
import * as moves from '../src/core/build/moves'
import * as reach from '../src/core/build/reach'
import { type Curves, legLength, pair, peaksOf, reachCurves, retime, strikes, type Strike } from '../src/core/build/strikes'
import { LabError } from '../src/core/errors'
import * as R from '../src/core/game/roster'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import * as nmstool from '../src/core/mnroi/nmstool'
import { Skeleton } from '../src/core/model/skeleton'
import { gameSource, ISO } from './helpers'

const flat = (n: number, v = 0) => Array(n).fill(v)
const curves = (over: Partial<Curves>): Curves => ({ right_arm: flat(20), left_arm: flat(20), right_leg: flat(20), left_leg: flat(20), ...over })

describe('strikes', () => {
  it('finds a reach out and back, and nothing in a limb that stays put or barely moves', () => {
    const jab = [0, 0.1, 0.3, 0.6, 0.8, 0.6, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const twitch = flat(20, 0.45).map((v, i) => (i === 5 ? 0.5 : v))
    const found = strikes(curves({ left_arm: jab, right_arm: twitch }), 1)
    expect(found).toEqual([{ limb: 'left_arm', frame: 4, height: 0.8 }])
  })

  it('pairs each base window with the strongest strike near where it would fall, in order', () => {
    const found: Strike[] = [{ limb: 'right_arm', frame: 3, height: 0.8 }, { limb: 'left_arm', frame: 10, height: 0.9 }, { limb: 'right_leg', frame: 18, height: 0.6 }]
    // one window at the stretched frame 9 takes the left jab at 10, not the earlier right
    expect(pair([{ limb: 'right_arm', peak: 9 }], found, 1, 20, 1)).toEqual([found[1]])
    // two windows take two strikes in time order; a far stronger strike outweighs a few frames' difference
    expect(pair([{ limb: 'right_arm', peak: 4 }, { limb: 'right_arm', peak: 16 }], found, 1, 20, 1)).toEqual([found[0], found[1]])
    expect(pair([{ limb: 'right_arm', peak: 4 }], [], 1, 20, 1)).toEqual([null])
    expect(peaksOf([{ limb: 'left_arm', from: 8, to: 12 }, { limb: 'right_leg', from: 0, to: 4 }], found)).toEqual([10, 2])
  })
})

const STATES = ['attack1', 'attack2', 'attack3', 'attack4', 'attackfar', 'lowattack', 'riseattack', 'superattack1', 'superattack2', 'superattack3', 'superattack4', 'superlowattack', 'attackstomp', 'dodgeexitattack']

describe.skipIf(!ISO)('strikes in the shipped attacks', () => {
  interface Info { key: string; rec: ngbtool.Record; wins: reach.Window[]; found: Strike[]; leg: number; peaks: number[] }
  const read = () => {
    const src = gameSource()
    const t = new R.Templates(src.entry('Misc/Global.not'))
    const by = new Map<string, Info[]>()
    for (const key of R.keys()) {
      let base: R.BaseCharacter, sk: Skeleton
      try {
        base = new R.BaseCharacter(src, key, t)
        sk = Skeleton.ofBase(base)
      } catch (e) {
        if (e instanceof LabError) continue
        throw e
      }
      const model = ngmtool.read(base.bundleFiles()[0])[1][0]
      const leg = legLength(model.nodes, sk)
      const set = moves.motionSetOf(base)
      const recs = ngbtool.parse(src.entry(`Bundles/${moves.stemOf(set)}.ngb`))
      const own = moves.resolved(src, nmstool.parse(src.entry(`Motions/${set}`)), () => true)
      for (const st of STATES) {
        const m = own.get(st)
        const rec = m && recs.find((r) => r.name.toLowerCase() === m.anim.toLowerCase())
        const p = rec && reach.plan(rec.events, rec.length)
        if (!rec || !p || p.kind !== 'hit') continue
        const found = strikes(reachCurves(model.nodes, rec, sk), leg)
        by.set(st, [...(by.get(st) ?? []), { key, rec, wins: p.windows, found, leg, peaks: peaksOf(p.windows, found) }])
      }
    }
    return by
  }

  it("puts one base's hits on another base's animation of the same move far better than stretching them", () => {
    let total = 0, stretched = 0, struck = 0
    const lands = (b: Info, limb: string, frame: number) => b.wins.some((w) => w.limb === limb && frame >= w.from - 2 && frame <= w.to + 2)
    for (const list of read().values()) {
      for (const a of list) for (const b of list) {
        if (a.key === b.key || a.rec.name === b.rec.name) continue
        const k = b.rec.length / a.rec.length
        const got = pair(a.wins.map((w, i) => ({ limb: w.limb, peak: a.peaks[i] })), b.found, k, b.rec.length, b.leg)
        a.wins.forEach((w, i) => {
          total++
          if (lands(b, w.limb, a.peaks[i] * k)) stretched++
          const s = got[i]
          if (s ? lands(b, s.limb, s.frame) : lands(b, w.limb, a.peaks[i] * k)) struck++
        })
      }
    }
    expect(total).toBeGreaterThan(1000)
    // measured 2026-11-04: stretched 0.32, strikes 0.84
    expect(stretched / total).toBeLessThan(0.45)
    expect(struck / total).toBeGreaterThan(0.78)
  })

  it("retimes a base's move onto another base's animation of it, keeping every event", () => {
    const src = gameSource()
    const base = new R.BaseCharacter(src, 'wolverine')
    const model = ngmtool.read(base.bundleFiles()[0])[1][0]
    const sk = Skeleton.ofBase(base)
    for (const list of read().values()) {
      const a = list.find((x) => x.key === 'magneto'), b = list.find((x) => x.key === 'daredevil')
      if (!a || !b) continue
      const out = retime(a.rec, b.rec, model.nodes, sk)!
      expect(out.events.length).toBe(a.rec.events.length)
      expect(out.events.every(([f]) => f >= 0 && f <= b.rec.length)).toBe(true)
      expect(out.events.map(([f]) => f)).toEqual([...out.events.map(([f]) => f)].sort((x, y) => x - y))
      // the same events by type and param, in the hit pairs' limbs
      const kinds = (evs: ngbtool.Event[]) => evs.filter(([, t]) => !reach.VOLUMES.some(([on, off]) => t === on || t === off)).map(([, t, p, v]) => `${t}.${p}.${v}`).sort()
      expect(kinds(out.events)).toEqual(kinds(a.rec.events))
      const p = reach.plan(out.events, b.rec.length)!
      expect(p.kind).toBe('hit')
      expect(p.windows.length).toBeLessThanOrEqual(out.moved.length)
    }
  })
})