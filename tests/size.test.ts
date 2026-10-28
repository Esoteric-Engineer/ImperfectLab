import { describe, expect, it } from 'vitest'
import * as size from '../src/core/build/size'
import * as nmstool from '../src/core/mnroi/nmstool'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import { scaleModel } from '../src/core/model/bundle'
import { encodeLatin1 } from '../src/core/bytes'

type V3 = [number, number, number]

const AT: [V3, number][] = [[[0, 0, 0], -1], [[0, 0, 1], 0], [[0.2, 0, 1.5], 1], [[0.5, 0, 1.5], 2], [[0.1, 0, 0.1], 1]]

function model(): ngmtool.Model {
  const m = new ngmtool.Model()
  m.nodes = AT.map(([p, parent]): ngmtool.Node => {
    const q = parent < 0 ? [0, 0, 0] : AT[parent][0]
    return [[p[0] - q[0], p[1] - q[1], p[2] - q[2], 1], [-p[0], -p[1], -p[2], 1], parent, 0]
  })
  m.attachments = [[3, 21, 1, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, -0.05, 1]]]
  m.streams = [new ngmtool.Stream(2, [[0, 0, 0]], [[0.5, 0, 1.5, 1, 0, 0, 3, 3, 3, 0]])]
  m.bounds = [-0.1, -0.2, 0, 7, 0.5, 0.2, 1.8, 7]
  return m
}

const rotZ = (deg: number): ngbtool.Packed => [Math.round(Math.cos((deg * Math.PI) / 360) * 16384), Math.round(-Math.sin((deg * Math.PI) / 360) * 16384), 0, 0]

const record: ngbtool.Record = {
  name: 'Walk.nad', length: 20, head: new Uint8Array(0x30), pointers: [0, 0, 0], extra: [], events: [],
  tracks: [
    [1, 1, [[0, ngbtool.encodeTranslation([0, 0, 0])], [20, ngbtool.encodeTranslation([0, 0.6, -0.1])]]],
    [2, 0, [[0, rotZ(0)], [20, rotZ(60)]]],
    [3, 1, [[0, ngbtool.encodeTranslation([0.05, 0, 0])], [20, ngbtool.encodeTranslation([0.2, 0, 0])]]],
  ],
}

describe('sizing a character', () => {
  it('scales every pose of an animation with the skeleton', () => {
    for (const s of [0.2, 1.3, 2.5]) {
      const m = model(), big = scaleModel(m, s), rec = size.scaleRecord(record, s)
      for (const t of [0, 7, 20]) {
        const want = ngbtool.pose(m, record, t), got = ngbtool.pose(big, rec, t)
        got.forEach(([, p], i) => p.forEach((x, k) => expect(x).toBeCloseTo(want[i][1][k] * s, 3)))
      }
    }
  })

  it('keeps the base\'s travel for a root that leaves the ground', () => {
    const lunge: ngbtool.Track = [0, 1, [[0, ngbtool.encodeTranslation([0, 0, 0])], [20, ngbtool.encodeTranslation([0, 2, 0])]]]
    const dive: ngbtool.Track = [0, 1, [[0, ngbtool.encodeTranslation([0, 0, 0])], [20, ngbtool.encodeTranslation([0, 5, -10])]]]
    const root = (rec: ngbtool.Record) => rec.tracks[0][2].map(([, v]) => ngbtool.translation(v))
    const ground = size.scaleRecord({ ...record, tracks: [lunge, ...record.tracks] }, 0.2)
    expect(root(ground)[1][1]).toBeCloseTo(0.4, 3)
    const air = size.scaleRecord({ ...record, tracks: [dive, ...record.tracks] }, 0.2)
    expect(size.airborne(air)).toBe(true)
    expect(air.tracks[0]).toEqual(dive)
    expect(ngbtool.translation(air.tracks[1][2][1][1])[1]).toBeCloseTo(0.12, 3)
  })

  it('scales the vertices, attachments and bounds but not the weights', () => {
    const m = scaleModel(model(), 2)
    expect(m.streams[0].vertices[0]).toEqual([1, 0, 3, 1, 0, 0, 3, 3, 3, 0])
    expect(m.attachments[0][3].slice(12)).toEqual([0.2, 0, -0.1, 1])
    expect(m.bounds).toEqual([-0.2, -0.4, 0, 7, 1, 0.4, 3.6, 7])
    expect(m.nodes[2][0][3]).toBe(1)
    expect(model().nodes[2][0][2]).toBe(0.5)
  })

  it('scales the strides of a motion set', () => {
    const set = nmstool.parse(encodeLatin1('basedon brute\r\nWalk Walk.nad noframereset move 1.94 \r\nStand Stand.nad lowpriority \r\n'))
    size.scaleMotionSet(set, 0.5)
    const m = set.motions()
    expect(m.get('walk')!.opts).toEqual(['noframereset', 'move', '0.970'])
    expect(m.get('stand')!.opts).toEqual(['lowpriority'])
    expect(set.lines[2].raw).toBe('Stand Stand.nad lowpriority \r\n')
  })
})
