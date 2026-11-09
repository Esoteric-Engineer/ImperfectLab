import { describe, expect, it } from 'vitest'
import * as R from '../src/core/game/roster'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import * as shaders from '../src/core/build/shaders'
import { baseMeshes, envImage, skin } from '../src/core/preview'
import { Service } from '../src/worker/service'
import type { MovePreview } from '../src/worker/protocol'
import { fileReader, gameSource, ISO, makeGlb, pngBytes } from './helpers'

function character(base: string, glb = false): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = 'Synth'
  c.base = base
  if (glb) {
    c.glb = makeGlb()
    c.materials = [imperfect.newMaterial(0, 'skin', true, '', [64, 64])]
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(gameSource(), base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
  }
  return c
}

function service(): Service {
  const s = new Service()
  s.openImage(fileReader(ISO!), ISO!)
  return s
}

const ok = (r: MovePreview | string): MovePreview => {
  if (typeof r === 'string') throw new Error(r)
  return r
}

describe.skipIf(!ISO)('move preview', () => {
  it('leaves the base model where it is in the bind pose', () => {
    const base = new R.BaseCharacter(gameSource(), 'thing')
    const model = ngmtool.read(base.bundleFiles()[0])[1][0]
    const posed = ngbtool.pose(model, null, 0)
    const rest = posed.map(([, T]) => T)
    for (const m of baseMeshes(gameSource(), base)) {
      const pos = new Float32Array(m.positions.length), nrm = new Float32Array(m.normals.length)
      skin(m, posed, rest, pos, nrm)
      for (let i = 0; i < pos.length; i++) expect(pos[i]).toBeCloseTo(m.positions[i], 4)
    }
  })

  it("plays the base's own move on the base's model", () => {
    const r = ok(service().movePreview(character('thing'), 'Attack1'))
    expect(r.custom).toBeNull()
    expect(r.base.length).toBeGreaterThan(0)
    expect(r.variants.length).toBeGreaterThan(0)
    expect(r.variants[0].state.toLowerCase()).toBe('attack1')
    expect(r.variants[0].fps).toBeGreaterThan(0)
  })

  it("plays a swapped move from another body class on the base's bones", async () => {
    const s = service()
    const c = character('daredevil', true)
    await s.importModel(c.glb!)
    c.moves.SuperThrow = 'thing'
    const r = ok(s.movePreview(c, 'SuperThrow'))
    expect(r.custom).not.toBeNull()
    expect(new Set(r.variants.map((v) => v.slot)).size).toBeGreaterThan(1)
    for (const v of r.variants) for (const [bone] of v.rec.tracks) expect(bone & 0xffff).toBeLessThan(r.nodes.length)
    expect(r.notes.some((n) => n.includes('approximate'))).toBe(true)
  })

  it('rebuilds when a setting the animations depend on changes', () => {
    const s = service()
    const c = character('daredevil')
    const before = ok(s.movePreview(c, 'Attack1')).variants[0].rec.name
    c.moves.Attack1 = 'wolverine'
    expect(ok(s.movePreview(c, 'Attack1')).variants[0].rec.name).not.toBe(before)
  })

  it("plays another base's version of the move without changing the character", () => {
    const s = service()
    const c = character('daredevil')
    const own = ok(s.movePreview(c, 'Attack1')).variants[0].rec.name
    const theirs = ok(s.movePreview(c, 'Attack1', 'wolverine')).variants[0].rec.name
    expect(theirs).not.toBe(own)
    expect(c.moves).toEqual({})
    expect(ok(s.movePreview(c, 'Attack1', 'daredevil')).variants[0].rec.name).toBe(own)
  })

  it('shows the glowing eyes on the head, framed on them', async () => {
    const s = service()
    const c = character('wolverine', true)
    await s.importModel(c.glb!)
    expect(s.eyesPreview(c)).toBe('the glowing eyes are off')
    c.eyes = { ...imperfect.defaultEyes(), on: true, color: '#FF0000', position: [0.05, 0.1, 0.02] }
    const r = s.eyesPreview(c)
    if (typeof r === 'string') throw new Error(r)
    const dots = r.meshes[r.meshes.length - 1]
    expect(dots.positions.length).toBe(2 * 8 * 3 * 3)
    const sk = Skeleton.ofBase(new R.BaseCharacter(gameSource(), 'wolverine'))
    const head = sk.nodes[sk.node('head')!].pos
    const mean = (from: number) => [0, 1, 2].map((k) => {
      let sum = 0
      for (let i = from; i < from + 24; i++) sum += dots.positions[i * 3 + k]
      return sum / 24
    })
    expect(mean(0).map((v, k) => v - head[k])).toEqual([-0.05, 0.1, 0.02].map((v) => expect.closeTo(v, 4)))
    expect(mean(24).map((v, k) => v - head[k])).toEqual([0.05, 0.1, 0.02].map((v) => expect.closeTo(v, 4)))
    expect(Array.from(dots.image!.data.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(r.focus[1]).toBeCloseTo(0.25)
  })

  it("shows each costume's textures with the materials' metallic finishes", async () => {
    const s = service()
    const c = character('wolverine', true)
    await s.importModel(c.glb!)
    c.materials = [{ ...c.materials[0], texture: 'textures/skin.png', alt: 'textures/skin_alt.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()], ['textures/skin_alt.png', pngBytes(4, 4, [0, 0, 255, 255])]])
    const meshes = (alt: boolean) => {
      const r = s.materialPreview(c, alt)
      if (typeof r === 'string') throw new Error(r)
      return r.meshes
    }
    expect(meshes(false).map((m) => [m.env, m.envStrength])).toEqual([[null, 0]])
    expect(Array.from(meshes(false)[0].image!.data.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(meshes(true)[0].image!.data.slice(0, 4))).toEqual([0, 0, 255, 255])
    c.materials[0].finish = { envmap: 'GE_env_polishedMetal', intensity: 0.5 }
    const [m] = meshes(true)
    expect([m.env!.width, m.env!.height, m.envStrength]).toEqual([256, 256, 0.5])
    expect(meshes(false)[0].env!.data.buffer).not.toBe(m.env!.data.buffer)
    for (const e of shaders.ENV_MAPS) expect(envImage(gameSource(), e.name).width, e.name).toBeGreaterThan(0)
  })
})
