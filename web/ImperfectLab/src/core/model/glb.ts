import { LabError } from '../errors'
import { decodeImage, isPng } from '../image/decode'
import type { RgbaImage } from '../image/rgba'
import { colMajor, COMP_SIZE, GLB, identity, matMul, matVec, NCOMP, type Json, type Mat4 } from '../mnroi/gltf'

const MAX_VERTICES = 400000
const MAX_ACCESSOR_BYTES = 64 << 20
export const RIGID_PREFIX = 'mesh:'

export type Vec3 = [number, number, number]
export type Skin = [string, number][]

export class Joint {
  name: string
  parent: string | null
  pos: Vec3

  constructor(name: string, parent: string | null, pos: Vec3) {
    this.name = name
    this.parent = parent
    this.pos = pos
  }
}

export interface Prim {
  material: number | null
  pos: Vec3[]
  nrm: Vec3[]
  uv: [number, number][]
  skin: Skin[]
  tris: [number, number, number][]
}

export interface JointModel {
  joints: Joint[]
  jointNames(): string[]
  weighted(): Map<string, number>
  joint(name: string): Joint
}

export interface Material {
  name: string
  image: number | null
  texCoord: number
  transform: Json | null
}

function unit(v: Vec3): Vec3 {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1.0
  return [v[0] / n, v[1] / n, v[2] / n]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function addScaled(a: Vec3, b: Vec3, k: number): Vec3 {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
}

export function triangles(mode: number, idx: number[]): [number, number, number][] {
  const out: [number, number, number][] = []
  if (mode === 4) {
    for (let k = 0; k < idx.length - 2; k += 3) out.push([idx[k], idx[k + 1], idx[k + 2]])
  } else if (mode === 5) {
    for (let k = 0; k < idx.length - 2; k++) {
      const a = idx[k], b = idx[k + 1], c = idx[k + 2]
      out.push(k % 2 === 0 ? [a, b, c] : [b, a, c])
    }
  } else if (mode === 6) {
    for (let k = 1; k < idx.length - 1; k++) out.push([idx[0], idx[k], idx[k + 1]])
  }
  return out
}

export function computedNormals(pos: Vec3[], tris: [number, number, number][]): Vec3[] {
  const acc: Vec3[] = pos.map(() => [0.0, 0.0, 0.0])
  for (const [a, b, c] of tris) {
    const n = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]))
    for (const k of [a, b, c]) {
      acc[k][0] += n[0]
      acc[k][1] += n[1]
      acc[k][2] += n[2]
    }
  }
  return acc.map(unit)
}

export function transformUv(uv: number[], tf: Json): [number, number] {
  const [ox, oy] = tf.offset ?? [0.0, 0.0]
  const [sx, sy] = tf.scale ?? [1.0, 1.0]
  const r = tf.rotation ?? 0.0
  let u = uv[0] * sx, v = uv[1] * sy
  if (r) {
    const c = Math.cos(r), s = Math.sin(r)
    ;[u, v] = [c * u + s * v, -s * u + c * v]
  }
  return [u + ox, v + oy]
}

export class Model implements JointModel {
  g: GLB
  joints: Joint[] = []
  materials: Material[] = []
  prims: Prim[] = []
  byName = new Map<string, Joint>()
  private decoded = new Map<number, RgbaImage>()

  constructor(data: Uint8Array) {
    if (data.length < 4 || data[0] !== 0x67 || data[1] !== 0x6c || data[2] !== 0x54 || data[3] !== 0x46) throw new LabError('not a binary glTF (.glb) file')
    try {
      this.g = new GLB(data)
      this.load()
    } catch (e) {
      if (e instanceof LabError) throw e
      throw new LabError(`the GLB could not be read: ${(e as Error).message}`)
    }
  }

  private accessor(i: number): number[][] {
    const a = this.g.j.accessors[i]
    if (a.sparse) throw new LabError('sparse accessors are not supported')
    const n = (NCOMP[a.type] ?? 0) * (COMP_SIZE[a.componentType] ?? 0)
    if (!n) throw new LabError(`accessor ${i} has an unknown type`)
    if (a.count * n > MAX_ACCESSOR_BYTES) throw new LabError('an accessor is too large')
    const bv = this.g.j.bufferViews[a.bufferView]
    const end = (bv.byteOffset ?? 0) + bv.byteLength
    if (end > this.g.bin.length || (a.byteOffset ?? 0) + (a.count - 1) * (bv.byteStride || n) + n > bv.byteLength) {
      throw new LabError(`accessor ${i} runs past its buffer`)
    }
    return this.g.accessor(i)
  }

  private scalars(i: number): number[] {
    return this.accessor(i).map((v) => v[0])
  }

  private load() {
    const j = this.g.j
    const nodes: Json[] = j.nodes ?? []
    const world = this.g.world()
    const parent = this.g.parent
    const meshNodes = nodes.map((nd, i) => (nd.mesh !== undefined ? i : -1)).filter((i) => i >= 0)
    const skins = [...new Set(meshNodes.filter((i) => nodes[i].skin !== undefined).map((i) => nodes[i].skin as number))].sort((a, b) => a - b)
    if (skins.length > 1) throw new LabError(`the model has ${skins.length} skins; ImperfectLab takes one`)
    const names = new Map<number, string>()
    const used = new Set<string>()
    const jointNodes: number[] = skins.length ? j.skins[skins[0]].joints : []
    const unique = (base: string) => {
      let name = base
      for (let k = 2; used.has(name); k++) name = `${base}.${k}`
      used.add(name)
      return name
    }
    for (const n of jointNodes) names.set(n, unique(nodes[n].name || `joint_${n}`))
    const jointParent = (n: number): number | undefined => {
      let p = parent.get(n)
      while (p !== undefined && !names.has(p)) p = parent.get(p)
      return p
    }
    const translation = (m: Mat4): Vec3 => [m[0][3], m[1][3], m[2][3]]
    for (const n of jointNodes) {
      const p = jointParent(n)
      this.joints.push(new Joint(names.get(n)!, p !== undefined ? names.get(p)! : null, translation(world.get(n)!)))
    }
    let jm: Mat4[] = []
    if (skins.length) {
      const sk = j.skins[skins[0]]
      const ibm = sk.inverseBindMatrices !== undefined ? this.accessor(sk.inverseBindMatrices).map(colMajor) : jointNodes.map(() => identity())
      jm = jointNodes.map((n, k) => matMul(world.get(n)!, ibm[k]))
    }

    ;(j.materials ?? []).forEach((m: Json, i: number) => {
      let t = m.pbrMetallicRoughness?.baseColorTexture
      if (t === undefined) t = m.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture
      const image = t ? (j.textures[t.index].source ?? null) : null
      const tf = t?.extensions?.KHR_texture_transform ?? null
      this.materials.push({ name: m.name || `material_${i}`, image, texCoord: tf?.texCoord ?? t?.texCoord ?? 0, transform: tf })
    })

    let total = 0
    for (const n of meshNodes) {
      const skinned = nodes[n].skin !== undefined
      let rigid: string | null = null
      if (!skinned) {
        rigid = unique(RIGID_PREFIX + (nodes[n].name || `node_${n}`))
        const p = jointParent(n)
        this.joints.push(new Joint(rigid, p !== undefined ? names.get(p)! : null, translation(world.get(n)!)))
      }
      for (const prim of j.meshes[nodes[n].mesh].primitives) {
        const a = prim.attributes
        const mode = prim.mode ?? 4
        if (![4, 5, 6].includes(mode) || a.POSITION === undefined) continue
        const mat: number | null = prim.material ?? null
        const tc = mat !== null ? this.materials[mat].texCoord : 0
        const P = this.accessor(a.POSITION)
        total += P.length
        if (total > MAX_VERTICES) throw new LabError(`the model has more than ${MAX_VERTICES} vertices`)
        const idx = prim.indices !== undefined ? this.scalars(prim.indices) : P.map((_, k) => k)
        if (idx.some((v) => v >= P.length)) throw new LabError('a primitive indexes past its vertices')
        const tris = triangles(mode, idx).filter((t) => t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2])
        const Nn = a.NORMAL !== undefined ? this.accessor(a.NORMAL) : null
        const key = `TEXCOORD_${tc}`
        let UV: [number, number][] = a[key] !== undefined ? this.accessor(a[key]).map((v) => [v[0], v[1]]) : P.map(() => [0.0, 0.0])
        if (mat !== null && this.materials[mat].transform) UV = UV.map((uv) => transformUv(uv, this.materials[mat].transform))
        const pos: Vec3[] = []
        let nrm: Vec3[] = []
        const skin: Skin[] = []
        if (skinned) {
          const J = this.accessor(a.JOINTS_0), Wt = this.accessor(a.WEIGHTS_0)
          P.forEach((p, k) => {
            let px: Vec3 = [0.0, 0.0, 0.0], nx: Vec3 = [0.0, 0.0, 0.0]
            const sw: [number, number][] = []
            for (let c = 0; c < Math.min(J[k].length, Wt[k].length); c++) if (Wt[k][c] > 0) sw.push([J[k][c], Wt[k][c]])
            if (!sw.length || sw.some(([ji]) => ji >= jm.length)) throw new LabError('a vertex has no valid skin weights')
            let tot = 0
            for (const [, w] of sw) tot += w
            for (const [ji, w] of sw) {
              px = addScaled(px, matVec(jm[ji], p), w / tot)
              if (Nn) nx = addScaled(nx, matVec(jm[ji], Nn[k], 0.0), w / tot)
            }
            pos.push(px)
            nrm.push(nx)
            skin.push(sw.map(([ji, w]) => [names.get(jointNodes[ji])!, w / tot]))
          })
        } else {
          const m = world.get(n)!
          P.forEach((p, k) => {
            pos.push(matVec(m, p))
            if (Nn) nrm.push(matVec(m, Nn[k], 0.0))
            skin.push([[rigid!, 1.0]])
          })
        }
        if (!Nn) nrm = computedNormals(pos, tris)
        this.prims.push({ material: mat, pos, nrm, uv: UV, skin, tris })
      }
    }
    if (!this.prims.length) throw new LabError('the model has no triangles')
    if (!this.joints.length) throw new LabError('the model has no skeleton (no skin and no mesh nodes to bind)')
    this.byName = new Map(this.joints.map((jt) => [jt.name, jt]))
  }

  jointNames(): string[] {
    return this.joints.map((jt) => jt.name)
  }

  weighted(): Map<string, number> {
    const out = new Map<string, number>()
    for (const p of this.prims) for (const sw of p.skin) for (const [name] of sw) out.set(name, (out.get(name) ?? 0) + 1)
    return out
  }

  joint(name: string): Joint {
    const jt = this.byName.get(name)
    if (!jt) throw new LabError(`the model has no joint ${name}`)
    return jt
  }

  ancestors(name: string): string[] {
    const out: string[] = []
    let p = this.joint(name).parent
    while (p !== null && !out.includes(p)) {
      out.push(p)
      p = this.joint(p).parent
    }
    return out
  }

  imageBytes(i: number): Uint8Array {
    const im = this.g.j.images[i]
    if (im.uri !== undefined) throw new LabError('the GLB names an external image file; embed the textures in the GLB')
    return this.g.view(im.bufferView)[0]
  }

  setDecoded(i: number, im: RgbaImage) {
    this.decoded.set(i, im)
  }

  undecoded(): number[] {
    const out: number[] = []
    for (const m of this.materials) {
      if (m.image !== null && !this.decoded.has(m.image) && !out.includes(m.image) && !isPng(this.imageBytes(m.image))) out.push(m.image)
    }
    return out
  }

  image(i: number): RgbaImage {
    const hit = this.decoded.get(i)
    if (hit) return hit
    const im = decodeImage(this.imageBytes(i))
    this.decoded.set(i, im)
    return im
  }

  triangleCount(): number {
    let n = 0
    for (const p of this.prims) n += p.tris.length
    return n
  }
}
