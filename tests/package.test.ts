import { describe, expect, it } from 'vitest'
import { LabError } from '../src/core/errors'
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

  it('keeps base moves to the bases that have them', () => {
    const c = character()
    c.baseMoves = { throw_reach: 20 }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('Daredevil'))).toBe(true)
    c.base = 'daredevil'
    expect(imperfect.problems(c).filter(([l]) => l === 'error')).toEqual([])
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
    ]
    for (const edit of cases) rejected(withManifest(files(), edit))
  })
})
