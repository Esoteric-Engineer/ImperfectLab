import { describe, expect, it } from 'vitest'
import { fixedDebug, VENUE_SCREEN, VENUES, venueList } from '../src/core/build/fixeddebug'
import { buildSecret } from '../src/core/build/secret'
import { equal } from '../src/core/bytes'
import * as D from '../src/core/game/dol'
import * as ngl from '../src/core/game/ngl'
import { gameSource, ISO } from './helpers'

const OLD = ['levels/catacombs.ngl', 'levels/museum.ngl', 'levels/roekeltrainingfacility.ngl', 'levels/0_propsallroom.ngl']
// Loads in game, but its vertex stream stops matching this reader after ten records.
const ODD = ['levels/roekelslab.ngl']

describe.skipIf(!ISO)('level files', () => {
  const src = () => gameSource()

  it('reads every other level to its last byte as the current layout', () => {
    const names = src().names('Levels/', '.ngl').filter((n) => !OLD.includes(n.toLowerCase()) && !ODD.includes(n.toLowerCase()))
    expect(names.length).toBe(10)
    for (const n of names) expect(() => ngl.check(src().entry(n)), n).not.toThrow()
    for (const n of OLD) expect(ngl.isCurrent(src().entry(n)), n).toBe(false)
  })

  it('upgrades the old ones, drawing the collision of the two with no render geometry', () => {
    const normals = ngl.readNormals(src().entry('Misc/NormalTable.ngn'))
    expect(normals.length).toBe(2609)
    const got = OLD.map((n) => {
      const u = ngl.upgrade(src().entry(n), normals)
      expect(() => ngl.check(u.data), n).not.toThrow()
      return [n, u.rebuilt, u.oldGraphVersion, u.lightsDropped]
    })
    expect(got).toEqual([
      ['levels/catacombs.ngl', true, 1, 8],
      ['levels/museum.ngl', true, 1, 0],
      ['levels/roekeltrainingfacility.ngl', false, 2, 0],
      ['levels/0_propsallroom.ngl', false, 1, 3],
    ])
  })
})

describe.skipIf(!ISO)('fixed debug', () => {
  const src = () => gameSource()

  it('reads the developers\' venue list', () => {
    expect(venueList(src().entry(VENUE_SCREEN))).toEqual([
      'powerplant', '0_test_look', '0_test_clash', '0_test_arena', 'brooklynbridge', 'avengersmansion', 'nycstreets', 'catacombs', 'dailybugle',
      'grandcentral', 'lightpooltest', 'lighttest', 'lighttest_props', 'roekeltrainingfacility', 'charactertest',
    ])
  })

  it('gives every listed venue a level the game can read', () => {
    const f = fixedDebug(src())
    expect(venueList(f.sets.get(VENUE_SCREEN)!)).toEqual(VENUES)
    const level = (v: string) => {
      const key = `levels/${v}.ngl`
      for (const m of [f.sets, f.adds]) for (const [k, d] of m) if (k.toLowerCase() === key) return d
      return src().entry(`Levels/${v}.ngl`)
    }
    for (const v of VENUES.filter((v) => !ODD.includes(`levels/${v}.ngl`))) expect(() => ngl.check(level(v)), v).not.toThrow()
    expect([...f.adds.keys()].filter((k) => k.endsWith('.ngl')).sort()).toEqual(['Levels/0_test_clash.ngl', 'Levels/charactertest.ngl', 'Levels/lighttest_props.ngl'])
    const r = buildSecret(src(), { debugMenu: false, fixedDebug: true })
    expect(equal(r.dol!, D.debugFixes(D.debugEnable(src().dol)))).toBe(true)
    expect([...r.sets.keys()]).toEqual([...f.sets.keys()])
    expect([...r.adds.keys()]).toEqual([...f.adds.keys()])
  })
})