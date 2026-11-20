import { describe, expect, it } from 'vitest'
import * as cutanim from '../src/core/build/cutanim'
import { equal } from '../src/core/bytes'
import * as R from '../src/core/game/roster'
import * as cuttool from '../src/core/mnroi/cuttool'
import { GLB, type Json } from '../src/core/mnroi/gltf'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import { gameSource, ISO } from './helpers'

type Pose = [ngbtool.Mat3, ngbtool.Vec3][]

// Rotation keys turned onto one hemisphere, as the game blends them (shipped tracks flip sign now and then).
function continuous(tracks: ngbtool.Track[], camera: boolean): ngbtool.Track[] {
  return tracks.map(([bone, ch, keys]) => {
    const out = keys.map(([f, p]): ngbtool.Key => [f, [...p] as ngbtool.Packed])
    if (ch === 0) {
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1][1], b = out[i][1]
        if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) out[i][1] = b.map((x) => -x) as ngbtool.Packed
      }
    }
    return [camera ? 0 : bone, ch, out]
  })
}

// Largest rotation (matrix entry) and position differences between two cutscenes' poses, every half frame.
export function poseError(a: cuttool.Cut, b: cuttool.Cut, rigs: cutanim.Rigs): { rot: number; pos: number } {
  let rot = 0, pos = 0
  a.chunks.forEach((ch, i) => {
    for (const x of ch.actors) {
      const name = cuttool.recordName(x.record)
      const y = b.chunks[i].actors.find((v) => cuttool.recordName(v.record) === name)!
      const rg = rigs.get(name.toLowerCase())
      const camera = cutanim.CAMERA.test(name)
      if (!rg && !camera) continue
      const nodes = rg?.nodes ?? [[[0, 0, 0, 0], [0, 0, 0, 0], -1, 0]]
      const pose = (r: ngbtool.Record, f: number): Pose => ngbtool.pose({ nodes }, { ...r, tracks: continuous(r.tracks, camera) }, f)
      for (let f = 0; f <= cuttool.frames(ch); f += 0.5) {
        const p = pose(cuttool.record(x), f), q = pose(cuttool.record(y), f)
        p.forEach(([R1, T1], k) => {
          const [R2, T2] = q[k]
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rot = Math.max(rot, Math.abs(R1[r][c] - R2[r][c]))
          pos = Math.max(pos, Math.hypot(T1[0] - T2[0], T1[1] - T2[1], T1[2] - T2[2]))
        })
      }
    }
  })
  return { rot, pos }
}

describe.skipIf(!ISO)('cutscene animation', () => {
  it('rebuilds every shipped cutscene byte for byte', () => {
    const src = gameSource()
    let n = 0
    for (const name of src.names('Cutscenes/', '.cut')) {
      const d = src.entry(name)
      let cut
      try {
        cut = cuttool.read(d)
      } catch {
        continue
      }
      expect(equal(cuttool.build(cut, cut.sizes), d), name).toBe(true)
      n++
    }
    expect(n).toBeGreaterThan(380)
  })

  it('reads back its own glTF to within the keys\' precision', () => {
    const src = gameSource()
    const rigs: cutanim.Rigs = new Map([['wolverine', cutanim.rig(new R.BaseCharacter(src, 'wolverine'))]])
    for (const name of ['mp_wl_int_1', 'mp_wl_int_2', 'mp_wl_ext_1']) {
      const cut = cuttool.read(src.entry(`Cutscenes/${name}.cut`))
      const glb = cutanim.toGlb(cut, rigs)
      const j = new GLB(glb).j
      expect(j.cameras.length).toBeGreaterThan(0)
      expect(j.skins.map((s: { name: string }) => s.name)).toEqual(['wolverine'])
      const back = cutanim.fromGlb(glb, cut, rigs)
      expect(back.notes).toEqual([])
      const err = poseError(cut, back.cut, rigs)
      expect(err.rot, name).toBeLessThan(2e-3)
      expect(err.pos, name).toBeLessThan(2e-3)
      expect(cuttool.read(cuttool.build(back.cut)).chunks.length).toBe(cut.chunks.length)
    }
  })

  it('keeps flagged tracks\' flags and motion', () => {
    const src = gameSource()
    const rigs: cutanim.Rigs = new Map([['megalith', cutanim.rig(new R.BaseCharacter(src, 'megalith'))]])
    const cut = cuttool.read(src.entry('Cutscenes/mp_ml_ext_1.cut'))
    const back = cutanim.fromGlb(cutanim.toGlb(cut, rigs), cut, rigs)
    expect(back.keyed.map((n) => n.toLowerCase()).sort()).toEqual(['megalith', 'nis_camera'])
    let flagged = 0
    cut.chunks.forEach((ch, i) => ch.actors.forEach((a, k) => {
      if (cutanim.CAMERA.test(cuttool.recordName(a.record))) return
      const b = back.cut.chunks[i].actors[k]
      expect(b.tracks.slice(0, a.tracks.length).map((t) => [cuttool.bone(t), t.head[4]])).toEqual(a.tracks.map((t) => [cuttool.bone(t), t.head[4]]))
      a.tracks.forEach((t, n) => {
        if (cuttool.bone(t) <= 0xffff) return
        flagged++
        expect(b.tracks[n]).toEqual(t)
      })
    }))
    expect(flagged).toBeGreaterThan(30)
  })

  it('places each chunk\'s performer and camera where it starts', () => {
    const src = gameSource()
    const rigs: cutanim.Rigs = new Map([['wolverine', cutanim.rig(new R.BaseCharacter(src, 'wolverine'))]])
    const cut = cuttool.read(src.entry('Cutscenes/mp_wl_int_1.cut'))
    const shift: ngbtool.Vec3 = [1.5, -0.5, 0]
    const moved = cuttool.read(cuttool.build(cut))
    for (const ch of moved.chunks) {
      for (const a of ch.actors) {
        const name = cuttool.recordName(a.record).toLowerCase()
        if (name !== 'wolverine' && name !== 'nis_camera') continue
        const t = a.tracks.find((t) => (name === 'nis_camera' || cuttool.bone(t) === 0) && t.head[4] === 1)!
        const keys = cuttool.keys(t).map(([f, p]) => [f, ngbtool.encodeTranslation(ngbtool.translation(p).map((v, k) => v + shift[k]) as ngbtool.Vec3)] as const)
        const out = new Uint8Array(12 * keys.length), dv = new DataView(out.buffer)
        keys.forEach(([f, p], k) => { dv.setFloat32(12 * k, f, true); p.forEach((x, j) => dv.setInt16(12 * k + 4 + 2 * j, x, true)) })
        t.keys = out
      }
    }
    const near = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) < 2e-3)
    const same = cutanim.fromGlb(cutanim.toGlb(cut, rigs), cut, rigs).cut
    const back = cutanim.fromGlb(cutanim.toGlb(moved, rigs), cut, rigs).cut
    let checked = 0
    cut.chunks.forEach((ch, i) => ch.actors.forEach((a, k) => {
      if (!['wolverine', 'nis_camera'].includes(cuttool.recordName(a.record).toLowerCase())) return
      const [R, T] = cuttool.placement(a.record)
      const [R2, T2] = cuttool.placement(same.chunks[i].actors[k].record)
      expect(near(T2, T), `chunk ${i}`).toBe(true)
      expect(near(R2.flat(), R.flat()), `chunk ${i}`).toBe(true)
      expect(near(cuttool.placement(back.chunks[i].actors[k].record)[1], T.map((v, j) => v + shift[j])), `chunk ${i}`).toBe(true)
      checked++
    }))
    expect(checked).toBe(2 * cut.chunks.length)
    const own = (c: cuttool.Cut) => c.records.find((r) => cuttool.recordName(r).toLowerCase() === 'wolverine')!
    const lastChunk = back.chunks[back.chunks.length - 1].actors.find((a) => cuttool.recordName(a.record).toLowerCase() === 'wolverine')!
    expect(cuttool.placement(own(back))).toEqual(cuttool.placement(lastChunk.record))
  })

  describe('field of view', () => {
    const rigs = () => new Map([['wolverine', cutanim.rig(new R.BaseCharacter(gameSource(), 'wolverine'))]]) as cutanim.Rigs
    const read = () => cuttool.read(gameSource().entry('Cutscenes/mp_wl_int_1.cut'))
    const fovs = (cut: cuttool.Cut) => cut.chunks.map((c) => cuttool.fov(c))
    const yfov = (fov: number) => 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 0.75)
    const rejson = (glb: Uint8Array, edit: (j: Json) => void) => {
      const g = new GLB(glb)
      edit(g.j)
      const json = new TextEncoder().encode(JSON.stringify(g.j)), pad = (4 - (json.length % 4)) % 4
      const out = new Uint8Array(28 + json.length + pad + g.bin.length), dv = new DataView(out.buffer)
      out.set([0x67, 0x6c, 0x54, 0x46])
      dv.setUint32(4, 2, true)
      dv.setUint32(8, out.length, true)
      dv.setUint32(12, json.length + pad, true)
      dv.setUint32(16, 0x4e4f534a, true)
      out.set(json, 20)
      out.fill(0x20, 20 + json.length, 20 + json.length + pad)
      dv.setUint32(20 + json.length + pad, g.bin.length, true)
      dv.setUint32(24 + json.length + pad, 0x004e4942, true)
      out.set(g.bin, 28 + json.length + pad)
      return out
    }

    it('writes each camera\'s shots as lens keys and reads them back', () => {
      const cut = read()
      const glb = cutanim.toGlb(cut, rigs())
      const j = new GLB(glb).j
      expect(j.extensionsUsed).toEqual(['KHR_animation_pointer'])
      const pointers = j.animations[0].channels.filter((c: Json) => c.target.path === 'pointer')
      expect(pointers.map((c: Json) => c.target.extensions.KHR_animation_pointer.pointer)).toEqual(j.cameras.map((_: Json, i: number) => `/cameras/${i}/perspective/yfov`))
      expect(j.animations[0].samplers[pointers[0].sampler].interpolation).toBe('STEP')
      expect(fovs(cutanim.fromGlb(glb, cut, rigs()).cut)).toEqual(fovs(cut))
    })

    it('changes only the shot whose lens key changed', () => {
      const cut = read(), zoomed = read()
      expect(cut.chunks.length).toBeGreaterThan(1)
      cuttool.setFov(zoomed.chunks[1], 40)
      const back = cutanim.fromGlb(cutanim.toGlb(zoomed, rigs()), cut, rigs()).cut
      expect(fovs(back)).toEqual(fovs(cut).map((f, i) => (i === 1 ? 40 : f)))
    })

    it('takes an unkeyed lens for every shot only when it changed', () => {
      const cut = read()
      const still = (fov: number | null) => rejson(cutanim.toGlb(cut, rigs()), (j) => {
        for (const a of j.animations) a.channels = a.channels.filter((c: Json) => c.target.path !== 'pointer')
        if (fov !== null) j.cameras[0].perspective.yfov = yfov(fov)
      })
      expect(fovs(cutanim.fromGlb(still(null), cut, rigs()).cut)).toEqual(fovs(cut))
      expect(new Set(fovs(cutanim.fromGlb(still(50), cut, rigs()).cut))).toEqual(new Set([50]))
    })
  })
})
