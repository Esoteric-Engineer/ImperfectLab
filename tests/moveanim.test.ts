import { describe, expect, it } from 'vitest'
import { animChoice, animGlb, animsOf, ClipFile, clipList, guessTurn, parseChoice, reduce, Retarget } from '../src/core/build/moveanim'
import * as basemoves from '../src/core/build/basemoves'
import * as moves from '../src/core/build/moves'
import * as reach from '../src/core/build/reach'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex, utf8 } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as R from '../src/core/game/roster'
import { GLB, type Json } from '../src/core/mnroi/gltf'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as nmstool from '../src/core/mnroi/nmstool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { Service } from '../src/worker/service'
import type { MovePreview } from '../src/worker/protocol'
import { fileReader, gameSource, ISO, makeGlb } from './helpers'

type V3 = [number, number, number]

interface Channel {
  node: string
  path: 'rotation' | 'translation'
  times: number[]
  values: number[][]
}

// A GLB with clips added, on the joints named (after the rig's prefix).
function withClips(glb: Uint8Array, clips: Record<string, Channel[]>, prefix = 'mixamorig:'): Uint8Array {
  const g = new GLB(glb)
  const j: Json = structuredClone(g.j)
  const blob = [...g.bin]
  const add = (flat: number[], count: number, type: string, minmax = false) => {
    while (blob.length % 4) blob.push(0)
    const bytes = new Uint8Array(flat.length * 4), dv = new DataView(bytes.buffer)
    flat.forEach((v, i) => dv.setFloat32(4 * i, v, true))
    j.bufferViews.push({ buffer: 0, byteOffset: blob.length, byteLength: bytes.length })
    blob.push(...bytes)
    const acc: Json = { bufferView: j.bufferViews.length - 1, componentType: 5126, count, type }
    if (minmax) Object.assign(acc, { min: [Math.min(...flat)], max: [Math.max(...flat)] })
    return j.accessors.push(acc) - 1
  }
  j.animations = Object.entries(clips).map(([name, chans]) => {
    const samplers: Json[] = [], channels: Json[] = []
    for (const ch of chans) {
      const node = j.nodes.findIndex((n: Json) => n.name === prefix + ch.node)
      samplers.push({ input: add(ch.times, ch.times.length, 'SCALAR', true), output: add(ch.values.flat(), ch.values.length, ch.path === 'rotation' ? 'VEC4' : 'VEC3') })
      channels.push({ sampler: samplers.length - 1, target: { node, path: ch.path } })
    }
    return { name, samplers, channels }
  })
  while (blob.length % 4) blob.push(0)
  j.buffers = [{ byteLength: blob.length }]
  let js = utf8(JSON.stringify(j))
  if (js.length % 4) {
    const p = new Uint8Array(js.length + ((4 - (js.length % 4)) % 4)).fill(0x20)
    p.set(js)
    js = p
  }
  const total = 28 + js.length + blob.length
  const out = new Uint8Array(total), dv = new DataView(out.buffer)
  out.set(utf8('glTF'))
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, js.length, true)
  out.set(utf8('JSON'), 16)
  out.set(js, 20)
  dv.setUint32(20 + js.length, blob.length, true)
  out.set(utf8('BIN\0'), 24 + js.length)
  out.set(blob, 28 + js.length)
  return out
}

const S45 = Math.SQRT1_2
// the right forearm swings 90° about y (its hand from pointing out to the side to pointing forward), the hips rise 0.1 m
const BEND: Channel[] = [
  { node: 'RightForeArm', path: 'rotation', times: [0, 1 / 3], values: [[0, 0, 0, 1], [0, S45, 0, S45]] },
  { node: 'Hips', path: 'translation', times: [0, 1 / 3], values: [[0, 1.0, 0], [0, 1.1, 0]] },
]
const STILL: Channel[] = [{ node: 'Hips', path: 'translation', times: [0, 0.5, 1], values: [[0, 1.0, 0], [0, 1.0, 0], [0, 1.0, 0]] }]

const PUNCH: Channel[] = [
  { node: 'Hips', path: 'rotation', times: [0, 0.2], values: [[0, S45, 0, S45], [0, S45, 0, S45]] },
  { node: 'RightArm', path: 'rotation', times: [0, 0.2], values: [[0, S45, 0, S45], [0, S45, 0, S45]] },
  { node: 'LeftArm', path: 'rotation', times: [0, 0.2], values: [[0, 0, -S45, S45], [0, 0, -S45, S45]] },
]

// a left jab: both arms down, the left one straight ahead at 4/30 s and back down by 8/30
const DOWN_L = [0, 0, -S45, S45], AHEAD_L = [0, -S45, 0, S45]
const JAB: Channel[] = [
  { node: 'LeftArm', path: 'rotation', times: [0, 2 / 30, 4 / 30, 6 / 30, 8 / 30, 0.5], values: [DOWN_L, DOWN_L, AHEAD_L, DOWN_L, DOWN_L, DOWN_L] },
  { node: 'RightArm', path: 'rotation', times: [0, 0.5], values: [[0, 0, S45, S45], [0, 0, S45, S45]] },
]

const LONG_STILL: Channel[] = [{ node: 'Hips', path: 'translation', times: [0, 3], values: [[0, 1.0, 0], [0, 1.0, 0]] }]
const clipGlb = () => withClips(makeGlb(), { bend: BEND, still: STILL, long_still: LONG_STILL })

describe('animation files', () => {
  it('lists the clips and their lengths, and keeps them when slimmed', () => {
    const raw = clipGlb()
    const file = new ClipFile(raw)
    expect(file.clips.map((x) => x.name)).toEqual(['bend', 'still', 'long_still'])
    expect(file.clips[0].seconds).toBeCloseTo(1 / 3, 5)
    expect(file.joints.get('mixamorig:Hips')).toBe(0)
    const slim = animGlb(raw)
    const j = new GLB(slim).j
    expect(j.meshes).toBeUndefined()
    expect(j.materials).toBeUndefined()
    expect(j.nodes.some((n: Json) => n.mesh !== undefined || n.skin !== undefined)).toBe(false)
    const again = new ClipFile(slim)
    expect(again.clips).toEqual(file.clips)
    expect([...again.joints]).toEqual([...file.joints])
    expect(clipList(slim).map((x) => x.name)).toEqual(['bend', 'still', 'long_still'])
  })

  it('refuses a file with no animations or no skin', () => {
    expect(() => new ClipFile(makeGlb())).toThrow('no animations')
    expect(() => new ClipFile(new Uint8Array(30))).toThrow(LabError)
    expect(clipList(new Uint8Array(30))).toEqual([])
  })

  it('reads a picker value back', () => {
    const p = { file: 'animations/a_b.glb', clip: 'power_3#x' }
    expect(parseChoice(animChoice(p))).toEqual(p)
    expect(parseChoice('wolverine')).toBeNull()
  })

  it('drops the keys a line through their neighbours gives', () => {
    const keys: [number, number[]][] = [[0, [0]], [1, [1]], [2, [2]], [3, [3]], [4, [1]], [5, [1]], [6, [1]]]
    expect(reduce(keys, 1e-6).map(([f]) => f)).toEqual([0, 3, 4, 6])
    expect(reduce([[0, [5]], [1, [5]], [2, [5]]], 1e-6).map(([f]) => f)).toEqual([0, 2])
  })
})

describe('the project file', () => {
  const character = () => {
    const c = imperfect.newCharacter()
    c.internalName = 'TestHero'
    c.base = 'wolverine'
    c.files = new Map([['animations/hero.glb', animGlb(clipGlb())]])
    c.moveAnims = { PowerOn: { file: 'animations/hero.glb', clip: 'bend' } }
    return c
  }

  it('saves and loads the moves played from clips', () => {
    const c = character()
    const back = imperfect.load(imperfect.save(c))
    expect(back.moveAnims).toEqual(c.moveAnims)
    expect([...back.files.keys()]).toEqual(['animations/hero.glb'])
    expect(imperfect.manifest(imperfect.newCharacter()).move_anims).toBeUndefined()
    expect(imperfect.animFiles(back).map(([m, n, clips]) => [m, n, clips.length])).toEqual([['animations/hero.glb', 'hero', 3]])
    expect(back.moveAnimFiles).toEqual({})
    expect(JSON.stringify(imperfect.manifest(c).move_anims)).not.toContain('timing')
    c.moveAnims.PowerOn.timing = 'clip'
    c.moveAnims.PowerOn.travel = 'base'
    expect(imperfect.load(imperfect.save(c)).moveAnims.PowerOn).toEqual({ file: 'animations/hero.glb', clip: 'bend', timing: 'clip', travel: 'base' })
    delete c.moveAnims.PowerOn.timing
    delete c.moveAnims.PowerOn.travel
    c.moveAnimFiles = { 'animations/hero.glb': { turn: -90 } }
    expect(imperfect.load(imperfect.save(c)).moveAnimFiles).toEqual(c.moveAnimFiles)
  })

  it('refuses a clip on an unknown move, a throw, a missing file, or a move taken twice', () => {
    const reload = (edit: (c: imperfect.Character) => void) => {
      const c = character()
      edit(c)
      return () => imperfect.load(imperfect.save(c))
    }
    expect(reload((c) => { c.moveAnims = { Nope: c.moveAnims.PowerOn } })).toThrow('unknown move')
    expect(reload((c) => { c.moveAnims = { Throw: c.moveAnims.PowerOn } })).toThrow('opponent')
    expect(reload((c) => { c.files = new Map() })).toThrow('lacks')
    expect(reload((c) => { c.moves = { PowerOn: 'daredevil' } })).toThrow('another base')
    expect(reload((c) => { c.moveIdle = ['PowerOn'] })).toThrow('idle')
    expect(reload((c) => { c.moveAnimFiles = { 'animations/other.glb': { turn: 90 } } })).toThrow('lacks')
    expect(reload((c) => { c.moveAnimFiles = { 'animations/hero.glb': { turn: 270 } } })).toThrow('-180 to 180')
    expect(reload((c) => { (c.moveAnims.PowerOn as { timing?: string }).timing = 'base' })).toThrow('timing')
    expect(reload((c) => { (c.moveAnims.PowerOn as { travel?: string }).travel = 'clip' })).toThrow('travel')
  })

  it('finds a missing clip, and a file no move plays', () => {
    const c = character()
    c.moveAnims.PowerOn = { ...c.moveAnims.PowerOn, clip: 'gone' }
    expect(imperfect.problems(c).some(([k, t]) => k === 'error' && t.includes('gone'))).toBe(true)
    c.moveAnims = {}
    expect(imperfect.problems(c).some(([k, t]) => k === 'warning' && t.includes('no move plays it'))).toBe(true)
  })
})

describe.skipIf(!ISO)('retargeting a clip', () => {
  const setup = (key = 'wolverine') => {
    const src = gameSource()
    const base = new R.BaseCharacter(src, key)
    const model = ngmtool.read(base.bundleFiles()[0])[1][0]
    const sk = new Skeleton(model, base.body)
    const glb = clipGlb()
    const m = new Model(glb)
    const auto = mapping.autoMap(m, sk)
    const file = new ClipFile(animGlb(glb))
    const rt = new Retarget({ model: m, mapping: auto.mapping, overrides: auto.overrides, fit: { scale: null, torso_squash: true, flip: null } }, sk, file)
    const set = moves.motionSetOf(base)
    const anim = moves.resolved(src, nmstool.parse(src.entry(`Motions/${set}`)), () => true).get('attack1')!.anim
    const template = ngbtool.parse(src.entry(`Bundles/${moves.stemOf(set)}.ngb`)).find((r) => r.name.toLowerCase() === anim.toLowerCase())!
    return { model, sk, m, auto, file, rt, template }
  }
  const dir = (a: V3, b: V3): V3 => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(...d)
    return d.map((x) => x / n) as V3
  }
  const conv = (rt: Retarget, v: V3): V3 => [0, 1, 2].map((i) => rt.C[i][0] * v[0] + rt.C[i][1] * v[1] + rt.C[i][2] * v[2]) as V3

  it("turns the game's forearm as the clip turns the joint, and lifts the pelvis by the fit's scale", () => {
    const { model, sk, rt, template } = setup()
    const rec = rt.record(template, 'bend', model.nodes, 30)
    expect(rec.length).toBe(10)
    const fore = sk.node('R.forearm')!, hand = sk.node('R.hand')!, pelvis = sk.node('pelvis')!
    const first = ngbtool.pose(model, rec, 0), last = ngbtool.pose(model, rec, rec.length)
    // at rest the forearm points as the model's does (out to its side), after the bend as the turned joint does (forward)
    const side = conv(rt, [-1, 0, 0]), ahead = conv(rt, [0, 0, 1])
    dir(first[fore][1], first[hand][1]).forEach((v, i) => expect(v).toBeCloseTo(side[i], 2))
    dir(last[fore][1], last[hand][1]).forEach((v, i) => expect(v).toBeCloseTo(ahead[i], 2))
    expect(last[pelvis][1][2] - first[pelvis][1][2]).toBeCloseTo(0.1 * rt.fit.S, 3)
  })

  it("keeps the template's events, stretched, and its flagged tracks", () => {
    const { model, rt, template } = setup()
    const rec = rt.record(template, 'bend', model.nodes, 30)
    const k = rec.length / template.length
    expect(rec.events.length).toBe(template.events.length)
    rec.events.forEach(([f, ...rest], i) => {
      expect(rest).toEqual(template.events[i].slice(1))
      expect(f).toBeCloseTo(Math.min(rec.length, template.events[i][0] * k), 1)
    })
    expect(rec.tracks.filter(([b]) => b > 0xffff).length).toBe(template.tracks.filter(([b]) => b > 0xffff).length)
    expect(rec.extra.length).toBe(template.extra.length)
    for (const [, , keys] of rec.tracks) for (const [f] of keys) expect(f).toBeLessThanOrEqual(rec.length)
  })

  it("keeps the base's travel and its Root marker, and carries the clip's body along with them", () => {
    const { model, sk, rt, template } = setup()
    const marker = sk.nodes.find((x) => x.name === 'Root marker')!.index
    const last = (r: ngbtool.Record, b: number) => {
      const keys = r.tracks.find(([bb, ch]) => bb === b && ch === 1)?.[2] ?? []
      return keys.length ? ngbtool.translation(keys[keys.length - 1][1]) : [0, 0, 0]
    }
    expect(Math.hypot(...last(template, 0).slice(0, 2))).toBeGreaterThan(0.1)
    // a 3 s clip, longer than Wolverine's attack: no squeeze, so the whole travel
    const rec = rt.record(template, 'long_still', model.nodes, 30, null, 'base')
    expect(rec.length).toBeGreaterThan(template.length)
    last(rec, 0).forEach((v, i) => expect(v).toBeCloseTo(last(template, 0)[i], 2))
    last(rec, marker).forEach((v, i) => expect(v).toBeCloseTo(last(template, marker)[i], 2))
    const pelvis = sk.node('pelvis')!
    const moved = ngbtool.pose(model, rec, rec.length)[pelvis][1][1] - ngbtool.pose(model, rec, 0)[pelvis][1][1]
    expect(moved).toBeCloseTo(last(template, 0)[1] - ngbtool.translation(rec.tracks.find(([b, ch]) => b === 0 && ch === 1)![2][0][1])[1], 2)
  })

  it("with the clip's own travel, leaves out the Root marker's, so it stays on Root (the camera follows it)", () => {
    // Magneto's attacks move the Root marker against the travel
    const { model, sk, rt, template } = setup('magneto')
    const marker = sk.nodes.find((x) => x.name === 'Root marker')!.index
    expect(template.tracks.some(([b, ch]) => b === marker && ch === 1)).toBe(true)
    const rec = rt.record(template, 'still', model.nodes, 30)
    expect(rt.travelled).toBeNull()
    expect(rec.tracks.some(([b, ch]) => b === marker && ch === 1)).toBe(false)
    // the clip stands still: Root barely moves
    const keys = rec.tracks.find(([b, ch]) => b === 0 && ch === 1)![2]
    expect(Math.max(...keys.map(([, v]) => Math.hypot(...ngbtool.translation(v).slice(0, 2))))).toBeLessThan(1e-3)
  })

  it('squeezes a travel into a short clip no faster than half again the base\'s', () => {
    const { model, rt, template } = setup()
    const top = (r: ngbtool.Record) => {
      const keys = r.tracks.find(([b, ch]) => b === 0 && ch === 1)![2]
      let best = 0
      for (let f = 0; f < r.length; f++) {
        const a = ngbtool.translation(ngbtool.sample(keys, f)), b = ngbtool.translation(ngbtool.sample(keys, f + 1))
        best = Math.max(best, Math.hypot(b[0] - a[0], b[1] - a[1]))
      }
      return best
    }
    // bend is a third of a second: Wolverine's attack squeezed to 10 frames
    const rec = rt.record(template, 'bend', model.nodes, 30, null, 'base')
    expect(rec.length).toBe(10)
    expect(top(rec)).toBeLessThanOrEqual(top(template) * 1.5 + 0.01)
    expect(rt.travelled?.shortened).toBe(true)
  })

  it('guesses the turn that faces a file\'s attacks forward, and turns its clips by it', () => {
    const { model, sk, m, auto, template } = setup()
    const file = new ClipFile(animGlb(withClips(makeGlb(), { attack_punch: PUNCH, still: STILL })))
    expect(guessTurn(file, sk)).toBe(-90)
    expect(guessTurn(file, sk, auto.mapping)).toBe(-90)
    expect(guessTurn(new ClipFile(animGlb(clipGlb())), sk)).toBe(0)
    const rig = { model: m, mapping: auto.mapping, overrides: auto.overrides, fit: { scale: null, flip: null } }
    const reach = (turn: number) => {
      const rt = new Retarget(rig, sk, file, turn)
      const rec = rt.record(template, 'attack_punch', model.nodes, 30)
      const P = ngbtool.pose(model, rec, rec.length)
      return dir(P[sk.node('R.upper_arm')!][1], P[sk.node('R.hand')!][1])
    }
    // as in the file the punch goes to the character's left, turned it goes ahead
    const left = reach(0), ahead = reach(-90)
    expect(left[0]).toBeLessThan(-0.95)
    expect(ahead[1]).toBeGreaterThan(0.95)
  })

  // pins the records as first built
  it('builds the same records with the base\'s timing and the clip\'s travel as it did', () => {
    const { model, sk, m, auto, template } = setup()
    const file = new ClipFile(animGlb(withClips(makeGlb(), { bend: BEND, still: STILL, attack_punch: PUNCH })))
    const rig = { model: m, mapping: auto.mapping, overrides: auto.overrides, fit: { scale: null, flip: null } }
    const hash = (turn: number, clip: string) => toHex(sha256(ngbtool.writeRecord(new Retarget(rig, sk, file, turn).record(template, clip, model.nodes, 30))))
    const want: Record<string, string> = {
      'bend 0': '9eb748724d47a8bd708c2979963fbf065e69574126111872112165bb8268792b',
      'bend -90': '591d3d48d0016c0133140261262ae80962600bbf29c2a1341a611baf6e8bb37d',
      'still 0': '159f238acadc9c3f626b1e28456e05b914dac8b431ccfe558fb78736dcf894a5',
      'still -90': '05e1e36eb8f7a5d1925f731fc6b07d041ec847fe7ebce64edbb1597a5fca39b3',
      'attack_punch 0': 'aa29a475f28f7321ff1c701070d824966d5ceb995ccc3753a98a27e1acfdd980',
      'attack_punch -90': '57fe00e0c1a86b8a0479311a1a29aaf956bf5d8890882280efe063a2907509ae',
    }
    for (const [key, sum] of Object.entries(want)) {
      const [clip, turn] = key.split(' ')
      expect(hash(Number(turn), clip), key).toBe(sum)
    }
  })

  it("moves the template's hits onto the clip's strike, on the clip's limb, when timed from the clip", () => {
    const { model, sk, m, auto, template } = setup()
    const file = new ClipFile(animGlb(withClips(makeGlb(), { attack_jab: JAB })))
    const rt = new Retarget({ model: m, mapping: auto.mapping, overrides: auto.overrides, fit: { scale: null, flip: null } }, sk, file)
    const stretched = rt.record(template, 'attack_jab', model.nodes, 30)
    expect(rt.timed).toBeNull()
    const timed = rt.record(template, 'attack_jab', model.nodes, 30, 'clip')
    expect(rt.timed).not.toBeNull()
    expect(timed.tracks.map(([b, ch]) => `${b}.${ch}`)).toEqual(stretched.tracks.map(([b, ch]) => `${b}.${ch}`))
    expect(timed.events.length).toBe(template.events.length)
    expect(timed.events.every(([f]) => f >= 0 && f <= timed.length)).toBe(true)
    const p = reach.plan(timed.events, timed.length)!
    expect(p.kind).toBe('hit')
    expect(p.windows.some((w) => w.limb === 'left_arm' && w.from <= 4 && 4 <= w.to)).toBe(true)
    expect(moves.hitsText(rt.timed!)).toMatch(/^hits from the clip: left arm at /)
  })

  it('refuses a clip from a rig without the joints the model maps', () => {
    const { sk, m, auto } = setup()
    const other = new ClipFile(animGlb(withClips(makeGlb(undefined, 'other:'), { still: STILL }, 'other:')))
    expect(() => new Retarget({ model: m, mapping: auto.mapping, overrides: auto.overrides, fit: { scale: null, flip: null } }, sk, other)).toThrow("model's rig")
  })

  it('builds the moves into the motion set, and the previewer plays them', () => {
    const src = gameSource()
    const base = new R.BaseCharacter(src, 'wolverine')
    const c = imperfect.newCharacter()
    c.internalName = 'Synth'
    c.base = 'wolverine'
    c.glb = makeGlb()
    c.materials = [imperfect.newMaterial(0, 'skin', true, '', [64, 64])]
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(base))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    c.files = new Map([['animations/hero.glb', animGlb(clipGlb())]])
    c.moveAnims = { PowerOn: { file: 'animations/hero.glb', clip: 'bend' } }
    const mf = moves.motionFiles(src, base, c.internalName, {}, undefined, {}, null, {}, null, 1, [], null, false, null, null, animsOf(c, new Model(c.glb)))
    const played = moves.played(src, mf, c.internalName, moves.MOVE_IDS.get('PowerOn')!)
    expect(played.length).toBeGreaterThan(0)
    // the clip keeps its length in seconds at the motion line's rate
    const fps = moves.motionFps(played[0].opts)
    expect(played.every((p) => p.rec.length === Math.round(fps / 3))).toBe(true)
    expect(mf.notes.some((n) => n.startsWith(`moves: Power on plays bend (${Math.round(fps / 3)} frames; Wolverine's timing cues `))).toBe(true)

    const s = new Service()
    s.openImage(fileReader(ISO!), ISO!)
    const pick = animChoice({ file: 'animations/hero.glb', clip: 'still' })
    const r = s.movePreview({ ...c, moveAnims: {} }, 'PowerOn', pick) as MovePreview | string
    if (typeof r === 'string') throw new Error(r)
    expect(r.variants.length).toBeGreaterThan(0)
    expect(r.variants[0].rec.length).toBe(Math.round(r.variants[0].fps))
    expect(r.notes.some((n) => n.startsWith('Power on plays still'))).toBe(true)
    // Power on has no hits, so a clip's timing keeps the stretched cues and says so
    const t = s.movePreview({ ...c, moveAnims: {} }, 'PowerOn', pick, 'clip') as MovePreview
    expect(t.notes.some((n) => n.includes('no hits to time from the clip'))).toBe(true)
    expect(Object.keys(t.hitBones).sort()).toEqual(['left_arm', 'left_leg', 'right_arm', 'right_leg'])
  })

  it("plays a clip on Daredevil's throw moves over the long throw, held while the club flies at the base's pace", () => {
    const src = gameSource()
    const base = new R.BaseCharacter(src, 'daredevil')
    const c = imperfect.newCharacter()
    c.internalName = 'Synth'
    c.base = 'daredevil'
    c.glb = makeGlb()
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(base))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    c.files = new Map([['animations/hero.glb', animGlb(clipGlb())]])
    c.moveAnims = Object.fromEntries(basemoves.THROW_MOVES.map((id) => [id, { file: 'animations/hero.glb', clip: 'bend' }]))
    const mf = moves.motionFiles(src, base, c.internalName, {}, 35, {}, null, {}, null, 1, [], null, false, null, null, animsOf(c, new Model(c.glb)))
    const model = ngmtool.read(base.bundleFiles()[0])[1][0]
    for (const id of basemoves.THROW_MOVES) {
      const played = moves.played(src, mf, c.internalName, moves.MOVE_IDS.get(id)!)
      expect(played.length).toBeGreaterThan(0)
      for (const { rec } of played) {
        expect(rec.events.some(([, t]) => t === basemoves.MIRROR_EVENT)).toBe(true)
        const club = Array.from({ length: rec.length + 1 }, (_, f) => ngbtool.pose(model, rec, f)[basemoves.CLUB][1])
        const steps = club.slice(1).map((p, f) => Math.hypot(p[0] - club[f][0], p[1] - club[f][1], p[2] - club[f][2]))
        expect(Math.max(...club.map((p) => Math.hypot(p[0] - club[0][0], p[1] - club[0][1], p[2] - club[0][2])))).toBeGreaterThan(34)
        // 36 frames out and back at Daredevil's 2 m a frame, the last a snap back to the hand
        expect(steps.filter((d) => d > 1.8 && d < 2)).toHaveLength(35)
        expect(steps.filter((d) => d >= 2).length).toBeLessThanOrEqual(1)
      }
    }
    expect(mf.notes.filter((n) => n.includes('while the club flies 35 m'))).toHaveLength(basemoves.THROW_MOVES.length)
  })
})
