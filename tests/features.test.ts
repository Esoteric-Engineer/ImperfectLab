import { describe, expect, it } from 'vitest'
import { buildBatch } from '../src/core/build/batch'
import { type DolFeature, dolFeatures } from '../src/core/build/features'
import { equal } from '../src/core/bytes'
import * as D from '../src/core/game/dol'
import * as imperfect from '../src/core/package/imperfect'
import { character, gameSource, ISO } from './helpers'

const z = (more: Partial<imperfect.ZButton>): imperfect.ZButton =>
  ({ stealth: null, costume: null, stats: null, size: null, bullet: null, gun: null, laser: null, impersonate: null, requires: {}, ...more })

const CASES: [DolFeature, (c: imperfect.Character) => void][] = [
  ['long_throw', (c) => { c.baseMoves = { throw_reach: 10 } }],
  ['stretch_return', (c) => { c.moveReach = { SuperAttackFar: { distance: 9 } } }],
  ['charge_rate', (c) => { c.gameplay = { energy_regen: 0 } }],
  ['air_throw', (c) => { c.baseMoves = { air_throw: true } }],
  ['shield_throw', (c) => { c.baseMoves = { shield_throw: { return: 'physics' } } }],
  ['throw_return', (c) => { c.baseMoves = { throw_return: true } }],
  ['throw_damage', (c) => { c.gameplay = { attack_damage_throw: 40 } }],
  ['sounds', (c) => { c.sounds = { 1: { game: 'ironman:0' } } }],
  ['z_energy', (c) => { c.zButton = z({ requires: { energy: { seconds: 5, regen: false } } }) }],
  ['z_stealth', (c) => { c.zButton = z({ stealth: { undetected: true, untouchable: false, visible: null } }) }],
  ['z_costume', (c) => { c.zButton = z({ costume: { normal: {}, alt: {} } }) }],
  ['z_stats', (c) => { c.zButton = z({ stats: { attack_damage_3: 40 } }) }],
  ['z_size', (c) => { c.zButton = z({ size: 1.5 }) }],
  ['z_bullet_time', (c) => { c.zButton = z({ bullet: 0.4 }) }],
  ['damage_stages', (c) => { c.damageStages = [{ enabled: true, health: 50 }] }],
  ['gun', (c) => { c.zButton = z({ gun: imperfect.defaultGun('right') }) }],
  ['laser', (c) => { c.zButton = z({ laser: imperfect.defaultLaser() }) }],
  ['impersonate_moves', (c) => { c.zButton = z({ impersonate: { moves: true, model: false, stats: false } }) }],
  ['impersonate_model', (c) => { c.zButton = z({ impersonate: { moves: false, model: true, stats: false } }) }],
  ['impersonate_stats', (c) => { c.zButton = z({ impersonate: { moves: false, model: false, stats: true } }) }],
]

describe('main.dol features', () => {
  it('finds none on a new character', () => {
    expect(dolFeatures(imperfect.newCharacter())).toEqual([])
  })

  it.each(CASES)('finds %s', (feature, set) => {
    const c = imperfect.newCharacter()
    c.base = 'daredevil'
    c.materials = [{ ...imperfect.newMaterial(0, 'skin'), texture: 'skin.png', damage: { normal: ['hue:30', 'prev', 'prev'], alt: ['prev', 'prev', 'prev'] } }]
    set(c)
    expect(dolFeatures(c)).toContain(feature)
  })
})

describe.skipIf(!ISO)('main.dol features on the disc', () => {
  it('patches only the roster for a character with none', () => {
    const c = character('wolverine', 'Plainza')
    expect(dolFeatures(c)).toEqual([])
    const r = buildBatch(gameSource(), [c])
    expect(equal(r.dol!, D.bundleFit(D.patch(gameSource().dol, c.internalName, c.displayName, c.stats.normal, c.stats.alt)))).toBe(true)
  })
})