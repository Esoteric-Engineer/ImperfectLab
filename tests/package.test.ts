import { describe, expect, it } from 'vitest'
import * as moves from '../src/core/build/moves'
import { LabError } from '../src/core/errors'
import * as asftool from '../src/core/mnroi/asftool'
import { Model } from '../src/core/model/glb'
import * as imperfect from '../src/core/package/imperfect'
import type { Json } from '../src/core/mnroi/gltf'
import { archive, makeGlb, pngBytes, sha } from './helpers'

function character(): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = 'TestHero'
  c.displayName = 'TEST HERO'
  c.base = 'wolverine'
  c.glb = makeGlb()
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png', alt: 'hue:120' }]
  c.files = new Map([['textures/skin.png', pngBytes()], ['ui/hud.png', pngBytes(64, 64)]])
  c.mapping = new Map([[1, 'mixamorig:Hips']])
  c.overrides = new Map([['mixamorig:LeftHandMiddle1', 48]])
  c.stats = { normal: [1, 2, 3, 4, 5, 6], alt: [7, 6, 5, 4, 3, 2] }
  c.gameplay = { damage_taken: 0.8, lift: 'heavy', wire_swing: true, rage_duration: 15000 }
  c.aura = { mode: 'tint', tint: 'power', color: '#112233', alt_color: '#445566' }
  c.ui.select = { ready: { scale: 0.5, anchor: [10, 20], glow: '#11223344' } }
  c.credits = { author: 'me', description: 'a test', assets: [{ what: 'model', by: 'me', license: 'CC0', url: '' }] }
  return c
}

function withManifest(files: Record<string, Uint8Array>, edit?: (m: Json) => void): Uint8Array {
  const m = imperfect.manifest(character())
  m.files = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)]))
  edit?.(m)
  return archive({ ...files, 'manifest.json': JSON.stringify(m) })
}

function rejected(data: Uint8Array, text = '') {
  expect(() => imperfect.load(data)).toThrow(LabError)
  expect(() => imperfect.load(data)).toThrow(text)
}

describe('round trip', () => {
  it('saves and loads the same character, byte for byte', () => {
    const c = character()
    const data = imperfect.save(c)
    const d = imperfect.load(data)
    expect(imperfect.manifest(d)).toEqual(imperfect.manifest(c))
    expect(imperfect.save(d)).toEqual(data)
  })

  it('writes fit.floor_from_mesh only when it is on', () => {
    const c = character()
    expect((imperfect.manifest(c).model as Json).fit).toEqual({ scale: null, torso_squash: true, flip: null })
    expect(imperfect.load(imperfect.save(c)).fit.floor_from_mesh).toBe(false)
    c.fit.floor_from_mesh = true
    expect((imperfect.manifest(c).model as Json).fit).toEqual({ scale: null, torso_squash: true, flip: null, floor_from_mesh: true })
    const d = imperfect.load(imperfect.save(c))
    expect(d.fit.floor_from_mesh).toBe(true)
    expect(imperfect.save(d)).toEqual(imperfect.save(c))
  })

  it('writes model.size only when it is not 1', () => {
    const c = character()
    expect((imperfect.manifest(c).model as Json).size).toBeUndefined()
    expect(imperfect.load(imperfect.save(c)).size).toBe(1)
    c.size = 1.3
    expect((imperfect.manifest(c).model as Json).size).toBe(1.3)
    const d = imperfect.load(imperfect.save(c))
    expect(d.size).toBe(1.3)
    expect(imperfect.save(d)).toEqual(imperfect.save(c))
    const m = imperfect.manifest(c) as Json
    const bad = (size: unknown) => () => imperfect.fromManifest({ ...m, model: { ...(m.model as Json), size } }, new Map())
    expect(bad(0.05)).toThrow(/from 0.1 to 3/)
    expect(bad(4)).toThrow(/from 0.1 to 3/)
    expect(bad('big')).toThrow(/must be a number/)
  })

  it('finds problems', () => {
    const c = character()
    expect(imperfect.problems(c).filter((p) => p[0] === 'error')).toEqual([])
    c.internalName = 'Has Space'
    c.displayName = 'lower case'
    const msgs = imperfect.problems(c).map(([, m]) => m).join(' ')
    expect(msgs).toContain('internal name')
    expect(msgs).toContain('display name')
  })

  it('saves and loads base moves', () => {
    const c = character()
    c.base = 'daredevil'
    c.baseMoves = { throw_reach: 35, throw_cable: false }
    const d = imperfect.load(imperfect.save(c))
    expect(d.baseMoves).toEqual({ throw_reach: 35, throw_cable: false })
  })

  it('saves and loads the range grab', () => {
    const c = character()
    c.base = 'daredevil'
    c.baseMoves = { range_grab: true }
    c.moves = { WirePull: 'spiderman' }
    const d = imperfect.load(imperfect.save(c))
    expect(d.baseMoves).toEqual({ range_grab: true })
    expect(imperfect.problems(d).filter(([l]) => l === 'error')).toEqual([])
  })

  it('asks the range grab for its animation', () => {
    const c = character()
    c.base = 'daredevil'
    c.baseMoves = { range_grab: true }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('ranged pickup'))).toBe(true)
    c.baseMoves = {}
    c.moves = { WirePull: 'spiderman' }
    expect(imperfect.problems(c).some(([l, m]) => l === 'warning' && m.includes('never play'))).toBe(true)
  })

  it('keeps base moves to the bases that have them', () => {
    const c = character()
    c.baseMoves = { throw_reach: 20 }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('Daredevil'))).toBe(true)
    c.base = 'daredevil'
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
  })

  it('saves and loads moves taken from other bases', () => {
    const c = character()
    c.base = 'daredevil'
    c.moves = { SuperThrow: 'thing', Attack1: 'spiderman' }
    const d = imperfect.load(imperfect.save(c))
    expect(d.moves).toEqual({ SuperThrow: 'thing', Attack1: 'spiderman' })
  })

  it('saves and loads move effects, line colors and the super throw range', () => {
    const c = character()
    c.base = 'wolverine'
    expect(imperfect.manifest(c).move_effects).toBeUndefined()
    expect(imperfect.manifest(c).move_lines).toBeUndefined()
    c.moves = { SuperThrow: 'daredevil', Attack1: 'spiderman' }
    c.moveEffects = { SuperThrow: 'theirs', Attack1: 'none' }
    c.moveLines = { color: '#C0C0C0', alt_color: '#40A0FF80' }
    c.gameplay = { super_throw_range: 10 }
    const d = imperfect.load(imperfect.save(c))
    expect(d.moveEffects).toEqual(c.moveEffects)
    expect(d.moveLines).toEqual(c.moveLines)
    expect(d.gameplay.super_throw_range).toBe(10)
    const m = imperfect.manifest(c) as Json
    expect(() => imperfect.fromManifest({ ...m, move_effects: { Throw: 'theirs' } }, new Map())).toThrow(/base's own/)
    expect(() => imperfect.fromManifest({ ...m, move_effects: { SuperThrow: 'mine' } }, new Map())).toThrow(/theirs or none/)
    expect(() => imperfect.fromManifest({ ...m, move_lines: { color: 'grey' } }, new Map())).toThrow(LabError)
    expect(() => imperfect.fromManifest({ ...m, move_lines: { texture: 'x' } }, new Map())).toThrow(/unknown key/)
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { super_throw_range: 50 } } }, new Map())).toThrow(/from 1 to 20/)
    c.moveEffects = { Throw: 'theirs' }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes("effects can't be changed"))).toBe(true)
  })

  it('saves and loads attack damage', () => {
    const c = character()
    c.gameplay = { attack_damage_1: 18, attack_damage_5: 70.5 }
    expect(imperfect.load(imperfect.save(c)).gameplay).toEqual(c.gameplay)
    const m = imperfect.manifest(c) as Json
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { attack_damage_2: 0 } } }, new Map())).toThrow(/from 1 to 1000/)
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { attack_damage_6: 10 } } }, new Map())).toThrow(/unknown key/)
  })

  it('saves and loads energy costs', () => {
    const c = character()
    c.gameplay = { energy_super_attack: 0, energy_super_low: 0.5, energy_super_run: 2.5 }
    expect(imperfect.load(imperfect.save(c)).gameplay).toEqual(c.gameplay)
    const m = imperfect.manifest(c) as Json
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { energy_super_low: 0 } } }, new Map())).toThrow(/from 0.1 to 100/)
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { energy_super_throw: 101 } } }, new Map())).toThrow(/from 0 to 100/)
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { energy_super_dance: 10 } } }, new Map())).toThrow(/unknown key/)
  })

  it('saves and loads energy recharge rates', () => {
    const c = character()
    c.gameplay = { energy_regen: 0, energy_charge: 12.5 }
    expect(imperfect.load(imperfect.save(c)).gameplay).toEqual(c.gameplay)
    const m = imperfect.manifest(c) as Json
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { energy_charge: -1 } } }, new Map())).toThrow(/from 0 to 100/)
    expect(() => imperfect.fromManifest({ ...m, stats: { gameplay: { energy_regen: 101 } } }, new Map())).toThrow(/from 0 to 100/)
  })

  it('warns about flight energy on a character that can\'t fly', () => {
    const c = character()
    c.gameplay = { energy_flight: 5 }
    expect(imperfect.problems(c).some(([l, m]) => l === 'warning' && m.includes('flight energy'))).toBe(true)
    c.base = 'storm'
    expect(imperfect.problems(c).some(([, m]) => m.includes('flight energy'))).toBe(false)
    c.gameplay.flight = false
    expect(imperfect.problems(c).some(([l, m]) => l === 'warning' && m.includes('flight energy'))).toBe(true)
  })

  it('saves and loads stretched moves', () => {
    const c = character()
    expect(imperfect.manifest(c).move_reach).toBeUndefined()
    c.moveReach = { SuperAttackFar: { distance: 15 }, WireSwing: {}, Attack1: { distance: 1.5, limbs: ['right_arm'] } }
    const d = imperfect.load(imperfect.save(c))
    expect(d.moveReach).toEqual(c.moveReach)
    const m = imperfect.manifest(c) as Json
    const bad = (move_reach: Json) => () => imperfect.fromManifest({ ...m, move_reach }, new Map())
    expect(bad({ Nothing: {} })).toThrow(/unknown move/)
    expect(bad({ Attack1: { distance: 50 } })).toThrow(/from 1 to 35/)
    expect(bad({ Attack1: { limbs: ['tail'] } })).toThrow(/limbs is a list/)
    expect(bad({ Attack1: { limbs: [] } })).toThrow(/limbs is a list/)
    expect(bad({ Attack1: { limbs: ['left_arm', 'left_arm'] } })).toThrow(/limbs is a list/)
    expect(bad({ Attack1: { speed: 2 } })).toThrow(/unknown key/)
    c.base = 'daredevil'
    c.baseMoves = { throw_reach: 30 }
    expect(imperfect.problems(c).some(([l, msg]) => l === 'error' && msg.includes('stretch'))).toBe(true)
  })

  it('saves and loads stretched jumps', () => {
    const c = character()
    c.moveReach = { Jump: { distance: 0.8, hold: true }, SuperRunJump: { distance: 1.5, limbs: ['left_leg'] } }
    expect(imperfect.load(imperfect.save(c)).moveReach).toEqual(c.moveReach)
    const m = imperfect.manifest(c) as Json
    const bad = (move_reach: Json) => () => imperfect.fromManifest({ ...m, move_reach }, new Map())
    expect(bad({ Jump: { distance: 5 } })).toThrow(/from 0.25 to 3/)
    expect(bad({ Attack1: { distance: 0.5 } })).toThrow(/from 1 to 35/)
    expect(bad({ Attack1: { distance: 2, hold: true } })).toThrow(/jumps only/)
    expect(bad({ Jump: { distance: 1, hold: 'yes' } })).toThrow(/wrong type/)
  })

  it('saves and loads moves that play the idle', () => {
    const c = character()
    expect(imperfect.manifest(c).move_idle).toBeUndefined()
    c.moveIdle = ['Run', 'Attack1']
    expect(imperfect.load(imperfect.save(c)).moveIdle).toEqual(c.moveIdle)
    const m = imperfect.manifest(c) as Json
    const bad = (move_idle: Json, more: Json = {}) => () => imperfect.fromManifest({ ...m, ...more, move_idle }, new Map())
    expect(bad(['Nothing'])).toThrow(/unknown move/)
    expect(bad(['Stand'])).toThrow(/unknown move/)
    expect(bad(['Run', 'Run'])).toThrow(/twice/)
    expect(bad({ Run: true })).toThrow(/wrong type/)
    expect(bad(['Run'], { moves: { Run: 'thing' } })).toThrow(/taken from another base/)
    c.moveReach = { Attack1: { distance: 2 } }
    expect(imperfect.problems(c).some(([l, msg]) => l === 'error' && msg.includes("can't stretch"))).toBe(true)
  })

  it('saves and loads the Z button action', () => {
    const c = character()
    expect(imperfect.manifest(c).z_button).toBeUndefined()
    c.zButton = { action: 'stealth', stealth: { undetected: true, untouchable: false, visible: null }, requires: {} }
    expect(JSON.parse(JSON.stringify(imperfect.manifest(c).z_button))).toEqual({ action: 'stealth', stealth: { undetected: true } })
    expect(imperfect.load(imperfect.save(c)).zButton).toEqual(c.zButton)
    c.zButton.stealth = { undetected: false, untouchable: true, visible: 0.35 }
    c.zButton.requires.energy = { seconds: 12, regen: true }
    expect(imperfect.load(imperfect.save(c)).zButton).toEqual(c.zButton)
    const m = imperfect.manifest(c) as Json
    const bad = (z: unknown) => expect(() => imperfect.fromManifest({ ...m, z_button: z } as Json, new Map())).toThrow(/z_button/)
    bad('stealth')
    bad({ action: 'fly' })
    bad({ action: 'stealth' })
    bad({ action: 'stealth', stealth: { undetected: false } })
    bad({ action: 'stealth', stealth: { visible: 1 } })
    bad({ action: 'stealth', stealth: { hidden: true } })
    bad({ action: 'stealth', stealth: { untouchable: true }, requires: { health: {} } })
    bad({ action: 'stealth', stealth: { untouchable: true }, requires: { energy: { seconds: 0 } } })
    bad({ action: 'stealth', stealth: { untouchable: true }, requires: { energy: { seconds: 8, regen: 'yes' } } })
    bad({ action: 'stealth', extra: 1 })
  })

  it('finds problems with moves', () => {
    const c = character()
    c.base = 'daredevil'
    c.moves = { SuperAttackFar: 'wolverine' }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    c.baseMoves = { throw_reach: 30 }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('baton throw'))).toBe(true)
    c.baseMoves = {}
    c.moves = { SuperThrow: 'daredevil' }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('the base itself'))).toBe(true)
  })

  it('finds problems with wall climbing, and saves and loads it', () => {
    const c = character()
    c.base = 'thing'
    const errors = () => imperfect.problems(c).filter(([l]) => l === 'error').map(([, m]) => m)
    c.gameplay = { wall_climb: true }
    expect(errors().filter((m) => m.startsWith('wall climbing needs')).length).toBe(5)
    c.moves = Object.fromEntries(moves.WALL_CLIMB.map((id) => [id, 'venom']))
    expect(errors()).toEqual([])
    const back = imperfect.fromManifest(imperfect.manifest(c), new Map(c.files))
    expect(back.gameplay.wall_climb).toBe(true)
    expect(back.moves).toEqual(c.moves)
    c.gameplay = {}
    expect(imperfect.problems(c).some(([l, m]) => l === 'warning' && m.includes('wall climbing is off'))).toBe(true)
    c.base = 'spiderman'
    c.moves = {}
    c.gameplay = { wall_climb: true }
    expect(errors().some((m) => m.includes('already climbs walls'))).toBe(true)
    expect(() => imperfect.fromManifest({ ...imperfect.manifest(c), stats: { gameplay: { wall_climb: 'yes' } } }, new Map())).toThrow(/wall_climb/)
  })

  it('turns off flight for a base that flies', () => {
    const c = character()
    c.base = 'storm'
    c.gameplay = { flight: false }
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
    expect(imperfect.load(imperfect.save(c)).gameplay).toEqual({ flight: false })
    c.base = 'thing'
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes("can't fly"))).toBe(true)
    expect(() => imperfect.fromManifest({ ...imperfect.manifest(c), stats: { gameplay: { flight: true } } }, new Map())).toThrow(/can only be false/)
  })

  it('turns the low-energy stun off for Megalith and on for other bases', () => {
    const c = character()
    const errors = () => imperfect.problems(c).filter(([l]) => l === 'error').map(([, m]) => m)
    c.base = 'megalith'
    c.gameplay = { low_energy_stun: false }
    expect(errors()).toEqual([])
    expect(imperfect.load(imperfect.save(c)).gameplay).toEqual({ low_energy_stun: false })
    c.gameplay = { low_energy_stun: true }
    expect(errors().some((m) => m.includes('already has low-energy stun'))).toBe(true)
    c.base = 'wolverine'
    expect(errors().some((m) => m.includes('needs'))).toBe(true)
    c.moves = { LowEnergyStun: 'megalith' }
    expect(errors()).toEqual([])
    expect(imperfect.load(imperfect.save(c)).gameplay).toEqual({ low_energy_stun: true })
    c.gameplay = {}
    expect(imperfect.problems(c).some(([l, m]) => l === 'warning' && m.includes('never plays'))).toBe(true)
    c.gameplay = { low_energy_stun: false }
    expect(errors().some((m) => m.includes('has no low-energy stun'))).toBe(true)
  })

  it('finds problems with wall running, and keeps a base\'s own wall jumps apart', () => {
    const c = character()
    const errors = () => imperfect.problems(c).filter(([l]) => l === 'error').map(([, m]) => m)
    const unplayed = () => imperfect.problems(c).some(([l, m]) => l === 'warning' && m.includes('never play'))
    c.base = 'spiderman'
    c.gameplay = { wall_run: true }
    expect(errors().filter((m) => m.startsWith('wall running needs')).length).toBe(3)
    c.moves = Object.fromEntries(moves.WALL_RUN.map((id) => [id, 'wolverine']))
    expect(errors()).toEqual([])
    expect(imperfect.fromManifest(imperfect.manifest(c), new Map(c.files)).gameplay.wall_run).toBe(true)
    c.gameplay = {}
    expect(unplayed()).toBe(true)
    c.base = 'daredevil'
    c.moves = { WallJumpOff: 'spiderman' }
    expect(unplayed()).toBe(false)
    c.gameplay = { wall_run: true }
    expect(errors().some((m) => m.includes('already runs on walls'))).toBe(true)
    c.base = 'thing'
    c.gameplay = {}
    expect(unplayed()).toBe(true)
  })

  it('saves and loads cutscenes and their audio, and leaves them out by default', () => {
    const c = character()
    expect(imperfect.manifest(c).cutscenes).toBeUndefined()
    expect(imperfect.load(imperfect.save(c)).cutscenes).toEqual({ audio: {}, effects: {} })
    const n = 3000
    const audio = asftool.build(asftool.encode([new Int16Array(n), new Int16Array(n)]))
    c.cutscenes = { finisher: 'thing', intro: 'storm', audio: { finisher_1: 'cutscenes/finisher_1.asf' }, effects: {} }
    c.files.set('cutscenes/finisher_1.asf', audio)
    const d = imperfect.load(imperfect.save(c))
    expect(d.cutscenes).toEqual(c.cutscenes)
    expect(d.files.get('cutscenes/finisher_1.asf')).toEqual(audio)
  })

  it('finds problems with cutscenes, and refuses bad ones in a file', () => {
    const c = character()
    c.cutscenes = { victory: 'wolverine', audio: { intro_1: 'cutscenes/x.asf' }, effects: {} }
    const errors = () => imperfect.problems(c).filter(([l]) => l === 'error').map(([, m]) => m)
    expect(errors().some((m) => m.includes('victory') && m.includes('the base itself'))).toBe(true)
    expect(errors().some((m) => m.includes('intro 1') && m.includes('missing'))).toBe(true)
    c.cutscenes = { audio: {}, effects: {} }
    expect(errors()).toEqual([])
    c.cutscenes = { audio: {}, effects: { intro: 'theirs' } }
    expect(errors().some((m) => m.includes("effects can't be changed"))).toBe(true)
    c.cutscenes = { intro: 'storm', audio: {}, effects: { intro: 'theirs' } }
    expect(imperfect.load(imperfect.save(c)).cutscenes).toEqual(c.cutscenes)
    c.cutscenes = { audio: {}, effects: {} }
    const m = imperfect.manifest(c) as Json
    expect(() => imperfect.fromManifest({ ...m, cutscenes: { audio: {}, effects: { intro: 'theirs' } } }, new Map())).toThrow(/base's own/)
    expect(() => imperfect.fromManifest({ ...m, cutscenes: { intro: 'storm', audio: {}, effects: { intro: 'mine' } } }, new Map())).toThrow(/theirs or none/)
    // the first form, a list of kinds
    expect(imperfect.fromManifest({ ...m, cutscenes: { intro: 'storm', finisher: 'thing', audio: {}, effects: ['intro', 'finisher'] } }, new Map()).cutscenes.effects).toEqual({ intro: 'theirs', finisher: 'theirs' })
    expect(() => imperfect.fromManifest({ ...m, cutscenes: { intro: 'nobody', audio: {} } }, new Map())).toThrow(/unknown base/)
    expect(() => imperfect.fromManifest({ ...m, cutscenes: { intro: 'constructor', audio: {} } }, new Map())).toThrow(/unknown base/)
    expect(() => imperfect.fromManifest({ ...m, moves: { SuperAttackFar: 'toString' } }, new Map())).toThrow(/unknown base/)
    expect(() => imperfect.fromManifest({ ...m, cutscenes: { audio: { outro_1: 'cutscenes/a.asf' } } }, new Map())).toThrow(/unknown cutscene audio/)
    expect(() => imperfect.fromManifest({ ...m, cutscenes: { audio: { intro_1: 'cutscenes/a.asf' } } }, new Map())).toThrow(/lacks/)
    expect(() => imperfect.checkMember('cutscenes/a.asf', pngBytes())).toThrow(LabError)
  })

  it('saves and loads flames, and leaves them out at their defaults', () => {
    const c = character()
    expect(imperfect.manifest(c).flames).toBeUndefined()
    expect(imperfect.load(imperfect.save(c)).flames).toEqual(imperfect.defaultFlames())
    c.flames = { parts: ['r_hand', 'head'], body: false, color: '#FF8000', alt_color: null, size: 1.5, base_effect: false }
    const d = imperfect.load(imperfect.save(c))
    expect(d.flames).toEqual({ ...c.flames, parts: ['head', 'r_hand'] })
  })

  it('keeps flames to the body or to parts', () => {
    const c = character()
    c.flames = { ...imperfect.defaultFlames(), parts: ['head'], body: true }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('whole body'))).toBe(true)
  })

  it('slims a GLB', () => {
    const raw = makeGlb(undefined, undefined, pngBytes())
    const slim = imperfect.slimGlb(raw, new Set())
    const a = new Model(raw), b = new Model(slim)
    expect(b.jointNames()).toEqual(a.jointNames())
    expect(b.prims.map((p) => p.pos)).toEqual(a.prims.map((p) => p.pos))
    expect(a.materials[0].image).not.toBeNull()
    expect(b.materials[0].image).toBeNull()
    expect(slim.length).toBeLessThan(raw.length)
  })
})

describe('hostile files', () => {
  const files = () => ({ 'model/model.glb': makeGlb(), 'textures/skin.png': pngBytes(), 'ui/hud.png': pngBytes(64, 64) })

  it('accepts a good file', () => {
    imperfect.load(withManifest(files()))
  })

  it('refuses path traversal and unknown members', () => {
    for (const name of ['../evil.png', '/abs.png', 'ui\\hud.png', 'textures/../../x.png', 'scripts/run.py', 'textures/x.exe']) {
      rejected(archive({ 'manifest.json': '{}', [name]: 'x' }), 'unexpected member')
    }
  })

  it('refuses what is not a zip', () => rejected(new TextEncoder().encode('not a zip'), 'not a .imperfect'))
  it('refuses a bad hash', () => rejected(withManifest(files(), (m) => (m.files['ui/hud.png'] = '0'.repeat(64))), 'damaged'))
  it('refuses an unlisted member', () => rejected(withManifest(files(), (m) => delete m.files['ui/hud.png']), 'file list'))
  it('refuses a fake PNG', () => {
    const gif = new Uint8Array(36)
    gif.set(new TextEncoder().encode('GIF89a'))
    rejected(withManifest({ ...files(), 'ui/hud.png': gif }), 'not a PNG')
  })
  it('refuses a huge PNG', () => {
    const body = pngBytes().slice()
    new DataView(body.buffer).setUint32(16, 5000)
    new DataView(body.buffer).setUint32(20, 5000)
    rejected(withManifest({ ...files(), 'ui/hud.png': body }), 'larger than')
  })
  it('refuses a zip bomb', () => {
    const bomb = new Uint8Array(8 + (4 << 20))
    bomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    rejected(withManifest({ ...files(), 'ui/banner.png': bomb }), 'compresses')
  })
  it('refuses bad JSON', () => rejected(archive({ 'manifest.json': '{not json' }), 'not valid JSON'))
  it('refuses unknown keys', () => rejected(withManifest(files(), (m) => (m.run = 'rm -rf /')), 'unknown key'))
  it('refuses newer versions', () => rejected(withManifest(files(), (m) => (m.version = 99)), 'newer ImperfectLab'))
  it('refuses bad values', () => {
    const cases: ((m: Json) => void)[] = [
      (m) => (m.character.internal_name = '../../x'),
      (m) => (m.character.display_name = 'x'.repeat(40)),
      (m) => (m.base = 'galactus'),
      (m) => (m.stats.display.normal = [9, 9, 9, 9, 9, 9]),
      (m) => (m.stats.gameplay.damage_taken = 'lots'),
      (m) => (m.stats.gameplay.attack_damage_1 = 'lots'),
      (m) => (m.stats.gameplay.energy_super_attack = 'lots'),
      (m) => (m.stats.gameplay.flight = true),
      (m) => (m.stats.gameplay.flight = 'no'),
      (m) => (m.stats.gameplay.low_energy_stun = 'no'),
      (m) => (m.model.materials[0].size = [300, 300]),
      (m) => (m.model.materials[0].texture = '../../etc/passwd'),
      (m) => (m.aura.mode = 'rainbow'),
      (m) => (m.aura.tint = 'most'),
      (m) => (m.model.mapping = { pelvis: 'x' }),
      (m) => (m.base_moves = { throw_reach: 20 }),
      (m) => ((m.base = 'daredevil'), (m.moves = { throw_reach: 20 })),
      (m) => ((m.base = 'daredevil'), (m.base_moves = { throw_reach: 100 })),
      (m) => ((m.base = 'daredevil'), (m.base_moves = { throw_cable: 'no' })),
      (m) => ((m.base = 'daredevil'), (m.base_moves = { grab: 'thing' })),
      (m) => ((m.base = 'daredevil'), (m.base_moves = { range_grab: 'yes' })),
      (m) => (m.base_moves = { range_grab: true }),
      (m) => (m.moves = { NotAMove: 'thing' }),
      (m) => (m.moves = { SuperThrow: 'galactus' }),
      (m) => (m.moves = { SuperThrow: 3 }),
      (m) => (m.moves = { SuperThrow: 'wolverine' }),
      (m) => (m.moves = ['SuperThrow']),
      (m) => (m.flames = { parts: ['tail'] }),
      (m) => (m.flames = { parts: ['head'], body: true }),
      (m) => (m.flames = { size: 5 }),
      (m) => (m.flames = { color: 'orange' }),
      (m) => (m.flames = { glow: true }),
    ]
    for (const edit of cases) rejected(withManifest(files(), edit))
  })
})
