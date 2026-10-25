import { describe, expect, it } from 'vitest'
import * as reach from '../src/core/build/reach'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import type * as ngmtool from '../src/core/mnroi/ngmtool'

type V3 = [number, number, number]

// root, pelvis, upper arm, forearm, forearm twist, hand, foot
const AT: [V3, number][] = [[[0, 0, 0], -1], [[0, 0, 1], 0], [[0.2, 0, 1.5], 1], [[0.5, 0, 1.5], 2], [[0.6, 0, 1.5], 3], [[0.75, 0, 1.5], 4], [[0.1, 0, 0.1], 1]]
const MODEL: Pick<ngmtool.Model, 'nodes' | 'attachments'> = {
  nodes: AT.map(([p, parent]): ngmtool.Node => {
    const q = parent < 0 ? [0, 0, 0] : AT[parent][0]
    return [[p[0] - q[0], p[1] - q[1], p[2] - q[2], 0], [-p[0], -p[1], -p[2], 0], parent, 0]
  }),
  attachments: [[6, 19, 2, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -0.05, 1]]],
}
const BONES: Record<reach.Limb, number> = { right_arm: 4, left_arm: 6, right_leg: 6, left_leg: 6 }

const rotZ = (deg: number): ngbtool.Packed => [Math.round(Math.cos((deg * Math.PI) / 360) * 16384), Math.round(-Math.sin((deg * Math.PI) / 360) * 16384), 0, 0]

function record(length: number, events: ngbtool.Event[]): ngbtool.Record {
  return { name: 'T.nad', length, head: new Uint8Array(0x30), pointers: [7], tracks: [[2, 0, [[0, rotZ(0)], [length, rotZ(40)]]]], events, extra: [] }
}

const at = (rec: ngbtool.Record, bone: number, t: number) => ngbtool.pose(MODEL, rec, t)[bone][1]
const without = (rec: ngbtool.Record, bone: number) => ({ ...rec, tracks: rec.tracks.filter(([b, ch]) => !(b === bone && ch === 1)) })
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const types = (rec: ngbtool.Record, ...want: number[]) => rec.events.filter(([, t]) => want.includes(t)).map(([f, t]) => [f, t])

describe('finding what a move does with its limbs', () => {
  it('takes the wire before hits, and hits before lines', () => {
    const lines = () => [{ start: [21, 1] as [number, number], end: null }]
    expect(reach.plan([[4, 0x39, 0, 0], [3, 0x23, 0, 1], [9, 0x24, 0, 0], [1, 0x48, 2, 0]], 20, lines))
      .toEqual({ kind: 'wire', windows: [{ limb: 'left_arm', from: 3, to: 9, end: null }] })
    expect(reach.plan([[2, 0x39, 0, 0], [6, 0x3a, 0, 0], [3, 0x3e, 0, 0], [5, 0x3f, 0, 0], [10, 0x18, 0, 0], [1, 0x48, 2, 0]], 20, lines)).toEqual({
      kind: 'hit',
      windows: [{ limb: 'right_arm', from: 2, to: 6, end: null }, { limb: 'right_leg', from: 3, to: 5, end: null }, { limb: 'left_arm', from: 10, to: 20, end: null }],
    })
  })

  it('finds lines that start at a forearm, until their effect stops', () => {
    const lines = (k: number) => (k === 4 ? [{ start: [21, 1] as [number, number], end: [19, 2] as [number, number] }, { start: [21, 2] as [number, number], end: null }]
      : k === 5 ? [{ start: [3, 2] as [number, number], end: null }] : [])
    expect(reach.plan([[1, 0x48, 4, 0], [2, 0x48, 5, 0], [20, 0x49, 5, 0], [30, 0x49, 4, 0]], 40, lines)).toEqual({
      kind: 'line',
      windows: [{ limb: 'right_arm', from: 1, to: 30, end: [19, 2] }, { limb: 'left_arm', from: 1, to: 30, end: null }],
    })
    expect(reach.plan([[2, 0x48, 5, 0], [1, 0x17, 3, 0]], 40, lines)).toBeNull()
  })

  it('marks where a wire catches what it pulls', () => {
    expect(reach.plan([[4, 0x23, 0, 0], [15.5, 0x05, 0, 0], [24.5, 0x24, 0, 0], [30, 0x05, 0, 0]], 50)).toEqual({
      kind: 'wire', windows: [{ limb: 'right_arm', from: 4, to: 24.5, end: null, caught: 15.5 }],
    })
  })

  it('joins a limb\'s overlapping windows', () => {
    const p = reach.plan([[2, 0x39, 0, 0], [4, 0x39, 0, 0], [8, 0x3a, 0, 0]], 20)!
    expect(p.windows).toEqual([{ limb: 'right_arm', from: 2, to: 8, end: null }])
    expect(reach.summary(p)).toEqual({ kind: 'hit', limbs: ['right_arm'] })
  })
})

describe('stretching', () => {
  it('sends a hit further ahead and back, slowed to a meter a frame, coming back from a hit', () => {
    const rec = record(20, [[4, 0x39, 0, 0], [8, 0x3a, 0, 0], [15, 0x17, 1, 0], [6, 0x53, 0, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.plan(rec.events, rec.length)!, { distance: 10, limbs: ['right_arm'], returns: true })
    expect(out.length).toBe(36)
    expect(types(out, 0x3a, 0x17)).toEqual([[24, 0x3a], [31, 0x17]])
    expect(types(out, 0x53, 0x7e)).toEqual([[14, 0x53], [14, 0x7e]])
    const body = without(out, 4)
    const ahead = (t: number) => at(out, 4, t).map((v, i) => v - at(body, 4, t)[i])
    expect(ahead(14)[1]).toBeCloseTo(10, 2)
    expect(Math.hypot(ahead(14)[0], ahead(14)[2])).toBeLessThan(0.01)
    for (let t = 4; t < 24; t++) expect(dist(ahead(t + 1) as V3, ahead(t) as V3)).toBeLessThanOrEqual(reach.STEP + 0.001)
    for (const t of [0, 4, 24, 30, 36]) expect(dist(at(out, 4, t), at(body, 4, t))).toBeLessThan(0.001)
    expect(ngbtool.sameMotion(ngbtool.parse(ngbtool.writeRecord(out))[0], out)).toBe(true)
  })

  it('keeps a short reach in the hit\'s own time', () => {
    const rec = record(20, [[4, 0x39, 0, 0], [14, 0x3a, 0, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.plan(rec.events, rec.length)!, { distance: 1.5, limbs: ['right_arm'], returns: false })
    expect(out.length).toBe(20)
    expect(types(out, 0x53, 0x7e)).toEqual([])
    expect(at(out, 4, 9)[1] - at(without(out, 4), 4, 9)[1]).toBeCloseTo(1.5, 2)
  })

  it('holds a hand at the wire\'s end until the wire lets go', () => {
    const rec = record(12, [[2, 0x23, 0, 0], [8, 0x24, 0, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.plan(rec.events, rec.length)!, { distance: 0, limbs: ['right_arm'], returns: false })
    for (const t of [7, 8]) expect(dist(at(out, 4, t), reach.WIRE_END)).toBeLessThan(0.001)
    // between keys the parent turns while the key is interpolated
    expect(dist(at(out, 4, 7.5), reach.WIRE_END)).toBeLessThan(0.01)
    expect(out.length).toBe(13)
    for (const t of [0, 2, 13]) expect(dist(at(out, 4, t), at(rec, 4, t))).toBeLessThan(0.001)
  })

  it('reaches a grab\'s opponent and comes back by the middle of the line', () => {
    const rec = record(40, [[0, 0x48, 4, 0], [30, 0x49, 4, 0]])
    const p = reach.plan(rec.events, rec.length, (k) => (k === 4 ? [{ start: [21, 1], end: [19, 2] }] : []))!
    const out = reach.stretch(rec, MODEL, BONES, p, { distance: 6, limbs: ['right_arm'], returns: false })
    expect(dist(at(out, 4, 4), [0, 6, 0.05])).toBeLessThan(0.001)
    for (const t of [0, 15, 20, 40]) expect(dist(at(out, 4, t), at(rec, 4, t))).toBeLessThan(0.001)
    expect(out.length).toBe(40)
  })

  it('reaches a pickup\'s object when the wire catches it, and comes back as fast as it is thrown', () => {
    const rec = record(50, [[4, 0x23, 0, 0], [15.5, 0x05, 0, 0], [24.5, 0x24, 0, 0]])
    const p = reach.forMove('WirePull', reach.plan(rec.events, rec.length)!)
    const out = reach.stretch(rec, MODEL, BONES, p, { distance: 4, limbs: ['right_arm'], returns: false })
    expect(dist(at(out, 4, 15.5), [0, 4, at(rec, 4, 4)[2]])).toBeLessThan(0.001)
    expect(at(out, 4, 10)[1]).toBeLessThan(3.5)
    expect(at(out, 4, 17)[1]).toBeGreaterThan(1)
    for (const t of [4, 19, 24.5, 30]) expect(dist(at(out, 4, t), at(rec, 4, t))).toBeLessThan(0.001)
    const slow = reach.stretch(rec, MODEL, BONES, p, { distance: 10, limbs: ['right_arm'], returns: false, pull: 20 })
    expect(at(slow, 4, 24.5)[1]).toBeGreaterThan(1)
    for (const t of [30.5, 40]) expect(dist(at(slow, 4, t), at(rec, 4, t))).toBeLessThan(0.001)
  })

  it('holds a grab\'s hand on the victim until the line ends', () => {
    const victim: reach.Victim = {
      model: MODEL,
      rec: { ...record(60, []), tracks: [[0, 1, [[0, ngbtool.encodeTranslation([0, 0, 0])], [40, ngbtool.encodeTranslation([0, 1, 0])]]]] },
    }
    const on = (t: number): V3 => [-0.1, 6 - t / 40, 0.05]
    const lines = (k: number) => (k === 4 ? [{ start: [21, 1] as [number, number], end: [19, 2] as [number, number] }] : [])
    const rec = record(40, [[0, 0x48, 4, 0], [30, 0x49, 4, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.plan(rec.events, rec.length, lines)!, { distance: 6, limbs: ['right_arm'], returns: false }, victim)
    for (const t of [4, 10, 20, 25, 30]) expect(dist(at(out, 4, t), on(t))).toBeLessThan(0.001)
    expect(dist(at(out, 4, 27.5), on(27.5))).toBeLessThan(0.01)
    expect(out.length).toBe(40)
    for (const t of [0, 33, 40]) expect(dist(at(out, 4, t), at(rec, 4, t))).toBeLessThan(0.001)
    const short = record(30, [[0, 0x48, 4, 0], [30, 0x49, 4, 0]])
    const grown = reach.stretch(short, MODEL, BONES, reach.plan(short.events, short.length, lines)!, { distance: 6, limbs: ['right_arm'], returns: false }, victim)
    expect(grown.length).toBe(33)
    expect(dist(at(grown, 4, 33), at(short, 4, 30))).toBeLessThan(0.001)
  })

  it('carries the long hit volume on the far reach\'s arm, along the fist\'s segment', () => {
    const rec = record(20, [[4, 0x39, 0, 0], [8, 0x3a, 0, 0], [5, 0x56, 0, 0], [7, 0x57, 0, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.plan(rec.events, rec.length)!, { distance: 10, limbs: ['right_arm'], returns: true, far: 'right_arm' })
    expect(types(out, 0x56, 0x57)).toEqual([[4, 0x56], [24, 0x57]])
    expect(types(out, 0x39, 0x3a)).toEqual([[4, 0x39], [24, 0x3a]])
    const m: ngmtool.Model = Object.assign(Object.create(null), {
      nodes: MODEL.nodes,
      attachments: [[4, 21, 1, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.14, 0, 0, 1]], [4, 23, 1, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.52, 0, 0, 1]], [39, 43, 0, new Array(16).fill(0)]],
    })
    expect(reach.farVolume(m, 'right_arm', 4)).toBe(true)
    const ends = m.attachments.filter(([, k]) => k === 43 || k === 44).map(([n, k, i, mat]) => [n, k, i, +mat[12].toFixed(3)])
    expect(ends).toEqual([[4, 43, 0, 1.77], [4, 44, 0, -1.11]])
  })

  it('sends a pickup out to the object, as a grab', () => {
    const p = reach.plan([[4, 0x23, 0, 0], [24, 0x24, 0, 0]], 50)!
    expect(reach.forMove('WireSwing', p)).toBe(p)
    expect(reach.forMove('WirePull', p)).toEqual({ kind: 'line', windows: [{ limb: 'right_arm', from: 4, to: 24, end: null }] })
    expect(reach.forMove('WirePull', reach.summary(p))).toEqual({ kind: 'line', limbs: ['right_arm'] })
    const rec = record(50, [[4, 0x23, 0, 0], [24, 0x24, 0, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.forMove('WirePull', p), { distance: 4, limbs: ['right_arm'], returns: false })
    expect(at(out, 4, 7)[1]).toBeCloseTo(4, 2)
    for (const t of [14, 30]) expect(dist(at(out, 4, t), at(rec, 4, t))).toBeLessThan(0.001)
  })

  it('stretches only the limbs asked for', () => {
    const rec = record(20, [[4, 0x39, 0, 0], [8, 0x3a, 0, 0], [4, 0x3e, 0, 0], [8, 0x3f, 0, 0]])
    const out = reach.stretch(rec, MODEL, BONES, reach.plan(rec.events, rec.length)!, { distance: 3, limbs: ['right_leg'], returns: false })
    expect(out.tracks.some(([b, ch]) => b === 4 && ch === 1)).toBe(false)
    expect(out.tracks.map(([b, ch]) => [b, ch])).toEqual([[2, 0], [6, 1]])
    expect(out.pointers).toEqual([7, 0])
  })
})
