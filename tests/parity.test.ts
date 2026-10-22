import { readFileSync } from 'node:fs'
import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { Builder, patch, report } from '../src/core/build/patch'
import { toHex } from '../src/core/bytes'
import * as R from '../src/core/game/roster'
import { GLB } from '../src/core/mnroi/gltf'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { defaultMaterials } from '../src/worker/service'
import { gameSource, ISO } from './helpers'

const reference = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url), 'utf8'))
const load = (name: string) => imperfect.load(new Uint8Array(readFileSync(new URL(`./fixtures/${name}.imperfect`, import.meta.url))))
const sha = (d: Uint8Array) => toHex(sha256(d))
const hashes = (m: Map<string, Uint8Array>) => Object.fromEntries([...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, sha(v)]))

describe.skipIf(!ISO)('parity with the Python ImperfectLab', () => {
  for (const name of ['parity_a', 'parity_b']) {
    it(`builds ${name} as Python does`, () => {
      const c = load(name)
      const r = new Builder(gameSource(), c).build()
      const want = reference[name]
      expect(sha(r.dol!)).toBe(want.dol)
      expect(hashes(r.sets)).toEqual(want.sets)
      expect(hashes(r.adds)).toEqual(want.adds)
      expect(r.notes).toEqual(want.notes)
      expect(report(c, r)).toBe(want.report)
    })

    it.skipIf(!process.env.IMPERFECTLAB_PARITY_ISO)(`writes the same disc for ${name}`, async () => {
      const want = reference[name].iso
      const h = sha256.create()
      let n = 0
      await patch(gameSource(), load(name), { sink: { write: (chunk) => { h.update(chunk); n += chunk.length } } }, () => {}, true)
      expect(n).toBe(1459978240)
      expect(toHex(h.digest())).toBe(want)
    })
  }

  it.skipIf(!process.env.IMPERFECTLAB_GLB || !reference.glb)('imports and builds a real model as Python does', () => {
    const want = reference.glb
    const raw = new Uint8Array(readFileSync(process.env.IMPERFECTLAB_GLB!))
    const full = new Model(raw)
    const slim = imperfect.slimGlb(raw, new Set(full.materials.map((m) => m.image).filter((i): i is number => i !== null)))
    const g = new GLB(slim)
    expect(g.j).toEqual(JSON.parse(JSON.stringify(want.slim_json)))
    expect(sha(g.bin)).toBe(want.slim_bin)
    const model = new Model(slim)
    const c = imperfect.newCharacter()
    c.internalName = 'RealModel'
    c.displayName = 'REAL MODEL'
    c.base = 'johnnyohm'
    c.glb = slim
    c.materials = defaultMaterials(model)
    const auto = mapping.autoMap(model, Skeleton.ofBase(new R.BaseCharacter(gameSource(), c.base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    expect(auto.preset).toBe(want.preset)
    const m = imperfect.manifest(c)
    expect(m.model).toEqual(want.manifest.model)
    delete m.files['model/model.glb']
    expect(m.files).toEqual(want.manifest.files)
    const r = new Builder(gameSource(), c, undefined, model).build()
    expect(sha(r.dol!)).toBe(want.dol)
    expect(hashes(r.sets)).toEqual(want.sets)
    expect(hashes(r.adds)).toEqual(want.adds)
    expect(r.notes).toEqual(want.notes)
  })
})
