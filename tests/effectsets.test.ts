import { describe, expect, it } from 'vitest'
import * as effectsets from '../src/core/build/effectsets'
import { Effects } from '../src/core/build/effects'
import { OWN_EFFECTS } from '../src/core/build/effectslots'
import { MOVE_IDS } from '../src/core/build/moves'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import type * as ngbtool from '../src/core/mnroi/ngbtool'

const DOOM = effectsets.DOOM

describe('effect sets', () => {
  it("holds Doctor Doom's effects as blocks the game can read, each name it uses among them", () => {
    const fx = new Effects(new Uint8Array())
    effectsets.add(fx, DOOM)
    const [problems] = nfxtool.problems(fx.items, 0x50000)
    expect(problems).toEqual([])
    expect(fx.tree(effectsets.roots(DOOM)).length).toBe(nfxtool.blocks(fx.items).length)
    for (const b of nfxtool.blocks(fx.items)) {
      for (const line of b.lines.slice(1)) {
        const [key, value] = nfxtool.tokens(line)
        if (key === 'effectname') expect(fx.has(value), `${b.name} names ${value}`).toBe(true)
        if (key === 'material') expect(['GE_par_DoomPwrup_01', 'GE_PAR_lensFlare_01_BW', 'GE_PAR_ElectricParticles']).toContain(value)
        if (key === 'markertype') expect([20, 31, effectsets.ARC_KIND, effectsets.PALM_KIND, effectsets.JET_KIND]).toContain(Number(value))
      }
    }
    expect(effectsets.roots(DOOM).every((n) => fx.has(n))).toBe(true)
    const before = fx.used()
    effectsets.add(fx, DOOM)
    expect(fx.used()).toBe(before)
    expect(effectsets.bytes(DOOM)).toBe(before)
  })

  it('ends the effects the game starts and stops as soon as they are stopped', () => {
    const fx = new Effects(new Uint8Array())
    effectsets.add(fx, DOOM)
    const held = DOOM.fields.map(([, n]) => n).filter(Boolean)
    // beams and billboards die on their own; the rest would keep drawing and pile up
    const lasting = fx.tree(held).filter((b) => !['controller', 'energybeam', 'billboard'].includes(nfxtool.TYPES[b.type]))
    for (const b of lasting) {
      const flags = b.lines.map(nfxtool.tokens).find(([k]) => k === 'flags')
      expect(flags && (Number(flags[1]) & 0x40000000) !== 0, b.name).toBe(true)
    }
  })

  it('places its markers on the bones every one of its effects uses', () => {
    const fx = new Effects(new Uint8Array())
    effectsets.add(fx, DOOM)
    const marked = new Set(DOOM.markers.map((m) => `${m.kind} ${m.index}`))
    const kinds = new Set(DOOM.markers.map((m) => m.kind))
    for (const b of nfxtool.blocks(fx.items)) {
      const recs = b.lines.slice(1).map(nfxtool.tokens)
      recs.forEach(([key, value], i) => {
        if (key !== 'markertype' || !kinds.has(Number(value))) return
        const index = recs[i + 1]?.[0] === 'marker_index' ? recs[i + 1][1] : null
        if (index !== null) expect(marked.has(`${value} ${index}`), `${b.name}: ${value} ${index}`).toBe(true)
      })
    }
    expect(DOOM.markers.filter((m) => m.kind === effectsets.ARC_KIND).length).toBe(13)
  })

  it("times its events on GC states, replacing the record's own effects", () => {
    const states = new Set([...MOVE_IDS.values()].flatMap((m) => m.states.map((s) => s.toLowerCase())))
    for (const [state] of DOOM.events) expect(states.has(state.toLowerCase()), state).toBe(true)
    const rec = { name: 'x.nad', length: 90, head: new Uint8Array(), pointers: [], tracks: [], extra: [],
      events: [[3, 0x48, 5, 0], [9, 0x49, 5, 0], [12, 0x04, 0, 0]] as ngbtool.Event[] } as unknown as ngbtool.Record
    const ks = new Map([['doomblock', 20], ['doomhandcharger', 21]])
    const out = effectsets.withEvents(DOOM, 'RangedAttack', rec, ks, false)
    expect(out.events).toEqual([[7.2, 0x48, 20, 0], [12, 0x04, 0, 0], [48.6, 0x49, 20, 0]])
    const kept = effectsets.withEvents(DOOM, 'RangedAttack', rec, ks, true)
    expect(kept.events.filter(([, t]) => OWN_EFFECTS.has(t)).length).toBe(4)
    expect(effectsets.withEvents(DOOM, 'Attack1', rec, ks, false).events).toEqual([[12, 0x04, 0, 0]])
    expect(effectsets.withEvents(DOOM, 'Attack1', { ...rec, events: [[12, 0x04, 0, 0]] }, ks, false).events).toEqual([[12, 0x04, 0, 0]])
  })
})
