import { describe, expect, it } from 'vitest'
import * as dsp from '../src/core/audio/dspadpcm'
import { buildBatch } from '../src/core/build/batch'
import { Builder, type Result } from '../src/core/build/patch'
import * as imperfect from '../src/core/package/imperfect'
import { character, gameSource, ISO, sha } from './helpers'

// GameCube output before the build-target refactor; regenerate only on purpose (vitest -u).

function sound(): Uint8Array {
  const rate = 16000
  const pcm = Int16Array.from({ length: rate / 2 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 600 * i) / rate)))
  return dsp.writeDsp({ ...dsp.encode(pcm), rate, loop: null, loopContext: { ps: 0, hist1: 0, hist2: 0 } })
}

function z(more: Partial<imperfect.ZButton>): imperfect.ZButton {
  return { stealth: null, costume: null, stats: null, size: null, bullet: null, gun: null, laser: null, impersonate: null, requires: { energy: { seconds: 8, regen: false } }, ...more }
}

const CHARACTERS: Record<string, () => imperfect.Character> = {
  tintFlamesTrailsEyes: () => {
    const c = character('humantorch', 'Glowza')
    c.aura = { mode: 'tint', tint: 'all', color: '#45FF42', alt_color: '#B109D3' }
    c.flames = { ...imperfect.defaultFlames(), parts: ['head', 'r_hand'] }
    c.trails = { ...imperfect.defaultTrails(), parts: ['arms'] }
    c.eyes = { ...imperfect.defaultEyes(), on: true, color: '#FF2000' }
    return c
  },
  doomSet: () => {
    const c = character('johnnyohm', 'Doomza')
    c.aura = { mode: 'base', tint: 'all', color: '#0080FF', alt_color: '#00FF00', set: 'doom' }
    return c
  },
  fadeStages: () => {
    const c = character('magneto', 'Fadeza')
    c.zButton = z({ stealth: { undetected: true, untouchable: false, visible: 0.5 } })
    c.damageStages = [{ enabled: true, health: 75 }, { enabled: false, health: 50 }, { enabled: true, health: 25 }]
    c.materials = [{ ...c.materials[0], damage: { normal: ['hue:30', 'prev', 'hue:90'], alt: ['prev', 'prev', 'prev'] } }]
    return c
  },
  laserCostume: () => {
    const c = character('ironman', 'Zapza')
    c.zButton = z({ costume: { normal: {}, alt: {} }, laser: imperfect.defaultLaser() })
    return c
  },
  airThrowReturn: () => {
    const c = character('daredevil', 'Batza')
    c.baseMoves = { air_throw: true, throw_return: true }
    c.gameplay = { attack_damage_throw: 40 }
    return c
  },
  soundsGameplay: () => {
    const c = character('wolverine', 'Loudza')
    c.files.set('sounds/roar.dsp', sound())
    c.sounds = { 0: { file: 'sounds/roar.dsp' }, 1: { game: 'ironman:0' } }
    c.gameplay = { energy_regen: 0, energy_charge: 12.5 }
    return c
  },
  projectileSwap: () => {
    const c = character('magneto', 'Shotza')
    c.projectile = { ...imperfect.defaultProjectile(), on: true, alt_color: '#0040FF' }
    return c
  },
  impersonateMoves: () => {
    const c = character('wolverine', 'Mimza')
    c.zButton = z({ impersonate: { moves: true, model: false, stats: false } })
    return c
  },
}

function digest(r: Result) {
  const files = (m: Map<string, Uint8Array>) => [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${sha(v)}`)
  return { dol: r.dol ? sha(r.dol) : null, cache: r.cache, sets: files(r.sets), adds: files(r.adds), notes: r.notes, gun: r.gun, laser: r.laser, shield: r.shield }
}

describe.skipIf(!ISO)('GameCube output', () => {
  it('stays the same for each kind of character', async () => {
    const out: Record<string, unknown> = {}
    for (const [name, make] of Object.entries(CHARACTERS)) out[name] = digest(buildBatch(gameSource(), [make()]))
    out.single = digest(new Builder(gameSource(), CHARACTERS.tintFlamesTrailsEyes()).build())
    out.batch = digest(buildBatch(gameSource(), [CHARACTERS.tintFlamesTrailsEyes(), CHARACTERS.fadeStages(), CHARACTERS.laserCostume()]))
    await expect(JSON.stringify(out, null, 1)).toMatchFileSnapshot('__golden__/gamecube.json')
  })
})