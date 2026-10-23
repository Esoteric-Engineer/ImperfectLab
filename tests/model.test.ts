import { describe, expect, it } from 'vitest'
import { LabError } from '../src/core/errors'
import { Fit } from '../src/core/model/fit'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { fakeSkeleton, type JointSpec, makeGlb, MIXAMO } from './helpers'

const dist = (a: number[], b: number[]) => Math.sqrt([0, 1, 2].reduce((s, i) => s + (a[i] - b[i]) ** 2, 0))

describe('mapping', () => {
  const sk = fakeSkeleton()
  const model = new Model(makeGlb())

  it('maps a Mixamo rig', () => {
    const auto = mapping.autoMap(model, sk)
    expect(auto.preset).toBe('Mixamo')
    expect(mapping.check(model, sk, auto.mapping, auto.overrides)).toEqual([])
    expect(auto.mapping.get(sk.node('L.hand')!)).toBe('mixamorig:LeftHand')
    expect(auto.mapping.get(sk.node('R.finger_b.0')!)).toBe('mixamorig:RightHandRing1')
    expect(auto.overrides.get('mixamorig:LeftHandMiddle1')).toBe(sk.node('L.finger_a.0'))
  })

  it('maps 3ds Max Biped names', () => {
    const biped: Record<string, string> = { Hips: 'Bip01 Pelvis', Spine: 'Bip01 Spine', Spine1: 'Bip01 Spine1', Spine2: 'Bip01 Spine2', Neck: 'Bip01 Neck', Head: 'Bip01 Head' }
    for (const [side, s] of [['Left', 'L'], ['Right', 'R']]) {
      for (const [a, b] of [['Shoulder', 'Clavicle'], ['Arm', 'UpperArm'], ['ForeArm', 'Forearm'], ['Hand', 'Hand'], ['UpLeg', 'Thigh'], ['Leg', 'Calf'],
        ['Foot', 'Foot'], ['ToeBase', 'Toe0'], ['HandIndex1', 'Finger1'], ['HandIndex2', 'Finger11'], ['HandThumb1', 'Finger0'], ['HandThumb2', 'Finger01']]) {
        biped[side + a] = `Bip01 ${s} ${b}`
      }
    }
    const names = MIXAMO.map(([j]) => j)
    const nm = (j: string, i: number) => `${biped[j] ?? j}_${String(i).padStart(2, '0')}`
    const joints: JointSpec[] = MIXAMO.map(([j, parent, p], i) => [nm(j, i), parent && nm(parent, names.indexOf(parent)), p])
    const m = new Model(makeGlb(joints, ''))
    const auto = mapping.autoMap(m, sk)
    expect(auto.preset.startsWith('3ds Max Biped')).toBe(true)
    expect(auto.mapping.get(sk.node('pelvis')!)).toBe('Bip01 Pelvis_00')
    expect(mapping.check(m, sk, auto.mapping, auto.overrides)).toEqual([])
  })

  it('reports a missing required bone', () => {
    const auto = mapping.autoMap(model, sk)
    auto.mapping.delete(sk.node('L.forearm')!)
    const errors = mapping.check(model, sk, auto.mapping, auto.overrides).filter(([l]) => l === 'error').map(([, m]) => m)
    expect(errors.some((m) => m.includes('L Forearm'))).toBe(true)
    expect(() => new Fit(model, sk, auto.mapping, auto.overrides)).toThrow(LabError)
  })

  it('inherits from mapped ancestors', () => {
    const auto = mapping.autoMap(model, sk)
    const eff = mapping.effective(model, auto.mapping, auto.overrides)
    expect(eff.get('mixamorig:Spine1')).toBe(sk.node('spine'))
    expect(eff.get('mixamorig:LeftHandMiddle1')).toBe(sk.node('L.finger_a.0'))
  })
})

describe('fitting', () => {
  const checkFit = (joints: JointSpec[]) => {
    const sk = fakeSkeleton()
    const model = new Model(makeGlb(joints))
    const auto = mapping.autoMap(model, sk)
    const f = new Fit(model, sk, auto.mapping, auto.overrides)
    const J = sk.positions()
    const prim = model.prims[0]
    const names = joints.map(([j]) => j)
    for (const [joint, role] of [['LeftHand', 'L.hand'], ['RightFoot', 'R.foot'], ['Head', 'head'], ['LeftArm', 'L.upper_arm']]) {
      const k = 3 * names.indexOf(joint)
      const [q, , w] = f.vertex(prim.pos[k], prim.nrm[k], prim.skin[k])
      expect(dist(q, J[sk.node(role)!]), joint).toBeLessThan(0.08)
      expect(w.map(([n]) => n)).toContain(sk.node(role))
    }
    return f
  }

  it('fits a model', () => expect(checkFit(MIXAMO).flip).toBe(false))
  it('turns a backwards model', () => expect(checkFit(MIXAMO.map(([j, p, v]) => [j, p, [-v[0], v[1], -v[2]]])).flip).toBe(true))

  it('stands a model whose origin is not on its floor', () => {
    const footDistance = (lift: number, floorFromMesh: boolean) => {
      const joints: JointSpec[] = MIXAMO.map(([j, p, v]) => [j, p, [v[0], v[1] + lift, v[2]]])
      const sk = fakeSkeleton()
      const model = new Model(makeGlb(joints))
      const auto = mapping.autoMap(model, sk)
      const f = new Fit(model, sk, auto.mapping, auto.overrides, null, true, null, floorFromMesh)
      const k = 3 * joints.findIndex(([j]) => j === 'RightFoot')
      const [q] = f.vertex(model.prims[0].pos[k], model.prims[0].nrm[k], model.prims[0].skin[k])
      return dist(q, sk.positions()[sk.node('R.foot')!])
    }
    expect(footDistance(-1.5, false)).toBeGreaterThan(1)
    expect(footDistance(-1.5, true)).toBeLessThan(0.15)
    expect(footDistance(0.7, true)).toBeLessThan(0.15)
  })

  it('splits twist weights', () => {
    const sk = fakeSkeleton()
    const model = new Model(makeGlb())
    const auto = mapping.autoMap(model, sk)
    const f = new Fit(model, sk, auto.mapping, auto.overrides)
    const upper = f.D.get('mixamorig:LeftArm')!, forearm = f.D.get('mixamorig:LeftForeArm')!
    const mid: [number, number, number] = [0, 1, 2].map((i) => upper[i] + (forearm[i] - upper[i]) * 0.4) as [number, number, number]
    const w = new Map(f.weights('mixamorig:LeftArm', mid))
    expect(w.get(sk.node('L.upper_arm')!)! + w.get(sk.node('L.upper_twist')!)!).toBeCloseTo(1.0)
    expect(w.get(sk.node('L.upper_twist')!)!).toBeGreaterThan(0)
  })
})
