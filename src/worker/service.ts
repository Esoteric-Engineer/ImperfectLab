import * as dsp from '../core/audio/dspadpcm'
import { type Batch, buildBatch, checkBatch } from '../core/build/batch'
import * as cutscenes from '../core/build/cutscenes'
import { Builder, glowRgba, gunPlanOf, onBackPlan, patch, type Progress, propShape, report, type Result, WIRE, write } from '../core/build/patch'
import * as effects from '../core/build/effects'
import * as gun from '../core/build/gun'
import * as moves from '../core/build/moves'
import * as portraits from '../core/build/portraits'
import * as sounds from '../core/build/sounds'
import * as tuning from '../core/build/tuning'
import * as ui from '../core/build/ui'
import { LabError } from '../core/errors'
import { FolderDisc, ImageDisc, type ReadAt, type Sink } from '../core/game/disc'
import * as R from '../core/game/roster'
import { GameSource } from '../core/game/source'
import { decodePng, encodePng } from '../core/image/png'
import { resizeNearest } from '../core/image/resample'
import { RgbaImage } from '../core/image/rgba'
import * as asftool from '../core/mnroi/asftool'
import * as gshtool from '../core/mnroi/gshtool'
import * as ngmtool from '../core/mnroi/ngmtool'
import * as bundle from '../core/model/bundle'
import { Fit, type MaterialSlots, type Tri } from '../core/model/fit'
import { Model } from '../core/model/glb'
import * as mapping from '../core/model/mapping'
import { Skeleton } from '../core/model/skeleton'
import * as imperfect from '../core/package/imperfect'
import { baseMeshes, type BoneLine, costumeImage, fittedMeshes, gameBones, holsteredTris, materialImages, type MeshData, sourceBones, sourceMeshes } from '../core/preview'
import type { BaseDetails, BaseInfo, CheckResult, ComposeArgs, DiscInfo, ImportedModel, BatchCheckResult, LayoutInfo, ModelInfo, MovePreview, PreviewResult } from './protocol'

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
  private motionCache = new Map<string, moves.MotionFiles>()
  private motionModel: Model | null = null
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

  moveCatalog(): moves.Catalog {
    const src = this.src()
    return moves.catalog(src, new effects.Effects(src.entry('Misc/game.nfx')))
  }

  cutsceneCatalog(): cutscenes.Catalog {
    return cutscenes.catalog(this.src())
  }

  cutsceneEffects(base: string, c: cutscenes.EffectChoices): cutscenes.EffectFit {
    return cutscenes.effectFit(this.src(), base, c)
  }

  moveEffects(base: string, c: cutscenes.EffectChoices): Record<string, moves.MoveEffectFit> {
    const src = this.src(), b = this.base(base)
    return moves.effectFit(src, b, c.moveEffects, c.moveLines, cutscenes.effectKs(src, b, c.cutscenes), () => new effects.Effects(src.entry('Misc/game.nfx')),
      moves.movedEffects(src, b, c.moves))
  }

  cutscenePcm(base: string, kind: imperfect.CutsceneKind, key: string): [Int16Array[], number] {
    return cutscenes.pcm(this.src(), base, kind, key)
  }

  cutsceneAnimation(base: string, kind: imperfect.CutsceneKind, key: string): Uint8Array {
    return cutscenes.animationGlb(this.src(), base, kind, key)
  }

  checkCutsceneAnimation(base: string, kind: imperfect.CutsceneKind, key: string, glb: Uint8Array): string[] {
    return cutscenes.checkAnimation(this.src(), base, kind, key, glb)
  }

  // `channels` are already at asftool.RATE.
  encodeCutsceneAudio(channels: Int16Array[], samples: number): Uint8Array {
    return asftool.build(asftool.encode(channels.map((c) => {
      const out = new Int16Array(Math.max(samples, c.length))
      out.set(c)
      return out
    })))
  }

  decodeCutsceneAudio(data: Uint8Array): [Int16Array[], number] {
    const a = asftool.read(data)
    return [asftool.decode(a), asftool.info(a).rate]
  }

  soundCatalog(): sounds.Catalog {
    return sounds.catalog(this.src())
  }

  soundPcm(base: string, index: number): [Int16Array, number] {
    return sounds.pcm(this.src(), base, index)
  }

  encodeSound(pcm: Int16Array, rate: number): Uint8Array {
    return dsp.writeDsp({ ...dsp.encode(pcm), rate, loop: null, loopContext: { ps: 0, hist1: 0, hist2: 0 } })
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

  // The base's skeleton with the gun's bone, which it may lack (gun.ts, rig).
  private gunSkeleton(key: string, side: imperfect.GunSide): Skeleton {
    const base = this.base(key)
    return new Skeleton(gun.rig(ngmtool.read(base.bundleFiles()[0])[1][0], base.body, side === 'left' ? 'L' : 'R'), base.body)
  }

  private fitted(c: imperfect.Character): { m: Model; sk: Skeleton; f: Fit; included: imperfect.Character['materials']; tris: Map<number, Tri[]> } {
    const m = this.currentModel()
    const g = imperfect.gunOf(c)
    const sk = g && this.skeleton(c.base) ? this.gunSkeleton(c.base, g.side) : this.skeleton(c.base)
    if (!sk) throw new LabError(`${R.label(c.base)}'s skeleton is not supported yet; pick another base`)
    const f = new Fit(m, sk, c.mapping, c.overrides, c.fit.scale, c.fit.torso_squash ?? true, c.fit.flip, c.fit.floor_from_mesh ?? false)
    const included = c.materials.filter((x) => x.include)
    const slots: MaterialSlots = new Map()
    for (const x of c.materials) slots.set(x.gltfMaterial, [null, false])
    included.forEach((x, i) => slots.set(x.gltfMaterial, [i, x.twoSided, x.bind]))
    return { m, sk, f, included, tris: f.triangles(slots) }
  }

  private build(c: imperfect.Character, tris: Map<number, Tri[]>, included: imperfect.Character['materials']): PreviewResult['stats'] {
    const base = this.base(c.base)
    const ngm = base.bundleFiles()[0]
    const [, models] = ngmtool.read(ngm)
    const nidx = new bundle.NormalIndex(bundle.readNormals(this.src().entry('Misc/NormalTable.ngn')))
    const render = bundle.renderModel(models[0], new Map([...tris].map(([k, v]) => [k, [...v]])), nidx, 'x', included.map(() => 'm'), models[0].meshes[0][5])
    const [data] = bundle.buildNgm(ngm, render, new Map())
    return [render.meshes.length, render.indices.length / 3, data.length, ngm.length]
  }

  fitCheck(c: imperfect.Character): string | null {
    if (!this.model) return null
    try {
      const { included, tris } = this.fitted(c)
      this.build(c, tris, included)
      return null
    } catch (e) {
      if (!(e instanceof LabError)) throw e
      return e.message
    }
  }

  preview(c: imperfect.Character, needBase: boolean): PreviewResult {
    const { m, sk, f, included, tris } = this.fitted(c)
    const base = this.base(c.base)
    const images = materialImages(m, c)
    const bySlot = new Map(included.map((x, i) => [i, images.get(x.gltfMaterial) ?? null]))
    const fitted = fittedMeshes(tris, bySlot, c.size)
    let stats: PreviewResult['stats']
    try {
      stats = this.build(c, tris, included)
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
      gameBones: gameBones(sk, c.size),
      sourceBones: sourceBones(m, f.flip),
      stats,
    }
  }

  // The fitted model with the holster's prop on the back, or the gun at the hip, or why it can't be shown.
  holsterPreview(c: imperfect.Character, gun = false): { meshes: MeshData[]; bones: BoneLine[] } | string {
    const g = gun ? imperfect.gunOf(c) : null, h = gun ? g?.holster : c.baseMoves.holster
    if (!h) return 'the holster is off'
    try {
      const { m, sk, included, tris } = this.fitted(c)
      const images = materialImages(m, c)
      const bySlot = new Map(included.map((x, i) => [i, images.get(x.gltfMaterial) ?? null]))
      const thigh = g ? sk.node(`${g.side === 'left' ? 'L' : 'R'}.thigh`) : undefined
      if (g && thigh === undefined) return `${R.label(c.base)} has no thigh bone for the gun's holster`
      const moved = g ? holsteredTris(tris, sk, h, imperfect.gunBone(c.base, g.side), thigh) : holsteredTris(tris, sk, h)
      return { meshes: previewTextures(fittedMeshes(moved, bySlot, c.size)), bones: gameBones(sk, c.size) }
    } catch (e) {
      if (!(e instanceof LabError)) throw e
      return e.message
    }
  }

  movePreview(c: imperfect.Character, moveId: string, from: string | null = null): MovePreview | string {
    const move = moves.MOVE_IDS.get(moveId)
    if (!move) return `there is no move ${moveId}`
    if (from !== null) {
      c = { ...c, moves: { ...c.moves }, moveReach: { ...c.moveReach }, moveIdle: c.moveIdle.filter((id) => id !== moveId) }
      delete c.moveReach[moveId]
      if (from === c.base) delete c.moves[moveId]
      else c.moves[moveId] = from
    }
    const src = this.src(), base = this.base(c.base)
    const notes: string[] = []
    let custom: MeshData[] | null = null, tris: Map<number, Tri[]> | null = null, sk: Skeleton | null = null
    if (!this.model) notes.push('Import a model on the Model page to see the move on it.')
    else {
      try {
        const f = this.fitted(c)
        tris = f.tris
        sk = f.sk
        const images = materialImages(f.m, c)
        custom = previewTextures(fittedMeshes(tris, new Map(f.included.map((x, i) => [i, images.get(x.gltfMaterial) ?? null])), c.size))
      } catch (e) {
        if (!(e instanceof LabError)) throw e
        notes.push(`The custom model can't be shown: ${e.message}`)
      }
    }
    const key = JSON.stringify([c.base, c.internalName, c.moves, c.moveIdle, c.moveReach, c.size, c.baseMoves, imperfect.gunOf(c), [...c.mapping], [...c.overrides], c.fit, c.materials])
    if (this.motionModel !== this.model) {
      this.motionCache.clear()
      this.motionModel = this.model
    }
    let mf = this.motionCache.get(key)
    if (!mf) {
      const baseModel = ngmtool.read(base.bundleFiles()[0])[1][0]
      const [center, geometry] = tris && sk ? propShape(c, baseModel, base.body, tris, sk) : [null, null]
      const shooter = gunPlanOf(c, baseModel, base.body, center, geometry)
      const fx = Object.keys(c.moveReach).length ? new effects.Effects(src.entry('Misc/game.nfx')) : null
      try {
        mf = moves.motionFiles(src, base, c.internalName, c.moves, c.baseMoves.throw_reach, {}, null, c.moveReach, fx, c.size, c.moveIdle, onBackPlan(c, center), false, shooter)
      } catch (e) {
        if (!(e instanceof LabError)) throw e
        return e.message
      }
      this.motionCache.set(key, mf)
      if (this.motionCache.size > 8) this.motionCache.delete(this.motionCache.keys().next().value!)
    }
    if ((c.baseMoves.holster || imperfect.gunOf(c)) && !tris) notes.push('The holstered prop needs the custom model, so the move plays without it.')
    notes.push(...mf.notes.filter((n) => n.startsWith(`moves: ${move.label} `) || n.startsWith(`reach: ${move.label} `)).map((n) => n.slice(n.indexOf(': ') + 2)))
    const variants = moves.played(src, mf, c.internalName, move).map((p) => ({ state: p.state, slot: p.slot, fps: moves.motionFps(p.opts), rec: p.rec }))
    const baseMesh = baseMeshes(src, base).map((m) => (c.size === 1 ? m : { ...m, positions: m.positions.map((v) => v * c.size) }))
    return { nodes: mf.model.nodes, variants, custom, base: previewTextures(baseMesh), notes }
  }

  private materialSource(c: imperfect.Character, x: imperfect.Material): RgbaImage | null {
    const m = this.model
    try {
      if (x.texture && c.files.has(x.texture)) return imperfect.image(c.files.get(x.texture)!)
      if (m && x.gltfMaterial < m.materials.length && m.materials[x.gltfMaterial].image !== null) return m.image(m.materials[x.gltfMaterial].image!)
    } catch (e) {
      if (!(e instanceof LabError)) throw e
    }
    return null
  }

  materialThumbs(c: imperfect.Character): [RgbaImage | null, RgbaImage | null][] {
    return c.materials.map((x) => {
      const small = shrink(this.materialSource(c, x), 128)
      let alt = small
      try {
        if (small) alt = shrink(costumeImage(small, x.alt, c.files), 128)
      } catch (e) {
        if (!(e instanceof LabError)) throw e
      }
      return [small, alt]
    })
  }

  materialPngs(c: imperfect.Character, index: number | null): [Uint8Array | null, Uint8Array | null][] {
    return c.materials.map((x, i) => {
      if (index !== null && i !== index) return [null, null]
      const im = this.materialSource(c, x)
      if (!im) return [null, null]
      let alt: Uint8Array | null = null
      try {
        if (x.alt !== 'same') alt = encodePng(costumeImage(im, x.alt, c.files))
      } catch (e) {
        if (!(e instanceof LabError)) throw e
      }
      return [encodePng(im), alt]
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

  stripOutlines(): [RgbaImage[], RgbaImage[]] {
    return [portraits.stripOutlines(this.src()), portraits.stripOutlines(this.src(), true)]
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
