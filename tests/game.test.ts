import { describe, expect, it } from 'vitest'
import * as cutscenes from '../src/core/build/cutscenes'
import * as damage from '../src/core/build/damage'
import * as effects from '../src/core/build/effects'
import * as eyes from '../src/core/build/eyes'
import { EFFECT_FIELDS } from '../src/core/build/effectslots'
import * as flames from '../src/core/build/flames'
import * as gun from '../src/core/build/gun'
import * as holster from '../src/core/build/holster'
import * as basemoves from '../src/core/build/basemoves'
import * as moves from '../src/core/build/moves'
import * as projectiles from '../src/core/build/projectiles'
import * as projectileswap from '../src/core/build/projectileswap'
import * as reach from '../src/core/build/reach'
import * as shaders from '../src/core/build/shaders'
import { buildBatch, checkBatch, ordinal } from '../src/core/build/batch'
import { Builder, report } from '../src/core/build/patch'
import * as templates from '../src/core/build/templates'
import * as trails from '../src/core/build/trails'
import * as tuning from '../src/core/build/tuning'
import * as ui from '../src/core/build/ui'
import { equal, f32be, latin1, u32be } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as D from '../src/core/game/dol'
import { menuCity } from '../src/core/game/menuart'
import * as R from '../src/core/game/roster'
import { Apt } from '../src/core/mnroi/apt'
import * as cuttool from '../src/core/mnroi/cuttool'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import * as nmstool from '../src/core/mnroi/nmstool'
import * as nvbtool from '../src/core/mnroi/nvbtool'
import { scaleModel } from '../src/core/model/bundle'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb, pngBytes } from './helpers'

const DOOM_EDITS: [number, string | number[]][] = [[0x4c7ac0, 'plr_doctordoom'], [0x4c7ae0, 'DOCTOR DOOM'], [0x4c7b00, [7, 4, 3, 6, 5, 4, 0, 0]],
  [0x4c80b0, 'plr_altDoctordoom'], [0x4c8148, [0, 0, 0, 0x13]]]

function tinted(base: string): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = 'Synth'
  c.displayName = 'SYNTH'
  c.base = base
  c.glb = makeGlb()
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
  c.files = new Map([['textures/skin.png', pngBytes()]])
  const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(gameSource(), c.base)))
  c.mapping = auto.mapping
  c.overrides = auto.overrides
  c.aura = { mode: 'tint', tint: 'all', color: '#45FF42', alt_color: '#B109D3' }
  return c
}

describe.skipIf(!ISO)('main.dol', () => {
  it('writes the Doctor Doom record as Doompatcher did', () => {
    const dol = gameSource().dol
    const out = D.patch(dol, 'DoctorDoom', 'DOCTOR DOOM', [7, 4, 3, 6, 5, 4], [7, 4, 3, 6, 5, 4])
    expect(out.length).toBe(dol.length)
    for (const [off, want] of DOOM_EDITS) {
      const bytes = typeof want === 'string' ? [...want].map((c) => c.charCodeAt(0)) : want
      expect([...out.subarray(off, off + bytes.length)]).toEqual(bytes)
    }
  })

  it('grows the effect cache', () => {
    const dol = gameSource().dol
    expect(D.readEffectCache(dol)).toBe(nfxtool.CACHE_SIZE)
    const out = D.growEffectCache(dol, 0x4a400)
    expect(D.readEffectCache(out)).toBe(0x4a400)
    expect(() => D.growEffectCache(out, 0x4a400)).toThrow(LabError)
  })

  it('rewrites only the animation time setter for a long throw', () => {
    const dol = gameSource().dol
    const out = D.mirrorSkip(dol)
    const at = D.fileOffset(dol, 0x8019db24)
    const changed = [...out].flatMap((b, i) => (b !== dol[i] ? [i] : []))
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every((i) => i >= at && i < at + 0x70)).toBe(true)
    expect(() => D.mirrorSkip(out)).toThrow(LabError)
  })

  it('rewrites only the energy rate cache for a split recharge', () => {
    const dol = gameSource().dol
    const out = D.chargeRate(dol)
    const at = D.fileOffset(dol, 0x8009d71c)
    const changed = [...out].flatMap((b, i) => (b !== dol[i] ? [i] : []))
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every((i) => i >= at && i < at + 0x8c)).toBe(true)
    expect(() => D.chargeRate(out)).toThrow(LabError)
  })

  it('rewrites only the damage event for the baton throw', () => {
    const dol = gameSource().dol
    const out = D.throwDamage(dol)
    const at = D.fileOffset(dol, 0x800e2338)
    const changed = [...out].flatMap((b, i) => (b !== dol[i] ? [i] : []))
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every((i) => i >= at && i < at + 0xf0)).toBe(true)
    expect(() => D.throwDamage(out)).toThrow(LabError)
  })

  it('binds Z to its actions', () => {
    const dol = gameSource().dol
    const none = { costume: false, damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: false }
    const out = D.zActions(dol, [
      { internal: 'Synth', seconds: 8, regen: true, undetected: false, untouchable: true, visible: 0.25, ...none },
      { internal: 'Other', seconds: 0, regen: false, undetected: true, untouchable: false, visible: 1, ...none, costume: true, damage: [null, 30, null, null, 2.5], taken: 0.5, lift: 'heavy', run: 20, sprint: 32, size: 2.5, slow: 0.5 },
      { internal: 'Small', seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, ...none, size: 0.5 },
      { internal: 'Quick', seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, ...none, slow: 0.25, gun: true },
    ])
    const at = (va: number) => D.fileOffset(dol, va)
    const block = at(0x804cc810), z = at(0x804cc810 + 18 * 0x50)
    expect(u32be(out, at(0x804cc80c))).toBe(19)
    expect(u32be(out, z + 0x10)).toBe(5)
    expect(u32be(out, z + 0x48)).toBe(19)
    expect(u32be(out, z + 0xc)).toBe(3)
    expect([...out.subarray(z + 0x14, z + 0x48)]).toEqual([...out.subarray(block + 0x14, block + 0x48)])
    const target = (from: number) => (from + ((((u32be(out, at(from)) << 6) >> 6) & ~3))) >>> 0
    expect(target(0x800fba50)).toBe(0x80137494)
    expect(target(0x80150240)).toBe(target(0x804619b0))
    const code = 0x534
    for (const site of [0x800e09cc, 0x80150240, 0x8014fa14, 0x800b1890]) expect(target(site) > 0x80137494 && target(site) < 0x80137494 + code).toBe(true)
    expect(target(0x801a483c) > 0x80148b50 && target(0x801a483c) < 0x80148b50 + 0x1e0).toBe(true)
    expect(u32be(out, at(0x801a483c)) & 1).toBe(1)
    for (const site of [0x801afb8c, 0x80094e88, 0x8007487c, 0x800748f8, 0x80061af0]) expect(target(site) > 0x80132838 && target(site) < 0x80132838 + 0x274).toBe(true)
    for (const site of [0x800bd30c, 0x800bd3e4]) expect(target(site) > 0x80138868 && target(site) < 0x80138868 + 0x1bc).toBe(true)
    // z_update eases through cut_ease, which lets Z go while a cutscene plays (the cut player's +0x9C above its +0xA0).
    expect(target(0x801374dc)).toBe(0x80138868 + 0x1a0)
    expect([0x80138a08, 0x80138a0c, 0x80138a10, 0x80138a14, 0x80138a18].map((va) => u32be(out, at(va)))).toEqual([0x3d208054, 0x8009337c, 0x81293380, 0x7c004840, 0x40810008])
    expect(target(0x80138a20)).toBe(0x80148bd8)
    expect(u32be(out, at(0x80132838))).toBe(0x4e800020)
    expect(u32be(out, at(0x80085f4c))).toBe(0x80030304)
    expect(u32be(out, at(0x800b1884))).toBe(0x3804ffea)
    expect(target(0x80086c98)).toBe(0x800b1884)
    const t = at(0x80137494) + code
    expect(latin1(out, t, at(0x80137494) + 0x858)).toContain('plr_synth\0plr_altSynth\0')
    expect([u32be(out, t), u32be(out, t + 4), u32be(out, t + 8)]).toEqual([0x41000000, 5, 0x3e800000])
    const other = t + 12 + 24
    expect([u32be(out, other), u32be(out, other + 4), u32be(out, other + 8)]).toEqual([0, 2 | 8 | 16 | 32 | 64 | 256, 0x3f800000])
    expect([12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52].map((o) => u32be(out, other + o))).toEqual([0xbf800000, 0x41f00000, 0xbf800000, 0xbf800000, 0x40200000, 0x3f000000, 0x20, 0x41a00000, 0x42000000, 0x40200000, 0x3f000000])
    expect(latin1(out, other + 56, other + 80)).toBe('plr_other\0plr_altOther\0\0')
    const small = other + 80
    expect([u32be(out, small + 4), u32be(out, small + 12)]).toEqual([32, 0x3f000000])
    expect(latin1(out, small + 16, small + 40)).toBe('plr_small\0plr_altSmall\0\0')
    const quick = small + 40
    expect([u32be(out, quick + 4), u32be(out, quick + 12)]).toEqual([64 | 128, 0x3e800000])
    expect(latin1(out, quick + 16, quick + 40)).toBe('plr_quick\0plr_altQuick\0\0')
    const sites = [[0x804cc80c, 4], [0x804cc810 + 18 * 0x50, 0x50], [0x80137494, 0x858], [0x80138868, 0x1bc], [0x80148b50, 0x1e0], [0x80132838, 0x274], [0x80085f4c, 0x30],
      [0x800b1884, 0x68], [0x80086c80, 0x5c], [0x800fba50, 4], [0x800e09cc, 4], [0x80150240, 4], [0x804619b0, 4], [0x8014fa14, 4], [0x801a483c, 4],
      [0x801afb8c, 4], [0x80094e88, 4], [0x8007487c, 4], [0x800748f8, 4], [0x80061af0, 4], [0x800bd30c, 4], [0x800bd3e4, 4]]
      .map(([va, n]) => [at(va), at(va) + n])
    const changed = [...out].flatMap((b, i) => (b !== dol[i] ? [i] : []))
    expect(changed.every((i) => sites.some(([lo, hi]) => i >= lo && i < hi))).toBe(true)
    expect(() => D.zActions(out, [])).toThrow(LabError)
    const one = { internal: 'Synth', seconds: 8, regen: false, undetected: true, untouchable: true, visible: 0.2, ...none }
    expect(() => D.zActions(dol, [{ ...one, seconds: 61 }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, visible: 0.99 }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, lift: 'huge' }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, run: 0 }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, size: 3.5 }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, size: 0.05 }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, slow: 0.2 }])).toThrow(LabError)
    expect(() => D.zActions(dol, [{ ...one, slow: 0.95 }])).toThrow(LabError)
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...one, internal: `Character${i}`, taken: 1, size: 2, slow: 0.5 }))
    expect(() => D.zActions(dol, nine)).not.toThrow()
    const many = Array.from({ length: 20 }, (_, i) => ({ ...one, internal: `Character${i}` }))
    expect(() => D.zActions(dol, many)).toThrow(/no room/)
  })

  it("adds the gun's code in a text section of its own and hooks the posing, motions, presses, events, stops, rage and projectile pick", () => {
    const dol = D.zActions(gameSource().dol, [{ internal: 'Synth', seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, costume: false,
      damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: true }])
    const guns: D.GunCharacter[] = [
      { internal: 'Synth', bone: 39, hand: 27, anchor: 65, nodes: 66, automatic: true, energy: 7.5, bind: [0.5, 0, 1.5], k: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0.1, 0.2, 0.3],
        swap: { bone: 72, bind: [0.75, 0, 1.55], k: [0, 1, 0, -1, 0, 0, 0, 0, 1, 0.5, 0.25, 2] }, upper: 23, fore: 25, arm: [[0.2, 0, 1.55], [0.48, 0, 1.55], [0.75, 0, 1.55]], draw: 0.25, moves: [[23, 24, 25, 26, 27, 30], [25, 26, 27, 30], [27, 30]] },
      { internal: 'Other', bone: 81, hand: 27, anchor: 58, nodes: 82, automatic: false, energy: 0, bind: [0, 0, 1], k: new Array(12).fill(0), swap: null,
        upper: 23, fore: 25, arm: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], draw: D.GUN_DRAW, moves: [[], [], []] },
    ]
    for (const before of [dol, D.patchMany(dol, [1, 2].map((i) => ({ internal: `C${i}`, display: `C${i}`, stats: [1, 1, 1, 1, 1, 1], altStats: [1, 1, 1, 1, 1, 1] })))]) {
      const lo = D.arenaLo(before)
      const out = D.gun(before, guns)
      const slot = [2, 3, 4, 5, 6].find((i) => u32be(out, 0x90 + 4 * i))!
      expect(u32be(out, 0x48 + 4 * slot)).toBe(lo)
      const size = u32be(out, 0x90 + 4 * slot), at = u32be(out, 4 * slot)
      expect(size % 0x20).toBe(0)
      expect(D.arenaLo(out)).toBe(lo + size)
      const target = (from: number) => (from + ((((u32be(out, D.fileOffset(out, from)) << 6) >> 6) & ~3))) >>> 0
      expect(target(0x801a4a08)).toBe(lo)
      expect(u32be(out, D.fileOffset(out, 0x801a4a08)) & 1).toBe(1)
      for (const [site, to] of [[0x80097ce8, D.GUN_PLAY], [0x800cc0bc, D.GUN_PRESSED], [0x8009b04c, D.GUN_MOTION], [0x800cdf84, D.GUN_EVENT], [0x8009aec8, D.GUN_STOP], [0x80086a2c, D.GUN_RAGE]]) {
        expect(target(site)).toBe(lo + to)
        expect(u32be(out, D.fileOffset(out, site)) & 1).toBe(0)
      }
      expect(target(0x800e1f04)).toBe(lo + D.GUN_PICK)
      expect(u32be(out, D.fileOffset(out, 0x800e1f0c))).toBe(0x4800001c)
      const table = at + D.GUN_DATA
      expect(u32be(out, table + D.GUN_COUNT)).toBe(2)
      const first = table + D.GUN_ENTRIES
      expect([...out.subarray(first, first + 8)]).toEqual([39, 27, 65, 66, 1, 23, 25, 72])
      expect([...out.subarray(first + D.GUN_ENTRY_SIZE, first + D.GUN_ENTRY_SIZE + 8)]).toEqual([81, 27, 58, 82, 0, 23, 25, 0xff])
      expect([0xe0, 0xe4, 0xec, 0x104, 0x108, 0x10c, 0x110, 0x114, 0x118].map((o) => f32be(out, first + o))).toEqual([0, 1, -1, 0.5, 0.25, 2, 0.75, 0, 1.55].map(Math.fround))
      expect(D.GUN_ENTRY_SIZE).toBe(0x120)
      expect([0x8, 0xc, 0x18, 0x3c, 0x44].map((o) => u32be(out, first + o))).toEqual([0x40f00000, 0x3f000000, 0x3f800000, 0x3dcccccd, 0x3e99999a])
      expect([0x48, 0x50, 0x54, 0x5c, 0x60, 0x68].map((o) => f32be(out, first + o))).toEqual([0.2, 1.55, 0.48, 1.55, 0.75, 1.55].map(Math.fround))
      expect(f32be(out, first + 0x6c)).toBeCloseTo(1 / 250, 9)
      expect([...out.subarray(first + 0x70, first + 0xa0)].flatMap((b, i) => [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => b & (1 << k)).map((k) => [i >> 4, 8 * (i & 15) + k])))
        .toEqual([...[23, 24, 25, 26, 27, 30].map((b) => [0, b]), ...[25, 26, 27, 30].map((b) => [1, b]), ...[27, 30].map((b) => [2, b])])
      expect(out[first + D.GUN_ENTRY_SIZE + 4]).toBe(0)
      expect(f32be(out, first + D.GUN_ENTRY_SIZE + 0x6c)).toBeCloseTo(1 / (1000 * D.GUN_DRAW), 9)
      expect(latin1(out, first + 0xa0, first + 0xe0)).toBe('plr_synth' + '\0'.repeat(23) + 'plr_altSynth' + '\0'.repeat(20))
      const changed = [...out.subarray(0, before.length)].flatMap((b, i) => (b !== before[i] ? [i] : []))
      const sites = [[0x801a4a08, 4], [0x80097ce8, 4], [0x800cc0bc, 4], [0x8009b04c, 4], [0x800cdf84, 4], [0x8009aec8, 4], [0x80086a2c, 4], [0x800e1efc, 0x2c]].map(([va, n]) => [D.fileOffset(out, va), D.fileOffset(out, va) + n])
      expect(changed.every((i) => i < 0x100 || sites.some(([a, b]) => i >= a && i < b) || [0x177bc4, 0x177bc8, 0x177bfc, 0x177c00].some((r) => i >= r && i < r + 4))).toBe(true)
      expect(() => D.gun(out, guns)).toThrow(LabError)
    }
    expect(() => D.gun(dol, Array.from({ length: 5 }, () => guns[0]))).toThrow(/room/)
    expect(() => D.gun(dol, [{ ...guns[0], moves: [[23, 130], [], []] }])).toThrow(/128/)
  })

  it("adds the damage stages' code in a text section of its own and hooks the posing", () => {
    const chars: D.HealthCharacter[] = [{ internal: 'Synth', stages: [0.75, 0.25], kept: 1, z: null }, { internal: 'Other', stages: [0.5], kept: 2, z: 1 }]
    expect(() => D.health(gameSource().dol, chars)).toThrow(/Z-button/)
    const dol = D.zActions(gameSource().dol, [{ internal: 'Other', seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, costume: true, staged: true,
      damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: false }])
    const lo = D.arenaLo(dol)
    const out = D.health(dol, chars)
    const slot = [2, 3, 4, 5, 6].find((i) => u32be(out, 0x90 + 4 * i))!
    expect(u32be(out, 0x48 + 4 * slot)).toBe(lo)
    const size = u32be(out, 0x90 + 4 * slot), at = u32be(out, 4 * slot)
    expect(D.arenaLo(out)).toBe(lo + size)
    const target = (o: Uint8Array, from: number) => (from + ((((u32be(o, D.fileOffset(o, from)) << 6) >> 6) & ~3))) >>> 0
    expect(target(out, 0x801a4814)).toBe(lo + D.HEALTH_POSE)
    expect(u32be(out, D.fileOffset(out, 0x801a4814)) & 1).toBe(1)
    const table = at + D.HEALTH_DATA
    expect(u32be(out, table)).toBe(0)
    expect(u32be(out, table + D.HEALTH_COUNT)).toBe(2)
    const first = table + D.HEALTH_ENTRIES, second = first + D.HEALTH_ENTRY_SIZE
    expect([0, 4, 8].map((o) => f32be(out, first + o))).toEqual([0.75, 0.25, -1].map(Math.fround))
    expect([...out.subarray(first + 0xc, first + 0xf)]).toEqual([1, 0xff, 4])
    expect([0, 4, 8].map((o) => f32be(out, second + o))).toEqual([0.5, -1, -1])
    expect([...out.subarray(second + 0xc, second + 0xf)]).toEqual([2, 1, 4])
    expect(latin1(out, first + 0x10, first + 0x50)).toBe('plr_synth' + '\0'.repeat(23) + 'plr_altSynth' + '\0'.repeat(20))
    const changed = [...out.subarray(0, dol.length)].flatMap((b, i) => (b !== dol[i] ? [i] : []))
    const site = D.fileOffset(out, 0x801a4814)
    expect(changed.every((i) => i < 0x100 || (i >= site && i < site + 4) || [0x177bc4, 0x177bc8, 0x177bfc, 0x177c00].some((r) => i >= r && i < r + 4))).toBe(true)
    expect(() => D.health(out, chars)).toThrow(LabError)

    const gunned = D.gun(out, [{ internal: 'Other', bone: 81, hand: 27, anchor: 58, nodes: 82, automatic: false, energy: 0, bind: [0, 0, 1], k: new Array(12).fill(0), swap: null,
      upper: 23, fore: 25, arm: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], draw: D.GUN_DRAW, moves: [[], [], []] }])
    expect(target(gunned, 0x801a4814)).toBe(lo + D.HEALTH_POSE)
    expect(target(gunned, 0x801a4a08)).toBe(lo + size)

    for (const bad of [{ stages: [] }, { stages: [0.5, 0.75] }, { stages: [1] }, { stages: [0.5, 0.4, 0.3, 0.2] }, { kept: 0 }, { kept: 1, z: 1 }]) {
      expect(() => D.health(dol, [{ ...chars[1], ...bad }])).toThrow(LabError)
    }
  })

  it('refuses a patched main.dol', () => {
    const out = D.patch(gameSource().dol, 'A', 'B', [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])
    expect(() => D.patch(out, 'A', 'B', [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])).toThrow(LabError)
  })

  it('reads every base record', () => {
    for (const key of R.keys()) expect(D.readRecord(gameSource().dol, D.NORMAL_TABLE, R.BASES[key][2]).name.toLowerCase().startsWith('plr_')).toBe(true)
  })

  it('moves the roster into a new data section for two characters', () => {
    const dol = gameSource().dol
    expect(D.tables(dol)).toEqual([D.NORMAL_TABLE, D.ALT_TABLE, 0x4c80fc])
    expect(D.arenaLo(dol)).toBe(D.ARENA_LO)
    const out = D.patchMany(dol, [
      { internal: 'DoctorDoom', display: 'DOCTOR DOOM', stats: [7, 4, 3, 6, 5, 4], altStats: [7, 4, 3, 6, 5, 4] },
      { internal: 'CaptainAmerica', display: 'CAPTAIN AMERICA', stats: [3, 4, 2, 3, 1, 6], altStats: [3, 4, 2, 3, 1, 6] },
    ])
    const [normal, alt, order] = D.tables(out)
    expect(normal).toBe(dol.length)
    expect(D.fileOffset(out, D.ARENA_LO)).toBe(normal)
    expect(D.arenaLo(out)).toBeGreaterThanOrEqual(D.ARENA_LO + 21 * (2 * 0x4c + 4))
    expect(D.arenaLo(out) % 32).toBe(0)
    for (let i = 0; i < 19; i++) expect(D.readRecord(out, normal, i)).toEqual(D.readRecord(dol, D.NORMAL_TABLE, i))
    for (let i = 0; i < 19; i++) expect(D.readRecord(out, alt, i)).toEqual(D.readRecord(dol, D.ALT_TABLE, i))
    expect(D.readRecord(out, normal, 19)).toEqual({ name: 'plr_doctordoom', key: 'DOCTOR DOOM', stats: [7, 4, 3, 6, 5, 4], unlocked: 1 })
    expect(D.readRecord(out, alt, 20)).toEqual({ name: 'plr_altCaptainamerica', key: 'CAPTAIN AMERICA', stats: [3, 4, 2, 3, 1, 6], unlocked: 1 })
    expect(Array.from({ length: 21 }, (_, i) => out[order + 4 * i + 3])).toEqual([0, 10, 2, 15, 6, 14, 3, 9, 7, 13, 4, 16, 8, 1, 17, 5, 12, 11, 18, 19, 20])
    expect(D.readEffectCache(D.growEffectCache(out, 0x4a400))).toBe(0x4a400)
    const c = { internal: 'A', display: 'B', stats: [1, 1, 1, 1, 1, 1], altStats: [1, 1, 1, 1, 1, 1] }
    expect(() => D.patchMany(out, [c, c])).toThrow(LabError)
    expect(() => D.patch(out, 'A', 'B', c.stats, c.altStats)).toThrow(LabError)
  })

  it('fills the select grid with nine characters', () => {
    const dol = gameSource().dol
    const chars = Array.from({ length: 9 }, (_, i) => ({ internal: `Hero${i}`, display: `HERO ${i}`, stats: [i, 1, 2, 3, 4, 5], altStats: [5, 4, 3, 2, 1, i] }))
    const out = D.patchMany(dol, chars)
    const [normal, alt, order] = D.tables(out)
    expect(normal).toBe(dol.length)
    expect(D.arenaLo(out)).toBeGreaterThanOrEqual(D.ARENA_LO + 28 * (2 * 0x4c + 4))
    expect(D.arenaLo(out) % 32).toBe(0)
    for (let i = 0; i < 19; i++) expect(D.readRecord(out, normal, i)).toEqual(D.readRecord(dol, D.NORMAL_TABLE, i))
    chars.forEach((c, i) => {
      expect(D.readRecord(out, normal, 19 + i)).toEqual({ name: `plr_hero${i}`, key: c.display, stats: c.stats, unlocked: 1 })
      expect(D.readRecord(out, alt, 19 + i)).toEqual({ name: `plr_altHero${i}`, key: c.display, stats: c.altStats, unlocked: 1 })
    })
    expect(Array.from({ length: 28 }, (_, i) => out[order + 4 * i + 3]).slice(18)).toEqual([18, 19, 20, 21, 22, 23, 24, 25, 26, 27])
    // the select screen's limits and fn_8044F070's search of the order table
    for (const off of [0x1007dc, 0x101758, 0x101760, 0x101788, 0x101790]) expect(out[off + 3]).toBe(27)
    expect(out[0x44c09c + 3]).toBe(0x1b)
    expect(() => D.patchMany(dol, [...chars, chars[0]])).toThrow(LabError)
    expect(() => D.patchMany(dol, [chars[0]])).toThrow(LabError)
  })
})

describe.skipIf(!ISO)('game', () => {
  const src = () => gameSource()

  it('reads the menu city for the Nemesis theme', () => {
    const im = menuCity(src())
    expect(im.size).toEqual([512, 256])
    const sum = [0, 0, 0]
    for (let i = 0; i < im.data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += im.data[i + c]
    const mean = sum.map((v) => v / (im.width * im.height))
    // the teal skyline, not the grey layer beside it in the same bank
    for (const [got, want] of mean.map((v, c) => [v, [34, 116, 136][c]])) expect(Math.abs(got - want)).toBeLessThan(3)
  })

  it('loads every base', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    const counts: Record<string, number> = { thing: 66, wolverine: 72, storm: 81, defcon: 97 }
    for (const key of R.keys()) {
      const b = new R.BaseCharacter(src(), key, t)
      expect(src().has(`Bundles/${b.bundle}.ngm`), key).toBe(true)
      expect(src().has(b.nvbName()), key).toBe(true)
      const sk = Skeleton.ofBase(b)
      expect(sk.requiredRoles().every((r) => sk.node(r) !== undefined), key).toBe(true)
      if (key in counts) expect(sk.nodes.length, key).toBe(counts[key])
    }
  })

  it('translates a mapping between body classes', () => {
    const male = Skeleton.ofBase(new R.BaseCharacter(src(), 'johnnyohm'))
    for (const key of ['storm', 'thing']) {
      const other = Skeleton.ofBase(new R.BaseCharacter(src(), key))
      const [m, o] = mapping.translate(new Map([[male.node('L.hand')!, 'hand'], [39, 'club']]), new Map([['mid', male.node('L.finger_a.0')!]]), male, other)
      expect(m).toEqual(new Map([[other.node('L.hand')!, 'hand']]))
      expect(o).toEqual(new Map([['mid', other.node('L.finger_a.0')!]]))
    }
  })

  it('adds a select-screen voice', () => {
    const values = ui.sfxValues(src().entry(ui.P + 'main.big'))
    expect(Object.values(R.VOICES).filter((k) => values.has(k)).length).toBe(18)
    const patched = ui.patchCharselect(src().entry(ui.P + 'screens/clashCharSelect.big'), values.get('FE_SFX_OHM')!)
    const files = ui.loadArchive(patched)
    const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
    const apt = new Apt(get('.apt'), get('.const'))
    const block = apt.frameActions(apt.aptOff, 0)[0]
    const pool = apt.pool(block)
    const pushes = apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool)))
    expect(pushes).toContainEqual(['g_aCharacterAudio', values.get('FE_SFX_OHM'), '_global'])
  })

  it('finds what a tint copies', () => {
    const jo = effects.tintPlans(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    const thing = effects.tintPlans(src(), new R.BaseCharacter(src(), 'thing'))
    expect(jo.power.roots).toEqual(['jOhmStand', 'jOhmPwrStand', 'jOhmPowerOn'])
    expect(jo.all.roots).toContain('jOhmArcToSkyL')
    expect([thing.all.roots, thing.all.alt]).toEqual([[], []])
  })

  it('swaps auras in the templates', () => {
    const base = new R.BaseCharacter(src(), 'johnnyohm')
    const t = new R.Templates(templates.build(src().entry('Misc/Global.not'), base, 'Tester', 'swap'))
    expect(R.text(t.prop('plr_Tester', R.P_CASTID))).toBe('ALT_JOHNNYOHM')
    expect(R.text(t.prop('plr_altTester', R.P_CASTID))).toBe('JOHNNYOHM')
    expect(R.text(t.prop('plr_altTester', R.P_MODEL))).toBe('Tester_alt.nod')
  })

  it("keeps the CPU levels' spread in tuning", () => {
    const tun = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    const [name, data, listed] = tun.build('Tester', { damage_taken: 0.4, run_speed: 13.9 })
    const nvb = nvbtool.parseNvb(data)
    expect(name).toBe('Misc/PLAYER_Tester.nvb')
    expect(latin1(nvb.rawName).split('\0')[0]).toBe('Tester')
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    const slots = (fid: number) => nvb.slots(fid, fields[fid][1])!.map((v) => new DataView(v.buffer, v.byteOffset).getFloat32(0, true))
    expect(slots(104)[0]).toBeCloseTo(13.9, 4)
    const taken = slots(134).map((x) => 1 - x)
    expect(taken[0]).toBeCloseTo(0.4, 4)
    expect(taken[3]).toBeLessThan(taken[0])
    expect(latin1(listed).endsWith('PLAYER Tester\r\n')).toBe(true)
  })

  it('tints effects', () => {
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const names = fx.tinted(['jOhmStand'], '#FF2020', 'testfx')
    expect(names.size).toBe(7)
    const items = nfxtool.readNfx(fx.build())
    const [problems] = nfxtool.problems(items)
    expect(problems.filter((p) => p.includes('cache:') || p.includes('records'))).toEqual([])
    const copy = nfxtool.blocks(items).find((b) => b.name === names.get('johmarc'))!
    const cols = copy.records()[0].filter((r) => ['startcol', 'endcol'].includes(nfxtool.KEYS[r.key])).map((r) => r.value as number)
    expect(cols.length).toBeGreaterThan(0)
    expect(cols.every((c) => ((c >>> 16) & 255) > (c & 255))).toBe(true)
  })

  it('tints the game\'s orange fire on the grey sprite', () => {
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const names = fx.tinted(['htFlightFX', 'htFireBallHandR', 'altHtFlightFX'], '#2040FF', 'testfx')
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(fx.build())).map((b) => [b.name, b]))
    const values = (name: string, key: string) => by.get(names.get(name.toLowerCase())!)!.records()[0].filter((r) => nfxtool.KEYS[r.key] === key).map((r) => r.value)
    // the orange sprite would turn any color orange
    for (const name of ['htFlightFX', 'htFireBallHandR']) {
      expect(values(name, 'material'), name).toEqual([flames.GREY_SPRITE])
      for (const col of ['startcol', 'endcol']) {
        const [c] = values(name, col) as number[]
        expect(c & 255, `${name} ${col}`).toBeGreaterThan((c >>> 16) & 255)
      }
    }
    expect(values('altHtFlightFX', 'material')).toEqual([flames.GREY_SPRITE])
    expect(fx.drawsFire(['htFlightFX'])).toBe(true)
    expect(fx.drawsFire(['altHtFlightFX'])).toBe(false)
  })

  it('makes the grey fire sprite transparent by darkening it', () => {
    // it is additive: only black adds nothing
    const rgbs = (fx: effects.Effects, names: string[]) => nfxtool.blocks(nfxtool.readNfx(fx.build())).filter((b) => names.includes(b.name))
      .flatMap((b) => b.records()[0].filter((r) => ['startcol', 'endcol'].includes(nfxtool.KEYS[r.key])).map((r) => (r.value as number) & 0xffffff))
    const tinted = (color: string) => {
      const fx = new effects.Effects(src().entry('Misc/game.nfx'))
      return rgbs(fx, [...fx.tinted(['htFlightFX', 'altHtFlightFX'], color, 'testfx').values()])
    }
    const lit = (fx: effects.Effects, f: imperfect.Flames) => rgbs(fx, flames.effectNames(fx, f, 'Synth')!.flatMap((n) => [n, ...fx.tree([n]).map((b) => b.name)]))
    const fire = (color: string) => {
      const fx = new effects.Effects(src().entry('Misc/game.nfx'))
      return [...lit(fx, { ...imperfect.defaultFlames(), parts: ['r_hand'], color, alt_color: color }), ...lit(fx, { ...imperfect.defaultFlames(), body: true, color, alt_color: color, size: 1.5 })]
    }
    for (const colors of [tinted, fire]) {
      expect(colors('#2040FF').length).toBeGreaterThan(0)
      expect(colors('#2040FF').every((c) => c > 0)).toBe(true)
      expect(colors('#2040FF00').every((c) => c === 0)).toBe(true)
      expect(colors('#2040FF80').every((c, i) => c > 0 && (c & 255) < (colors('#2040FF')[i] & 255))).toBe(true)
    }
  })

  it('puts the grey fire sprite in a tinted costume\'s bundle once', () => {
    for (const base of ['humantorch', 'heatwave']) {
      const r = new Builder(src(), tinted(base)).build()
      const greys = (costume: string) => latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).split(/\s+/).filter((n) => n.toLowerCase() === flames.GREY_SPRITE.toLowerCase()).length
      expect([greys(''), greys('_alt')], base).toEqual([1, 1])
    }
  })

  it('scales the alpha of a tint by its color\'s opacity', () => {
    const alphas = (color: string) => {
      const fx = new effects.Effects(src().entry('Misc/game.nfx'))
      const names = fx.tinted(['jOhmStand'], color, 'testfx')
      const copies = new Set([...names.values()].map((n) => n.toLowerCase()))
      return nfxtool.blocks(nfxtool.readNfx(fx.build())).filter((b) => copies.has(b.name.toLowerCase()))
        .flatMap((b) => b.lines.slice(1).map(nfxtool.tokens).filter((t) => t.length >= 2 && ['startcol', 'endcol'].includes(t[0].toLowerCase())))
        .map((t) => nfxtool.scanFloats(t[1], 4)[0])
    }
    const full = alphas('#FF2020'), half = alphas('#FF202080'), faint = alphas('#FF202001')
    expect(full.length).toBeGreaterThan(0)
    expect(alphas('#FF2020FF')).toEqual(full)
    expect(half.every((a, i) => Math.abs(a - full[i] * 128 / 255) < 0.01)).toBe(true)
    expect(faint.every((a, i) => Math.abs(a - full[i] / 255) < 0.01)).toBe(true)
  })

  it('hides effects with a fully transparent tint instead of copying them', () => {
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const names = fx.tinted(['htFlightFX', 'htFireballExp', 'htPowerOn'], '#40A0FF00', 'testfx')
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(fx.build())).map((b) => [b.name.toLowerCase(), b]))
    const block = (name: string) => by.get(names.get(name.toLowerCase())!.toLowerCase())!
    const refs = (b: nfxtool.Block) => b.lines.slice(1).map(nfxtool.tokens).filter((t) => t.length >= 2 && ['effectname', 'effect0'].includes(t[0].toLowerCase())).map((t) => t[1])
    // what only draws is one empty controller
    const none = names.get('htflightfx')!
    expect(block('htFlightFX').lines).toEqual([`controller ${none}`, 'end'])
    for (const n of ['htPowerOn', 'htPowerOn0', 'htFirebExp0', 'victimBurnStd0']) expect(names.get(n.toLowerCase()), n).toBe(none)
    // a controller also naming what a tint leaves alone is copied
    expect(refs(block('victimBurnStd'))).toEqual([none, 'victimBurnStd1'])
    // the explosion's damage stays
    const exp = block('htFireballExp')
    expect(nfxtool.TYPES[exp.type]).toBe('controller')
    const dam = names.get('htfballdam')!
    expect(refs(exp)).toEqual([dam, none, none])
    expect(nfxtool.TYPES[block('htFballDam').type]).toBe('damage')
    expect(refs(block('htFballDam'))).toEqual([names.get('victimburnstd')])
    expect(fx.drawsFire(['htFlightFX'])).toBe(true)
    // Human Torch's costume 2 tinted and costume 1 hidden fits the game's cache
    const plans = effects.tintPlans(src(), new R.BaseCharacter(src(), 'humantorch'))
    expect(plans.all.extra).toBe(8224)
    expect(plans[effects.planKey('all', [true, false])].extra).toBe(0)
    expect(plans[effects.planKey('all', [true, true])].bytes).toBeLessThan(plans.all.bytes / 10)
    expect(plans.all.grey).toEqual([8192, 0])
    expect(plans[effects.planKey('all', [true, false])].grey).toEqual([0, 0])
    expect(effects.tintLevel(plans, 'all', trails.cost({ ...imperfect.defaultFlames(), parts: ['r_hand'] }, imperfect.defaultTrails()), [true, false])).toBe('all')
  })

  it('builds a hidden costume without growing the cache or borrowing the grey sprite', () => {
    const c = { ...tinted('humantorch'), aura: { mode: 'tint', tint: 'all', color: '#40A0FF00', alt_color: '#50FF50' } }
    const r = new Builder(src(), c).build()
    expect(r.cache).toBeNull()
    expect(D.readEffectCache(r.dol!)).toBe(nfxtool.CACHE_SIZE)
    const greys = (costume: string) => latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).split(/\s+/).filter((n) => n.toLowerCase() === flames.GREY_SPRITE.toLowerCase()).length
    expect([greys(''), greys('_alt')]).toEqual([0, 1])
    const nvb = nvbtool.parseNvb(r.adds.get('Misc/PLAYER_Synth.nvb')!)
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    const flight = nvb.slots(101, fields[101][1])!.map((v) => latin1(v).split('\0')[0])
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
    expect(by.get(flight[0])!.lines).toEqual([`controller ${flight[0]}`, 'end'])
    expect(by.get(flight[5])!.lines.length).toBeGreaterThan(2)
    expect(r.notes.some((n) => n.includes("costume 1's effects hidden"))).toBe(true)
  })

  it('builds a synthetic character', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Synth'
    c.displayName = 'SYNTH'
    c.base = 'wolverine'
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()], ['ui/hud.png', pngBytes(64, 64)]])
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src(), c.base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    c.gameplay = { lift: 'heavy' }
    c.zButton = { stealth: { undetected: true, untouchable: false, visible: 0.5 }, costume: null, stats: null, size: null, bullet: null, gun: null, laser: null, impersonate: null, requires: { energy: { seconds: 5, regen: false } } }
    const r = new Builder(src(), c).build()
    expect(r.adds.has('Bundles/synth.ngm')).toBe(true)
    expect(equal(r.dol!, D.zActions(D.patch(src().dol, 'Synth', 'SYNTH', c.stats.normal, c.stats.alt), [{ internal: 'Synth', seconds: 5, regen: false, undetected: true, untouchable: false, visible: 0.5, costume: false, damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: false }]))).toBe(true)
    expect(report(c, r)).toContain('Stealth Mode')
    expect(r.adds.has('Bundles/synth_alt.tpl')).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.u32(t.prop('plr_Synth', R.P_ABILITIES))! & 0x30).toBe(0x20)
  })

  it('builds Z costumes and stats', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Synth'
    c.displayName = 'SYNTH'
    c.base = 'wolverine'
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()], ['ui/hud.png', pngBytes(64, 64)]])
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src(), c.base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    c.zButton = { stealth: null, costume: { normal: {}, alt: { 0: 'alt' } }, stats: { attack_damage_3: 40, lift: 'light' }, size: 1.5, bullet: 0.4, gun: null, laser: null, impersonate: null, requires: {} }
    const r = new Builder(src(), c).build()
    const parts = (name: string) => ngmtool.read(r.adds.get(name)!)[1][0].parts
    expect(parts('Bundles/synth.ngm')).toEqual(['Synth', 'Synth_z', 'Synth_zo'])
    expect(parts('Bundles/synth_alt.ngm')).toEqual(['Synth_alt', 'Synth_altz', 'Synth_altzo'])
    const nsa = shaders.blocks(r.sets.get('Materials/Shaders/shaders.nsa')!)
    expect(nsa.get('synth_z')!.get('texture')).toBe('Synth_z')
    expect(nsa.get('synth_altz')!.get('texture')).toBe('Synth_alt')
    expect(nsa.get('synth_zo')!.get('texture')).toBe('Synth')
    expect(nsa.get('synth_altzo')!.get('texture')).toBe('Synth_alt')
    expect(latin1(r.adds.get('Bundles/synth.ngt')!)).toContain('Synth_z\r\n')
    expect(latin1(r.adds.get('Bundles/synth_alt.ngt')!)).not.toContain('Synth_altz')
    const want = D.zActions(D.patch(src().dol, 'Synth', 'SYNTH', c.stats.normal, c.stats.alt),
      [{ internal: 'Synth', seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, costume: true, damage: [null, null, 40, null, null], taken: null, lift: 'light', run: null, sprint: null, size: 1.5, slow: 0.4, gun: false }])
    expect(equal(r.dol!, want)).toBe(true)
    expect(report(c, r)).toContain('Costume Change, Stat Change, Change Size, Bullet Time')
    c.materials = [...c.materials, { ...imperfect.newMaterial(1, 'cape', true, '_z', [64, 64]), texture: 'textures/skin.png' }]
    expect(() => new Builder(src(), c).build()).toThrow(/both be named synth_z/)
  })

  it('builds damage stages, with and without a Z costume', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Synth'
    c.displayName = 'SYNTH'
    c.base = 'wolverine'
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png',
      damage: { normal: ['textures/mat0_d1.png', 'hue:30', 'hue:90'], alt: ['prev', 'prev', 'prev'] } }]
    c.files = new Map([['textures/skin.png', pngBytes()], ['textures/mat0_d1.png', pngBytes()], ['ui/hud.png', pngBytes(64, 64)]])
    c.damageStages = [{ enabled: true, health: 75 }, { enabled: false, health: 50 }, { enabled: true, health: 25 }]
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src(), c.base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    const patched = () => D.patch(src().dol, 'Synth', 'SYNTH', c.stats.normal, c.stats.alt)
    const parts = (r: ReturnType<Builder['build']>, name: string) => ngmtool.read(r.adds.get(name)!)[1][0].parts

    let r = new Builder(src(), c).build()
    expect(parts(r, 'Bundles/synth.ngm')).toEqual(['Synth', 'Synth_zo', 'Synth_d1', 'Synth_d3'])
    expect(parts(r, 'Bundles/synth_alt.ngm')).toEqual(['Synth_alt', 'Synth_altzo', 'Synth_altd1', 'Synth_altd3'])
    const nsa = shaders.blocks(r.sets.get('Materials/Shaders/shaders.nsa')!)
    expect(['synth_zo', 'synth_d1', 'synth_d3', 'synth_altzo', 'synth_altd1', 'synth_altd3'].map((n) => nsa.get(n)!.get('texture')))
      .toEqual(['Synth', 'Synth_d1', 'Synth_d3', 'Synth_alt', 'Synth_alt', 'Synth_alt'])
    const ngt = latin1(r.adds.get('Bundles/synth.ngt')!)
    expect(ngt).toContain('Synth_d1\r\n')
    expect(ngt).toContain('Synth_d3\r\n')
    expect(ngt).not.toContain('Synth_d2')
    expect(latin1(r.adds.get('Bundles/synth_alt.ngt')!)).not.toContain('Synth_altd')
    expect(equal(r.dol!, D.health(patched(), [{ internal: 'Synth', stages: [0.75, 0.25], kept: 1, z: null }]))).toBe(true)
    expect(r.notes).toContain('damage stages at 75%, 25% health: 2 textures, 4 KB')
    expect(report(c, r)).toContain('fn_801A479C')

    c.zButton = { stealth: null, costume: { normal: {}, alt: {} }, stats: null, size: null, bullet: null, gun: null, laser: null, impersonate: null, requires: {} }
    const z: D.ZCharacter = { internal: 'Synth', seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, costume: true,
      damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: false }
    r = new Builder(src(), c).build()
    expect(parts(r, 'Bundles/synth.ngm')).toEqual(['Synth', 'Synth_z', 'Synth_zo', 'Synth_d1', 'Synth_d3'])
    expect(equal(r.dol!, D.health(D.zActions(patched(), [{ ...z, staged: true }]), [{ internal: 'Synth', stages: [0.75, 0.25], kept: 2, z: 1 }]))).toBe(true)

    c.materials = [{ ...c.materials[0], damage: imperfect.noDamage() }]
    expect(imperfect.problems(c)).toContainEqual(['warning', 'damage stages are ticked but no material changes texture at them: pick textures on the Materials page'])
    r = new Builder(src(), c).build()
    expect(parts(r, 'Bundles/synth.ngm')).toEqual(['Synth', 'Synth_z', 'Synth_zo'])
    expect(equal(r.dol!, D.zActions(patched(), [z]))).toBe(true)

    c.materials = [{ ...c.materials[0], damage: { normal: ['prev', 'prev', 'hue:90'], alt: ['prev', 'prev', 'prev'] } }]
    c.damageStages = [{ enabled: true, health: 25 }, { enabled: false, health: 50 }, { enabled: true, health: 30 }]
    expect(() => new Builder(src(), c).build()).toThrow(/lower health than the one before/)
  })

  it('points every field naming a tinted effect at its copy', () => {
    const r = new Builder(src(), tinted('johnnyohm')).build()
    const nvb = nvbtool.parseNvb(r.adds.get('Misc/PLAYER_Synth.nvb')!)
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    const names = (fid: number) => nvb.slots(fid, fields[fid][1])!.map((v) => latin1(v).split('\0')[0])
    const fx = new Set(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => b.name))
    for (const [event, power] of [[87, 98], [88, 99]]) expect(names(event)).toEqual(names(power))
    for (const fid of [81, 98, 99, 101, 242, 243]) expect(names(fid).every((n) => /^sy[fa][0-9a-z]+$/.test(n) && fx.has(n))).toBe(true)
    expect(names(67)).toEqual(new Array(6).fill('stdHitTrailLH'))
    const used = nfxtool.cacheUse(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!))[1]
    expect(D.readEffectCache(r.dol!)).toBe(effects.cacheSize(used))
    expect(D.readEffectCache(r.dol!)! - used).toBeLessThan(0x800 + 0x400)
    // A projectile, its explosion and the zap the explosion leaves on the victim are copies too.
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const fid of [90, 91, 92]) {
      for (const proj of names(fid)) {
        const chain = templates.chain(T, proj)
        expect(chain.map((t) => t.name.split('_')[0])).toEqual(['proj', 'exp'])
        const fxNames = chain.flatMap((t) => t.props.map(([, v]) => R.text(v)).filter((s) => s && fx.has(s)))
        expect(fxNames.length).toBeGreaterThan(0)
        expect(fxNames.every((n) => /^sy[fa][0-9a-z]+$/.test(n!))).toBe(true)
      }
    }
  })

  it('fits every base\'s tint in the effect cache', () => {
    const over: string[] = []
    for (const key of R.keys()) {
      const plans = effects.tintPlans(src(), new R.BaseCharacter(src(), key))
      expect(plans.power.extra, key).toBe(0)
      expect(nfxtool.CACHE_SIZE + plans.all.extra, key).toBeLessThanOrEqual(effects.CACHE_MAX)
      if (effects.tintLevel(plans, 'all') !== 'all') over.push(key)
    }
    expect(over).toEqual(['ironman'])
  })

  it('tints only the idle and power-up effects when a full tint needs too much memory', () => {
    const r = new Builder(src(), tinted('ironman')).build()
    expect(D.readEffectCache(r.dol!)).toBe(nfxtool.CACHE_SIZE)
    expect(r.notes.some((n) => n.includes('idle and power-up effects are tinted'))).toBe(true)
  })

  it('puts flames on chosen parts', () => {
    for (const base of ['wolverine', 'storm', 'megalith']) {
      const c = tinted(base)
      c.aura = { ...c.aura, mode: 'base' }
      c.flames = { ...imperfect.defaultFlames(), parts: ['head', 'r_hand', 'l_foot'] }
      const r = new Builder(src(), c).build()
      const sk = Skeleton.ofBase(new R.BaseCharacter(src(), base))
      for (const costume of ['', '_alt']) {
        const [, models] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
        const marks = models[0].attachments.filter(([, kind]) => kind === flames.FLAME_KIND).map(([node, , index]) => [node, index])
        expect(marks, base).toEqual([[sk.node('head'), 0], [sk.node('R.hand'), 2], [sk.node('L.foot'), 5]])
      }
      const T = new R.Templates(r.sets.get('Misc/Global.not')!)
      const names = ['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2))!)
      expect(names[0]).toBe(names[1])
      const items = nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)
      expect(nfxtool.problems(items)[0]).toEqual([])
      const by = new Map(nfxtool.blocks(items).map((b) => [b.name, b]))
      const children = by.get(names[0])!.records()[0].map((rec) => rec.value as string)
      const marker = (n: string) => by.get(n)!.records()[0].filter((rec) => ['markertype', 'marker_index'].includes(nfxtool.KEYS[rec.key])).map((rec) => rec.value)
      expect(children.map(marker)).toEqual([[69, 0], [69, 2], [69, 5]])
      expect(r.adds.has('Misc/PLAYER_Synth.nvb')).toBe(false)
      expect(D.readEffectCache(r.dol!)).toBe(nfxtool.CACHE_SIZE)
    }
  })

  it('colors flames per costume and drops the base\'s own effect', () => {
    const c = tinted('humantorch')
    c.aura = { ...c.aura, mode: 'base' }
    c.flames = { ...imperfect.defaultFlames(), parts: ['head'], color: '#2040FF', base_effect: false }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const t of ['act_Synth', 'plr_Synth', 'plr_altSynth']) expect(T.get(t).get(R.P_EFFECT1), t).toBeNull()
    const [normal, alt] = ['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2))!)
    expect(normal).not.toBe(alt)
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
    const records = (controller: string) => by.get(by.get(controller)!.records()[0][0].value as string)!.records()[0]
    const values = (controller: string, key: string) => records(controller).filter((rec) => nfxtool.KEYS[rec.key] === key).map((rec) => rec.value)
    // blue, from a lighter start, on the grey sprite; the game's own orange sprite would turn any color orange
    const [start, end] = ['startcol', 'endcol'].map((k) => values(normal, k)[0] as number)
    expect((end & 255) > ((end >>> 16) & 255)).toBe(true)
    expect((start >>> 16) & 255).toBeGreaterThan((end >>> 16) & 255)
    expect(values(normal, 'material')).toEqual([flames.GREY_SPRITE])
    expect([values(alt, 'startcol'), values(alt, 'endcol'), values(alt, 'material')]).toEqual([[], [], ['GE_PAR_FireSprite_04']])
    // the grey sprite goes into the recolored costume's bundle (Human Torch's costume 2 bundle has its own), once
    const greys = (costume: string) => latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).split(/\s+/).filter((n) => n.toLowerCase() === flames.GREY_SPRITE.toLowerCase()).length
    expect([greys(''), greys('_alt')]).toEqual([1, 1])
  })

  it('sets the whole body on fire with the game\'s own effect', () => {
    const c = tinted('wolverine')
    c.aura = { ...c.aura, mode: 'base' }
    c.flames = { ...imperfect.defaultFlames(), body: true }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2)))).toEqual(['htBodyFire', 'htBodyFire'])
    expect(r.sets.has('Misc/game.nfx')).toBe(false)
    const [, models] = ngmtool.read(r.adds.get('Bundles/synth.ngm')!)
    expect(models[0].attachments.some(([, kind]) => kind === flames.FLAME_KIND)).toBe(false)
  })

  it('puts motion trails on the limbs\' joints', () => {
    for (const base of ['wolverine', 'storm', 'megalith']) {
      const c = tinted(base)
      c.aura = { ...c.aura, mode: 'base' }
      c.trails = { ...imperfect.defaultTrails(), parts: [...imperfect.TRAIL_PARTS] }
      const r = new Builder(src(), c).build()
      const sk = Skeleton.ofBase(new R.BaseCharacter(src(), base))
      const bones = ['R.upper_arm', 'R.forearm', 'R.hand', 'L.upper_arm', 'L.forearm', 'L.hand', 'R.thigh', 'R.calf', 'R.foot', 'L.thigh', 'L.calf', 'L.foot', 'pelvis', 'neck', 'head']
      for (const costume of ['', '_alt']) {
        const [, models] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
        const marks = models[0].attachments.filter(([, kind]) => kind === trails.TRAIL_KIND).map(([node, , index]) => [node, index])
        expect(marks, base).toEqual(bones.map((b, i) => [sk.node(b), i]))
      }
      const T = new R.Templates(r.sets.get('Misc/Global.not')!)
      const names = ['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2))!)
      expect(names[0]).toBe(names[1])
      const items = nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)
      expect(nfxtool.problems(items)[0]).toEqual([])
      const by = new Map(nfxtool.blocks(items).map((b) => [b.name, b]))
      const values = (n: string) => by.get(n)!.records()[0].map((rec) => [nfxtool.KEYS[rec.key], rec.value])
      const groups = values(names[0]).map(([, v]) => v as string)
      expect(groups.length).toBe(3)
      const pairs = groups.flatMap((g) => values(g).filter(([k]) => k !== 'effectname').map(([, v]) => v))
      expect(pairs).toEqual(Object.values(trails.SEGMENTS).flat(2))
      const ribbon = Object.fromEntries(values(values(groups[0])[0][1] as string))
      expect(by.get(values(groups[0])[0][1] as string)!.type).toBe(nfxtool.TYPES.indexOf('trail'))
      expect([ribbon.markertype, ribbon.endmarker, ribbon.startcol, ribbon.endcol, ribbon.part_life]).toEqual([68, 68, 0x60ffffff, 0x00ffffff, Math.fround(0.2)])
      expect(r.adds.has('Misc/PLAYER_Synth.nvb')).toBe(false)
      expect(D.readEffectCache(r.dol!)).toBe(nfxtool.CACHE_SIZE)
    }
  })

  it('names flames and trails together, colored per costume', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    c.flames = { ...imperfect.defaultFlames(), parts: ['head'] }
    c.trails = { ...imperfect.defaultTrails(), parts: ['arms'], alt_color: '#FF000080', length: 0.5 }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    const [normal, alt] = ['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2))!)
    expect(normal).not.toBe(alt)
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
    const children = (n: string) => by.get(n)!.records()[0].filter((rec) => nfxtool.KEYS[rec.key] === 'effectname').map((rec) => rec.value as string)
    const ribbon = (n: string) => Object.fromEntries(by.get(children(children(n)[1])[0])!.records()[0].map((rec) => [nfxtool.KEYS[rec.key], rec.value]))
    expect(children(normal)[0]).toBe(children(alt)[0])
    expect(children(children(normal)[0]).map((n) => by.get(n)!.type)).toEqual([nfxtool.TYPES.indexOf('partsys')])
    expect([ribbon(normal).startcol, ribbon(alt).startcol, ribbon(alt).sampledelay, ribbon(alt).part_life]).toEqual([0x60ffffff, 0x80ff0000, Math.fround(0.01), 0.5])
    expect(trails.label(c.flames, c.trails)).toBe('flames and motion trails')
  })

  it('leaves out the trails of a costume whose trail color is hidden', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    c.trails = { ...imperfect.defaultTrails(), parts: ['arms'], alt_color: '#FF000000' }
    let r = new Builder(src(), c).build()
    let T = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(T.prop('plr_Synth', R.P_EFFECT2))).toBeTruthy()
    expect(T.get('plr_altSynth').get(R.P_EFFECT2)).toBeNull()
    const marked = (costume: string) => ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)[1][0].attachments.some(([, kind]) => kind === trails.TRAIL_KIND)
    expect([marked(''), marked('_alt')]).toEqual([true, false])
    c.flames = { ...imperfect.defaultFlames(), parts: ['head'] }
    r = new Builder(src(), c).build()
    T = new R.Templates(r.sets.get('Misc/Global.not')!)
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
    const children = (n: string) => by.get(n)!.records()[0].filter((rec) => nfxtool.KEYS[rec.key] === 'effectname').map((rec) => rec.value as string)
    expect(children(R.text(T.prop('plr_Synth', R.P_EFFECT2))!)[0]).toBe(R.text(T.prop('plr_altSynth', R.P_EFFECT2)))
    expect(trails.cost(imperfect.defaultFlames(), { ...c.trails, color: '#FFFFFF00' })).toBe(0)
  })

  it('counts motion trails in the effect memory', () => {
    const t = { ...imperfect.defaultTrails(), parts: [...imperfect.TRAIL_PARTS], alt_color: '#00FF0040' }
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const before = fx.used()
    trails.alwaysOn(fx, imperfect.defaultFlames(), t, 'Synth')
    expect(Math.abs(fx.used() - before - trails.cost(imperfect.defaultFlames(), t))).toBeLessThan(16)
    expect(trails.cost(imperfect.defaultFlames(), imperfect.defaultTrails())).toBe(0)
  })

  it('puts glowing eyes on the head bone, replacing the base\'s eye markers', () => {
    // Iron Man's own eye markers are kind 20 on the head bone at Iron Man's place
    const iron = new R.BaseCharacter(src(), 'ironman')
    const ironModel = ngmtool.read(iron.bundleFiles()[0])[1][0]
    const head = Skeleton.ofBase(iron).node('head')
    expect(ironModel.attachments.filter(([, k]) => k === eyes.EYE_KIND).map(([n, , i, m]) => [n, i, ...m.slice(12, 15).map((v) => Math.round(v * 1000) / 1000)]))
      .toEqual([[head, 1, -0.033, 0.129, 0.046], [head, 2, 0.033, 0.129, 0.046]])
    for (const base of ['wolverine', 'storm']) {
      const c = tinted(base)
      c.aura = { ...c.aura, mode: 'base' }
      c.eyes = { ...imperfect.defaultEyes(), on: true, color: '#FF2000', alt_color: '#0040FF80', size: 1.5, position: [0.04, 0.1, 0.05] }
      const r = new Builder(src(), c).build()
      const sk = Skeleton.ofBase(new R.BaseCharacter(src(), base))
      for (const costume of ['', '_alt']) {
        const m = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)[1][0]
        expect(m.attachments.filter(([, k]) => k === eyes.EYE_KIND).map(([n, , i, mat]) => [n, i, ...mat.slice(12, 15).map((v) => Math.fround(v))]))
          .toEqual([[sk.node('head'), 1, ...[-0.04, 0.1, 0.05].map(Math.fround)], [sk.node('head'), 2, ...[0.04, 0.1, 0.05].map(Math.fround)]])
      }
      const T = new R.Templates(r.sets.get('Misc/Global.not')!)
      const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
      const glow = (t: string) => Object.fromEntries(by.get(R.text(T.prop(t, R.P_EFFECT2))!)!.records()[0].map((rec) => [nfxtool.KEYS[rec.key], rec.value]))
      expect(['plr_Synth', 'plr_altSynth'].map((t) => by.get(R.text(T.prop(t, R.P_EFFECT2))!)!.type)).toEqual([nfxtool.TYPES.indexOf('billboard'), nfxtool.TYPES.indexOf('billboard')])
      expect([glow('plr_Synth').startcol, glow('plr_altSynth').startcol, glow('plr_Synth').markertype, glow('plr_Synth').width]).toEqual([0xb4ff2000, 0x5a0040ff, 20, Math.fround(0.15)])
      // Storm keeps her hair; only an effect drawn on the eyes alone gives way
      expect(R.text(T.prop('plr_Synth', R.P_EFFECT1))).toBe(base === 'storm' ? 'strmHair' : null)
    }
  })

  it('replaces Iron Man\'s own eye glow and leaves out a hidden costume\'s', () => {
    const c = tinted('ironman')
    c.aura = { ...c.aura, mode: 'base' }
    c.eyes = { ...imperfect.defaultEyes(), on: true, alt_color: '#00FF0000' }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const t of ['act_Synth', 'plr_Synth', 'plr_altSynth']) expect(T.get(t).get(R.P_EFFECT1), t).toBeNull()
    // white at Iron Man's size is his own irnManFX, which costs nothing
    expect(R.text(T.prop('plr_Synth', R.P_EFFECT2))).toBe('irnManFX')
    expect(T.get('plr_altSynth').get(R.P_EFFECT2)).toBeNull()
    expect(r.notes.some((n) => n.includes('replace Iron Man'))).toBe(true)
  })

  it('combines glowing eyes with flames and trails, and counts them', () => {
    const f = { ...imperfect.defaultFlames(), parts: ['head'] }, t = { ...imperfect.defaultTrails(), parts: ['arms'] }
    const e = { ...imperfect.defaultEyes(), on: true, color: '#FF0000' }
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const before = fx.used()
    const [normal] = trails.alwaysOn(fx, f, t, 'Synth', e)!
    const kids = fx.by.get(normal!.toLowerCase())!.records()[0].filter((rec) => nfxtool.KEYS[rec.key] === 'effectname').map((rec) => fx.by.get((rec.value as string).toLowerCase())!.type)
    expect(kids).toEqual([nfxtool.TYPES.indexOf('controller'), nfxtool.TYPES.indexOf('controller'), nfxtool.TYPES.indexOf('billboard')])
    expect(Math.abs(fx.used() - before - trails.cost(f, t, e))).toBeLessThan(16)
    expect(trails.cost(imperfect.defaultFlames(), imperfect.defaultTrails(), imperfect.defaultEyes())).toBe(0)
    expect(trails.cost(imperfect.defaultFlames(), imperfect.defaultTrails(), e)).toBeGreaterThan(0)
    expect(trails.label(f, t, e)).toBe('flames, motion trails and glowing eyes')
    const src0 = new effects.Effects(src().entry('Misc/game.nfx'))
    expect(['irnManFX', 'altIrnManFX', 'strmHair', 'htBodyFire'].map((n) => src0.eyesOnly(n))).toEqual([true, true, false, false])
  })

  it('counts flames in the memory a tint may take', () => {
    const f = { ...imperfect.defaultFlames(), parts: [...imperfect.FLAME_PARTS], color: '#FF0000', alt_color: '#0000FF' }
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const before = fx.used()
    flames.effectNames(fx, f, 'Synth')
    expect(Math.abs(fx.used() - before - trails.cost(f, imperfect.defaultTrails()))).toBeLessThan(16)
    expect(trails.cost({ ...imperfect.defaultFlames(), body: true }, imperfect.defaultTrails())).toBe(0)
    const plans = effects.tintPlans(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    expect(effects.tintLevel(plans, 'all', 0)).toBe('all')
    expect(effects.tintLevel(plans, 'all', trails.cost(f, imperfect.defaultTrails()))).toBe('power')
    const c = tinted('johnnyohm')
    c.flames = f
    const r = new Builder(src(), c).build()
    expect(r.notes.some((n) => n.includes('idle and power-up effects are tinted'))).toBe(true)
  })

  it('shares the flames of characters that have the same', () => {
    const f = { ...imperfect.defaultFlames(), parts: ['head', 'chest'] }
    const a = { ...tinted('wolverine'), flames: f }
    const b = { ...tinted('storm'), internalName: 'Other', displayName: 'OTHER', flames: f }
    for (const c of [a, b]) c.aura = { ...c.aura, mode: 'base' }
    const r = buildBatch(src(), [a, b])
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(T.prop('plr_Other', R.P_EFFECT2))).toBe(R.text(T.prop('plr_Synth', R.P_EFFECT2)))
    const added = nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).length - nfxtool.blocks(nfxtool.readNfx(src().entry('Misc/game.nfx'))).length
    expect(added).toBe(3)
  })

  it('names the new fighters', () => {
    expect(Array.from({ length: 9 }, (_, i) => ordinal(i))).toEqual(['19th', '20th', '21st', '22nd', '23rd', '24th', '25th', '26th', '27th'])
  })

  it('builds two characters, the second on the first', () => {
    const a = tinted('johnnyohm')
    const b = { ...tinted('humantorch'), internalName: 'Other', displayName: 'OTHER', zButton: { stealth: { undetected: true, untouchable: true, visible: null }, costume: null, stats: null, size: null, bullet: null, gun: null, laser: null, impersonate: null, requires: {} } }
    b.ui = { ...b.ui, ready_voice: 'FE_SFX_TORCH' }
    b.files = new Map([...b.files, ['ui/select_ready.png', pngBytes(200, 400)], ['ui/tile.png', pngBytes(64, 32)]])
    const r = buildBatch(src(), [a, b])
    const [normal, alt] = D.tables(r.dol!)
    expect(D.readRecord(r.dol!, normal, 19).name).toBe('plr_synth')
    expect(D.readRecord(r.dol!, alt, 20)).toMatchObject({ name: 'plr_altOther', key: 'OTHER' })
    expect(u32be(r.dol!, D.fileOffset(r.dol!, 0x804cc80c))).toBe(19)
    for (const name of ['Bundles/synth.ngm', 'Bundles/other_alt.tpl', 'Misc/PLAYER_Synth.nvb', 'Misc/PLAYER_Other.nvb']) expect(r.adds.has(name), name).toBe(true)
    // the base's portraits under both ids: 18 had placeholders to replace, 19 is new
    expect(r.sets.has(ui.P + 'portraits/c18_p0.big')).toBe(true)
    for (const n of ['c19_p0', 'cvs19', 'cvs19_alt', 'cvs18_alt']) expect(r.adds.has(`${ui.P}portraits/${n}.big`), n).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(t.has('plr_Synth') && t.has('plr_altOther')).toBe(true)
    expect(latin1(r.sets.get('Misc/nvblist.txt')!).endsWith('PLAYER Synth\r\nPLAYER Other\r\n')).toBe(true)
    // both tints in full would grow the effect cache by 16 KB: they are cut back to fit what one may
    expect(r.cache === null || r.cache - nfxtool.CACHE_SIZE <= effects.TINT_ALL_LIMIT).toBe(true)
    expect(r.notes.some((n) => n.startsWith('OTHER: aura tint') && n.includes('idle and power-up'))).toBe(true)
    expect(r.notes.some((n) => n.includes("uses Johnny Ohm's (FE_SFX_OHM)"))).toBe(true)

    const movie = (name: string) => {
      const files = ui.loadArchive(r.sets.get(ui.P + name)!)
      const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
      return new Apt(get('.apt'), get('.const'))
    }
    const pushes = (apt: Apt) => apt.frameActions(apt.aptOff, 0).flatMap((block) => {
      const pool = apt.pool(block)
      return apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool)))
    })
    const select = pushes(movie('screens/clashCharSelect.big'))
    const values = ui.sfxValues(src().entry(ui.P + 'main.big'))
    expect(select).toContainEqual(['g_aCharacterAudio', values.get('FE_SFX_TORCH'), values.get('FE_SFX_OHM'), '_global'])
    expect(select.find((v) => v[0] === 'aObject')!.slice(0, 3)).toEqual(['aObject', 'thumb19', 'thumb18'])
    expect(select.find((v) => v[0] === 'g_aCharacterOrder')!.slice(0, 3)).toEqual(['g_aCharacterOrder', 19, 18])
    const main = pushes(movie('main.big'))
    const names = main.find((v) => v.includes('~kT_VANROEKEL'))!
    expect(names.slice(-21)).toEqual(['OTHER', 'SYNTH', ...names.slice(-19, -1), 20])
    expect(names[names.length - 19]).toBe('~kT_VANROEKEL')
    expect(main.find((v) => v.includes('kGlobal_Max_NumChar'))!.slice(-1)).toEqual([20])
    const thumbs = new Map(movie('screens/clashCharSelect_thumbs.big').exports())
    expect(thumbs.has('char18') && thumbs.has('char19')).toBe(true)
    expect(report([a, b], r)).toContain('roster records 19 to 20')
  })

  it('checks a pair before building it', () => {
    const a = tinted('johnnyohm')
    const b = { ...tinted('humantorch'), internalName: 'Other', displayName: 'OTHER' }
    b.ui = { ...b.ui, ready_voice: 'FE_SFX_TORCH' }
    const [check, r] = checkBatch(src(), [a, b])
    expect(check.problems.filter(([l]) => l === 'error')).toEqual([])
    expect(check.problems.some(([l, m]) => l === 'warning' && m.startsWith('20th (OTHER)') && m.includes('idle and power-up'))).toBe(true)
    expect(check.problems.some(([, m]) => m.includes('FE_SFX_OHM'))).toBe(true)
    expect(r).not.toBeNull()
    expect(check.cacheExtra).toBeLessThanOrEqual(effects.TINT_ALL_LIMIT)
    expect(check.largest).toBe(420153)
    expect(check.models.map(([n]) => n)).toEqual(['19th (SYNTH)', '20th (OTHER)'])
    expect(check.models.every(([, size]) => size > 0 && size < check.largest)).toBe(true)
  })

  it('finds names two characters would both add', () => {
    const a = { ...tinted('johnnyohm'), internalName: 'Foo' }
    const [same] = checkBatch(src(), [a, { ...tinted('storm'), internalName: 'foo' }])
    expect(same.problems.some(([l, m]) => l === 'error' && m.includes('internal name'))).toBe(true)
    const [overlap, r] = checkBatch(src(), [a, { ...tinted('storm'), internalName: 'altFoo' }])
    expect(overlap.problems).toContainEqual(['error', '19th (SYNTH) and 20th (SYNTH) both would add plr_altfoo, plr_altfoo_rage to the game: change one internal name'])
    expect(r).toBeNull()
  })

  it('refuses two characters with the same internal name', () => {
    expect(() => buildBatch(src(), [tinted('johnnyohm'), tinted('storm')])).toThrow(LabError)
  })

  it('gives a voice to one before a voiced one', () => {
    const named = (base: string, name: string, voice: string | null) => {
      const c = { ...tinted(base), internalName: name, displayName: name.toUpperCase(), aura: { ...tinted(base).aura, mode: 'base' as const } }
      c.ui = { ...c.ui, ready_voice: voice }
      return c
    }
    const chars = [named('johnnyohm', 'One', 'FE_SFX_OHM'), named('storm', 'Two', null), named('venom', 'Three', 'FE_SFX_VENOM')]
    const r = buildBatch(src(), chars)
    expect(r.notes.some((n) => n.includes("TWO: no ready voice") && n.includes("uses Storm's (FE_SFX_STORM)"))).toBe(true)
    const files = ui.loadArchive(r.sets.get(ui.P + 'screens/clashCharSelect.big')!)
    const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
    const apt = new Apt(get('.apt'), get('.const'))
    const block = apt.frameActions(apt.aptOff, 0)[0]
    const pool = apt.pool(block)
    const audio = apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool))).find((v) => v[0] === 'g_aCharacterAudio')!
    const values = ui.sfxValues(src().entry(ui.P + 'main.big'))
    expect(audio).toEqual(['g_aCharacterAudio', ...['FE_SFX_VENOM', 'FE_SFX_STORM', 'FE_SFX_OHM'].map((v) => values.get(v)), '_global'])
  })

  it('builds nine characters into the third row', () => {
    const bases = ['thing', 'wolverine', 'paradox', 'elektra', 'johnnyohm', 'spiderman', 'daredevil', 'storm', 'venom']
    const chars = bases.map((base, i) => ({ ...tinted(base), internalName: `Nine${i}`, displayName: `NINE ${i}`, aura: { ...tinted(base).aura, mode: 'base' as const } }))
    const [check, r] = checkBatch(src(), chars)
    expect(check.problems.filter(([l]) => l === 'error')).toEqual([])
    expect(check.models.map(([n]) => n)).toEqual(chars.map((c, i) => `${ordinal(i)} (${c.displayName})`))
    const [normal] = D.tables(r!.dol!)
    expect(D.readRecord(r!.dol!, normal, 27)).toMatchObject({ name: 'plr_nine8', key: 'NINE 8' })
    expect(r!.adds.has('Misc/PLAYER_Nine0.nvb')).toBe(false)
    const movie = (name: string) => {
      const files = ui.loadArchive(r!.sets.get(ui.P + name)!)
      const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
      return new Apt(get('.apt'), get('.const'))
    }
    const pushes = (apt: Apt) => apt.frameActions(apt.aptOff, 0).flatMap((block) => {
      const pool = apt.pool(block)
      return apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool)))
    })
    const select = pushes(movie('screens/clashCharSelect.big'))
    expect(select.find((v) => v[0] === 'aObject')!.slice(0, 2)).toEqual(['aObject', 'thumb26'])
    expect(select.find((v) => v[0] === 'g_aCharacterOrder')!.slice(-1)).toEqual([27])
    const main = pushes(movie('main.big'))
    const names = main.find((v) => v.includes('~kT_VANROEKEL'))!
    expect(names.slice(-28, -19)).toEqual(chars.map((c) => c.displayName).reverse())
    expect(names[names.length - 1]).toBe(27)
    expect(main.find((v) => v.includes('kGlobal_Max_NumChar'))!.slice(-1)).toEqual([27])
    const thumbs = new Map(movie('screens/clashCharSelect_thumbs.big').exports())
    for (let id = 18; id < 27; id++) expect(thumbs.has(`char${id}`), `char${id}`).toBe(true)
    for (let id = 18; id < 27; id++) expect(r!.sets.has(`${ui.P}portraits/c${id}_p0.big`) || r!.adds.has(`${ui.P}portraits/c${id}_p0.big`), `c${id}_p0`).toBe(true)
    expect(report(chars, r!)).toContain('roster records 19 to 27')
  })

  it("keeps the tuned characters to what the game's tuning list holds", () => {
    const chars = ['johnnyohm', 'storm', 'venom', 'heatwave', 'magneto'].map((base, i) => ({ ...tinted(base), internalName: `Tuned${i}`, displayName: `TUNED ${i}` }))
    const [check, r] = checkBatch(src(), chars)
    expect(r).toBeNull()
    expect(check.problems.some(([l, m]) => l === 'error' && m.includes("tuning list take 70 bytes where it has 53 free"))).toBe(true)
    const short = [{ ...tinted('johnnyohm'), internalName: 'A', displayName: 'A' }, { ...tinted('magneto'), internalName: 'B', displayName: 'B' }]
    expect(checkBatch(src(), short)[0].problems.filter(([l]) => l === 'error')).toEqual([])
  })

  it('refuses a name the game uses', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Wolverine'
    c.displayName = 'W'
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()]])
    expect(() => new Builder(src(), c).build()).toThrow(LabError)
  })
})

describe.skipIf(!ISO)('base moves', () => {
  const src = () => gameSource()
  const daredevil = () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    return c
  }

  it('reads and writes animation bundles byte for byte', () => {
    for (const name of ['daredevil', 'daredevil-t0', 'daredevil-t1', 'daredevil-t2', 'thing']) {
      const data = src().entry(`Bundles/${name}.ngb`)
      expect(ngbtool.build(ngbtool.parse(data))).toEqual(data)
    }
  })

  it('flies the club straight out to the reach and back', () => {
    const [, models] = ngmtool.read(src().entry('Bundles/daredevil.ngm'))
    const rec = ngbtool.parse(src().entry('Bundles/daredevil.ngb')).find((r) => r.name === 'Daredevil_RangedAttack.nad')!
    const out = basemoves.longThrow(rec, models[0], 35)
    const at = (t: number) => ngbtool.pose(models[0], out, t)[basemoves.CLUB][1]
    const start = at(13), turn = at(13 + 18)
    expect(out.length).toBe(rec.length + 25)
    expect(turn[1] - start[1]).toBeCloseTo(35, 1)
    expect(Math.abs(turn[0] - start[0])).toBeLessThan(0.2)
    expect(Math.abs(turn[2] - start[2])).toBeLessThan(0.2)
    expect(out.events.filter(([, t]) => t === 0x53 || t === basemoves.MIRROR_EVENT).map(([f, t]) => [f, t])).toEqual([[31, 0x53], [31, basemoves.MIRROR_EVENT]])
    // mirrored about the turn, the return passes where the way out did
    for (const i of [3, 9, 15]) expect(at(31 + i)[1]).toBeCloseTo(at(31 - i)[1], 1)
    // the rest of the body only moves in time
    const other = (r: ngbtool.Record) => r.tracks.filter(([b]) => b !== basemoves.CLUB).map(([, , k]) => k.map(([, v]) => v))
    expect(other(out)).toEqual(other(rec))
  })

  it('builds a long baton throw', () => {
    const c = daredevil()
    c.baseMoves = { throw_reach: 30, throw_cable: false }
    const r = new Builder(src(), c).build()
    expect(r.adds.has('Motions/Synth.nms')).toBe(true)
    for (const n of ['synth', 'synth-t0', 'synth-t1', 'synth-t2']) expect(r.adds.has(`Bundles/${n}.ngb`)).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_MOTIONSET))).toBe('Synth.nms')
    expect(R.text(t.prop('plr_altSynth', R.P_MOTIONSET))).toBe('Synth.nms')
    expect(t.prop('plr_Synth', R.P_EFFECT1)).toBeNull()
    expect(t.prop('plr_altSynth', R.P_EFFECT1)).toBeNull()
    expect(R.text(t.prop('plr_Daredevil', R.P_MOTIONSET))).toBe('Daredevil.nms')
    const nvb = nvbtool.parseNvb(r.adds.get('Misc/PLAYER_Synth.nvb')!)
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    expect(nvb.slots(tuning.AIM_RANGE, fields[tuning.AIM_RANGE][1])!.map((v) => new DataView(v.buffer, v.byteOffset).getFloat32(0, true))).toEqual(new Array(tuning.SLOTS).fill(30))
    for (const costume of ['', '_alt']) {
      const [, base] = ngmtool.read(src().entry(`Bundles/daredevil${costume}.ngm`))
      const [, built] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
      const end = (m: ngmtool.Model, kind: number) => m.attachments.find(([n, k]) => n === basemoves.CLUB && k === kind)![3][12]
      expect(end(built[0], 43) - end(base[0], 43)).toBeCloseTo(basemoves.HIT_REACH, 5)
      expect(end(built[0], 44) - end(base[0], 44)).toBeCloseTo(-basemoves.HIT_REACH, 5)
    }
  })

  it('gives the baton throw its own damage', () => {
    for (const n of src().names('Bundles/', '.ngb')) {
      for (const [, , evs] of ngbtool.events(src().entry(n))) expect(evs.some(([, t, p]) => t === damage.TIER_EVENT && p === damage.THROW_PARAM)).toBe(false)
    }
    const c = daredevil()
    c.gameplay = { attack_damage_throw: 45 }
    const r = new Builder(src(), c).build()
    expect(equal(r.dol!, D.throwDamage(new Builder(src(), daredevil()).build().dol!))).toBe(true)
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const own = set.get('superattackfar')!.anim.toLowerCase()
    expect(own).not.toBe(basemoves.THROW)
    const rec = ngbtool.parse(r.adds.get('Bundles/synth.ngb')!).find((x) => x.name.toLowerCase() === own)!
    const stock = ngbtool.parse(src().entry('Bundles/daredevil.ngb')).find((x) => x.name.toLowerCase() === basemoves.THROW)!
    expect(damage.strikes(stock.events)).toEqual([damage.THROW_TIER])
    expect(damage.strikes(rec.events)).toEqual([damage.THROW_PARAM])
    const nvb = nvbtool.parseNvb(r.adds.get('Misc/PLAYER_Synth.nvb')!)
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    const floats = (v: Uint8Array[]) => v.map((b) => new DataView(b.buffer, b.byteOffset).getFloat32(0, true))
    const tier = floats(new tuning.Tuning(src(), new R.BaseCharacter(src(), 'daredevil')).slots(22 + damage.THROW_TIER)[1])
    floats(nvb.slots(damage.THROW_FIELD, fields[damage.THROW_FIELD][1])!).forEach((v, s) => expect(v).toBeCloseTo((tier[s] * 45) / tier[0], 4))
  })

  it('keeps the cable unless asked', () => {
    const c = daredevil()
    c.baseMoves = { throw_reach: 20 }
    const t = new R.Templates(new Builder(src(), c).build().sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_EFFECT1))).toBe(R.text(t.prop('plr_Daredevil', R.P_EFFECT1)))
  })

  it('gives the long throw a name of its own', () => {
    const c = daredevil()
    c.baseMoves = { throw_reach: 30 }
    const r = new Builder(src(), c).build()
    const names = ngbtool.names(r.adds.get('Bundles/synth.ngb')!).map((n) => n.toLowerCase())
    expect(names).not.toContain(basemoves.THROW)
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const own = set.get('superattackfar')!.anim
    expect(own).toMatch(/^Daredevil_RangedAtta_[0-9a-f]{6}\.nad$/)
    for (const s of ['rangedattack', 'dodgeexitsuperattack']) expect(set.get(s)!.anim).toBe(own)
    expect(names).toContain(own.toLowerCase())
  })

  const played = (c: imperfect.Character) => {
    const r = new Builder(src(), c).build()
    const recs = ngbtool.parse(r.adds.get('Bundles/synth.ngb')!)
    const now = moves.resolved(src(), nmstool.parse(r.adds.get('Motions/Synth.nms')!), () => true)
    const at = (state: string) => {
      const m = now.get(state.toLowerCase())!
      return { anim: m.anim.toLowerCase(), rec: recs.find((x) => x.name.toLowerCase() === m.anim.toLowerCase())! }
    }
    return { r, at }
  }

  it('keeps the club in the hand with the throw off', () => {
    const c = daredevil()
    c.baseMoves = { no_throw: 'in_hand' }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    const { r, at } = played(c)
    const [, models] = ngmtool.read(src().entry('Bundles/daredevil.ngm'))
    const model = models[0]
    const hand = holster.armOf(new Skeleton(model, new R.BaseCharacter(src(), 'daredevil').body)).hand
    const stock = ngbtool.parse(src().entry('Bundles/daredevil.ngb')).find((x) => x.name.toLowerCase() === basemoves.THROW)!
    const rec = at('SuperAttackFar').rec
    expect(at('SuperAttackFar').anim).not.toBe(basemoves.THROW)
    for (const s of ['RangedAttack', 'DodgeExitSuperAttack']) expect(at(s).anim).toBe(at('SuperAttackFar').anim)
    const gap = (r: ngbtool.Record, t: number) => {
      const p = ngbtool.pose(model, r, t)
      return Math.hypot(...[0, 1, 2].map((k) => p[basemoves.CLUB][1][k] - p[hand][1][k]))
    }
    expect(Math.max(...[14, 16, 18, 20].map((t) => gap(stock, t)))).toBeGreaterThan(2)
    for (let t = 0; t <= rec.length; t += 0.5) expect(gap(rec, t), `frame ${t}`).toBeLessThan(0.25)
    for (const t of [5, 30, 38]) expect(gap(rec, t)).toBeCloseTo(gap(stock, t), 3)
    expect(rec.events).toEqual(stock.events)
    const other = (x: ngbtool.Record) => x.tracks.filter(([b]) => b !== basemoves.CLUB)
    expect(other(rec)).toEqual(other(stock))
    expect(r.notes.some((n) => n.startsWith('baton throw: the club stays in the hand'))).toBe(true)
  })

  it('plays attack far in place of the baton throw', () => {
    const c = daredevil()
    c.baseMoves = { no_throw: 'attack_far' }
    const { r, at } = played(c)
    const far = at('AttackFar').anim
    expect(far).toBe('daredevil_mobilityattack.nad')
    for (const s of basemoves.THROW_MOVES) expect(at(s).anim, s).toBe(far)
    expect(ngbtool.names(r.adds.get('Bundles/synth.ngb')!).map((n) => n.toLowerCase())).not.toContain(basemoves.THROW)
    expect(r.notes.some((n) => n.startsWith('baton throw: ') && n.endsWith('play attack far instead'))).toBe(true)
    c.moves = { SuperAttackFar: 'spiderman' }
    const kept = played(c).at
    expect(kept('SuperAttackFar').anim).not.toBe(far)
    expect(kept('RangedAttack').anim).toBe(far)
  })

  it('refuses a reach on a throw that is off', () => {
    const c = daredevil()
    c.baseMoves = { no_throw: 'in_hand', throw_reach: 20 }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('reach does nothing'))).toBe(true)
    expect(() => new Builder(src(), c).build()).toThrow(LabError)
  })
})

describe.skipIf(!ISO)('holster', () => {
  const src = () => gameSource()
  const dd = () => new R.BaseCharacter(src(), 'daredevil')
  const model = () => ngmtool.read(src().entry('Bundles/daredevil.ngm'))[1][0]
  const plan = (): holster.Plan => {
    const club = ngbtool.pose(model(), null, 0)[basemoves.CLUB][1]
    return { position: [0.05, -0.2, 0.1], rotation: [0, 90, 0], center: [club[0], club[1] + 0.05, club[2]] }
  }
  const built = (mf: moves.MotionFiles) => ({
    set: nmstool.parse(mf.files.get('Motions/Synth.nms')!).motions(),
    recs: new Map(ngbtool.parse(mf.files.get('Bundles/synth.ngb')!).map((r) => [r.name.toLowerCase(), r])),
  })
  const onBack = (m: Pick<ngmtool.Model, 'nodes'>, p: holster.Plan, rec: ngbtool.Record, t: number) => {
    const posed = ngbtool.pose(m, rec, t)
    const [, T] = holster.stowedAt(m, p)(posed)
    return Math.hypot(...posed[basemoves.CLUB][1].map((v, k) => v - T[k]))
  }

  it('keeps the club on the back outside power mode, and in hand in it', () => {
    const p = plan()
    const { set, recs } = built(moves.motionFiles(src(), dd(), 'Synth', {}, undefined, {}, null, {}, null, 1, [], p))
    for (const state of ['stand', 'walk', 'run', 'attack1', 'block', 'hitreactlarge', 'jump']) {
      const rec = recs.get(set.get(state)!.anim.toLowerCase())!
      for (const t of [0, rec.length / 3, rec.length]) expect(onBack(model(), p, rec, t)).toBeLessThan(0.01)
    }
    expect(set.get('powerstand')!.anim).toBe('Daredevil_PowerStand.nad')
    expect(set.get('superattack1')!.anim).toBe('Daredevil_SCombo_H1.nad')
    expect(set.get('superrun')!.anim).toBe('Spiderman_Run.nad')
    expect(set.get('run')!.anim).not.toBe('Spiderman_Run.nad')
    expect(recs.has('spiderman_run.nad')).toBe(true)
    expect(recs.has('daredevil_stand.nad')).toBe(false)
    const on = recs.get(set.get('poweron')!.anim.toLowerCase())!
    expect(onBack(model(), p, on, 0)).toBeLessThan(5e-3)
    expect(onBack(model(), p, on, on.length)).toBeGreaterThan(0.2)
    const clip = recs.get(set.get('ikclaws')!.anim.toLowerCase())!
    expect(clip.tracks.some(([b]) => b === basemoves.CLUB)).toBe(false)
    expect(clip.tracks.length).toBe(8)
    const off = recs.get(set.get('poweroff')!.anim.toLowerCase())!
    expect(onBack(model(), p, off, 0)).toBeGreaterThan(0.2)
    expect(onBack(model(), p, off, off.length)).toBeLessThan(5e-3)
  })

  it('holds moves in hand or on the back as picked', () => {
    const p = { ...plan(), drawn: { Block: true, SuperBlock: false } }
    const { set, recs } = built(moves.motionFiles(src(), dd(), 'Synth', {}, undefined, {}, null, {}, null, 1, [], p))
    for (const st of ['blockstart', 'block', 'blockend']) expect(set.get(st)!.anim).toMatch(/^Daredevil_Block(Start|End)?\.nad$/)
    const sb = recs.get(set.get('superblock')!.anim.toLowerCase())!
    expect(sb.name).not.toBe('Daredevil_SuperBlock.nad')
    for (const t of [0, sb.length / 2, sb.length]) expect(onBack(model(), p, sb, t)).toBeLessThan(0.01)
  })

  it('ends the baton throw in the power-stand grip', () => {
    const hand = holster.armOf(new Skeleton(model(), dd().body)).hand
    const stock = new Map(ngbtool.parse(src().entry('Bundles/daredevil.ngb')).map((r) => [r.name.toLowerCase(), r]))
    const gripAt = (rec: ngbtool.Record, t: number) => holster.grip(ngbtool.pose(model(), rec, t), hand)
    const off = (a: ngbtool.Mat3, b: ngbtool.Mat3) => Math.max(...a.flatMap((r, i) => r.map((v, j) => Math.abs(v - b[i][j]))))
    const [GR, GT] = gripAt(stock.get('daredevil_powerstand.nad')!, 0)
    const thrown = stock.get(basemoves.THROW)!
    expect(off(gripAt(thrown, thrown.length)[0], GR)).toBeGreaterThan(0.5)
    for (const reachTo of [undefined, 35]) {
      const { set, recs } = built(moves.motionFiles(src(), dd(), 'Synth', {}, reachTo, {}, null, {}, null, 1, [], plan()))
      const rec = recs.get(set.get('superattackfar')!.anim.toLowerCase())!
      expect(set.get('rangedattack')!.anim).toBe(rec.name)
      const [R, T] = gripAt(rec, rec.length)
      expect(off(R, GR)).toBeLessThan(1e-2)
      expect(Math.hypot(...T.map((v, k) => v - GT[k]))).toBeLessThan(5e-3)
      expect(off(gripAt(rec, 10)[0], gripAt(thrown, 10)[0])).toBeLessThan(1e-2)
    }
  })

  it('draws from swapped power animations, sized and with a long throw', () => {
    const p = plan()
    const mf = moves.motionFiles(src(), dd(), 'Synth', { PowerOn: 'wolverine', PowerOff: 'wolverine', PowerStand: 'wolverine' }, 30, {}, null, {}, null, 1.5, [], p)
    const { set, recs } = built(mf)
    const big = scaleModel(model(), 1.5)
    const k = (v: ngbtool.Vec3) => v.map((x) => x * 1.5) as ngbtool.Vec3
    const bp = { ...p, position: k(p.position), center: k(p.center) }
    const stand = recs.get(set.get('stand')!.anim.toLowerCase())!
    expect(onBack(big, bp, stand, 5)).toBeLessThan(5e-3)
    const on = recs.get(set.get('poweron')!.anim.toLowerCase())!
    expect(on.length).toBe(10)
    expect(onBack(big, bp, on, 0)).toBeLessThan(5e-3)
    expect(set.get('superattackfar')!.anim).toMatch(/^Daredevil_RangedAtta_[0-9a-f]{6}\.nad$/)
    expect(mf.notes.some((n) => n.startsWith('holster:'))).toBe(true)
  })

  it('reads and writes a cutscene actor\'s animation unchanged', () => {
    const body = src().entry('Cutscenes/mp_dd_int_1.cut')
    const cut = cuttool.read(body)
    for (const ch of cut.chunks) for (const a of ch.actors) cuttool.setRecord(a, cuttool.record(a))
    expect(equal(cuttool.build(cut), body)).toBe(true)
  })

  it('keeps the club on the back in the intros', () => {
    const p = plan(), c = tinted('daredevil')
    const out = cutscenes.plan(src(), dd(), c, undefined, (rec) => holster.stow(rec, model(), p))
    const stock = cuttool.read(src().entry('Cutscenes/mp_dd_int_2.cut'))
    for (const fid of cutscenes.FIELDS.intro) {
      for (const name of out.fields.get(fid)!) {
        expect(name).toMatch(/^synth_intro\d$/)
        const cut = cuttool.read(out.files.get(cutscenes.cutPath(name))!)
        for (const ch of cut.chunks) {
          const rec = cuttool.record(ch.actors.find((a) => cuttool.recordName(a.record).toLowerCase() === 'daredevil')!)
          for (const t of [0, rec.length / 2, rec.length]) expect(onBack(model(), p, rec, t)).toBeLessThan(0.01)
        }
      }
    }
    const cut = cuttool.read(out.files.get(cutscenes.cutPath(out.fields.get(171)![0]))!)
    cut.chunks.forEach((ch, i) => ch.actors.forEach((a, j) => {
      const was = stock.chunks[i].actors[j]
      if (cuttool.recordName(a.record).toLowerCase() !== 'daredevil') expect(a.tracks).toEqual(was.tracks)
      else expect(a.tracks.filter((t) => cuttool.bone(t) !== basemoves.CLUB)).toEqual(was.tracks.filter((t) => cuttool.bone(t) !== basemoves.CLUB))
    }))
    expect(out.notes).toEqual(['cutscenes: intro club on the back'])
  })

  it('builds a character with a holster', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    c.materials[0].bind = basemoves.CLUB
    c.baseMoves = { throw_cable: false, holster: imperfect.defaultHolster() }
    const r = new Builder(src(), c).build()
    expect(r.adds.has('Motions/Synth.nms')).toBe(true)
    expect(r.adds.has('Cutscenes/synth_intro1.cut')).toBe(true)
    expect(r.notes.some((n) => n.startsWith('holster:'))).toBe(true)
    expect(r.notes.some((n) => n.includes('intro club on the back'))).toBe(true)
  })

  it('keeps the club in the hand with the throw off and a holster', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    c.materials[0].bind = basemoves.CLUB
    c.baseMoves = { throw_cable: false, holster: imperfect.defaultHolster(), no_throw: 'in_hand' }
    const r = new Builder(src(), c).build()
    const anim = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions().get('superattackfar')!.anim.toLowerCase()
    const rec = ngbtool.parse(r.adds.get('Bundles/synth.ngb')!).find((x) => x.name.toLowerCase() === anim)!
    const model = ngmtool.read(src().entry('Bundles/daredevil.ngm'))[1][0]
    const hand = holster.armOf(new Skeleton(model, dd().body)).hand
    for (const t of [14, 18, 22]) {
      const p = ngbtool.pose(model, rec, t)
      expect(Math.hypot(...[0, 1, 2].map((k) => p[basemoves.CLUB][1][k] - p[hand][1][k])), `frame ${t}`).toBeLessThan(0.25)
    }
  })
})

describe.skipIf(!ISO)('moves', () => {
  const src = () => gameSource()
  const catalog = () => moves.catalog(src(), new effects.Effects(src().entry('Misc/game.nfx')))
  const daredevil = () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    return c
  }
  const records = (data: Uint8Array) => new Map(ngbtool.parse(data).map((r) => [r.name.toLowerCase(), r]))

  it('reads and writes every motion set byte for byte', () => {
    const names = src().names('Motions/', '.nms')
    expect(names.length).toBeGreaterThanOrEqual(47)
    for (const n of names) expect(nmstool.parse(src().entry(n)).build()).toEqual(src().entry(n))
  })

  it('lists every base\'s moves', () => {
    const cat = catalog()
    expect(Object.keys(cat).sort()).toEqual(R.keys().sort())
    expect(cat.thing.body).toBe('brute')
    expect(cat.daredevil.motions.superthrow).toBe('daredevil_superThrow.nad')
    expect(cat.thing.motions.superthrowfemale).toBe('Thing_SuperThrowFemale.nad')
    // a line whose animation no bundle has is dropped, as the game drops it
    expect(cat.daredevil.motions.superwallattackloop).not.toBe('Daredevil_WallAttackSLoop.nad')
    const grab = moves.options(cat, 'daredevil', moves.MOVE_IDS.get('SuperThrow')!)
    expect(grab.some((o) => o.from.includes('thing'))).toBe(true)
  })

  it('sets the motion set on the player templates\' parent only', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    for (const key of R.keys()) {
      const b = new R.BaseCharacter(src(), key, t)
      expect(t.get(b.plr).get(R.P_MOTIONSET)).toBeNull()
      expect(t.get(b.alt).get(R.P_MOTIONSET)).toBeNull()
      expect(R.text(t.prop(b.plr, R.P_MOTIONSET))).toBe(moves.motionSetOf(b))
    }
  })

  it('gives Daredevil the Thing\'s super throw, as the Doom and Cap mod gave Captain America', () => {
    const c = daredevil()
    c.moves = { SuperThrow: 'thing' }
    const r = new Builder(src(), c).build()
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_MOTIONSET))).toBe('Synth.nms')
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const thing = nmstool.parse(src().entry('Motions/thing.nms')).motions()
    for (const s of ['superthrowvictim', 'superthrowvictimfemale', 'superthrowvictimbrute']) expect(set.get(s)).toEqual(thing.get(s))
    const map = moves.boneMap('brute', 'male', 88)
    for (const [i, suffix] of ['', 'Female', 'Brute'].entries()) {
      const m = set.get(`superthrow${suffix.toLowerCase()}`)!
      expect(m.opts).toEqual(['noloop', 'endpause'])
      expect(m.anim).toMatch(new RegExp(`^${`Thing_SuperThrow${suffix || 'Male'}`.slice(0, 20)}_[0-9a-f]{6}\\.nad$`))
      const built = records(r.adds.get(`Bundles/synth-t${i}.ngb`)!)
      const theirs = records(src().entry(`Bundles/thing-t${i}.ngb`))
      const own = built.get(m.anim.toLowerCase())!
      expect(ngbtool.sameMotion(own, moves.remapRecord(theirs.get(`thing_superthrow${(suffix || 'male').toLowerCase()}.nad`)!, map))).toBe(true)
      const victim = thing.get(`superthrowvictim${suffix.toLowerCase()}`)!.anim.toLowerCase()
      expect(ngbtool.sameMotion(built.get(victim)!, theirs.get(victim)!)).toBe(true)
      for (const gone of ['daredevil_superthrow.nad', 'male_ddsuperthrwvictim.nad', 'female_ddsuperthrwvictim.nad', 'brute_ddsuperthrwvictim.nad']) expect(built.has(gone)).toBe(false)
      // the rest of Daredevil's bundle is as it was
      const dd = records(src().entry(`Bundles/daredevil-t${i}.ngb`))
      for (const [k, rec] of dd) if (!k.includes('superthrw') && !k.includes('superthrow')) expect(built.has(k) && ngbtool.sameMotion(built.get(k)!, rec)).toBe(true)
    }
    expect(r.adds.get('Bundles/synth.ngb')).toEqual(src().entry('Bundles/daredevil.ngb'))
    expect(r.notes.some((n) => n.includes('Super throw') && n.includes('approximate'))).toBe(true)
  })

  it('gives Elektra Wolverine\'s super air throw in every opponent\'s slot', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    const el = new R.BaseCharacter(src(), 'elektra', t)
    const mf = moves.motionFiles(src(), el, 'Synth', { SuperAirThrow: 'wolverine' })
    const set = nmstool.parse(mf.files.get('Motions/Synth.nms')!).motions()
    const anim = set.get('superairthrow')!.anim
    expect(anim).toMatch(/^Wolverine_SuperAirTa_[0-9a-f]{6}\.nad$/)
    for (const s of ['superairthrowfemale', 'superairthrowbrute']) expect(set.get(s)!.anim).toBe(anim)
    const map = moves.boneMap('male', 'female', 81)
    for (let i = 0; i < 3; i++) {
      const built = records(mf.files.get(`Bundles/synth-t${i}.ngb`)!)
      const theirs = records(src().entry(`Bundles/wolverine-t${i}.ngb`))
      expect(ngbtool.sameMotion(built.get(anim.toLowerCase())!, moves.remapRecord(theirs.get('wolverine_superairtackle.nad')!, map))).toBe(true)
    }
  })

  it('plays Wolverine\'s idle in place of his run and first attack', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    const wv = new R.BaseCharacter(src(), 'wolverine', t)
    const mf = moves.motionFiles(src(), wv, 'Synth', {}, undefined, {}, null, {}, null, 1, ['Run', 'Attack1'])
    const set = nmstool.parse(mf.files.get('Motions/Synth.nms')!).motions()
    const base = catalog().wolverine.motions
    const built = records(mf.files.get('Bundles/synth.ngb')!)
    const theirs = records(src().entry('Bundles/wolverine.ngb'))
    const stand = set.get('stand')!.anim
    expect(stand.toLowerCase()).toBe(base.stand.toLowerCase())
    for (const state of ['run', 'attack1']) {
      const m = set.get(state)!
      if (moves.loops(m.opts)) {
        expect(m.anim).toBe(stand)
        expect(m.opts).toEqual(moves.idleOpts(m.opts, set.get('stand')!.opts))
        expect(m.opts.map((o) => o.toLowerCase())).not.toContain('move')
        continue
      }
      const own = built.get(m.anim.toLowerCase())!, was = theirs.get(base[state].toLowerCase())!
      expect(own.length).toBe(was.length)
      expect(own.events).toEqual(was.events)
      expect(own.tracks.filter(([b]) => (b & 0xffff) === 0)).toEqual(was.tracks.filter(([b]) => (b & 0xffff) === 0))
      expect(own.tracks.every(([, , keys]) => keys[keys.length - 1][0] <= was.length)).toBe(true)
      expect(built.has(base[state].toLowerCase())).toBe(false)
    }
    expect(mf.notes.some((n) => n.includes('Run plays the idle'))).toBe(true)
  })

  it('takes moves along with a long throw', () => {
    const c = daredevil()
    c.moves = { SuperThrow: 'thing', Attack1: 'spiderman' }
    c.baseMoves = { throw_reach: 30 }
    const r = new Builder(src(), c).build()
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const main = records(r.adds.get('Bundles/synth.ngb')!)
    expect(set.get('superattackfar')!.anim).toMatch(/^Daredevil_RangedAtta_/)
    const attack = set.get('attack1')!
    expect(attack.anim.toLowerCase()).toBe(catalog().spiderman.motions.attack1.toLowerCase())
    expect(main.has(attack.anim.toLowerCase())).toBe(true)
    expect(main.has('daredevil_ncombo_h1.nad')).toBe(false)
    expect(set.get('superthrow')!.anim).toMatch(/^Thing_SuperThrowMale_/)
  })

  it('knows which bases climb walls and run on them', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    for (const [key, bit] of [['wall_climb', 0x2], ['wall_run', 0x4000000]] as const) {
      const have = R.keys().filter((k) => new R.BaseCharacter(src(), k, t).abilities & bit)
      expect(have.sort()).toEqual([...imperfect.WALL.find((w) => w.key === key)!.bases].sort())
    }
  })

  const walls: [string, imperfect.Gameplay, Record<string, string>, number][] = [
    ['thing', { wall_climb: true }, { climb: 'venom' }, 0x2],
    ['thing', { wall_climb: true }, { climb: 'spiderman' }, 0x2],
    ['thing', { wall_run: true }, { run: 'wolverine' }, 0x4000000],
    ['thing', { wall_climb: true, wall_run: true }, { climb: 'venom', run: 'biohazard' }, 0x4000002],
    ['spiderman', { wall_run: true }, { run: 'elektra' }, 0x4000000],
  ]
  for (const [base, gameplay, from, bits] of walls) {
    it(`gives ${base} ${Object.entries(from).map(([k, v]) => `${v}'s wall ${k}`).join(' and ')}`, () => {
      const c = tinted(base)
      c.aura = { ...c.aura, mode: 'base' }
      c.gameplay = gameplay
      const cat = catalog()
      const has = (k: string, id: string) => Boolean(cat[k].motions[id.toLowerCase()])
      const ids: [string[], string][] = [[moves.WALL_CLIMB, from.climb], [moves.WALL_RUN, from.run], [moves.WALL_JUMPS, from.climb ?? from.run]]
      c.moves = Object.fromEntries(ids.flatMap(([states, k]) => (k ? states.filter((id) => has(k, id) && !has(base, id)).map((id) => [id, k]) : [])))
      expect(imperfect.problems(c).filter(([l, m]) => l === 'error' || m.includes('never play'))).toEqual([])
      const r = new Builder(src(), c).build()
      const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
      const names = new Set(moves.SLOTS.flatMap((slot) => [...records(r.adds.get(`Bundles/synth${slot}.ngb`)!).keys()]))
      for (const id of Object.keys(c.moves)) expect(names.has(set.get(id.toLowerCase())!.anim.toLowerCase())).toBe(true)
      for (const w of imperfect.WALL) if (gameplay[w.key]) for (const id of w.states) expect(set.has(id.toLowerCase())).toBe(true)
      const t = new R.Templates(r.sets.get('Misc/Global.not')!)
      for (const n of ['plr_Synth', 'plr_altSynth']) expect(R.u32(t.prop(n, R.P_ABILITIES))! & bits).toBe(bits)
    })
  }

  it('knows which bases are stunned at low energy', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    expect(R.keys().filter((k) => new R.BaseCharacter(src(), k, t).abilities & 0x8000)).toEqual(imperfect.STUN_BASES)
  })

  it('turns off Megalith\'s low-energy stun', () => {
    const c = tinted('megalith')
    c.aura = { ...c.aura, mode: 'base' }
    const abilities = (n: string) => R.u32(new R.Templates(new Builder(src(), c).build().sets.get('Misc/Global.not')!).prop(n, R.P_ABILITIES))!
    const megalith = abilities('plr_Megalith')
    expect(megalith & 0x8000).toBe(0x8000)
    expect(abilities('plr_Synth')).toBe(megalith)
    c.gameplay = { low_energy_stun: false }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    for (const n of ['plr_Synth', 'plr_altSynth']) expect(abilities(n)).toBe((megalith & ~0x8000) >>> 0)
  })

  it('gives Wolverine Megalith\'s low-energy stun', () => {
    const c = tinted('wolverine')
    c.aura = { ...c.aura, mode: 'base' }
    c.gameplay = { low_energy_stun: true }
    c.moves = { LowEnergyStun: 'megalith' }
    expect(imperfect.problems(c).filter(([l, m]) => l === 'error' || m.includes('never play'))).toEqual([])
    const r = new Builder(src(), c).build()
    const anim = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions().get('lowenergystun')!.anim.toLowerCase()
    expect(moves.SLOTS.some((slot) => records(r.adds.get(`Bundles/synth${slot}.ngb`)!).has(anim))).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const n of ['plr_Synth', 'plr_altSynth']) expect(R.u32(t.prop(n, R.P_ABILITIES))! & 0x8000).toBe(0x8000)
  })

  it('builds two characters with moves in one patch', () => {
    const a = daredevil()
    a.moves = { SuperThrow: 'thing' }
    const b = tinted('wolverine')
    b.aura = { ...b.aura, mode: 'base' }
    b.internalName = 'Other'
    b.displayName = 'OTHER'
    b.moves = { Attack1: 'spiderman', Throw: 'storm' }
    const r = buildBatch(src(), [a, b])
    for (const n of ['Motions/Synth.nms', 'Motions/Other.nms', 'Bundles/synth-t1.ngb', 'Bundles/other-t2.ngb']) expect(r.adds.has(n)).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Other', R.P_MOTIONSET))).toBe('Other.nms')
    expect(r.notes.some((n) => n.startsWith('OTHER: moves: Throw from Storm') && n.includes('female animations on a male skeleton'))).toBe(true)
  })

  const tunedValues = (nvb: Uint8Array, fid: number) => {
    const t = Object.create(tuning.Tuning.prototype) as tuning.Tuning
    t.fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    t.nvb = nvbtool.parseNvb(nvb)
    return Array.from({ length: tuning.SLOTS }, (_, s) => t.value(fid, s))
  }
  const wolverine = () => {
    const c = tinted('wolverine')
    c.aura = { ...c.aura, mode: 'base' }
    c.moves = { SuperThrow: 'daredevil' }
    return c
  }
  const grabEvents = (r: { adds: Map<string, Uint8Array> }) => {
    const anim = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions().get('superthrow')!.anim.toLowerCase()
    return [0, 1, 2].map((i) => records(r.adds.get(`Bundles/synth-t${i}.ngb`)!).get(anim)!.events.filter(([, t]) => [0x48, 0x49, 0x5d, 0x5e].includes(t)))
  }

  it('sets the super throw range in every tuning slot', () => {
    const c = wolverine()
    c.gameplay = { super_throw_range: 10 }
    const r = new Builder(src(), c).build()
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 28)).toEqual(new Array(tuning.SLOTS).fill(10))
    expect(catalog().daredevil.range).toBe(10)
    expect(catalog().thing.range).toBe(3)
  })

  it('reads which damage value each move hits with', () => {
    const cat = catalog()
    expect(cat.thing.damage).toEqual([9, 15, 20, 25, 35])
    expect(cat.wolverine.damage).toEqual([5, 7, 10, 12, 15])
    const labels = (base: string, picked: Record<string, string> = {}) => moves.damageMoves(cat, base, picked).map((ms) => ms.map((m) => m.id))
    const thing = labels('thing')
    expect(thing[0]).toEqual(expect.arrayContaining(['Attack1', 'Attack2', 'LowAttack']))
    expect(thing[1]).not.toContain('Attack1')
    expect(thing[2]).toContain('SuperAttack1')
    expect(thing.flat()).not.toContain('Walk')
    expect(labels('wolverine')[0]).not.toContain('Attack1')
    expect(labels('wolverine', { Attack1: 'thing' })[0]).toContain('Attack1')
    const thrown = ['SuperAttackFar', 'RangedAttack', 'DodgeExitSuperAttack']
    expect(labels('daredevil')[2]).toEqual(expect.arrayContaining(thrown))
    const own = moves.damageMoves(cat, 'daredevil', {}, true).map((ms) => ms.map((m) => m.id))
    expect(own[5].sort()).toEqual([...thrown].sort())
    expect(own.slice(0, 5).flat()).not.toEqual(expect.arrayContaining(['SuperAttackFar']))
  })

  it('doubles Thing\'s first damage value in every tuning slot', () => {
    const c = tinted('thing')
    c.aura = { ...c.aura, mode: 'base' }
    c.gameplay = { attack_damage_1: 18 }
    const r = new Builder(src(), c).build()
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 22)).toEqual([18, 12, 18, 24, 18, 18])
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 23)).toEqual([15, 11, 15, 20, 15, 15])
  })

  it('reads energy costs and the moves they apply to', () => {
    expect(new tuning.Tuning(src(), new R.BaseCharacter(src(), 'thing')).gameplay().energy_super_attack).toBe(15)
    expect(new tuning.Tuning(src(), new R.BaseCharacter(src(), 'wolverine')).gameplay().energy_super_attack).toBe(7)
    const cat = catalog()
    const ids = (base: string, picked: Record<string, string> = {}) => Object.fromEntries(Object.entries(moves.energyMoves(cat, base, picked)).map(([k, ms]) => [k, ms.map((m) => m.id)]))
    const thing = ids('thing')
    expect(thing.energy_super_attack).toContain('SuperAttack1')
    expect(thing.energy_super_throw).toEqual(['SuperThrow'])
    expect(thing.energy_wire_extend).toEqual([])
    expect(ids('spiderman').energy_wire_extend).toEqual(['WireExtend'])
    expect(ids('ironman').energy_super_ranged).toEqual(['SuperRangedAttack'])
    expect(ids('spiderman').energy_super_attack).toContain('WallClimbRangedAttack')
    expect(ids('daredevil').energy_super_ranged).toEqual([])
    expect(new tuning.Tuning(src(), new R.BaseCharacter(src(), 'ironman')).gameplay().energy_super_ranged).toBe(18)
    expect(ids('thing', { WireExtend: 'spiderman' }).energy_wire_extend).toEqual(['WireExtend'])
  })

  it('doubles Thing\'s super attack energy cost in every tuning slot', () => {
    const c = tinted('thing')
    c.aura = { ...c.aura, mode: 'base' }
    c.gameplay = { energy_super_attack: 30 }
    const r = new Builder(src(), c).build()
    const base = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'thing'))
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 31)).toEqual(Array.from({ length: tuning.SLOTS }, (_, s) => base.num(31, s) * 2))
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 36)).toEqual(Array.from({ length: tuning.SLOTS }, (_, s) => base.num(36, s)))
  })

  it('reads the energy recharge rates', () => {
    const g = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'wolverine')).gameplay()
    expect(g.energy_regen).toBe(1.5)
    expect(g.energy_charge).toBe(6)
  })

  it('sets the passive and held-R energy recharge apart', () => {
    const base = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'wolverine'))
    const regen = Array.from({ length: tuning.SLOTS }, (_, s) => base.num(45, s))
    const build = (gameplay: imperfect.Gameplay) => {
      const c = tinted('wolverine')
      c.aura = { ...c.aura, mode: 'base' }
      c.gameplay = gameplay
      return new Builder(src(), c).build()
    }
    const rates = (r: { adds: Map<string, Uint8Array> }) => {
      const nvb = r.adds.get('Misc/PLAYER_Synth.nvb')!
      const passive = tunedValues(nvb, 45) as number[], extra = tunedValues(nvb, 245) as number[]
      return [passive, passive.map((p, s) => Math.fround(Math.fround(4 * p) + extra[s]))]
    }

    const off = build({ energy_regen: 0 })
    expect(rates(off)).toEqual([new Array(tuning.SLOTS).fill(0), regen.map((v) => v * 4)])
    expect(equal(off.dol!, D.chargeRate(build({}).dol!))).toBe(true)
    expect(rates(build({ energy_charge: 0 }))).toEqual([regen, new Array(tuning.SLOTS).fill(0)])
    const [passive, held] = rates(build({ energy_regen: 3, energy_charge: 20 }))
    passive.forEach((v, s) => expect(v).toBeCloseTo(regen[s] * 2, 5))
    held.forEach((v, s) => expect(v).toBeCloseTo((regen[s] * 20) / 1.5, 4))
  })

  it('plays Daredevil\'s cable when Wolverine takes his super throw', () => {
    const c = wolverine()
    c.moveEffects = { SuperThrow: 'theirs' }
    const r = new Builder(src(), c).build()
    const events = grabEvents(r)
    const ks = new Set(events.flat().map(([, , k]) => k))
    expect(ks.size).toBe(1)
    const [k] = ks
    expect(k).not.toBe(2)
    const wolvKs = moves.baseEffects(src(), new R.BaseCharacter(src(), 'wolverine'))
    expect(wolvKs).not.toContain(k)
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, EFFECT_FIELDS[k - 1])).toEqual(['ddNeckAtt', 'ddNeckAtt', 'ddNeckAtt', 'ddNeckAtt', 'ddNeckAtt', 'altDdNeckAtt'])
    // the victim's side plays on the opponent and is left alone
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const dd = records(src().entry('Bundles/daredevil-t0.ngb'))
    const victim = set.get('superthrowvictim')!.anim.toLowerCase()
    expect(ngbtool.sameMotion(records(r.adds.get('Bundles/synth-t0.ngb')!).get(victim)!, dd.get(victim)!)).toBe(true)
    expect(set.get('superthrow')!.opts).toContain('-1.00')
    expect(r.notes.some((n) => n.includes("Super throw") && n.includes("1 of Daredevil's effects"))).toBe(true)
    expect(r.sets.has('Misc/game.nfx')).toBe(false)
  })

  it('recolors a taken line per costume', () => {
    const c = wolverine()
    c.moveEffects = { SuperThrow: 'theirs' }
    c.moveLines = { color: '#00FF00', alt_color: null }
    const r = new Builder(src(), c).build()
    const [k] = new Set(grabEvents(r).flat().map(([, , k]) => k))
    const names = tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, EFFECT_FIELDS[k - 1]) as string[]
    expect(names[5]).toBe('altDdNeckAtt')
    expect(names[0]).not.toBe('ddNeckAtt')
    expect(new Set(names.slice(0, 5)).size).toBe(1)
    const fx = new effects.Effects(r.sets.get('Misc/game.nfx')!)
    expect(fx.isLine(names[0])).toBe(true)
    const lines = fx.by.get(names[0].toLowerCase())!.lines
    expect(lines).toContain('startcol (255,0,255,0)')
    expect(lines).toContain('endcol (255,0,255,0)')
    expect(fx.used() - new effects.Effects(src().entry('Misc/game.nfx')).used()).toBeLessThan(256)
  })

  it('plays none of a taken move\'s effects when told to', () => {
    const c = wolverine()
    c.moveEffects = { SuperThrow: 'none' }
    const r = new Builder(src(), c).build()
    expect(grabEvents(r).flat()).toEqual([])
    expect(r.notes.some((n) => n.includes('Super throw') && n.includes('no effects'))).toBe(true)
  })

  const descending = (base: string, from: string, how?: imperfect.MoveEffect) => {
    const c = tinted(base)
    c.aura = { ...c.aura, mode: 'base' }
    c.moves = { SuperJumpAttackDesc: from }
    if (how) c.moveEffects = { SuperJumpAttackDesc: how }
    const r = new Builder(src(), c).build()
    const anim = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions().get('superjumpattackdesc')!.anim.toLowerCase()
    return { r, anim, rec: records(r.adds.get('Bundles/synth.ngb')!).get(anim)! }
  }
  const picks = (rec: ngbtool.Record) => rec.events.filter(([, t]) => t === 0x4e)

  it('launches Spider-Man\'s web from Human Torch\'s super jump attack', () => {
    const { r, anim, rec } = descending('spiderman', 'humantorch')
    expect(anim).not.toBe('torch_superpeakattack.nad')
    expect(picks(rec).map(([, , k]) => k)).toEqual([1])
    expect(r.notes.some((n) => n.includes('Super jump attack descending') && n.includes("launches Spider-Man's projectile"))).toBe(true)
    expect(picks(descending('spiderman', 'humantorch', 'none').rec).map(([, , k]) => k)).toEqual([1])
  })

  it('launches the base\'s own projectile from a taken move', () => {
    expect(picks(descending('ironman', 'humantorch').rec).map(([, , k]) => k)).toEqual([1])
    expect(picks(descending('humantorch', 'ironman').rec)).toEqual([[0, 0x4e, 3, 0]])
  })

  it('leaves a taken projectile alone on a base without any', () => {
    const { r, anim, rec } = descending('wolverine', 'humantorch')
    expect(anim).toBe('torch_superpeakattack.nad')
    const torch = records(src().entry('Bundles/torch.ngb')).get(anim)!
    expect(rec.events).toEqual(torch.events)
    expect(r.notes.some((n) => n.includes("Human Torch's projectile has nothing to launch on Wolverine"))).toBe(true)
  })

  it('gives taken moves\' effects free slots before cutscenes\'', () => {
    const jo = new R.BaseCharacter(src(), 'johnnyohm')
    const moved = moves.movedEffects(src(), jo, { SuperThrow: 'spiderman' })
    expect(moved.moves.get('SuperThrow')!.ks.sort()).toEqual([4, 5, 6])
    const fresh = () => new effects.Effects(src().entry('Misc/game.nfx'))
    const lines = { color: null, alt_color: null }
    const alone = moves.effectFit(src(), jo, {}, lines, [], fresh, moved).SuperThrow
    expect(alone.chosen).toBe(false)
    expect(alone.line).toBe(true)
    expect(alone.total).toBe(3)
    expect(alone.fit).toBe(2)
    const c = { moves: { SuperThrow: 'spiderman' }, moveEffects: { SuperThrow: 'theirs' as const }, moveLines: lines,
      cutscenes: { finisher: 'ironman', audio: {}, effects: { finisher: 'theirs' as const }, animation: {} } }
    const cuts = cutscenes.effectFit(src(), 'johnnyohm', c)
    expect(cuts.finisher!.fit).toBe(0)
    expect(cutscenes.effectFit(src(), 'johnnyohm', { ...c, moveEffects: {} }).finisher!.fit).toBeGreaterThan(0)
  })

  it('refuses a move from the base itself', () => {
    const c = daredevil()
    c.moves = { SuperThrow: 'daredevil' }
    expect(() => new Builder(src(), c).build()).toThrow(LabError)
  })
})

describe.skipIf(!ISO)('stretching limbs', () => {
  const src = () => gameSource()
  const records = (data: Uint8Array) => new Map(ngbtool.parse(data).map((r) => [r.name.toLowerCase(), r]))
  const spiderman = () => {
    const c = tinted('spiderman')
    c.aura = { ...c.aura, mode: 'base' }
    return c
  }
  const model = () => ngmtool.read(new R.BaseCharacter(src(), 'spiderman').bundleFiles()[0])[1][0]
  const at = (m: ngmtool.Model, rec: ngbtool.Record, t: number) => ngbtool.pose(m, rec, t)[26][1]
  const body = (rec: ngbtool.Record) => ({ ...rec, tracks: rec.tracks.filter(([b, ch]) => !(b === 26 && ch === 1)) })
  const tunedValues = (nvb: Uint8Array, fid: number) => {
    const t = Object.create(tuning.Tuning.prototype) as tuning.Tuning
    t.fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    t.nvb = nvbtool.parseNvb(nvb)
    return Array.from({ length: tuning.SLOTS }, (_, s) => t.value(fid, s))
  }

  it('finds what each base\'s moves can stretch', () => {
    const cat = moves.catalog(src(), new effects.Effects(src().entry('Misc/game.nfx')))
    const sp = cat.spiderman.reach!
    expect(sp['spiderman_superattack1far.nad']).toEqual({ kind: 'hit', limbs: ['right_arm'] })
    expect(sp['spiderman_attack1.nad']).toEqual({ kind: 'hit', limbs: ['right_arm'] })
    expect(sp['spiderman_wireswing.nad']).toEqual({ kind: 'wire', limbs: ['right_arm'] })
    expect(sp['spiderman_superthrow.nad']).toEqual({ kind: 'line', limbs: ['right_arm'] })
    expect(cat.venom.reach!['venom_superthrow.nad']).toEqual({ kind: 'line', limbs: ['right_arm', 'left_arm'] })
    expect(cat.daredevil.reach!['daredevil_superthrow.nad'].kind).toBe('line')
    expect(cat.daredevil.reach!['daredevil_wireswing.nad'].kind).toBe('wire')
  })

  it('builds a stretched punch, far attack, grab and swing', () => {
    const c = spiderman()
    c.moveReach = { SuperAttackFar: { distance: 12 }, SuperThrow: { distance: 6 }, WireSwing: {}, Attack1: { distance: 1.5 }, WirePull: { distance: 4 } }
    const r = new Builder(src(), c).build()
    const m = model()
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const own = nmstool.parse(src().entry('Motions/SpiderMan.nms')).motions()
    const main = records(r.adds.get('Bundles/synth.ngb')!)
    for (const s of ['superattackfar', 'superthrow', 'wireswing', 'attack1']) expect(set.get(s)!.anim).not.toBe(own.get(s)!.anim)
    const far = main.get(set.get('superattackfar')!.anim.toLowerCase())!
    const turn = far.events.find(([, t]) => t === 0x53)![0]
    expect(far.events.find(([, t]) => t === basemoves.MIRROR_EVENT)![0]).toBe(turn)
    expect(at(m, far, turn)[1] - at(m, body(far), turn)[1]).toBeCloseTo(12, 1)
    expect(far.events.filter(([, t]) => t === 0x56 || t === 0x57).map(([f, t]) => [f, t])).toEqual([[far.events.find(([, t]) => t === 0x39)![0], 0x56], [far.events.find(([, t]) => t === 0x3a)![0], 0x57]])
    for (const costume of ['', '_alt']) {
      const [, built] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
      expect(built[0].attachments.filter(([, k]) => k === 43 || k === 44).map(([n, k]) => [n, k])).toEqual([[26, 43], [26, 44]])
    }
    const pull = main.get(set.get('wirepull')!.anim.toLowerCase())!
    expect(at(m, pull, pull.events.find(([, t]) => t === 0x05)![0])[1]).toBeCloseTo(4, 1)
    const punch = main.get(set.get('attack1')!.anim.toLowerCase())!
    const hit = (type: number) => punch.events.find(([, t]) => t === type)![0]
    const peak = (hit(0x39) + hit(0x3a)) / 2
    expect(at(m, punch, peak)[1] - at(m, body(punch), peak)[1]).toBeCloseTo(1.5, 1)
    const swing = main.get(set.get('wireswing')!.anim.toLowerCase())!
    const on = swing.events.find(([, t]) => t === 0x23)![0], off = swing.events.find(([, t]) => t === 0x24)![0]
    for (const t of [Math.ceil(on) + 6, Math.round((on + off) / 2), off]) {
      const p = at(m, swing, t)
      expect(Math.hypot(p[0] - reach.WIRE_END[0], p[1] - reach.WIRE_END[1], p[2] - reach.WIRE_END[2])).toBeLessThan(0.01)
    }
    for (let i = 0; i < 3; i++) {
      const slot = records(r.adds.get(`Bundles/synth-t${i}.ngb`)!)
      const grab = slot.get(set.get('superthrow')!.anim.toLowerCase())!
      const victim = set.get(['superthrowvictim', 'superthrowvictimfemale', 'superthrowvictimbrute'][i])!.anim.toLowerCase()
      expect(ngbtool.sameMotion(slot.get(victim)!, records(src().entry(`Bundles/spiderman-t${i}.ngb`)).get(victim)!)).toBe(true)
      const body = ['male', 'female', 'brute'][i]
      const stand = ngmtool.read(new R.BaseCharacter(src(), R.keys().find((k) => new R.BaseCharacter(src(), k).body === body)!).bundleFiles()[0])[1][0]
      const v = slot.get(victim)!, held = grab.events.find(([, t]) => t === 0x49)![0] / 2
      const [n, , , mat] = stand.attachments.find(([, k, idx]) => k === 19 && idx === 2)!
      const [rot, pos] = ngbtool.pose(stand, v, Math.round(held))[n]
      const q = [0, 1, 2].map((c) => pos[c] + rot[c][0] * mat[12] + rot[c][1] * mat[13] + rot[c][2] * mat[14])
      const hand = at(m, grab, Math.round(held))
      expect(Math.hypot(hand[0] + q[0], hand[1] - (6 - q[1]), hand[2] - q[2])).toBeLessThan(0.01)
    }
    expect(set.get('superthrowvictim')).toEqual(own.get('superthrowvictim'))
    for (const st of ['superthrow', 'superthrowfemale', 'superthrowbrute']) expect(set.get(st)!.opts.join(' ')).toBe(own.get(st)!.opts.join(' ').replace('dist -1.00', 'dist 6.00'))
    expect(set.get('wirepull')!.opts).toEqual(own.get('wirepull')!.opts)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const n of ['plr_Synth', 'plr_altSynth']) expect(R.u32(t.prop(n, R.P_ABILITIES))! & reach.RETURN_ABILITY).toBe(reach.RETURN_ABILITY)
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, tuning.AIM_RANGE)).toEqual(new Array(tuning.SLOTS).fill(12))
    expect(() => D.mirrorSkip(r.dol!)).toThrow(LabError)
    expect(r.notes).toContain('reach: Super attack far (R + attack at range) stretches the right arm 12 m ahead, coming back from where it hits')
    expect(r.notes).toContain("reach: Wire swing stretches the right arm out to the wire's end")
    expect(r.notes).toContain('reach: Wire pull stretches the right arm 4 m out to the object')
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, tuning.PICKUP_RANGE)).toEqual(new Array(tuning.SLOTS).fill(4))
  })

  it('gives Daredevil a range grab that stretches', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    c.baseMoves = { range_grab: true }
    c.moves = { WirePull: 'spiderman' }
    c.moveReach = { WirePull: { distance: 12 } }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    const r = new Builder(src(), c).build()
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const n of ['plr_Synth', 'plr_altSynth']) expect(R.u32(t.prop(n, R.P_ABILITIES))! & 0x2000).toBe(0x2000)
    expect(R.u32(t.prop('plr_Daredevil', R.P_ABILITIES))! & 0x2000).toBe(0)
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const main = records(r.adds.get('Bundles/synth.ngb')!)
    const pull = main.get(set.get('wirepull')!.anim.toLowerCase())!
    expect(at(model(), pull, pull.events.find(([, t]) => t === 0x05)![0])[1]).toBeCloseTo(12, 1)
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, tuning.PICKUP_RANGE)).toEqual(new Array(tuning.SLOTS).fill(12))
    expect(r.notes).toContain('pickup: props can be grabbed from 12 m away')
  })

  it('leaves Daredevil without the range grab alone', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    const t = new R.Templates(new Builder(src(), c).build().sets.get('Misc/Global.not')!)
    expect(R.u32(t.prop('plr_Synth', R.P_ABILITIES))! & 0x2000).toBe(0)
  })

  it('knows which bases have the ranged pickup', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    expect(R.keys().filter((k) => new R.BaseCharacter(src(), k, t).abilities & 0x2000)).toEqual(imperfect.PICKUP_BASES)
  })

  it('turns off Spider-Man\'s range grab', () => {
    const c = tinted('spiderman')
    c.aura = { ...c.aura, mode: 'base' }
    const build = () => new Builder(src(), c).build()
    const abilities = (r: ReturnType<typeof build>, n: string) => R.u32(new R.Templates(r.sets.get('Misc/Global.not')!).prop(n, R.P_ABILITIES))!
    const spidey = abilities(build(), 'plr_SpiderMan')
    expect(spidey & 0x2000).toBe(0x2000)
    c.gameplay = { range_grab: false }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    const r = build()
    for (const n of ['plr_Synth', 'plr_altSynth']) expect(abilities(r, n)).toBe((spidey & ~0x2000) >>> 0)
    expect(abilities(r, 'plr_SpiderMan')).toBe(spidey)
    c.moveReach = { WirePull: { distance: 4 } }
    expect(build().adds.has('Misc/PLAYER_Synth.nvb')).toBe(false)
  })

  it('turns off a flyer\'s flight and keeps it by default', () => {
    const c = tinted('storm')
    c.aura = { ...c.aura, mode: 'base' }
    const abilities = (c: imperfect.Character, n: string) => R.u32(new R.Templates(new Builder(src(), c).build().sets.get('Misc/Global.not')!).prop(n, R.P_ABILITIES))!
    const storm = abilities(c, 'plr_Storm')
    expect(storm & 0x100001).toBe(0x100001)
    expect(abilities(c, 'plr_Synth')).toBe(storm)
    c.gameplay = { flight: false }
    for (const n of ['plr_Synth', 'plr_altSynth']) expect(abilities(c, n)).toBe((storm & ~0x100001) >>> 0)
    expect(abilities(c, 'plr_Storm')).toBe(storm)
  })

  it('moves Daredevil\'s long hit segment from the club to a stretched arm', () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    c.moveReach = { SuperAttackFar: { distance: 20 } }
    const r = new Builder(src(), c).build()
    const [, built] = ngmtool.read(r.adds.get('Bundles/synth.ngm')!)
    expect(built[0].attachments.filter(([, k]) => k === 43 || k === 44).map(([n, k]) => [n, k])).toEqual([[26, 43], [26, 44]])
    expect(r.notes).toContain("reach: Daredevil's long hit segment (attachments 43 and 44) moves to the right arm, so moves that hit with it hit from there")
    c.baseMoves = { throw_reach: 30 }
    c.moveReach = { SuperRiseAttack: { distance: 5 } }
    expect(imperfect.problems(c).some(([l, msg]) => l === 'error' && msg.includes('super rise attack'))).toBe(true)
  })

  it('leaves the far attack alone without a stretch on it', () => {
    const c = spiderman()
    c.moveReach = { Attack1: { distance: 2 } }
    const r = new Builder(src(), c).build()
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.u32(t.prop('plr_Synth', R.P_ABILITIES))! & reach.RETURN_ABILITY).toBe(0)
    expect(() => D.mirrorSkip(r.dol!)).not.toThrow()
    expect(r.adds.has('Misc/PLAYER_Synth.nvb')).toBe(false)
  })

  it('recolors and hides a stretched move\'s own lines per costume', () => {
    const c = spiderman()
    c.moveReach = { WireSwing: {}, SuperThrow: { distance: 6 } }
    c.moveLines = { color: '#00000000', alt_color: '#FF000080' }
    const r = new Builder(src(), c).build()
    const nvb = r.adds.get('Misc/PLAYER_Synth.nvb')!
    const fx = new effects.Effects(r.sets.get('Misc/game.nfx')!)
    const tun = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'spiderman'))
    for (const fid of [reach.WIRE_FIELD, EFFECT_FIELDS[3], EFFECT_FIELDS[4]]) {
      const names = tunedValues(nvb, fid) as string[]
      expect(names.every((n, s) => n !== tun.value(fid, s))).toBe(true)
      expect(names.every((n) => fx.isLine(n))).toBe(true)
      expect(fx.tree([names[0]]).some((b) => b.lines.includes('startcol (0,0,0,0)'))).toBe(true)
      expect(fx.tree([names[5]]).some((b) => b.lines.some((l) => /^startcol \([\d.]+,255,0,0\)$/.test(l)))).toBe(true)
    }
  })

  it('refuses a stretch the move can\'t do', () => {
    const build = (moveReach: Record<string, imperfect.MoveReach>) => () => new Builder(src(), { ...spiderman(), moveReach }).build()
    expect(build({ WireSwing: { distance: 5 } })).toThrow(/takes no distance/)
    expect(build({ SuperAttackFar: {} })).toThrow(/needs a distance/)
    expect(build({ SuperAttackFar: { distance: 5, limbs: ['left_leg'] } })).toThrow(/doesn't use the left leg/)
    expect(build({ PowerOn: { distance: 5 } })).toThrow(LabError)
  })

  it('builds a jump with longer legs in the jump\'s own time', () => {
    const c = spiderman()
    c.moveReach = { Jump: { distance: 1 }, SuperJump: { distance: 0.5, limbs: ['left_leg'], hold: true } }
    const r = new Builder(src(), c).build()
    const m = model()
    const foot = Skeleton.ofBase(new R.BaseCharacter(src(), 'spiderman')).node('R.foot')!
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const own = nmstool.parse(src().entry('Motions/SpiderMan.nms')).motions()
    const main = records(r.adds.get('Bundles/synth.ngb')!)
    const base = records(src().entry('Bundles/spiderman.ngb'))
    for (const s of ['jump', 'superjump']) expect(set.get(s)!.anim).not.toBe(own.get(s)!.anim)
    expect(set.get('runjump')!.anim).toBe(own.get('runjump')!.anim)
    const was = base.get(own.get('jump')!.anim.toLowerCase())!
    const now = main.get(set.get('jump')!.anim.toLowerCase())!
    const grown = (t: number) => Math.hypot(...ngbtool.pose(m, now, t)[foot][1].map((v, i) => v - ngbtool.pose(m, was, t)[foot][1][i]))
    expect(now.length).toBe(was.length)
    expect(grown(was.length / 2)).toBeCloseTo(1, 1)
    expect(grown(0)).toBeLessThan(0.01)
    expect(r.notes.some((n) => n.includes('Jump stretches the right leg and left leg 1 m longer'))).toBe(true)
  })
})

describe.skipIf(!ISO)('size', () => {
  const src = () => gameSource()
  const records = (data: Uint8Array) => new Map(ngbtool.parse(data).map((r) => [r.name.toLowerCase(), r]))
  const thing = (size: number) => {
    const c = tinted('thing')
    c.aura = { ...c.aura, mode: 'base' }
    c.size = size
    return c
  }

  it('grows the skeleton, animations, strides and collision body', () => {
    const r = new Builder(src(), thing(1.3)).build()
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.f32(t.prop('act_Synth', R.P_RADIUS))).toBeCloseTo(0.715, 5)
    expect(R.f32(t.prop('plr_altSynth', R.P_HEIGHT))).toBeCloseTo(2.834, 5)
    expect(R.f32(t.prop('act_Thing', R.P_HEIGHT))).toBeCloseTo(2.18, 5)

    const base = new R.BaseCharacter(src(), 'thing')
    const [, theirs] = ngmtool.read(base.bundleFiles()[0])
    const [, mine] = ngmtool.read(r.adds.get('Bundles/synth.ngm')!)
    for (const i of [0, 1]) mine[i].nodes.forEach(([, b], n) => b.slice(0, 3).forEach((x, k) => expect(x).toBeCloseTo(theirs[i].nodes[n][1][k] * 1.3, 4)))

    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const was = nmstool.parse(src().entry('Motions/Thing.nms')).motions()
    const walk = set.get('walk')!
    expect(walk.opts).toContain('2.522')
    const old = records(src().entry('Bundles/thing.ngb')), now = records(r.adds.get('Bundles/synth.ngb')!)
    expect(old.has(walk.anim.toLowerCase())).toBe(false)
    const a = old.get(was.get('walk')!.anim.toLowerCase())!, b = now.get(walk.anim.toLowerCase())!
    const posed = ngbtool.pose(theirs[0], a, 10), grown = ngbtool.pose(mine[0], b, 10)
    grown.forEach(([, p], n) => p.forEach((x, k) => expect(x).toBeCloseTo(posed[n][1][k] * 1.3, 2)))
    const dive = now.get(set.get('jumpattackpeak')!.anim.toLowerCase())!, base0 = old.get(was.get('jumpattackpeak')!.anim.toLowerCase())!
    const root = (rec: ngbtool.Record) => rec.tracks.find(([b, ch]) => (b & 0xffff) === 0 && ch === 1)
    expect(root(dive)).toEqual(root(base0))
    expect(dive.tracks).not.toEqual(base0.tracks)

    const brute = nmstool.parse(src().entry('Motions/Brute.nms')).motions()
    for (const [state, m] of set) {
      if (/victim/i.test(state)) expect(m.anim.toLowerCase()).toBe((was.get(state) ?? brute.get(state))!.anim.toLowerCase())
      else expect(old.has(m.anim.toLowerCase()), state).toBe(false)
    }
    for (const state of brute.keys()) expect(set.has(state) || !old.has(brute.get(state)!.anim.toLowerCase()), state).toBe(true)
  })

  it('leaves a character of the base\'s size on the base\'s animations', () => {
    const r = new Builder(src(), thing(1)).build()
    expect(r.adds.has('Motions/Synth.nms')).toBe(false)
    expect(R.f32(new R.Templates(r.sets.get('Misc/Global.not')!).prop('act_Synth', R.P_RADIUS))).toBeCloseTo(0.55, 5)
  })
})

describe.skipIf(!ISO)('gun', () => {
  const src = () => gameSource()
  const tunedValues = (nvb: Uint8Array, fid: number) => {
    const t = Object.create(tuning.Tuning.prototype) as tuning.Tuning
    t.fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    t.nvb = nvbtool.parseNvb(nvb)
    return Array.from({ length: tuning.SLOTS }, (_, s) => t.value(fid, s))
  }
  const armed = (base: string, side: imperfect.GunSide = 'right', internal = 'Synth') => {
    const c = { ...tinted(base), internalName: internal, displayName: internal.toUpperCase() }
    c.aura = { ...c.aura, mode: 'base' }
    c.zButton = { stealth: null, costume: null, stats: null, size: null, bullet: null, laser: null, impersonate: null, requires: {}, gun: { ...imperfect.defaultGun(side), damage: 25, bullets: 3, energy: 7.5, automatic: true } }
    c.materials[0].bind = imperfect.gunBone(base, side)
    return c
  }
  const motions = (r: { adds: Map<string, Uint8Array> }, internal = 'Synth') => nmstool.parse(r.adds.get(`Motions/${internal}.nms`)!).motions()
  const records = (r: { adds: Map<string, Uint8Array> }, stem = 'synth') => new Map(ngbtool.parse(r.adds.get(`Bundles/${stem}.ngb`)!).map((x) => [x.name.toLowerCase(), x]))

  it('puts the gun and the swap on the bones the manifest names, on every base', () => {
    for (const key of R.keys()) {
      const base = new R.BaseCharacter(src(), key)
      const model = ngmtool.read(base.bundleFiles()[0])[1][0]
      for (const side of imperfect.GUN_SIDES) {
        expect(gun.bone(model, base.body, side === 'right' ? 'R' : 'L')[0], `${key} ${side}`).toBe(imperfect.gunBone(key, side))
        expect(gun.swapBone(model, base.body, side === 'right' ? 'R' : 'L'), `${key} ${side} swap`).toBe(imperfect.swapBone(key, side))
      }
    }
  })

  it('leaves tuning field 176 and motions action1 to action4 to the gun', () => {
    for (const key of R.keys()) {
      const base = new R.BaseCharacter(src(), key)
      expect(new tuning.Tuning(src(), base).value(gun.FIELD, 0) ?? '').toBe('')
      const set = nmstool.parse(src().entry(`Motions/${moves.motionSetOf(base)}`)).motions()
      for (const state of Object.values(D.GUN_MOTIONS)) expect(set.has(state)).toBe(false)
    }
  })

  it("takes Elektra's two-shot throws", () => {
    const elektra = new R.BaseCharacter(src(), gun.DONOR)
    const set = nmstool.parse(src().entry(`Motions/${moves.motionSetOf(elektra)}`)).motions()
    const recs = new Map(ngbtool.parse(src().entry(`Bundles/${moves.stemOf(moves.motionSetOf(elektra))}.ngb`)).map((r) => [r.name.toLowerCase(), r]))
    for (const state of [gun.DONOR_GROUND, gun.DONOR_AIR]) expect(gun.shotsOf(recs.get(set.get(state)!.anim.toLowerCase())!).length).toBe(2)
  })

  it('builds Wolverine with a gun Z draws, its shots under their own motions and the super attacks left alone', () => {
    const r = new Builder(src(), armed('wolverine')).build()
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, gun.FIELD)).toEqual(new Array(tuning.SLOTS).fill('proj_SynthGun'))
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    const bullet = T.get('proj_SynthGun')
    expect(R.u32(bullet.get(0x4b))).toBe(25)
    expect(bullet.get(R.P_MODEL)).toBeNull()
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
    expect(by.get(R.text(bullet.get(R.P_EFFECT1))!)!.lines[0]).toMatch(/^controller /)
    const set = motions(r), recs = records(r)
    const wolverine = nmstool.parse(src().entry(`Motions/${moves.motionSetOf(new R.BaseCharacter(src(), 'wolverine'))}`)).motions()
    expect(set.get('superattack1')!.anim.toLowerCase()).not.toMatch(/^gun_/)
    expect(set.get('superattack1')!.anim.split('_')[0]).toBe(wolverine.get('superattack1')!.anim.split('_')[0])
    for (const [state, name] of [[D.GUN_MOTIONS.ground, /^Gun_Shot_[0-9a-f_]+\.nad$/], [D.GUN_MOTIONS.air, /^Gun_AirShot_[0-9a-f_]+\.nad$/],
      [D.GUN_MOTIONS.run, /^Gun_RunShot_[0-9a-f_]+\.nad$/], [D.GUN_MOTIONS.walk, /^Gun_WalkShot_[0-9a-f_]+\.nad$/]] as const) {
      const rec = recs.get(set.get(state)!.anim.toLowerCase())!
      expect(rec.name).toMatch(name)
      expect(gun.shotsOf(rec).length).toBe(3)
      expect(rec.events.filter(([, t, p]) => t === 0x4e && p === D.GUN_PICK_VALUE).map(([f]) => f)).toEqual([1])
      expect(rec.events.some(([, t, p]) => t === 0x4f && p === gun.MUZZLE_INDEX)).toBe(true)
    }
    for (const state of [D.GUN_MOTIONS.ground, D.GUN_MOTIONS.run, D.GUN_MOTIONS.walk]) expect(set.get(state)!.opts).toEqual(['noloop', 'mix', 'nofadeout'])
    const base = new R.BaseCharacter(src(), 'wolverine')
    const arm = holster.armOf(new Skeleton(ngmtool.read(base.bundleFiles()[0])[1][0], base.body), 'R')
    for (const state of [D.GUN_MOTIONS.ground, D.GUN_MOTIONS.run, D.GUN_MOTIONS.walk]) {
      expect(new Set(recs.get(set.get(state)!.anim.toLowerCase())!.tracks.map(([b]) => b & 0xffff))).toEqual(new Set([arm.upper, arm.fore, arm.hand, 39]))
    }
    expect(set.get(D.GUN_MOTIONS.air)!.opts).toEqual(['noloop', 'endpause'])
    expect(recs.get(set.get('stand')!.anim.toLowerCase())!.tracks.some(([b]) => b === 39)).toBe(true)
    const [, models] = ngmtool.read(r.adds.get('Bundles/synth.ngm')!)
    expect(models[0].attachments.filter(([n, k, i]) => n === 39 && k === gun.MUZZLE_KIND && i === gun.MUZZLE_INDEX).length).toBe(1)
    expect(r.gun).toMatchObject({ internal: 'Synth', bone: 39, hand: 27, anchor: 65, swap: null, automatic: true, energy: 7.5, upper: 23, fore: 25, draw: D.GUN_DRAW })
    expect(r.gun!.k.length).toBe(12)
    const [upper, fore, hand] = r.gun!.moves
    expect([upper[0], fore[0], hand[0]]).toEqual([23, 25, 27])
    expect(hand.every((b) => fore.includes(b)) && fore.every((b) => upper.includes(b))).toBe(true)
    expect(upper).not.toContain(39)
    expect(r.gun!.nodes).toBe(Math.max(65, ...upper) + 1)
    for (const state of Object.values(D.GUN_MOTIONS)) {
      const rec = recs.get(set.get(state)!.anim.toLowerCase())!
      const shots = gun.shotsOf(rec)
      expect(rec.events.filter(([f, t, p]) => t === gun.SOUND && (p === gun.THROW_SOUND || shots.includes(f)))).toEqual([])
    }
    expect(D.arenaLo(r.dol!)).toBeGreaterThan(D.arenaLo(src().dol))
    expect(r.adds.has('Cutscenes/synth_intro1.cut')).toBe(true)
    for (const text of ['gun: each bullet launches proj_SynthGun', 'a burst of 3 bullets from the right hand', 'holstered at the right hip']) expect(r.notes.some((n) => n.includes(text)), text).toBe(true)
  })

  it('holsters the gun on the back and swaps what the gun hand holds into its place', () => {
    const c = armed('wolverine', 'left')
    c.materials[0].bind = null
    for (const [bone, joint] of [...c.mapping]) if (['mixamorig:LeftHandIndex3', 'mixamorig:LeftHandRing3'].includes(joint)) c.mapping.delete(bone)
    c.mapping.set(59, 'mixamorig:LeftHandIndex3')
    c.mapping.set(imperfect.swapBone('wolverine', 'left'), 'mixamorig:LeftHandRing3')
    const holster = imperfect.gunHolster('left', 'back_left')
    c.zButton!.gun = { ...c.zButton!.gun!, holster, swap: { position: holster.position, rotation: [-90, -45, 0] } }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    const r = new Builder(src(), c).build()
    expect(r.gun).toMatchObject({ bone: 59, hand: 47, anchor: 3 })
    expect(r.gun!.swap!.bone).toBe(72)
    expect(r.gun!.swap!.k.length).toBe(12)
    expect(r.gun!.nodes).toBeGreaterThan(72)
    expect(r.gun!.moves[2]).toContain(72)
    expect(r.gun!.moves[2]).not.toContain(59)
    const [, models] = ngmtool.read(r.adds.get('Bundles/synth.ngm')!)
    expect(models[0].nodes.length).toBe(73)
    expect(models[0].nodes[72][2]).toBe(47)
    const set = motions(r), recs = records(r)
    const stand = recs.get(set.get('stand')!.anim.toLowerCase())!
    expect(stand.tracks.some(([b]) => b === 59)).toBe(true)
    expect(stand.tracks.some(([b]) => b === 72)).toBe(false)
    expect(r.notes.some((n) => n.includes('holstered on the back over the left shoulder') && n.includes('game bone 72'))).toBe(true)
  })

  it('plays the sound event picked for the gun, or none', () => {
    for (const [sound, want] of [[[116, 3], [116, 3]], [undefined, null]] as [gun.Sound | undefined, [number, number] | null][]) {
      const c = armed('wolverine')
      c.zButton!.gun!.sound = sound
      const r = new Builder(src(), c).build()
      const set = motions(r), recs = records(r)
      for (const state of Object.values(D.GUN_MOTIONS)) {
        const rec = recs.get(set.get(state)!.anim.toLowerCase())!
        const at = new Set(gun.shotsOf(rec))
        const played = rec.events.filter(([f, t]) => t === gun.SOUND && at.has(f)).map(([, , p, v]) => [p, v])
        expect(played).toEqual(want ? gun.shotsOf(rec).map(() => want) : [])
      }
      expect(r.notes.some((n) => n.includes(want ? 'with sound event 116:3' : 'silently'))).toBe(true)
    }
  })

  it('lists the sound events each base plays, by the moves that play them', () => {
    const cat = moves.catalog(src(), new effects.Effects(src().entry('Misc/game.nfx')))
    expect(Object.keys(cat.wolverine.sounds!)).toEqual(expect.arrayContaining(['21:2', '116:3']))
    const choices = moves.soundChoices(cat, 'wolverine')
    expect(choices.find(([e, v]) => e === 116 && v === 3)![2]).toContain('Super attack 1')
    expect(choices.map(([e, v]) => e * 1e6 + v)).toEqual(choices.map(([e, v]) => e * 1e6 + v).sort((a, b) => a - b))
  })

  it("gives the gun a bone of its own on the hand where the base's prop bone is taken or missing", () => {
    for (const [base, side, bone, hand] of [['paradox', 'left', 81, 42], ['daredevil', 'right', 88, 27], ['thing', 'right', 66, 27]] as const) {
      const r = new Builder(src(), armed(base, side)).build()
      for (const costume of ['', '_alt']) {
        const [, models] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
        expect(models[0].nodes.length).toBe(bone + 1)
        expect(models[0].nodes[bone][2]).toBe(hand)
        expect(models[0].attachments.some(([n, k, i]) => n === bone && k === gun.MUZZLE_KIND && i === gun.MUZZLE_INDEX)).toBe(true)
      }
      expect(r.gun).toMatchObject({ bone, hand })
    }
  })

  it("keeps a projectile base's own projectiles", () => {
    const r = new Builder(src(), armed('johnnyohm')).build()
    const ohm = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 90)).toEqual(Array.from({ length: tuning.SLOTS }, (_, s) => ohm.value(90, s)))
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, gun.FIELD)[0]).toBe('proj_SynthGun')
  })

  it("puts every character's gun in one table", () => {
    const r = buildBatch(src(), [armed('wolverine'), armed('storm', 'left', 'Other')], () => {})
    const slot = [2, 3, 4, 5, 6].find((i) => u32be(r.dol!, 0x90 + 4 * i))!
    const table = u32be(r.dol!, 4 * slot) + D.GUN_DATA
    expect(u32be(r.dol!, table + D.GUN_COUNT)).toBe(2)
    expect(latin1(r.dol!, table + D.GUN_ENTRIES + D.GUN_ENTRY_SIZE + 0xa0, table + D.GUN_ENTRIES + D.GUN_ENTRY_SIZE + 0xa9)).toBe('plr_other')
  })
})

describe.skipIf(!ISO)('projectile swap', () => {
  const src = () => gameSource()
  const tunedValues = (nvb: Uint8Array, fid: number) => {
    const t = Object.create(tuning.Tuning.prototype) as tuning.Tuning
    t.fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    t.nvb = nvbtool.parseNvb(nvb)
    return Array.from({ length: tuning.SLOTS }, (_, s) => t.value(fid, s))
  }
  const beams = (base: string, from: imperfect.ProjectileFrom = 'bone', bone = 'head', position = imperfect.projectileDefault(bone, 'ironman')) => {
    const c = tinted(base)
    c.aura = { ...c.aura, mode: 'base' }
    c.projectile = { on: true, base: 'ironman', color: '#FF2000', alt_color: '#0040FF', from, bone, position, remove: false, melee: false }
    return c
  }
  const launchMarkers = (ngm: Uint8Array) => ngmtool.read(ngm)[1][0].attachments
    .filter(([, k, i]) => k === projectiles.SPAWN_KIND && i === projectiles.LAUNCH_INDEX).map(([b, , , mat]) => [b, ...mat.slice(12, 15)])

  it("fires a tinted copy of Iron Man's repulsor from Magneto's head, with Magneto's sound", () => {
    const r = new Builder(src(), beams('magneto')).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    const [n, a] = [tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 90), tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 91)]
    expect(n).toEqual(a)
    expect(new Set(n.slice(0, 5)).size).toBe(1)
    expect(n[0]).not.toBe(n[5])
    expect(tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 92)).toEqual(new Array(tuning.SLOTS).fill(''))
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name.toLowerCase(), b]))
    for (const [name, hue] of [[n[0] as string, 'red'], [n[5] as string, 'blue']]) {
      const shot = T.get(name)
      expect(shot.get(0x70)![0]).toBe(244)
      expect(R.u32(shot.get(0x4b))).toBe(20)
      const fly = by.get(R.text(shot.get(R.P_EFFECT1))!.toLowerCase())!
      expect(fly.lines[0]).toMatch(/^partcylinder /)
      expect(fly.lines.some((l) => /^material GE_PAR_lensFlare_01_BW$/i.test(l))).toBe(true)
      // the tint takes the color's hue and keeps the repulsor's lightness
      const [, r, g, bl] = nfxtool.scanFloats(nfxtool.tokens(fly.lines.find((l) => /^startcol /.test(l))!)[1], 4)
      expect(hue === 'red' ? r > g && g >= bl : bl > g && g > r, `${name} ${r},${g},${bl}`).toBe(true)
      const exp = T.get(R.text(shot.get(0x23))!)
      expect(R.text(exp.get(R.P_EFFECT1))).not.toMatch(/IrnMnRepExp|IronManRepExp/i)
    }
    // the explosion's sprite is only in Iron Man's bundles, so both costumes borrow it
    for (const costume of ['', '_alt']) expect(latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).toLowerCase().split(/\s+/)).toContain('ge_vol_explosion01')
    const sk = Skeleton.ofBase(new R.BaseCharacter(src(), 'magneto'))
    // by default between Iron Man's eyes and the repulsor's lead ahead of them, as checked in Dolphin
    for (const costume of ['', '_alt']) {
      expect(launchMarkers(r.adds.get(`Bundles/synth${costume}.ngm`)!))
        .toEqual([[sk.node('head'), 0, Math.fround(imperfect.EYE_POSITION[1] + imperfect.PROJECTILE_LEAD.ironman), Math.fround(imperfect.EYE_POSITION[2])]])
    }
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const recs = new Map(ngbtool.parse(r.adds.get('Bundles/synth.ngb')!).map((x) => [x.name.toLowerCase(), x]))
    const magneto = new R.BaseCharacter(src(), 'magneto')
    const own = nmstool.parse(src().entry(`Motions/${moves.motionSetOf(magneto)}`)).motions()
    const theirs = new Map(ngbtool.parse(src().entry(`Bundles/${moves.stemOf(moves.motionSetOf(magneto))}.ngb`)).map((x) => [x.name.toLowerCase(), x]))
    for (const state of ['superattack1', 'superattack2', 'superattackfar', 'superairrangedattack', 'superjumpattack']) {
      const rec = recs.get(set.get(state)!.anim.toLowerCase())!, before = theirs.get(own.get(state)!.anim.toLowerCase())!
      expect(rec.events.filter(([, t]) => t === projectiles.SPAWN).map(([, , p]) => p), state).toEqual([projectiles.LAUNCH_INDEX])
      expect(rec.events.filter(([, t]) => t === projectiles.PICK), state).toEqual(before.events.filter(([, t]) => t === projectiles.PICK))
    }
    // a carried object is thrown from the hands as before
    expect(set.get('carrytosslarge')!.anim.toLowerCase()).toBe(own.get('carrytosslarge')!.anim.toLowerCase())
    expect(r.notes.some((x) => x.startsWith("projectile: Iron Man's repulsor tinted #FF2000 and #0040FF"))).toBe(true)
  })

  it('launches from a chosen spot on any bone', () => {
    const r = new Builder(src(), beams('magneto', 'bone', 'R.hand', [0.05, 0.1, -0.02])).build()
    const sk = Skeleton.ofBase(new R.BaseCharacter(src(), 'magneto'))
    for (const costume of ['', '_alt']) {
      expect(launchMarkers(r.adds.get(`Bundles/synth${costume}.ngm`)!)).toEqual([[sk.node('R.hand'), Math.fround(0.05), Math.fround(0.1), Math.fround(-0.02)]])
    }
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const recs = new Map(ngbtool.parse(r.adds.get('Bundles/synth.ngb')!).map((x) => [x.name.toLowerCase(), x]))
    const rec = recs.get(set.get('superattackfar')!.anim.toLowerCase())!
    expect(rec.events.filter(([, t]) => t === projectiles.SPAWN).map(([, , p]) => p)).toEqual([projectiles.LAUNCH_INDEX])
    expect(r.notes.some((x) => x.includes('from the R.hand bone at (0.05, 0.1, -0.02)'))).toBe(true)
  })

  it('finds every launch bone on every base', () => {
    for (const key of R.keys()) {
      const sk = Skeleton.ofBase(new R.BaseCharacter(src(), key))
      for (const bone of imperfect.PROJECTILE_BONES) expect(sk.node(bone), `${key} ${bone}`).toBeDefined()
    }
  })

  it('keeps the launch points from the hands and shares one copy when both costumes are one color', () => {
    const c = beams('magneto', 'own')
    c.projectile.alt_color = c.projectile.color
    const r = new Builder(src(), c).build()
    const n = tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 90)
    expect(new Set(n).size).toBe(1)
    expect(r.adds.has('Motions/Synth.nms')).toBe(false)
    expect(launchMarkers(r.adds.get('Bundles/synth.ngm')!)).toEqual([])
  })

  it('knows the effect memory each copy takes', () => {
    for (const donor of imperfect.PROJECTILE_BASES) {
      for (const alt_color of ['#FF2000', '#00FF00', '#0A0B0C80']) {
        const p = { ...imperfect.defaultProjectile(), on: true, base: donor, alt_color }
        const fx = new effects.Effects(src().entry('Misc/game.nfx')), before = fx.used()
        const base = new R.BaseCharacter(src(), 'magneto')
        projectileswap.build(src(), base, fx, p, 'Abcdefghij', templates.namer(base.t, 'Abcdefghij'))
        const used = fx.used() - before
        expect(used, `${donor} ${alt_color}`).toBeLessThanOrEqual(projectileswap.bytes(p))
        expect(used, `${donor} ${alt_color}`).toBeGreaterThan(projectileswap.bytes(p) - 40)
      }
    }
  })

  it("fires every donor's shot, with the models and textures it draws", () => {
    const sk = Skeleton.ofBase(new R.BaseCharacter(src(), 'magneto'))
    const own = (alt: boolean) => ngmtool.read(new R.BaseCharacter(src(), 'magneto').bundleFiles(alt)[0])[1].map((m) => m.name.toLowerCase())
    for (const donor of imperfect.PROJECTILE_BASES) {
      const c = beams('magneto')
      c.projectile = { ...c.projectile, base: donor, position: imperfect.projectileDefault('head', donor) }
      const r = new Builder(src(), c).build()
      const T = new R.Templates(r.sets.get('Misc/Global.not')!)
      const n = tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 90)
      expect(T.has(n[0] as string), donor).toBe(true)
      for (const [costume, alt] of [['', false], ['_alt', true]] as [string, boolean][]) {
        const models = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)[1].map((m) => m.name.toLowerCase())
        const added = models.slice(1).filter((m) => !own(alt).includes(m) && !/_(phys|shadow)\.nod$/.test(m))
        const drawn = R.text(T.get(n[alt ? 5 : 0] as string).get(R.P_MODEL))
        expect(added, `${donor}${costume}`).toEqual(drawn ? [drawn.toLowerCase()] : [])
        expect(projectileswap.MODELED.includes(donor), donor).toBe(Boolean(drawn))
        const textures = latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).toLowerCase().split(/\s+/)
        if (donor === 'megalith' || donor === 'roekel') expect(textures, `${donor}${costume}`).toContain('plasmabomb')
        expect(launchMarkers(r.adds.get(`Bundles/synth${costume}.ngm`)!).map(([b]) => b), `${donor}${costume}`).toEqual([sk.node('head')])
      }
    }
  })

  it("hides Elektra's star with a fully transparent color", () => {
    const c = beams('magneto')
    c.projectile = { ...c.projectile, base: 'elektra', alt_color: '#0040FF00' }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    const n = tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 90)
    expect(R.text(T.get(n[0] as string).get(R.P_MODEL))).toBe('Elektra_shiruken.nod')
    expect(T.get(n[5] as string).get(R.P_MODEL)).toBeNull()
    expect(ngmtool.read(r.adds.get('Bundles/synth_alt.ngm')!)[1].some((m) => /shiruken/i.test(m.name))).toBe(false)
  })

  it("lays DefCon's tinted mines from the chosen bone", () => {
    const c = beams('magneto', 'bone')
    c.projectile.base = 'defcon'
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    const fx = new effects.Effects(r.sets.get('Misc/game.nfx')!)
    const n = tunedValues(r.adds.get('Misc/PLAYER_Synth.nvb')!, 90)
    for (const [name, hue] of [[n[0] as string, 'red'], [n[5] as string, 'blue']]) {
      const shot = T.get(name)
      const mines = fx.tree([R.text(shot.get(R.P_EFFECT1))]).flatMap((b) => effects.spawnedBy(b))
      expect(mines.length, name).toBe(1)
      expect(mines[0]).not.toMatch(/dc1Crystal/i)
      const mine = T.get(mines[0])
      expect(mine.get(0x70)).toBeNull()
      expect(shot.get(0x70)![0]).toBe(244)
      const glow = fx.tree([R.text(mine.get(R.P_EFFECT1))])[0]
      const [, red, g, bl] = nfxtool.scanFloats(nfxtool.tokens(glow.lines.find((l) => /^startcol /.test(l))!)[1], 4)
      expect(hue === 'red' ? red > g && red > bl : bl > g && bl > red, `${name} ${red},${g},${bl}`).toBe(true)
      expect(R.text(T.get(R.text(mine.get(0x23))!).get(R.P_EFFECT1))).not.toMatch(/dc1CrystalMineExp/i)
    }
    for (const costume of ['', '_alt']) expect(launchMarkers(r.adds.get(`Bundles/synth${costume}.ngm`)!).length).toBe(1)
  })

  it('refuses a base that launches nothing', () => {
    expect(imperfect.problems(beams('wolverine')).some(([kind, text]) => kind === 'error' && text.includes('launches no projectiles'))).toBe(true)
    expect(() => new Builder(src(), beams('wolverine')).build()).toThrow(LabError)
    for (const key of R.keys()) expect(imperfect.NO_SHOTS.includes(key), key).toBe(!projectiles.filled(new tuning.Tuning(src(), new R.BaseCharacter(src(), key))).some(Boolean))
  })
})

describe.skipIf(!ISO)('projectile removal', () => {
  const src = () => gameSource()
  const removed = (base: string, melee = false) => {
    const c = tinted(base)
    c.aura = { ...c.aura, mode: 'base' }
    c.projectile = { ...imperfect.defaultProjectile(), remove: true, melee }
    return c
  }
  const played = (r: { adds: Map<string, Uint8Array> }) => {
    const recs = new Map(ngbtool.parse(r.adds.get('Bundles/synth.ngb')!).map((x) => [x.name.toLowerCase(), x]))
    const now = moves.resolved(src(), nmstool.parse(r.adds.get('Motions/Synth.nms')!), () => true)
    return (state: string) => {
      const m = now.get(state.toLowerCase())!
      return { anim: m.anim, rec: recs.get(m.anim.toLowerCase())! }
    }
  }
  const shots = (rec: ngbtool.Record) => rec.events.filter(([, t]) => t === projectiles.FIRE).length
  const baseAnim = (key: string, state: string) => {
    const base = new R.BaseCharacter(src(), key)
    return moves.resolved(src(), nmstool.parse(src().entry(`Motions/${moves.motionSetOf(base)}`)), () => true).get(state.toLowerCase())!.anim
  }

  it("takes the shots out of Johnny Ohm's moves and keeps the throws'", () => {
    const r = new Builder(src(), removed('johnnyohm')).build()
    const at = played(r)
    for (const state of ['SuperAttack3', 'SuperAttackStomp', 'SuperRiseAttack', 'SuperJumpAttack', 'SuperJumpAttackDesc', 'DodgeExitSuperAttack', 'RangedAttack', 'SuperRangedAttack', 'SuperAirRangedAttack']) {
      expect(shots(at(state).rec), state).toBe(0)
      expect(at(state).rec.events.some(([, t]) => t === projectiles.PICK || t === projectiles.SPAWN), state).toBe(false)
    }
    for (const state of ['CarryTossSmall', 'CarryTossLarge', 'WieldThrow', 'FlyCarryTossSmall']) expect(shots(at(state).rec), state).toBe(1)
    expect(at('SuperAttack1').anim).toBe(baseAnim('johnnyohm', 'SuperAttack1'))
    expect(at('SuperAttack3').anim).not.toBe(baseAnim('johnnyohm', 'SuperAttack3'))
    expect(r.notes.some((n) => n.startsWith('projectile: removed from '))).toBe(true)
  })

  it("keeps Iron Man's finisher shots", () => {
    const at = played(new Builder(src(), removed('ironman')).build())
    expect(shots(at('FinishingMove').rec)).toBe(2)
    expect(shots(at('RangedAttack').rec)).toBe(0)
  })

  it('plays attack far in place of ground moves that shot', () => {
    const r = new Builder(src(), removed('johnnyohm', true)).build()
    const at = played(r)
    const far = at('AttackFar').anim
    expect(far).toBe(baseAnim('johnnyohm', 'AttackFar'))
    for (const state of ['SuperAttack3', 'SuperAttackStomp', 'SuperRiseAttack', 'DodgeExitSuperAttack', 'RangedAttack', 'SuperRangedAttack']) expect(at(state).anim, state).toBe(far)
    for (const state of ['SuperAttack1', 'SuperAttack2']) expect(at(state).anim, state).toBe(baseAnim('johnnyohm', state))
    for (const state of ['SuperJumpAttack', 'SuperAirRangedAttack']) {
      expect(at(state).anim, state).not.toBe(far)
      expect(shots(at(state).rec), state).toBe(0)
    }
    expect(r.notes.some((n) => n.startsWith('projectile: ') && n.includes('Super attack 3') && n.endsWith('play attack far instead'))).toBe(true)
  })

  it('leaves moves changed on the Moves page to the user', () => {
    const c = removed('johnnyohm', true)
    c.moveIdle = ['SuperAttack3']
    const at = played(new Builder(src(), c).build())
    expect(at('SuperAttack3').anim).not.toBe(at('AttackFar').anim)
    expect(shots(at('SuperAttack3').rec)).toBe(0)
    expect(at('RangedAttack').anim).toBe(at('AttackFar').anim)
  })

  it("keeps a gun's shots", () => {
    const armed = (remove: boolean) => {
      const c = removed('johnnyohm')
      c.projectile.remove = remove
      c.zButton = { stealth: null, costume: null, stats: null, size: null, bullet: null, laser: null, impersonate: null, requires: {}, gun: { ...imperfect.defaultGun('right'), damage: 25, bullets: 3, energy: 7.5, automatic: true } }
      c.materials[0].bind = imperfect.gunBone('johnnyohm', 'right')
      const recs = ngbtool.parse(new Builder(src(), c).build().adds.get('Bundles/synth.ngb')!)
      return recs.filter((x) => /^gun_/i.test(x.name)).map((x) => [x.name, shots(x)])
    }
    const kept = armed(true)
    expect(kept.some(([, n]) => (n as number) > 0)).toBe(true)
    expect(kept).toEqual(armed(false))
  })
})
