import { describe, expect, it } from 'vitest'
import { Effects } from '../src/core/build/effects'
import * as gun from '../src/core/build/gun'
import { GUN_PICK_VALUE } from '../src/core/game/dol'
import * as holster from '../src/core/build/holster'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import type { Tri } from '../src/core/model/fit'

type V3 = [number, number, number]

const AT = new Map<number, [V3, number]>([
  [0, [[0, 0, 0], -1]], [1, [[0, 0, 1], 0]], [2, [[0, 0, 1.2], 1]], [3, [[0, 0, 1.4], 2]],
  [22, [[0.05, 0, 1.55], 3]], [23, [[0.2, 0, 1.55], 22]], [24, [[0.35, 0, 1.55], 23]], [25, [[0.48, 0, 1.55], 24]],
  [26, [[0.6, 0, 1.55], 25]], [27, [[0.75, 0, 1.55], 26]], [38, [[0.55, 0, 1.62], 26]], [39, [[0.65, 0, 1.62], 38]],
])
const nodes = (count: number): ngmtool.Node[] => Array.from({ length: count }, (_, i): ngmtool.Node => {
  const [p, parent] = AT.get(i) ?? [[0, 0, 0] as V3, 0]
  const q = parent < 0 ? [0, 0, 0] : AT.get(parent)![0]
  return [[p[0] - q[0], p[1] - q[1], p[2] - q[2], 0], [-p[0], -p[1], -p[2], 0], parent, 0]
})
const MODEL: Pick<ngmtool.Model, 'nodes'> = { nodes: nodes(40) }
const ARM: holster.Arm = { upper: 23, fore: 25, hand: 27 }
const PROP: holster.Prop = { bone: 39, anchor: 1, side: 'R', hand: 27 }
const HAND: V3 = [0.75, 0, 1.55]

// A pistol in the right hand at bind: the barrel out along +X above the hand, the grip down through it.
function pistol(): Tri[] {
  const v = (p: V3): Tri[number] => [p, [0, 0, 1], [0, 0], [[39, 1]]]
  const box = (lo: V3, hi: V3): Tri[] => {
    const c = [0, 1, 2, 3, 4, 5, 6, 7].map((i): V3 => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
    return [[v(c[0]), v(c[1]), v(c[2])], [v(c[3]), v(c[4]), v(c[5])], [v(c[6]), v(c[7]), v(c[0])]]
  }
  return [...box([0.7, -0.02, 1.57], [1.0, 0.02, 1.62]), ...box([0.72, -0.02, 1.45], [0.78, 0.02, 1.57]), ...box([0.69, -0.015, 1.43], [0.75, 0.015, 1.47])]
}

function record(length: number, shots: number[]): ngbtool.Record {
  return {
    name: 'T.nad', length, head: new Uint8Array(0x30), pointers: [1], extra: [],
    events: shots.map((f): ngbtool.Event => [f, 0x04, 0, 0]),
    tracks: [[0, 1, [[0, ngbtool.encodeTranslation([0, 0, 0])], [length, ngbtool.encodeTranslation([0, 0.1, 0])]]]],
  }
}

describe('gun', () => {
  it('finds the barrel, the muzzle and which way is up', () => {
    const g = gun.geometry([pistol()], 39, HAND)
    g.barrel.forEach((x, k) => expect(x).toBeCloseTo([1, 0, 0][k], 2))
    g.up.forEach((x, k) => expect(x).toBeCloseTo([0, 0, 1][k], 1))
    expect(g.muzzle[0]).toBeCloseTo(1.0, 3)
    expect(() => gun.geometry([pistol()], 59, HAND)).toThrow(/nothing is fixed to game bone 59/)
    expect(gun.sized(g, 2).muzzle[0]).toBeCloseTo(2.0, 3)
  })

  it('kicks the muzzle up after each shot and settles', () => {
    expect(gun.recoil([6, 12], 5)).toBe(0)
    expect(gun.recoil([6, 12], 7)).toBeGreaterThan(gun.recoil([6, 12], 6.5))
    expect(gun.recoil([6, 12], 11)).toBe(0)
    expect(gun.recoil([6, 12], 13)).toBeCloseTo(gun.recoil([6, 12], 7), 6)
  })

  it('aims the gun straight ahead at every shot, with the arm out in front', () => {
    const g = gun.geometry([pistol()], 39, HAND)
    const out = gun.aim(record(36, [6, 12]), MODEL, PROP, g, ARM)
    const bind = ngbtool.pose(MODEL, null, 0)
    for (const t of [6, 12]) {
      const p = ngbtool.pose(MODEL, out, t)
      const dir = holster.apply(p[27][0], g.barrel), up = holster.apply(p[27][0], g.up)
      dir.forEach((x, k) => expect(x).toBeCloseTo([0, 1, 0][k], 2))
      expect(up[2]).toBeGreaterThan(0.99)
      expect(p[27][1][1] - p[23][1][1]).toBeGreaterThan(0.3)
    }
    const kick = holster.apply(ngbtool.pose(MODEL, out, 7)[27][0], g.barrel)
    expect(kick[2]).toBeGreaterThan(0.1)
    const end = ngbtool.pose(MODEL, out, 36)
    expect(Math.hypot(...holster.sub(end[27][1], ngbtool.pose(MODEL, record(36, []), 36)[27][1]))).toBeLessThan(1e-3)
    expect(bind[27][1]).toEqual(HAND)
    expect(() => gun.aim(record(36, []), MODEL, PROP, g, ARM)).toThrow(/no shot/)
  })

  it("keeps a machine gun's arm aimed from the first frame to the last", () => {
    const g = gun.geometry([pistol()], 39, HAND)
    const out = gun.aim(record(11, [2, 5, 8]), MODEL, PROP, g, ARM, true)
    for (const t of [0, 2]) holster.apply(ngbtool.pose(MODEL, out, t)[27][0], g.barrel).forEach((x, k) => expect(x).toBeCloseTo([0, 1, 0][k], 2))
    for (const t of [0, 11]) {
      const p = ngbtool.pose(MODEL, out, t)
      expect(p[27][1][1] - p[23][1][1]).toBeGreaterThan(0.3)
    }
  })

  it("fires a burst from Elektra's first throw, from the muzzle with the gun's sound, without her effects or hits", () => {
    const events: ngbtool.Event[] = [[0, 0x4f, 2, 0], [1, 0x4e, 3, 0], [2, 0x48, 4, 0], [3, 0x18, 0, 0], [4.8, 0x17, gun.THROW_SOUND, 2], [5, 0x17, 36, 700], [6, 0x04, 0, 1], [12, 0x04, 0, 1]]
    const head: ngbtool.Event[] = [[1, 0x4e, GUN_PICK_VALUE, 0], [1, 0x4f, gun.MUZZLE_INDEX, 0]]
    expect(gun.shotEvents(events, [99, 5], 2, 30)).toEqual([[...head, [5, 0x17, 36, 700], [6, 0x17, 99, 5], [6, 0x04, 0, 1], [9, 0x17, 99, 5], [9, 0x04, 0, 1]], 30])
    expect(gun.shotEvents(events, null, 2, 30)[0].filter(([, t]) => t === 0x17)).toEqual([[5, 0x17, 36, 700]])
    const fires = (bullets: number, length: number, grow = false) => {
      const [out, n] = gun.shotEvents(events, null, bullets, length, grow)
      return [out.filter(([, t]) => t === 0x04).map(([f]) => f), n]
    }
    expect(fires(1, 30)).toEqual([[6], 30])
    expect(fires(5, 30)).toEqual([[6, 9, 12, 15, 18], 30])
    expect(fires(5, 20)).toEqual([[6, 7, 8, 9, 10], 20])
    expect(fires(10, 20, true)).toEqual([[6, 9, 12, 15, 18, 21, 24, 27, 30, 33], 43])
    expect(fires(3, 30, true)).toEqual([[6, 9, 12], 30])
    const held = gun.shotEvents(events, null, 3, 30, true, true)
    expect([held[0].filter(([, t]) => t === 0x04).map(([f]) => f), held[1]]).toEqual([[2, 5, 8], 11])
    expect(() => gun.shotEvents([[1, 0x04, 0, 0]], null, 2, 30)).toThrow(/no shot/)
  })

  it('puts the muzzle attachment on the gun bone where the muzzle is', () => {
    const g = gun.geometry([pistol()], 39, HAND)
    const [node, kind, index, mat] = gun.muzzleAttachment(39, MODEL, g)
    expect([node, kind, index]).toEqual([39, gun.MUZZLE_KIND, gun.MUZZLE_INDEX])
    expect(mat[12]).toBeCloseTo(1.0 - 0.65, 3)
  })

  it('uses a free forearm prop bone of a male skeleton and adds one on the hand otherwise', () => {
    const male = { nodes: nodes(72), attachments: [] }
    expect(gun.bone(male, 'male', 'R')).toEqual([39, false])
    expect(gun.bone(male, 'male', 'L')).toEqual([59, false])
    expect(gun.extraNode(male, 'male', 'R')).toEqual([])
    const club = { nodes: nodes(88), attachments: [[39, 43, 0, []]] as ngmtool.Attachment[] }
    expect(gun.bone(club, 'male', 'R')).toEqual([88, true])
    expect(gun.bone(club, 'male', 'L')).toEqual([59, false])
    expect(gun.extraNode(club, 'male', 'R')).toEqual([[[0, 0, 0, 0], club.nodes[27][1], 27, club.nodes[27][3]]])
    const female = Object.assign(new ngmtool.Model(), { nodes: nodes(81) })
    expect(gun.bone(female, 'female', 'R')).toEqual([81, true])
    const rigged = gun.rig(female, 'female', 'L')
    expect(rigged.nodes.length).toBe(82)
    expect(rigged.nodes[81][2]).toBe(42)
    expect(ngbtool.pose(rigged, null, 0)[81][1]).toEqual(ngbtool.pose(rigged, null, 0)[42][1])
    expect(female.nodes.length).toBe(81)
    expect(gun.prop(female, 'female', 'R')).toEqual({ bone: 81, anchor: 58, side: 'R', hand: 27 })
  })

  it("holsters the gun at run time where the baked holster puts it, from the thigh's skin matrix", () => {
    const plan: holster.Plan = { position: [0.1, 0.02, -0.2], rotation: [10, 90, -20], center: [0.7, 0, 1.5], prop: PROP }
    const e = gun.entry('Deadpool', MODEL, plan, 7.5, true, ARM)
    expect([e.bone, e.hand, e.thigh, e.nodes, e.energy, e.automatic]).toEqual([39, 27, 1, 40, 7.5, true])
    expect(e.bind).toEqual(ngbtool.pose(MODEL, null, 0)[39][1])
    const rec = { ...record(10, []), tracks: [[1, 0, [[0, ngbtool.encodeRotation(ngbtool.matQuat(holster.turn([30, -10, 45])))]]], [1, 1, [[0, ngbtool.encodeTranslation([0.2, -0.1, 0.05])]]]] as ngbtool.Track[] }
    const posed = ngbtool.pose(MODEL, rec, 0)
    const [GR, GT] = holster.stowedAt(MODEL as ngmtool.Model, plan)(posed)
    const thighBind = ngbtool.pose(MODEL, null, 0)[1][1]
    const skin = (p: number[]) => holster.add(holster.apply(posed[1][0], holster.sub(p as V3, thighBind)), posed[1][1])
    const k = (p: V3): V3 => [0, 1, 2].map((c) => p[0] * e.k[c] + p[1] * e.k[3 + c] + p[2] * e.k[6 + c] + e.k[9 + c]) as V3
    for (const p of [[0.7, 0, 1.5], [1.0, 0.02, 1.62], [0.69, -0.015, 1.43]] as V3[]) {
      const want = holster.add(holster.apply(GR, holster.sub(p, e.bind)), GT)
      skin(k(p)).forEach((x, i) => expect(x).toBeCloseTo(want[i], 5))
    }
  })

  it('reaches with the arm and everything under it but the gun', () => {
    const plan: holster.Plan = { position: [0, 0, 0], rotation: [0, 0, 0], center: [0, 0, 0], prop: PROP }
    const e = gun.entry('Deadpool', MODEL, plan, 0, false, ARM, 0.4)
    expect([e.upper, e.fore, e.draw]).toEqual([23, 25, 0.4])
    expect(e.arm).toEqual([23, 25, 27].map((b) => ngbtool.pose(MODEL, null, 0)[b][1]))
    expect(e.moves).toEqual([[23, 24, 25, 26, 27, 38], [25, 26, 27, 38], [27]])
    expect(gun.reachBones(MODEL, ARM, 27)).toEqual([[23, 24, 25, 26, 38, 39], [25, 26, 38, 39], []])
  })

  it('draws the bullet as a streak and a glow', () => {
    const fx = new Effects(new Uint8Array())
    const name = gun.tracer(fx, 'Deadpool')
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(fx.build())).map((b) => [b.name, b]))
    const top = by.get(name)!
    expect(top.lines[0]).toBe(`controller ${name}`)
    const parts = top.lines.filter((l) => l.startsWith('effectname ')).map((l) => by.get(l.split(' ')[1])!.lines[0].split(' ')[0])
    expect(parts).toEqual(['trail', 'partsys'])
    expect(gun.tracer(fx, 'Deadpool')).toBe(name)
  })
})
