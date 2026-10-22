import { openSync, readSync, statSync } from 'node:fs'
import { zipSync } from 'fflate'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex, utf8 } from '../src/core/bytes'
import type { ReadAt } from '../src/core/game/disc'
import { ImageDisc } from '../src/core/game/disc'
import { GameSource } from '../src/core/game/source'
import { encodePng } from '../src/core/image/png'
import { RgbaImage } from '../src/core/image/rgba'
import { Skeleton } from '../src/core/model/skeleton'
import type { Json } from '../src/core/mnroi/gltf'

export const ISO = process.env.IMPERFECTLAB_ISO

type V3 = [number, number, number]
export type JointSpec = [string, string | null, V3]

export const MIXAMO: JointSpec[] = [
  ['Hips', null, [0, 1.0, 0]], ['Spine', 'Hips', [0, 1.1, 0]], ['Spine1', 'Spine', [0, 1.2, 0]],
  ['Spine2', 'Spine1', [0, 1.3, 0]], ['Neck', 'Spine2', [0, 1.5, 0]], ['Head', 'Neck', [0, 1.6, 0]],
]
for (const [side, x] of [['Left', 1], ['Right', -1]] as [string, number][]) {
  MIXAMO.push(
    [side + 'Shoulder', 'Spine2', [0.05 * x, 1.45, 0]],
    [side + 'Arm', side + 'Shoulder', [0.18 * x, 1.45, 0]],
    [side + 'ForeArm', side + 'Arm', [0.45 * x, 1.45, 0]],
    [side + 'Hand', side + 'ForeArm', [0.7 * x, 1.45, 0]],
    [side + 'HandIndex1', side + 'Hand', [0.78 * x, 1.45, 0.02]],
    [side + 'HandIndex2', side + 'HandIndex1', [0.81 * x, 1.45, 0.02]],
    [side + 'HandIndex3', side + 'HandIndex2', [0.84 * x, 1.45, 0.02]],
    [side + 'HandMiddle1', side + 'Hand', [0.78 * x, 1.45, 0.0]],
    [side + 'HandRing1', side + 'Hand', [0.78 * x, 1.45, -0.02]],
    [side + 'HandRing2', side + 'HandRing1', [0.81 * x, 1.45, -0.02]],
    [side + 'HandRing3', side + 'HandRing2', [0.84 * x, 1.45, -0.02]],
    [side + 'HandThumb1', side + 'Hand', [0.73 * x, 1.44, 0.04]],
    [side + 'HandThumb2', side + 'HandThumb1', [0.76 * x, 1.44, 0.06]],
    [side + 'UpLeg', 'Hips', [0.1 * x, 0.95, 0]],
    [side + 'Leg', side + 'UpLeg', [0.1 * x, 0.5, 0]],
    [side + 'Foot', side + 'Leg', [0.1 * x, 0.08, 0]],
    [side + 'ToeBase', side + 'Foot', [0.1 * x, 0.02, 0.1]],
  )
}

export function makeGlb(joints: JointSpec[] = MIXAMO, prefix = 'mixamorig:', image: Uint8Array | null = null): Uint8Array {
  const index = new Map(joints.map(([j], i) => [j, i]))
  const nodes: Json[] = joints.map(([j, parent, p]) => {
    const q = parent ? joints[index.get(parent)!][2] : [0, 0, 0]
    return { name: prefix + j, translation: [0, 1, 2].map((k) => p[k] - q[k]) }
  })
  joints.forEach(([, parent], i) => {
    if (parent) (nodes[index.get(parent)!].children ??= []).push(i)
  })
  const pos: number[][] = [], nrm: number[][] = [], uv: number[][] = [], jnt: number[][] = [], wgt: number[][] = [], idx: number[] = []
  joints.forEach(([, , p], i) => {
    const base = pos.length
    for (const d of [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]]) {
      pos.push([0, 1, 2].map((k) => p[k] + d[k]))
      nrm.push([0, 0, 1])
      uv.push([0.5, 0.5])
      jnt.push([i, 0, 0, 0])
      wgt.push([1, 0, 0, 0])
    }
    idx.push(base, base + 1, base + 2)
  })
  const ibm: number[] = []
  for (const [, , p] of joints) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1)
  const blob: number[] = []
  const views: Json[] = [], accessors: Json[] = []
  const view = (data: Uint8Array) => {
    while (blob.length % 4) blob.push(0)
    views.push({ buffer: 0, byteOffset: blob.length, byteLength: data.length })
    for (const b of data) blob.push(b)
    return views.length - 1
  }
  const pack = (fmt: 'f' | 'H', flat: number[]) => {
    const out = new Uint8Array(flat.length * (fmt === 'f' ? 4 : 2))
    const dv = new DataView(out.buffer)
    flat.forEach((v, i) => (fmt === 'f' ? dv.setFloat32(4 * i, v, true) : dv.setUint16(2 * i, v, true)))
    return out
  }
  const accessor = (fmt: 'f' | 'H', rows: number[][] | number[], kind: string, ctype: number) => {
    const isRows = Array.isArray(rows[0])
    const flat = isRows ? (rows as number[][]).flat() : (rows as number[])
    accessors.push({ bufferView: view(pack(fmt, flat)), componentType: ctype, count: isRows ? rows.length : rows.length / (kind === 'MAT4' ? 16 : 1), type: kind })
    return accessors.length - 1
  }
  const attrs: Json = {
    POSITION: accessor('f', pos, 'VEC3', 5126), NORMAL: accessor('f', nrm, 'VEC3', 5126), TEXCOORD_0: accessor('f', uv, 'VEC2', 5126),
    JOINTS_0: accessor('H', jnt, 'VEC4', 5123), WEIGHTS_0: accessor('f', wgt, 'VEC4', 5126),
  }
  accessors[attrs.POSITION].min = [0, 1, 2].map((k) => Math.min(...pos.map((p) => p[k])))
  accessors[attrs.POSITION].max = [0, 1, 2].map((k) => Math.max(...pos.map((p) => p[k])))
  const aIdx = accessor('H', idx, 'SCALAR', 5123)
  const aIbm = accessor('f', ibm, 'MAT4', 5126)
  const j: Json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, nodes.length] }],
    nodes: [...nodes, { name: 'body', mesh: 0, skin: 0 }],
    skins: [{ joints: nodes.map((_, i) => i), inverseBindMatrices: aIbm }],
    meshes: [{ primitives: [{ attributes: attrs, indices: aIdx, material: 0 }] }],
    materials: [{ name: 'skin' }], accessors, bufferViews: views,
  }
  if (image) {
    j.images = [{ bufferView: view(image), mimeType: 'image/png' }]
    j.textures = [{ source: 0 }]
    j.materials[0].pbrMetallicRoughness = { baseColorTexture: { index: 0 } }
  }
  while (blob.length % 4) blob.push(0)
  j.buffers = [{ byteLength: blob.length }]
  let js = utf8(JSON.stringify(j))
  if (js.length % 4) {
    const p = new Uint8Array(js.length + ((4 - (js.length % 4)) % 4)).fill(0x20)
    p.set(js)
    js = p
  }
  const total = 12 + 8 + js.length + 8 + blob.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
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

export function fakeRenderModel() {
  const pos = new Map<number, V3>([[0, [0, 0, 0]], [1, [0, 0, 1.22]], [2, [0, 0, 1.27]], [3, [0, 0, 1.43]], [4, [0, 0, 1.68]], [5, [0, 0, 1.77]], [60, [0, 0, 1.18]]])
  for (const [, x, o, legs] of [['R', 1, 22, [65, 66, 67, 68]], ['L', -1, 42, [61, 62, 63, 64]]] as [string, number, number, number[]][]) {
    ;[0.03, 0.22, 0.36, 0.49, 0.59, 0.76].forEach((px, k) => pos.set(o + k, [px * x, 0.0, 1.57]))
    for (let k = 0; k < 3; k++) {
      pos.set(o + 6 + k, [(0.89 + 0.05 * k) * x, 0.04, 1.58])
      pos.set(o + 9 + k, [(0.89 + 0.05 * k) * x, -0.03, 1.58])
    }
    pos.set(o + 12, [0.82 * x, 0.07, 1.56])
    pos.set(o + 13, [0.88 * x, 0.07, 1.56])
    legs.forEach((n, i) => pos.set(n, [0.15 * x, n === legs[3] ? 0.03 : 0.0, [1.09, 0.61, 0.15, 0.05][i]]))
  }
  const nodes: [number[], number[], number, number][] = []
  for (let i = 0; i < 72; i++) {
    const p = pos.get(i) ?? [0.0, 0.0, 1.0]
    nodes.push([[0.0, 0.0, 0.0, 1.0], [-p[0], -p[1], -p[2], 1.0], i === 0 ? -1 : 0, 0])
  }
  return { nodes }
}

export function fakeSkeleton(): Skeleton {
  return new Skeleton(fakeRenderModel(), 'male')
}

export function pngBytes(w = 4, h = 4, color: number[] = [255, 0, 0, 255]): Uint8Array {
  return encodePng(RgbaImage.filled(w, h, color))
}

export function archive(members: Record<string, Uint8Array | string>): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(members)) files[k] = typeof v === 'string' ? utf8(v) : v
  return zipSync(files)
}

export function sha(body: Uint8Array): string {
  return toHex(sha256(body))
}

export function fileReader(path: string): ReadAt {
  const fd = openSync(path, 'r')
  const size = statSync(path).size
  return {
    size,
    read(offset: number, n: number) {
      const out = new Uint8Array(n)
      let got = 0
      while (got < n) {
        const k = readSync(fd, out, got, n - got, offset + got)
        if (k <= 0) break
        got += k
      }
      return got === n ? out : out.subarray(0, got)
    },
  }
}


let source: GameSource | null = null
export function gameSource(): GameSource {
  if (!source) source = new GameSource(new ImageDisc(fileReader(ISO!), ISO!))
  return source
}
