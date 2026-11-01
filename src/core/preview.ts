// Unindexed triangle lists for the 3D preview, all in the game's frame (Z up, facing +Y).
import { u16be, f32be, latin1 } from './bytes'
import type { BaseCharacter } from './game/roster'
import type { GameSource } from './game/source'
import { RgbaImage } from './image/rgba'
import { hueShift } from './image/filters'
import * as gxtex from './mnroi/gxtex'
import * as ngmtool from './mnroi/ngmtool'
import * as shaders from './build/shaders'
import { CLUB } from './build/basemoves'
import * as holster from './build/holster'
import { conv, type Tri, unit } from './model/fit'
import type { Model } from './model/glb'
import type { Skeleton } from './model/skeleton'
import { type Character, type Holster, image as readImage } from './package/imperfect'

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  image: RgbaImage | null
  alpha: number
  keys: (string | number)[]
  influences: Float32Array
  influenceKeys: Int32Array
}

export type BoneLine = [[number, number, number], [number, number, number], string | number]

class MeshBuilder {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  infKeys: number[] = []
  infW: number[] = []
  keys: (string | number)[] = []
  keyIndex = new Map<string | number, number>()

  vertex(p: ArrayLike<number>, n: ArrayLike<number>, uv: ArrayLike<number>, inf: [string | number, number][]) {
    this.pos.push(p[0], p[1], p[2])
    this.nrm.push(n[0], n[1], n[2])
    this.uv.push(uv[0], uv[1])
    for (let k = 0; k < 3; k++) {
      const e = inf[k]
      if (!e) {
        this.infKeys.push(-1)
        this.infW.push(0)
        continue
      }
      let ki = this.keyIndex.get(e[0])
      if (ki === undefined) {
        ki = this.keys.length
        this.keys.push(e[0])
        this.keyIndex.set(e[0], ki)
      }
      this.infKeys.push(ki)
      this.infW.push(e[1])
    }
  }

  done(image: RgbaImage | null, alpha = 1.0): MeshData {
    return {
      positions: Float32Array.from(this.pos), normals: Float32Array.from(this.nrm), uvs: Float32Array.from(this.uv),
      image, alpha, keys: this.keys, influences: Float32Array.from(this.infW), influenceKeys: Int32Array.from(this.infKeys),
    }
  }
}

export function materialImages(model: Model, c: Character): Map<number, RgbaImage> {
  const out = new Map<number, RgbaImage>()
  const specs = new Map(c.materials.map((m) => [m.gltfMaterial, m]))
  model.materials.forEach((mat, i) => {
    const m = specs.get(i)
    try {
      if (m && m.texture && c.files.has(m.texture)) out.set(i, readImage(c.files.get(m.texture)!))
      else if (mat.image !== null) out.set(i, model.image(mat.image))
    } catch {
      // a texture that cannot be read is drawn untextured
    }
  })
  return out
}

export function costumeImage(im: RgbaImage, alt: string, files: Map<string, Uint8Array>): RgbaImage {
  if (alt.startsWith('hue:')) return hueShift(im, parseFloat(alt.slice(4)))
  if (alt !== 'same' && files.has(alt)) return readImage(files.get(alt)!)
  return im
}

export function sourceMeshes(model: Model, c: Character, flip = false): MeshData[] {
  const images = materialImages(model, c)
  return model.prims.map((prim) => {
    const b = new MeshBuilder()
    for (const tri of prim.tris) for (const k of tri) b.vertex(conv(prim.pos[k], flip), unit(conv(prim.nrm[k], flip)), prim.uv[k], prim.skin[k])
    return b.done(prim.material !== null ? (images.get(prim.material) ?? null) : null)
  })
}

export function fittedMeshes(trisByMat: Map<number, Tri[]>, images: Map<number, RgbaImage | null>, size = 1): MeshData[] {
  return [...trisByMat.keys()].sort((a, b) => a - b).map((slot) => {
    const b = new MeshBuilder()
    for (const t of trisByMat.get(slot)!) for (const [p, n, u, w] of t) b.vertex([p[0] * size, p[1] * size, p[2] * size], n, u, w)
    return b.done(images.get(slot) ?? null)
  })
}

// What is fixed to the prop bone alone, moved into the holster on the anchor bone.
export function holsteredTris(trisByMat: Map<number, Tri[]>, skeleton: Skeleton, h: Pick<Holster, 'position' | 'rotation'>, bone = CLUB, anchor = holster.CHEST): Map<number, Tri[]> {
  const C = holster.center(trisByMat.values(), bone)
  const chest = skeleton.positions()[anchor]
  const R = holster.turn(h.rotation)
  const at = (p: number[]) => {
    const v = holster.apply(R, [p[0] - C[0], p[1] - C[1], p[2] - C[2]])
    return [0, 1, 2].map((k) => chest[k] + h.position[k] + v[k]) as [number, number, number]
  }
  const onClub = (w: [number, number][]) => w.some(([b, x]) => b === bone && x > 0) && !w.some(([b, x]) => b !== bone && x > 0)
  return new Map([...trisByMat].map(([slot, tris]) => [slot, tris.map((t) => t.map((v): Tri[number] => (onClub(v[3]) ? [at(v[0]), holster.apply(R, v[1]), v[2], v[3]] : v)) as Tri)]))
}

export function baseMeshes(source: GameSource, base: BaseCharacter, alpha = 1.0): MeshData[] {
  const [ngm, ngt, tpl] = base.bundleFiles()
  const [, models] = ngmtool.read(ngm)
  const m = models[0]
  const names = latin1(ngt).split(/\s+/).filter(Boolean).map((n) => n.toLowerCase())
  const [tplImages] = gxtex.readTpl(tpl)
  const nsa = shaders.blocks(source.entry('Materials/Shaders/shaders.nsa'))
  const raw = source.entry('Misc/NormalTable.ngn')
  const count = u16be(raw, 0)
  const normals = Array.from({ length: count }, (_, i) => [f32be(raw, 2 + 12 * i), f32be(raw, 6 + 12 * i), f32be(raw, 10 + 12 * i)])
  const cache = new Map<string, RgbaImage | null>()
  const texture = (part: string): RgbaImage | null => {
    const name = shaders.firstWord(nsa.get(part.toLowerCase())?.get('texture') || part).toLowerCase()
    if (!cache.has(name)) {
      cache.set(name, null)
      const i = names.indexOf(name)
      if (i >= 0 && i < tplImages.length) {
        const im = tplImages[i]
        cache.set(name, new RgbaImage(im.width, im.height, gxtex.decode(im.format, im.base(), im.width, im.height)))
      }
    }
    return cache.get(name)!
  }
  const out: MeshData[] = []
  const start = new Array(m.streams.length).fill(0)
  let off = 0
  for (const [part, stream, strips, lists, count2, , nodes] of m.meshes) {
    const st = m.streams[stream]
    start[stream] += count2
    const idx = m.indices.slice(off, off + strips + lists)
    off += strips + lists
    const tris: number[][] = []
    for (let i = 0; i < strips - 2; i++) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2]
      if (a !== b && b !== c && a !== c) tris.push(i % 2 === 0 ? [a, b, c] : [b, a, c])
    }
    for (let k = strips; k < strips + lists; k += 3) tris.push(idx.slice(k, k + 3))
    const b = new MeshBuilder()
    for (const t of tris) {
      for (const r of t) {
        const [vi, ni, ui] = st.refs[r]
        const v = st.vertices[vi]
        const n = ni < normals.length ? normals[ni] : [0.0, 0.0, 1.0]
        const u = ui < m.uvs.length ? m.uvs[ui] : [0, 0]
        let inf: [number, number][]
        if (st.kind === 2) inf = [0, 1, 2].filter((j) => v[3 + j] > 0).map((j) => [v[6 + j], v[3 + j]])
        else if (st.kind === 1) inf = [[v[3], 1.0]]
        else inf = nodes.length ? [[nodes[0], 1.0]] : []
        b.vertex(v, n, [u[0] / 512.0, u[1] / 512.0], inf)
      }
    }
    out.push(b.done(part < m.parts.length ? texture(m.parts[part]) : null, alpha))
  }
  return out
}

export function gameBones(skeleton: Skeleton, size = 1): BoneLine[] {
  const J = skeleton.positions().map((p): [number, number, number] => [p[0] * size, p[1] * size, p[2] * size])
  return skeleton.nodes.filter((n) => n.parent !== null && n.parent >= 0).map((n) => [J[n.parent], J[n.index], n.index])
}

export function sourceBones(model: Model, flip = false): BoneLine[] {
  return model.joints.filter((j) => j.parent !== null).map((j) => [conv(model.joint(j.parent!).pos, flip), conv(j.pos, flip), j.name])
}
