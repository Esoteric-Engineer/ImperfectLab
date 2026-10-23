import { describe, expect, it } from 'vitest'
import * as moves from '../src/core/build/moves'
import { encodeLatin1, latin1 } from '../src/core/bytes'
import type * as ngbtool from '../src/core/mnroi/ngbtool'
import * as nmstool from '../src/core/mnroi/nmstool'

// Table for the Thing's super throw on Daredevil's skeleton.
const THING_TO_DD = new Map<number, number>([
  ...Array.from({ length: 36 }, (_, i): [number, number] => [i, i]),
  [37, 37],
  ...Array.from({ length: 14 }, (_, i): [number, number] => [38 + i, 42 + i]),
  [53, 57],
  ...Array.from({ length: 12 }, (_, i): [number, number] => [54 + i, 60 + i]),
])

const SET = '; a set\r\nbasedon male\r\nStand          A_Stand.nad   lowpriority\r\nSuperThrow     A_Grab.nad    dist -1.00 noloop ; pulls\r\n' +
  'SuperThrow     A_Grab.nad    noloop\r\noverlay wield\r\nStand          A_WieldStand.nad\r\nTail           never_read.nad'

describe('motion sets', () => {
  it('reads lines as the game does', () => {
    const s = nmstool.parse(encodeLatin1(SET))
    expect(s.basedon).toBe('male')
    const m = s.motions()
    expect([...m.keys()]).toEqual(['stand', 'superthrow'])
    expect(m.get('superthrow')).toEqual({ state: 'SuperThrow', anim: 'A_Grab.nad', opts: ['dist', '-1.00', 'noloop'] })
    expect(latin1(s.build())).toBe(SET)
  })

  it('replaces a state, adds one in the first overlay and renames animations', () => {
    const s = nmstool.parse(encodeLatin1(SET))
    s.set({ state: 'SuperThrow', anim: 'B_Grab.nad', opts: ['noloop', 'endpause'] })
    s.set({ state: 'Throw', anim: 'B_Throw.nad', opts: [] })
    s.rename('a_stand.nad', 'A_Stand_123456.nad')
    const again = nmstool.parse(s.build())
    const m = again.motions()
    expect([...m.keys()]).toEqual(['stand', 'superthrow', 'throw'])
    expect(m.get('superthrow')!.anim).toBe('B_Grab.nad')
    expect(m.get('stand')!.anim).toBe('A_Stand_123456.nad')
    const text = latin1(again.build())
    expect(text.match(/SuperThrow/g)!.length).toBe(1)
    expect(text.indexOf('B_Throw.nad')).toBeLessThan(text.indexOf('overlay wield'))
    expect(text.endsWith('Tail           never_read.nad')).toBe(true)
  })
})

describe('moves', () => {
  it('lists every state once', () => {
    const states = moves.MOVES.flatMap((m) => m.states.map((s) => s.toLowerCase()))
    expect(new Set(states).size).toBe(states.length)
    expect(moves.MOVE_IDS.get('SuperThrow')!.states).toEqual(['SuperThrow', 'SuperThrowFemale', 'SuperThrowBrute', 'SuperThrowVictim', 'SuperThrowVictimFemale', 'SuperThrowVictimBrute'])
    expect(moves.MOVE_IDS.has('FinishingMove')).toBe(false)
    for (const m of moves.MOVES) expect(moves.CATEGORIES).toContain(m.category)
  })

  it('matches bones across body classes by name', () => {
    expect(moves.boneMap('brute', 'male', 88)).toEqual(THING_TO_DD)
    expect([...moves.boneMap('male', 'male', 72).keys()]).toEqual(Array.from({ length: 72 }, (_, i) => i))
    const toFemale = moves.boneMap('male', 'female', 81)
    expect([...toFemale.values()].every((j) => j < 81)).toBe(true)
    expect(toFemale.get(1)).toBe(1)
  })

  it('moves tracks with their bones and drops the rest', () => {
    const key: ngbtool.Key = [0, [16384, 0, 0, 0]]
    const rec: ngbtool.Record = { name: 'X.nad', length: 10, head: new Uint8Array(0x30), pointers: [1, 2, 3], tracks: [[1, 0, [key]], [36, 0, [key]], [54, 1, [key]]], events: [], extra: [] }
    const out = moves.remapRecord(rec, THING_TO_DD)
    expect(out.tracks.map(([b, ch]) => [b, ch])).toEqual([[1, 0], [60, 1]])
    expect(out.pointers).toEqual([1, 3])
    const name = moves.ownName({ ...out, name: 'A_Very_Long_Animation_Name.nad' })
    expect(name).toMatch(/^A_Very_Long_Animatio_[0-9a-f]{6}\.nad$/)
    expect(name.length).toBeLessThanOrEqual(31)
  })

  it('offers the other bases\' versions that cover the base\'s states', () => {
    const grab = moves.MOVE_IDS.get('SuperThrow')!
    const all = (prefix: string) => Object.fromEntries(grab.states.map((s) => [s.toLowerCase(), `${prefix}_${s}.nad`]))
    const cat: moves.Catalog = {
      daredevil: { body: 'male', motions: all('dd') },
      thing: { body: 'brute', motions: all('thing') },
      venom: { body: 'brute', motions: all('thing') },
      wolverine: { body: 'male', motions: all('dd') },
      storm: { body: 'female', motions: { superthrow: 'storm.nad' } },
    }
    const opts = moves.options(cat, 'daredevil', grab)
    expect(opts.map((o) => o.from)).toEqual([['thing', 'venom']])
    expect(opts[0].body).toBe('brute')
    expect(moves.options(cat, 'storm', grab).map((o) => o.from)).toEqual([['thing', 'venom'], ['wolverine', 'daredevil']])
    expect(moves.options(cat, 'magneto', grab)).toEqual([])
  })
})
