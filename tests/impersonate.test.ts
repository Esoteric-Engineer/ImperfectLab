import { describe, expect, it } from 'vitest'
import { CLASSES, CLIP_BONES, clipMap, impersonationData, nodeMap, statFields } from '../src/core/build/impersonate'
import { boneMap, throwStates } from '../src/core/build/moves'
import * as energy from '../src/core/build/energy'
import { FIELDS } from '../src/core/build/tuning'
import { latin1, u32be } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as D from '../src/core/game/dol'
import { loadTable } from '../src/core/model/skeleton'
import { gameSource, ISO } from './helpers'

const zOnly = (internal: string, more: Partial<D.ZCharacter> = {}): D.ZCharacter => ({
  internal, seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, costume: false,
  damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: false, ...more
})

const nodeName = (body: string, i: number) => loadTable(body).nodes[String(i)]?.name

describe('impersonation tables', () => {
  it("takes every Stats page field and the cached regen ones as stats, and nothing a move fires", () => {
    const stats = statFields()
    for (const f of Object.values(FIELDS)) expect(stats).toContain(f)
    for (const f of [134, 138, 43, 44, energy.CHARGE, 217]) expect(stats).toContain(f)
    for (const f of [90, 91, 92, 93, 168]) expect(stats).not.toContain(f)
    expect(stats.every((f) => f < 256)).toBe(true)
  })

  it('maps a class onto itself node for node', () => {
    for (const body of CLASSES) {
      const map = nodeMap(body, body)
      expect(map).toEqual(map.map((_, i) => i))
    }
  })

  it('maps limbs across classes by role and leaves the rest to their parents', () => {
    const female = nodeMap('female', 'male')
    expect(female).toHaveLength(65)
    for (const [i, name] of [[1, 'Pelvis'], [38, 'L Upper arm'], [53, 'Hips'], [54, 'L Thigh'], [61, 'R Toe'], [63, 'Root marker']] as const) {
      expect(nodeName('female', i)).toBe(name)
      expect(nodeName('male', female[i])).toBe(name)
    }
    expect(female[9]).toBe(0xff) // a face node
    expect(female[52]).toBe(0xff) // Chest front
    const brute = nodeMap('brute', 'female')
    expect(nodeName('brute', 36)).toBe('R Thumb 3')
    expect(brute[36]).toBe(0xff)
    expect(nodeName('female', brute[55])).toBe('L Thigh')
    for (const map of [female, brute, nodeMap('male', 'brute')]) expect(map.every((s) => s === 0xff || s < 72)).toBe(true)
  })

  it("renumbers clips across classes as the Moves page does, dropping bones the player's class lacks", () => {
    const female = clipMap('female', 'male')
    expect(female).toHaveLength(CLIP_BONES)
    const moves = boneMap('female', 'male', 128)
    for (let i = 0; i < CLIP_BONES; i++) expect(female[i]).toBe(moves.get(i) ?? 0xff)
    expect(nodeName('male', female[40])).toBe('L Forearm')
    expect(nodeName('female', 40)).toBe('L Forearm')
    expect(clipMap('brute', 'male')[36]).toBe(0xff)
    expect(clipMap('male', 'female').every((b) => b === 0xff || b < 81)).toBe(true)
  })

  it('fits the tables in the section', () => {
    const d = impersonationData()
    expect(d.bases).toEqual([72, 65, 66])
    expect(d.maps.map((row) => row.map((m) => m.length))).toEqual(d.bases.map((n) => [n, n, n]))
    expect(d.clipMaps.flat().every((m) => m.length === D.IMP_AMAPLEN)).toBe(true)
    expect(d.throws).toEqual(throwStates())
    expect(d.throws).toContain('SuperAirThrowVictimBrute')
  })
})

describe.skipIf(!ISO)('impersonation', () => {
  it("reads the motion states' numbers from main.dol", () => {
    const states = D.motionStates(gameSource().dol)
    expect(states.size).toBeGreaterThan(300)
    expect([states.get('SuperAttack1'), states.get('SuperAttackFar'), states.get('AirAttack')]).toEqual([0x2f, 0x33, 0x3e])
    for (const name of throwStates()) expect(states.get(name)).toBeLessThan(0x174)
  })

  it('marks its parts in the Z table', () => {
    const out = D.zActions(gameSource().dol, [zOnly('Synth', { impersonate: { moves: true, model: false, stats: true } }), zOnly('Other', { impersonate: { moves: false, model: true, stats: false } })])
    const t = D.fileOffset(out, 0x80137494) + 0x534
    expect(u32be(out, t + 4)).toBe(D.IMP_MOVES | D.IMP_STATS)
    expect(latin1(out, t + 12, t + 36)).toBe('plr_synth\0plr_altSynth\0\0')
    expect(u32be(out, t + 36 + 4)).toBe(D.IMP_MODEL)
  })

  it("adds its code in a text section of its own and takes over Z's hook", () => {
    const d = impersonationData()
    expect(() => D.impersonate(gameSource().dol, d)).toThrow(/Z-button/)
    const zd = D.zActions(gameSource().dol, [zOnly('Synth', { impersonate: { moves: true, model: true, stats: true } })])
    for (const before of [zd, D.patchMany(zd, [1, 2].map((i) => ({ internal: `C${i}`, display: `C${i}`, stats: [1, 1, 1, 1, 1, 1], altStats: [1, 1, 1, 1, 1, 1] })))]) {
      const lo = D.arenaLo(before)
      const out = D.impersonate(before, d)
      const slot = [2, 3, 4, 5, 6].find((i) => u32be(out, 0x90 + 4 * i) && !u32be(before, 0x90 + 4 * i))!
      expect(u32be(out, 0x48 + 4 * slot)).toBe(lo)
      const size = u32be(out, 0x90 + 4 * slot), at = u32be(out, 4 * slot)
      expect(D.arenaLo(out)).toBe(lo + size)
      const word = (va: number) => u32be(out, D.fileOffset(out, va))
      const target = (from: number) => (from + (((word(from) << 6) >> 6) & ~3)) >>> 0
      for (const [site, to, link] of [[0x800fba50, D.IMP_FRAME, 1], [0x800b1884, D.IMP_TUNING, 0], [0x800b18ec, D.IMP_INT, 0], [0x800acd20, D.IMP_NAME, 0], [0x8010cdcc, D.IMP_VOICE, 0], [0x80097614, D.IMP_RELEASE, 0],
      [0x8019c878, D.IMP_TRACK, 1], [0x8019c7dc, D.IMP_CLIP, 1], [0x80097d18, D.IMP_PLAY, 1], [0x80024f3c, D.IMP_DRAW, 1], [0x8001aea8, D.IMP_SHADOW, 1],
      [0x8019d180, D.IMP_CLIP2, 1], [0x8019cee8, D.IMP_CLIP2, 1], [0x8019d244, D.IMP_TRACK2, 1], [0x8019d050, D.IMP_WORD, 1], [0x8019d07c, D.IMP_WORD, 1], [0x8019d098, D.IMP_WORD, 1]]) {
        expect(target(site)).toBe(lo + to)
        expect(word(site) >>> 26).toBe(18)
        expect(word(site) & 1).toBe(link)
      }
      // the replaced instructions
      const code = out.subarray(at, at + D.IMP_DATA)
      const words = Array.from({ length: code.length / 4 }, (_, i) => u32be(code, 4 * i))
      for (const w of [0x3804ffea, 0x9421ffe8, 0x9421ffc0, 0x9421fff0, 0x38000001, 0x38000000, 0x801f0014, 0x80090000]) expect(words).toContain(w)
      const data = at + D.IMP_DATA
      expect([...out.subarray(data, data + D.IMP_STATBITS)].every((b) => b === 0)).toBe(true)
      for (const f of d.stats) expect((out[data + D.IMP_STATBITS + (f >> 3)] >> (f & 7)) & 1).toBe(1)
      expect([...out.subarray(data + D.IMP_BASES, data + D.IMP_BASES + 3)]).toEqual([72, 65, 66])
      expect(out[data + D.IMP_MAPS + (1 * 3 + 0) * D.IMP_MAPLEN + 53]).toBe(60)
      expect(out[data + D.IMP_AMAPS + (1 * 3 + 0) * D.IMP_AMAPLEN + 40]).toBe(clipMap('female', 'male')[40])
      const throwState = D.motionStates(before).get('ThrowVictimFemale')!
      expect((out[data + D.IMP_THROWBITS + (throwState >> 3)] >> (throwState & 7)) & 1).toBe(1)
      expect(out[data + D.IMP_THROWBITS + (0x2f >> 3)] & (1 << (0x2f & 7))).toBe(0)
      const changed = [...out.subarray(0, before.length)].flatMap((b, i) => (b !== before[i] ? [i] : []))
      const sites = [0x800fba50, 0x800b1884, 0x800b18ec, 0x800acd20, 0x8010cdcc, 0x80097614, 0x8019c878, 0x8019c7dc, 0x80097d18, 0x80024f3c, 0x8001aea8,
        0x8019d180, 0x8019cee8, 0x8019d244, 0x8019d050, 0x8019d07c, 0x8019d098].map((va) => D.fileOffset(out, va))
      // the arena start (ARENA_REFS)
      const arena = [[0x177bc4, 0x177bcc], [0x177bfc, 0x177c04]]
      expect(changed.every((i) => i < 0x100 || sites.some((s) => i >= s && i < s + 4) || arena.some(([a, b]) => i >= a && i < b))).toBe(true)
    }
    expect(() => D.impersonate(D.impersonate(zd, d), d)).toThrow(LabError)
  })
})