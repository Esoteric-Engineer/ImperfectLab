import { describe, expect, it } from 'vitest'
import * as holster from '../src/core/build/holster'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import type * as ngmtool from '../src/core/mnroi/ngmtool'

type V3 = [number, number, number]

const AT = new Map<number, [V3, number]>([
  [0, [[0, 0, 0], -1]], [1, [[0, 0, 1], 0]], [2, [[0, 0, 1.2], 1]], [3, [[0, 0, 1.4], 2]],
  [22, [[0.05, 0, 1.55], 3]], [23, [[0.2, 0, 1.55], 22]], [24, [[0.35, 0, 1.55], 23]], [25, [[0.48, 0, 1.55], 24]],
  [26, [[0.6, 0, 1.55], 25]], [27, [[0.75, 0, 1.55], 26]], [38, [[0.55, 0, 1.62], 26]], [39, [[0.65, 0, 1.62], 38]],
])
const MODEL: Pick<ngmtool.Model, 'nodes'> = {
  nodes: Array.from({ length: 40 }, (_, i): ngmtool.Node => {
    const [p, parent] = AT.get(i) ?? [[0, 0, 0] as V3, 0]
    const q = parent < 0 ? [0, 0, 0] : AT.get(parent)![0]
    return [[p[0] - q[0], p[1] - q[1], p[2] - q[2], 0], [-p[0], -p[1], -p[2], 0], parent, 0]
  }),
}
const ARM: holster.Arm = { upper: 23, fore: 25, hand: 27 }
const PLAN: holster.Plan = { position: [0.15, -0.2, 0.1], rotation: [0, 90, 20], center: [0.6, 0, 1.6] }

const rotZ = (deg: number): ngbtool.Packed => ngbtool.encodeRotation([Math.cos((deg * Math.PI) / 360), 0, 0, Math.sin((deg * Math.PI) / 360)])
const rotX = (deg: number): ngbtool.Packed => ngbtool.encodeRotation([Math.cos((deg * Math.PI) / 360), Math.sin((deg * Math.PI) / 360), 0, 0])

function record(length: number): ngbtool.Record {
  return {
    name: 'T.nad', length, head: new Uint8Array(0x30), pointers: [1, 2, 3, 4, 5], events: [], extra: [],
    tracks: [
      [0, 1, [[0, ngbtool.encodeTranslation([0, 0, 0])], [length, ngbtool.encodeTranslation([0.3, 0.2, 0])]]],
      [3, 0, [[0, rotZ(0)], [length, rotZ(30)]]],
      [25, 0, [[0, rotX(0)], [length, rotX(-40)]]],
      [39, 0, [[0, rotZ(10)], [length, rotZ(10)]]],
      [39, 1, [[0, ngbtool.encodeTranslation([0.01, 0, 0])]]],
    ],
  }
}

const close = (a: V3, b: V3, tol: number) => expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(tol)
const sameRot = (a: ngbtool.Mat3, b: ngbtool.Mat3, tol: number) => a.forEach((row, r) => close(row, b[r], tol))
const posed = (rec: ngbtool.Record, t: number) => ngbtool.pose(MODEL, rec, t)

function handTarget(rec: ngbtool.Record, t: number): V3 {
  const [R, T] = holster.stowedAt(MODEL, PLAN)(posed(rec, t))
  const bind = ngbtool.pose(MODEL, null, 0)
  const grip = [0, 1, 2].map((k) => bind[27][1][k] - bind[39][1][k]) as V3
  const g = holster.apply(R, grip)
  return [T[0] + g[0], T[1] + g[1], T[2] + g[2]]
}

describe('rotation keys', () => {
  it('encode and decode', () => {
    for (const q of [[1, 0, 0, 0], [0.5, 0.5, -0.5, 0.5], [0.1, -0.7, 0.2, 0.676], [-0.3, 0.1, 0.9, -0.3]]) {
      const n = Math.hypot(...q), u = q.map((v) => v / n)
      const back = ngbtool.quat(ngbtool.encodeRotation(u))
      back.forEach((v, i) => expect(v).toBeCloseTo(u[i], 3))
      const m = ngbtool.matQuat(ngbtool.qmat(u))
      const s = Math.sign(m.reduce((x, v, i) => x + v * u[i], 0))
      m.forEach((v, i) => expect(v * s).toBeCloseTo(u[i], 6))
    }
  })
})

describe('holster', () => {
  it('sorts states by power mode', () => {
    expect(['Stand', 'Run', 'Attack1', 'Block', 'HitReactLarge'].map(holster.role)).toEqual(['stowed', 'stowed', 'stowed', 'stowed', 'stowed'])
    expect(['PowerStand', 'SuperRun', 'SuperAttack1', 'RangedAttack', 'DodgeExitSuperAttack'].map(holster.role)).toEqual(['drawn', 'drawn', 'drawn', 'drawn', 'drawn'])
    expect(['PowerOn', 'PowerOff', 'SuperThrowVictim', 'IKAimUp', 'IKClaws'].map(holster.role)).toEqual(['on', 'off', null, null, 'free'])
  })

  it('draws moves by their states, and leaves power-on and power-off to the holster', () => {
    expect(holster.defaultDrawn(['BlockStart', 'Block', 'BlockEnd'])).toBe(false)
    expect(holster.defaultDrawn(['SuperAttack1'])).toBe(true)
    expect(holster.defaultDrawn(['SuperThrow', 'SuperThrowVictim'])).toBe(true)
    expect(holster.defaultDrawn(['PowerOn'])).toBeNull()
    expect(holster.defaultDrawn(['IKClaws'])).toBeNull()
    expect(holster.defaultDrawn(['ThrowVictim'])).toBeNull()
  })

  it('takes the club out of a clip and keeps the rest', () => {
    const out = holster.free(record(10))
    expect(out.tracks.map(([b, ch]) => [b, ch])).toEqual([[0, 1], [3, 0], [25, 0]])
    expect(out.pointers).toEqual([1, 2, 3])
  })

  it('finds the middle of what is fixed to the club alone', () => {
    const v = (p: V3, w: [number, number][]): [V3, V3, [number, number], [number, number][]] => [p, [0, 0, 1], [0, 0], w]
    const tris = [[v([0, 0, 0], [[39, 1]]), v([1, 2, 4], [[39, 1]]), v([9, 9, 9], [[39, 0.5], [27, 0.5]])]] as const
    expect(holster.center([tris.map((t) => [...t]) as never])).toEqual([0.5, 1, 2])
    expect(() => holster.center([])).toThrow(/nothing is fixed/)
  })

  it('holds the club on the back as the chest and arm move', () => {
    const rec = record(10)
    const out = holster.stow(rec, MODEL, PLAN)
    expect(out.length).toBe(10)
    expect(out.tracks.filter(([b]) => b === 39).map(([, ch]) => ch)).toEqual([0, 1])
    expect(out.pointers.length).toBe(out.tracks.length)
    for (const t of [0, 2.5, 5, 7.25, 10]) {
      const p = posed(out, t)
      const [R, T] = holster.stowedAt(MODEL, PLAN)(p)
      close(p[39][1], T, 2e-3)
      sameRot(p[39][0], R, 5e-3)
    }
  })

  it('reaches back for the club on power-on and keeps its own after', () => {
    const rec = record(20)
    const out = holster.draw(rec, MODEL, PLAN, ARM, 'on')
    close(posed(out, 0)[27][1], posed(rec, 0)[27][1], 1e-3)
    const far = posed(rec, 9)[27][1], target = handTarget(out, 9)
    expect(Math.hypot(far[0] - target[0], far[1] - target[1], far[2] - target[2])).toBeGreaterThan(0.3)
    close(posed(out, 9)[27][1], target, 0.01)
    close(posed(out, 19)[27][1], posed(rec, 19)[27][1], 1e-3)
    const [, T] = holster.stowedAt(MODEL, PLAN)(posed(out, 4))
    close(posed(out, 4)[39][1], T, 2e-3)
    for (const t of [18, 20]) close(posed(out, t)[39][1], posed(rec, t)[39][1], 2e-3)
  })

  it('puts the club back on power-off', () => {
    const rec = record(20)
    const out = holster.draw(rec, MODEL, PLAN, ARM, 'off')
    for (const t of [0, 1]) close(posed(out, t)[39][1], posed(rec, t)[39][1], 2e-3)
    close(posed(out, 11)[27][1], handTarget(out, 11), 0.01)
    const p = posed(out, 20)
    close(p[39][1], holster.stowedAt(MODEL, PLAN)(p)[1], 2e-3)
    close(p[27][1], posed(rec, 20)[27][1], 1e-3)
  })
})
