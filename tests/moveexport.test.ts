import { describe, expect, it } from 'vitest'
import { animGlb, animsOf, ClipFile, gameRig, guessTurn, Retarget, stateClips } from '../src/core/build/moveanim'
import { baseClips, changedClips, movesGlb } from '../src/core/build/moveexport'
import * as moves from '../src/core/build/moves'
import * as R from '../src/core/game/roster'
import { GLB, type Json } from '../src/core/mnroi/gltf'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb } from './helpers'

// Turns one joint's rotation keys in a clip by `deg` about x.
function edited(glb: Uint8Array, clip: string, joint: string, deg: number): Uint8Array {
  const g = new GLB(glb)
  const j: Json = structuredClone(g.j)
  const bin = g.bin.slice()
  const node = (j.nodes as Json[]).findIndex((n) => n.name === joint)
  const anim = (j.animations as Json[]).find((a) => a.name === clip)!
  const ch = (anim.channels as Json[]).find((c) => c.target.node === node && c.target.path === 'rotation')!
  const acc = j.accessors[anim.samplers[ch.sampler].output], view = j.bufferViews[acc.bufferView]
  const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0))
  const h = (deg * Math.PI) / 360, s = Math.sin(h), c = Math.cos(h)
  for (let i = 0; i < acc.count; i++) {
    const [x, y, z, w] = [0, 1, 2, 3].map((k) => dv.getFloat32(16 * i + 4 * k, true))
    // q · (s, 0, 0, c)
    const out = [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s]
    out.forEach((v, k) => dv.setFloat32(16 * i + 4 * k, v, true))
  }
  return rebuild(j, bin)
}

function rebuild(j: Json, bin: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(j))
  const pad = (4 - (json.length % 4)) % 4, binPad = (4 - (bin.length % 4)) % 4
  const total = 28 + json.length + pad + bin.length + binPad
  const out = new Uint8Array(total), dv = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46])
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, json.length + pad, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(json, 20)
  out.fill(0x20, 20 + json.length, 20 + json.length + pad)
  dv.setUint32(20 + json.length + pad, bin.length + binPad, true)
  dv.setUint32(24 + json.length + pad, 0x004e4942, true)
  out.set(bin, 28 + json.length + pad)
  return out
}

describe('picking a clip per state', () => {
  it("plays the clips named after the move's other states", () => {
    expect(stateClips(['BlockStart', 'Block', 'BlockEnd'], 'Block', ['BlockStart', 'Block', 'BlockEnd', 'Attack1'])).toEqual({ BlockStart: 'BlockStart', BlockEnd: 'BlockEnd' })
    expect(stateClips(['BlockStart', 'Block', 'BlockEnd'], 'block', ['blockstart', 'block'])).toEqual({ BlockStart: 'blockstart' })
    // a clip not named after a state, or a move with one state, plays one clip
    expect(stateClips(['BlockStart', 'Block', 'BlockEnd'], 'guard', ['BlockStart', 'guard'])).toBeUndefined()
    expect(stateClips(['Attack1'], 'Attack1', ['Attack1'])).toBeUndefined()
  })

  it('saves the per-state clips, and refuses a state the move lacks or a clip the file lacks', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'TestHero'
    c.base = 'wolverine'
    c.files = new Map([['animations/set.glb', animGlb(makeAnimated(['BlockStart', 'Block', 'BlockEnd']))]])
    c.moveAnims = { Block: { file: 'animations/set.glb', clip: 'Block', states: { BlockStart: 'BlockStart', BlockEnd: 'BlockEnd' } } }
    expect(imperfect.load(imperfect.save(c)).moveAnims).toEqual(c.moveAnims)
    expect(imperfect.problems(c).filter(([k, t]) => k === 'error' && t.includes('plays'))).toEqual([])
    c.moveAnims.Block.states = { BlockEnd: 'gone' }
    expect(imperfect.problems(c).some(([k, t]) => k === 'error' && t.includes('gone'))).toBe(true)
    c.moveAnims.Block.states = { Attack1: 'BlockEnd' }
    expect(() => imperfect.load(imperfect.save(c))).toThrow("isn't a state of Block")
  })
})

function makeAnimated(names: string[]): Uint8Array {
  const g = new GLB(makeGlb())
  const j: Json = structuredClone(g.j)
  const blob = [...g.bin]
  while (blob.length % 4) blob.push(0)
  const at = blob.length
  for (const v of [0, 1, 0, 0, 0, 1, 0, 0, 0, 1]) blob.push(...new Uint8Array(new Float32Array([v]).buffer))
  j.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: 8 }, { buffer: 0, byteOffset: at + 8, byteLength: 32 })
  const v = j.bufferViews.length
  j.accessors.push({ bufferView: v - 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: v - 1, componentType: 5126, count: 2, type: 'VEC4' })
  const a = j.accessors.length
  j.animations = names.map((name) => ({ name, samplers: [{ input: a - 2, output: a - 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }))
  j.buffers = [{ byteLength: blob.length }]
  return rebuild(j, new Uint8Array(blob))
}

describe.skipIf(!ISO)("a base's animations as glTF", () => {
  const setup = (key = 'wolverine') => {
    const src = gameSource()
    const base = new R.BaseCharacter(src, key)
    const model = ngmtool.read(base.bundleFiles()[0])[1][0]
    const sk = new Skeleton(model, base.body)
    return { src, base, model, sk }
  }
  const cache = new Map<string, Uint8Array>()
  const exported = (key = 'wolverine') => {
    if (!cache.has(key)) cache.set(key, movesGlb(gameSource(), new R.BaseCharacter(gameSource(), key)))
    return cache.get(key)!
  }

  it("has a clip for every state the base plays that can take one, on the game's bone names and its body", () => {
    const { src, base, sk } = setup()
    const file = new ClipFile(animGlb(exported()))
    const states = [...new Set(baseClips(src, base).map((c) => c.state))]
    expect(file.clips.map((c) => c.name)).toEqual(states)
    for (const s of ['Attack1', 'BlockStart', 'Block', 'BlockEnd', 'Walk', 'Stand']) expect(states).toContain(s)
    expect(states.some((s) => /victim/i.test(s))).toBe(false)
    expect(gameRig(file, sk)).not.toBeNull()
    expect(guessTurn(file, sk)).toBe(0)
    const g = new GLB(exported())
    expect(g.j.meshes[0].name).toBe('body')
    expect(g.j.images.length).toBeGreaterThan(0)
    expect(new GLB(animGlb(exported())).j.images).toBeUndefined()
  })

  // the largest distance and angle any body bone is off the record's
  const worst = (model: ngmtool.Model, sk: Skeleton, a: ngbtool.Record, b: ngbtool.Record) => {
    let far = 0, turned = 0
    const body = sk.nodes.filter((n) => n.group !== 'props').map((n) => n.index)
    for (let f = 0; f <= a.length; f++) {
      const x = ngbtool.pose(model, a, f), y = ngbtool.pose(model, b, f)
      for (const i of body) {
        far = Math.max(far, Math.hypot(...[0, 1, 2].map((k) => x[i][1][k] - y[i][1][k])))
        let tr = 0
        for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) tr += x[i][0][r][s] * y[i][0][r][s]
        turned = Math.max(turned, Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))))
      }
    }
    return [far, (turned * 180) / Math.PI]
  }

  for (const withModel of [false, true]) {
    it(`gives back the base's own motion, untouched${withModel ? ', with a custom model' : ''}`, () => {
      const { src, base, model, sk } = setup()
      const file = new ClipFile(animGlb(exported()))
      const m = withModel ? new Model(makeGlb()) : null
      const auto = m ? mapping.autoMap(m, sk) : { mapping: new Map(), overrides: new Map() }
      const rt = new Retarget({ model: m, mapping: auto.mapping, overrides: auto.overrides, fit: { scale: null, flip: null } }, sk, file)
      expect(rt.game).toBe(true)
      expect(rt.notes).toEqual(["on the game's skeleton, bone for bone"])
      let far = 0, turned = 0
      for (const c of baseClips(src, base)) {
        const made = rt.record(c.rec, c.state, model.nodes, moves.motionFps(c.opts))
        expect(made.length).toBe(c.rec.length)
        const [d, a] = worst(model, sk, c.rec, made)
        far = Math.max(far, d)
        turned = Math.max(turned, a)
        const props = new Set(sk.nodes.filter((n) => n.group === 'props').map((n) => n.index))
        const kept = (r: ngbtool.Record) => JSON.stringify(r.tracks.filter(([b]) => b > 0xffff || props.has(b)))
        expect(kept(made)).toBe(kept(c.rec))
      }
      expect(far).toBeLessThan(1e-3)
      expect(turned).toBeLessThan(0.1)
    })
  }

  it("keeps the base's travel and Root marker, so the camera follows as it did", () => {
    const { src, base, model, sk } = setup('magneto')
    const file = new ClipFile(animGlb(exported('magneto')))
    const rt = new Retarget({ model: null, mapping: new Map(), overrides: new Map(), fit: { scale: null, flip: null } }, sk, file)
    const travelling = moves.travelling(src, base)
    const c = baseClips(src, base).find((x) => travelling.includes(x.move))!
    const made = rt.record(c.rec, c.state, model.nodes, moves.motionFps(c.opts))
    const root = (r: ngbtool.Record) => r.tracks.find(([b, ch]) => b === 0 && ch === 1)![2]
    const end = (r: ngbtool.Record) => ngbtool.translation(root(r)[root(r).length - 1][1])
    end(made).forEach((v, k) => expect(v).toBeCloseTo(end(c.rec)[k], 3))
    const marker = sk.nodes.find((n) => n.name === 'Root marker')!.index
    const track = (r: ngbtool.Record) => JSON.stringify(r.tracks.find(([b, ch]) => b === marker && ch === 1))
    expect(track(made)).toBe(track(c.rec))
    // the base's travel instead of the clip's: still the record's, not twice over
    const based = rt.record(c.rec, c.state, model.nodes, moves.motionFps(c.opts), null, 'base')
    expect(worst(model, sk, c.rec, based)[0]).toBeLessThan(0.02)
  })

  it('finds only the clips that were changed', () => {
    const { src, base } = setup()
    const untouched = changedClips(src, base, new ClipFile(animGlb(exported())))
    expect(untouched.changed).toEqual([])
    expect(untouched.same).toBe(new Set(baseClips(src, base).map((c) => c.state)).size)
    const glb = edited(edited(exported(), 'Attack1', 'R Forearm', 30), 'BlockEnd', 'L Forearm', 20)
    const got = changedClips(src, base, new ClipFile(animGlb(glb)))
    expect(got.changed).toEqual([{ move: 'Attack1', state: 'Attack1', clip: 'Attack1' }, { move: 'Block', state: 'BlockEnd', clip: 'BlockEnd' }])
    expect(() => changedClips(src, base, new ClipFile(animGlb(makeAnimated(['Attack1']))))).toThrow("isn't on a base's skeleton")
  })

  it('builds each state of a move from its own clip', () => {
    const { src, base } = setup()
    const c = imperfect.newCharacter()
    c.internalName = 'SetHero'
    c.base = 'wolverine'
    c.files = new Map([['animations/set.glb', animGlb(edited(exported(), 'Attack1', 'R Forearm', 30))]])
    c.moveAnims = {
      Attack1: { file: 'animations/set.glb', clip: 'Attack1' },
      Block: { file: 'animations/set.glb', clip: 'Block', states: { BlockStart: 'BlockStart', BlockEnd: 'BlockEnd' } },
    }
    const mf = moves.motionFiles(src, base, c.internalName, {}, undefined, {}, null, {}, null, 1, [], null, false, null, null, animsOf(c, null))
    const played = moves.played(src, mf, c.internalName, moves.MOVE_IDS.get('Block')!)
    const lengths = (states: ngbtool.Record[]) => states.map((r) => r.length)
    const own = baseClips(src, base).filter((x) => x.move === 'Block')
    expect(lengths(played.map((p) => p.rec))).toEqual(lengths(own.map((x) => x.rec)))
    expect(mf.notes.some((n) => n.startsWith('moves: Block plays BlockStart / Block / BlockEnd ('))).toBe(true)
  })
})