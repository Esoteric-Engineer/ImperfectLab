// A base's move animations as glTF, to edit in Blender and import back as clips (moveanim.ts).
// One clip per state, named after it, on the base's skeleton and body. Flagged tracks are left out (a build keeps them from the base), and so are moves with a victim.
import { LabError } from '../errors'
import type { BaseCharacter } from '../game/roster'
import type { GameSource } from '../game/source'
import { encodePng } from '../image/png'
import type { RgbaImage } from '../image/rgba'
import type { Json } from '../mnroi/gltf'
import * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import * as nmstool from '../mnroi/nmstool'
import { conv } from '../model/fit'
import { Skeleton } from '../model/skeleton'
import { baseMeshes, type MeshData } from '../preview'
import { armature, hemisphere, M, mul, rig, toGltf, Writer } from './cutanim'
import { type AnimRig, type ClipFile, gameRig, Retarget } from './moveanim'
import { animatable, holds, loadBundles, motionFps, motionSetOf, MOVES, resolved, SLOTS, stemOf } from './moves'

type Vec3 = ngbtool.Vec3

const MOVED = 0.01
const TURNED = (2 * Math.PI) / 180
// the game blends rotations linearly, glTF along the arc: keys further apart than this get one each frame between
const ARC = (10 * Math.PI) / 180

function blended(keys: ngbtool.Key[]): ngbtool.Key[] {
  const out: ngbtool.Key[] = []
  keys.forEach(([f, v], i) => {
    out.push([f, v])
    if (i + 1 >= keys.length) return
    const a = ngbtool.quat(v), b = ngbtool.quat(keys[i + 1][1])
    if (2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, x, k) => s + x * b[k], 0)))) <= ARC) return
    for (let g = Math.floor(f) + 1; g < keys[i + 1][0]; g++) out.push([g, ngbtool.sample(keys, g)])
  })
  return out
}

export interface BaseClip {
  move: string
  state: string
  opts: string[]
  rec: ngbtool.Record
}

export function baseClips(src: GameSource, base: BaseCharacter): BaseClip[] {
  const set = motionSetOf(base)
  const bundles = loadBundles(src, stemOf(set))
  const now = resolved(src, nmstool.parse(src.entry(`Motions/${set}`)), holds(bundles))
  const out: BaseClip[] = []
  for (const move of MOVES) {
    if (!animatable(move)) continue
    for (const state of move.states) {
      const m = now.get(state.toLowerCase())
      if (!m) continue
      let rec: ngbtool.Record | undefined
      for (const slot of SLOTS) {
        rec = bundles.get(slot)?.find((r) => r.name.toLowerCase() === m.anim.toLowerCase())
        if (rec) break
      }
      if (rec) out.push({ move: move.id, state, opts: m.opts, rec })
    }
  }
  return out
}

// Bind rotations are the identity, so the body rests where its bones do.
function body(g: Writer, root: number, skin: number, meshes: MeshData[], bones: number) {
  const textures = new Map<RgbaImage, number>()
  const texture = (im: RgbaImage): number => {
    let t = textures.get(im)
    if (t === undefined) {
      const image = (g.json.images ??= []).push({ bufferView: g.blob(encodePng(im)), mimeType: 'image/png' }) - 1
      t = (g.json.textures ??= []).push({ source: image }) - 1
      textures.set(im, t)
    }
    return t
  }
  const primitives: Json[] = []
  meshes.forEach((m, k) => {
    const n = m.positions.length / 3
    if (!n) return
    const pos: number[][] = [], nrm: number[][] = [], uv: number[][] = [], jnt: number[][] = [], wgt: number[][] = []
    for (let i = 0; i < n; i++) {
      pos.push(conv(m.positions.subarray(i * 3, i * 3 + 3)))
      nrm.push(conv(m.normals.subarray(i * 3, i * 3 + 3)))
      uv.push([m.uvs[i * 2], m.uvs[i * 2 + 1]])
      const inf: [number, number][] = []
      for (let s = 0; s < 3; s++) {
        const key = m.influenceKeys[i * 3 + s], w = m.influences[i * 3 + s]
        const bone = key >= 0 ? m.keys[key] : -1
        if (typeof bone === 'number' && bone >= 0 && bone < bones && w > 0) inf.push([bone, w])
      }
      if (!inf.length) inf.push([0, 1])
      const sum = inf.reduce((s, [, w]) => s + w, 0)
      while (inf.length < 4) inf.push([0, 0])
      jnt.push(inf.map(([b]) => b))
      wgt.push(inf.map(([, w]) => w / sum))
    }
    const material = (g.json.materials ??= []).push({
      name: `part_${k}`,
      pbrMetallicRoughness: { ...(m.image && { baseColorTexture: { index: texture(m.image) } }), metallicFactor: 0, roughnessFactor: 1 },
    }) - 1
    primitives.push({ attributes: { POSITION: g.floats(pos, 'VEC3'), NORMAL: g.floats(nrm, 'VEC3'), TEXCOORD_0: g.floats(uv, 'VEC2'), JOINTS_0: g.shorts(jnt, 'VEC4'), WEIGHTS_0: g.floats(wgt, 'VEC4') }, material })
  })
  const mesh = g.json.meshes.push({ name: 'body', primitives }) - 1
  g.json.nodes[root].children.push(g.node({ name: 'body', mesh, skin }))
}

export function movesGlb(src: GameSource, base: BaseCharacter): Uint8Array {
  const clips = baseClips(src, base)
  if (!clips.length) throw new LabError(`${base.label} has no moves to export`)
  const rg = rig(base)
  const g = new Writer()
  let meshes: MeshData[] = []
  try {
    meshes = baseMeshes(src, base).filter((m) => m.positions.length)
  } catch (e) {
    // the joints' small shapes stand in for a body that can't be read
    if (!(e instanceof LabError)) throw e
  }
  const { root, joints, skin } = armature(g, base.label, rg, !meshes.length)
  if (meshes.length) body(g, root, skin, meshes, joints.length)
  const bind = (b: number): Vec3 => [rg.nodes[b][0][0], rg.nodes[b][0][1], rg.nodes[b][0][2]]
  const seen = new Set<string>()
  for (const c of clips) {
    if (seen.has(c.state.toLowerCase())) continue
    seen.add(c.state.toLowerCase())
    const fps = motionFps(c.opts), end = c.rec.length
    const samplers: Json[] = [], channels: Json[] = []
    const animate = (node: number, path: string, keys: [number, number[]][]) => {
      // every channel spans the record, so the clip is as long as the record
      if (keys[0][0] > 0) keys.unshift([0, keys[0][1]])
      if (keys[keys.length - 1][0] < end) keys.push([end, keys[keys.length - 1][1]])
      const timed = keys.filter(([f], i) => i === 0 || f > keys[i - 1][0]).map(([f, v]): [number, number[]] => [f / fps, v])
      if (path === 'rotation') hemisphere(timed)
      const input = g.floats(timed.map(([s]) => [s]), 'SCALAR')
      const output = g.floats(timed.map(([, v]) => v), path === 'rotation' ? 'VEC4' : 'VEC3')
      channels.push({ sampler: samplers.push({ input, output, interpolation: 'LINEAR' }) - 1, target: { node, path } })
    }
    const done = new Set<string>()
    for (const [b, ch, keys] of c.rec.tracks) {
      if (b >= joints.length || !keys.length || done.has(`${b}.${ch}`)) continue
      done.add(`${b}.${ch}`)
      if (ch === 0) animate(joints[b], 'rotation', blended(keys).map(([f, p]) => [f, toGltf(ngbtool.matQuat(mul(mul(M, ngbtool.qmat(ngbtool.quat(p))), M)))]))
      else if (ch === 1) {
        const q = bind(b)
        animate(joints[b], 'translation', keys.map(([f, p]) => {
          const t = ngbtool.translation(p)
          return [f, conv([t[0] + q[0], t[1] + q[1], t[2] + q[2]])]
        }))
      }
    }
    if (!channels.length) animate(joints[0], 'translation', [[0, conv(bind(0))]])
    g.json.animations.push({ name: c.state, samplers, channels })
  }
  g.json.scenes[0].extras = { imperfectlab: { kind: 'moves', base: base.key } }
  return g.finish()
}

export interface ChangedClip {
  move: string
  state: string
  clip: string
}

export interface Changes {
  changed: ChangedClip[]
  same: number
}

// The clips of an edited movesGlb file that differ from the base's records, retargeted as a build would and compared frame by frame.
export function changedClips(src: GameSource, base: BaseCharacter, file: ClipFile, turn = 0): Changes {
  const model = ngmtool.read(base.bundleFiles()[0])[1][0]
  const sk = new Skeleton(model, base.body)
  if (!gameRig(file, sk)) throw new LabError(`the file isn't on a base's skeleton (export one with "Download ${base.label}'s animations"), so its clips can't be compared with ${base.label}'s`)
  const rig: AnimRig = { model: null, mapping: new Map(), overrides: new Map(), fit: { scale: null, flip: null } }
  const rt = new Retarget(rig, sk, file, turn)
  const body = sk.nodes.filter((n) => n.group !== 'props' && n.index > 0).map((n) => n.index)
  const clipOf = new Map(file.clips.map((c) => [c.name.toLowerCase(), c.name]))
  const out: Changes = { changed: [], same: 0 }
  const seen = new Set<string>()
  for (const c of baseClips(src, base)) {
    const clip = clipOf.get(c.state.toLowerCase())
    if (!clip || seen.has(c.state.toLowerCase())) continue
    seen.add(c.state.toLowerCase())
    const made = rt.record(c.rec, clip, model.nodes, motionFps(c.opts))
    let changed = Math.abs(made.length - c.rec.length) > 1
    const k = c.rec.length > 0 ? made.length / c.rec.length : 1
    for (let f = 0; f <= c.rec.length && !changed; f++) {
      const was = ngbtool.pose(model, c.rec, f), now = ngbtool.pose(model, made, f * k)
      changed = body.some((i) => {
        const [A, a] = was[i], [B, b] = now[i]
        // the angle between the two world rotations, from the trace of Aᵀ B
        let tr = 0
        for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) tr += A[r][s] * B[r][s]
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > MOVED || Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) > TURNED
      })
    }
    if (changed) out.changed.push({ move: c.move, state: c.state, clip })
    else out.same++
  }
  return out
}