import { type Batch, buildBatch, checkBatch } from '../core/build/batch'
import { Builder, glowRgba, patch, type Progress, report, type Result, WIRE, write } from '../core/build/patch'
import * as effects from '../core/build/effects'
import * as portraits from '../core/build/portraits'
import * as tuning from '../core/build/tuning'
import * as ui from '../core/build/ui'
import { LabError } from '../core/errors'
import { FolderDisc, ImageDisc, type ReadAt, type Sink } from '../core/game/disc'
import * as R from '../core/game/roster'
import { GameSource } from '../core/game/source'
import { decodePng } from '../core/image/png'
import { resizeNearest } from '../core/image/resample'
import { RgbaImage } from '../core/image/rgba'
import * as gshtool from '../core/mnroi/gshtool'
import * as ngmtool from '../core/mnroi/ngmtool'
import * as bundle from '../core/model/bundle'
import { Fit, type MaterialSlots } from '../core/model/fit'
import { Model } from '../core/model/glb'
import * as mapping from '../core/model/mapping'
import { Skeleton } from '../core/model/skeleton'
import * as imperfect from '../core/package/imperfect'
import { baseMeshes, costumeImage, fittedMeshes, gameBones, materialImages, type MeshData, sourceBones, sourceMeshes } from '../core/preview'
import type { BaseDetails, BaseInfo, CheckResult, ComposeArgs, DiscInfo, ImportedModel, BatchCheckResult, LayoutInfo, ModelInfo, PreviewResult } from './protocol'

const DEFAULT_SIZES: Record<string, [number, number]> = {
  tile0: [64, 32], tile1: [64, 32], hud: [64, 64], strip0: [128, 256], strip1: [32, 256], strip0_alt: [128, 256], strip1_alt: [32, 256],
}

export type ImageDecoder = (body: Uint8Array) => Promise<RgbaImage>

function shrink(im: RgbaImage | null, side: number): RgbaImage | null {
  if (!im) return null
  const k = Math.min(1, side / Math.max(im.width, im.height))
  return k < 1 ? resizeNearest(im, Math.max(1, Math.round(im.width * k)), Math.max(1, Math.round(im.height * k))) : im.copy()
}

function previewTextures(meshes: MeshData[]): MeshData[] {
  const seen = new Map<RgbaImage, RgbaImage | null>()
  return meshes.map((m) => {
    if (!m.image) return m
    if (!seen.has(m.image)) seen.set(m.image, shrink(m.image, 512))
    return { ...m, image: seen.get(m.image)! }
  })
}

export function defaultMaterials(model: Model): imperfect.Material[] {
  const used = [...new Set(model.prims.map((p) => p.material).filter((m): m is number => m !== null))].sort((a, b) => a - b)
  const pow2 = (d: number) => Math.min(512, 1 << Math.max(3, 32 - Math.clz32(Math.max(8, d) - 1)))
  return used.map((i, k) => {
    const mat = model.materials[i]
    let size: [number, number] = [256, 256]
    if (mat.image !== null) {
      try {
        const im = model.image(mat.image)
        size = [pow2(im.width), pow2(im.height)]
      } catch {
        // keep the default size
      }
    }
    return imperfect.newMaterial(i, mat.name, true, k === 0 ? '' : `_m${k}`, size)
  })
}

export function modelInfo(m: Model): ModelInfo {
  return {
    joints: m.joints.map((j) => ({ name: j.name, parent: j.parent, pos: j.pos })),
    weighted: [...m.weighted()],
    materials: m.materials.map((x) => ({ name: x.name, image: x.image })),
    triangles: m.triangleCount(),
  }
}

export class Service {
  source: GameSource | null = null
  private templates: R.Templates | null = null
  private bases = new Map<string, R.BaseCharacter>()
  private skeletons = new Map<string, Skeleton | null>()
  private model: Model | null = null
  private modelBytes: Uint8Array | null = null
  private layoutCache: portraits.SelectLayout | null = null
  private pictures = new Map<string, RgbaImage>()
  private batchBuild: { token: number; result: Result } | null = null
  private batchTokens = 0
  decoder: ImageDecoder | null = null

  openDisc(disc: ImageDisc | FolderDisc): DiscInfo {
    const src = new GameSource(disc)
    this.source = src
    this.batchBuild = null
    this.templates = null
    this.bases.clear()
    this.skeletons.clear()
    this.layoutCache = null
    return { name: disc.name, gameId: disc.gameId }
  }

  openImage(r: ReadAt, name: string): DiscInfo {
    return this.openDisc(new ImageDisc(r, name))
  }

  openFolder(entries: Map<string, ReadAt>, name: string): DiscInfo {
    let root = ''
    for (const k of entries.keys()) {
      const i = k.toLowerCase().lastIndexOf('sys/boot.bin')
      if (i >= 0 && (i === 0 || k[i - 1] === '/')) {
        root = k.slice(0, i)
        break
      }
    }
    const inner = new Map<string, ReadAt>()
    for (const [k, v] of entries) if (k.startsWith(root)) inner.set(k.slice(root.length), v)
    return this.openDisc(new FolderDisc(inner, name))
  }

  private src(): GameSource {
    if (!this.source) throw new LabError('choose your game disc first')
    return this.source
  }

  verify(progress: Progress) {
    this.src().verify((done, total) => progress('Checking the disc', done, total))
  }

  private base(key: string): R.BaseCharacter {
    let b = this.bases.get(key)
    if (!b) {
      this.templates ??= new R.Templates(this.src().entry('Misc/Global.not'))
      b = new R.BaseCharacter(this.src(), key, this.templates)
      this.bases.set(key, b)
    }
    return b
  }

  private skeleton(key: string): Skeleton | null {
    if (!this.skeletons.has(key)) {
      try {
        this.skeletons.set(key, Skeleton.ofBase(this.base(key)))
      } catch (e) {
        if (!(e instanceof LabError)) throw e
        this.skeletons.set(key, null)
      }
    }
    return this.skeletons.get(key)!
  }

  baseList(): BaseInfo[] {
    let hud: gshtool.Bank | null = null
    try {
      hud = gshtool.readGsh(this.src().entry('HUD/hudENG.1.gsh'))
    } catch {
      hud = null
    }
    return R.keys().map((key) => {
      try {
        const b = this.base(key)
        const sk = this.skeleton(key)
        const rec = hud?.records.get(`plr_${b.hudName}`)
        let icon: RgbaImage | null = null
        if (rec) {
          const pic = new gshtool.Picture(rec)
          icon = new RgbaImage(pic.width, pic.height, pic.decode(rec))
        }
        const [, models] = ngmtool.read(b.bundleFiles()[0])
        return {
          key, label: b.label, body: b.body, stats: b.stats, altStats: b.altStats, hudName: b.hudName, icon,
          skeleton: sk ? { body: sk.body, nodes: models[0].nodes.map(([a, bb, p, x]) => [a, bb, p, x]) } : null, error: null,
        }
      } catch (e) {
        if (!(e instanceof LabError)) throw e
        return { key, label: R.label(key), body: 'male', stats: [], altStats: [], hudName: '', icon: null, skeleton: null, error: e.message }
      }
    })
  }

  baseDetails(key: string): BaseDetails {
    const b = this.base(key), src = this.src()
    let gameplay: Record<string, number> = {}
    try {
      gameplay = new tuning.Tuning(src, b).gameplay()
    } catch (e) {
      if (!(e instanceof LabError)) throw e
    }
    const ab = b.abilities
    let tint: Record<string, effects.TintPlan> = {}
    try {
      tint = effects.tintPlans(src, b)
    } catch (e) {
      if (!(e instanceof LabError)) throw e
    }
    let sizes: Record<string, [number, number]>
    try {
      const tiles = ui.tileSizes(src.entry(ui.P + 'screens/clashCharSelect_thumbs.big'))
      const strips = portraits.stripSizes(src), stripsAlt = portraits.stripSizes(src, true)
      sizes = { tile0: tiles[0], tile1: tiles[1], strip0: strips[0], strip1: strips[1], strip0_alt: stripsAlt[0], strip1_alt: stripsAlt[1] }
      const hud = ui.bankImageSize(src.entry('HUD/hudENG.1.gsh'), `plr_${b.hudName}`)
      const banner = ui.bankImageSize(src.entry('HUD/hudENG.2.gsh'), `ovr_${b.hudName}ENG`)
      if (hud) sizes.hud = hud
      if (banner) sizes.banner = banner
    } catch (e) {
      if (!(e instanceof LabError)) throw e
      sizes = { ...DEFAULT_SIZES }
    }
    return {
      gameplay,
      lift: ab & 0x20 ? 'heavy' : ab & 0x10 ? 'medium' : 'light',
      wireSwing: ab & WIRE ? 'on' : 'off',
      hasWire: Boolean(ab & WIRE),
      health: R.u32(b.t.prop(b.plr, R.P_MAXHEALTH)) || 100,
      tint,
      sizes,
    }
  }

  private async decodeImages(m: Model) {
    for (const i of m.undecoded()) {
      if (!this.decoder) throw new LabError('the GLB has a texture that is not a PNG')
      m.setDecoded(i, await this.decoder(m.imageBytes(i)))
    }
  }

  async importModel(raw: Uint8Array): Promise<ImportedModel> {
    const full = new Model(raw)
    const keep = new Set(full.materials.map((m) => m.image).filter((i): i is number => i !== null))
    const slim = imperfect.slimGlb(raw, keep)
    const model = new Model(slim)
    await this.decodeImages(model)
    this.model = model
    this.modelBytes = slim
    return { slim, info: modelInfo(model), materials: defaultMaterials(model) }
  }

  async setModel(glb: Uint8Array | null): Promise<ModelInfo | null> {
    if (glb === null) {
      this.model = null
      this.modelBytes = null
      return null
    }
    if (this.modelBytes && this.modelBytes.length === glb.length && this.modelBytes.every((b, i) => b === glb[i])) return modelInfo(this.model!)
    const m = new Model(glb)
    await this.decodeImages(m)
    this.model = m
    this.modelBytes = glb
    return modelInfo(m)
  }

  private currentModel(): Model {
    if (!this.model) throw new LabError('import a model (.glb)')
    return this.model
  }

  autoMap(key: string): mapping.AutoMap | null {
    const sk = this.skeleton(key)
    if (!sk || !this.model) return null
    return mapping.autoMap(this.model, sk)
  }

  preview(c: imperfect.Character, needBase: boolean): PreviewResult {
    const m = this.currentModel()
    const sk = this.skeleton(c.base)
    if (!sk) throw new LabError(`${R.label(c.base)}'s skeleton is not supported yet; pick another base`)
    const base = this.base(c.base)
    const f = new Fit(m, sk, c.mapping, c.overrides, c.fit.scale, c.fit.torso_squash ?? true, c.fit.flip)
    const included = c.materials.filter((x) => x.include)
    const slots: MaterialSlots = new Map()
    for (const x of c.materials) slots.set(x.gltfMaterial, [null, false])
    included.forEach((x, i) => slots.set(x.gltfMaterial, [i, x.twoSided, x.bind]))
    const tris = f.triangles(slots)
    const images = materialImages(m, c)
    const bySlot = new Map(included.map((x, i) => [i, images.get(x.gltfMaterial) ?? null]))
    const fitted = fittedMeshes(tris, bySlot)
    let stats: PreviewResult['stats']
    try {
      const ngm = base.bundleFiles()[0]
      const [, models] = ngmtool.read(ngm)
      const nidx = new bundle.NormalIndex(bundle.readNormals(this.src().entry('Misc/NormalTable.ngn')))
      const render = bundle.renderModel(models[0], new Map([...tris].map(([k, v]) => [k, [...v]])), nidx, 'x', included.map(() => 'm'), models[0].meshes[0][5])
      const [data] = bundle.buildNgm(ngm, render, new Map())
      stats = [render.meshes.length, render.indices.length / 3, data.length, ngm.length]
    } catch (e) {
      if (!(e instanceof LabError)) throw e
      stats = e.message
    }
    return {
      scale: f.S,
      flip: f.flip,
      fitted: previewTextures(fitted),
      source: previewTextures(sourceMeshes(m, c, f.flip)),
      base: needBase ? previewTextures(baseMeshes(this.src(), base)) : null,
      gameBones: gameBones(sk),
      sourceBones: sourceBones(m, f.flip),
      stats,
    }
  }

  materialThumbs(c: imperfect.Character): [RgbaImage | null, RgbaImage | null][] {
    const m = this.model
    return c.materials.map((x) => {
      let im: RgbaImage | null = null
      try {
        if (x.texture && c.files.has(x.texture)) im = imperfect.image(c.files.get(x.texture)!)
        else if (m && x.gltfMaterial < m.materials.length && m.materials[x.gltfMaterial].image !== null) im = m.image(m.materials[x.gltfMaterial].image!)
      } catch (e) {
        if (!(e instanceof LabError)) throw e
      }
      const small = shrink(im, 128)
      let alt = small
      try {
        if (small) alt = shrink(costumeImage(small, x.alt, c.files), 128)
      } catch (e) {
        if (!(e instanceof LabError)) throw e
      }
      return [small, alt]
    })
  }

  private layout(): portraits.SelectLayout {
    this.layoutCache ??= new portraits.SelectLayout(this.src())
    return this.layoutCache
  }

  layoutInfo(): LayoutInfo {
    const layout = this.layout()
    const canvases: LayoutInfo['canvases'] = {}
    for (const [i, pose, size] of layout.canvases()) {
      const cur = canvases[pose]
      if (!cur || size[0] * size[1] > cur.size[0] * cur.size[1]) canvases[pose] = { index: i, size, scale: layout.screenBox(layout.records[i])[0] }
    }
    const originals: Record<string, RgbaImage | null> = {}
    for (const pose of portraits.POSES) originals[pose] = layout.original(pose)
    return { canvases, sR: layout.sR, originals }
  }

  setPictures(pictures: Record<string, Uint8Array>) {
    this.pictures = new Map(Object.entries(pictures).map(([k, v]) => [k, decodePng(v)]))
  }

  compose(a: ComposeArgs, index: number): RgbaImage {
    const pic = this.pictures.get(a.pose)
    if (!pic) throw new LabError(`no picture for ${a.pose}`)
    return this.layout().compose(index, pic, a.scale, a.anchor, a.glow ? glowRgba(a.glow) : null, a.fade)
  }

  private withModel(c: imperfect.Character): imperfect.Character {
    this.currentModel()
    return { ...c, glb: this.modelBytes }
  }

  check(c: imperfect.Character, progress: Progress): CheckResult {
    const r = new Builder(this.src(), this.withModel(c), progress, this.currentModel()).build()
    return { notes: r.notes, sets: [...r.sets.keys()].sort(), adds: [...r.adds.keys()].sort() }
  }

  // A model that cannot be read is left to the check, which reports it.
  private async batchModels(chars: Batch): Promise<(Model | undefined)[]> {
    return Promise.all(chars.map(async (c) => {
      if (!c.glb) return undefined
      try {
        const m = new Model(c.glb)
        await this.decodeImages(m)
        return m
      } catch (e) {
        if (!(e instanceof LabError)) throw e
        return undefined
      }
    }))
  }

  async checkBatch(chars: Batch, progress: Progress): Promise<BatchCheckResult> {
    this.batchBuild = null
    const [check, r] = checkBatch(this.src(), chars, progress, await this.batchModels(chars))
    if (!r) return { ...check, token: null }
    this.batchBuild = { token: ++this.batchTokens, result: r }
    return { ...check, token: this.batchBuild.token }
  }

  async patchBatch(chars: Batch, sink: Sink, verified: boolean, token: number | null, progress: Progress): Promise<string> {
    const built = this.batchBuild?.token === token ? this.batchBuild.result : null
    const models = built ? [] : await this.batchModels(chars)
    const r = await write(this.src(), { sink }, progress, verified, () => built ?? buildBatch(this.src(), chars, progress, models))
    return report(chars, r)
  }

  async patch(c: imperfect.Character, sink: Sink, verified: boolean, progress: Progress): Promise<string> {
    const full = this.withModel(c)
    const r = await patch(this.src(), full, { sink }, progress, verified, this.currentModel())
    return report(full, r)
  }
}
