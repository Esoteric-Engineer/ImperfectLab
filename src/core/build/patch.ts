// The actual character patcher.
// The builder works out every changed and added file as bytes, then patch() streams the new disc image.
import { latin1 } from '../bytes'
import { LabError } from '../errors'
import { GC_DISC_SIZE, type Sink, writeIso } from '../game/disc'
import { planRepack, writeBig } from '../game/bigrepack'
import * as D from '../game/dol'
import * as R from '../game/roster'
import type { GameSource } from '../game/source'
import { hueShift } from '../image/filters'
import { resizeLanczos } from '../image/resample'
import { RgbaImage } from '../image/rgba'
import * as gshtool from '../mnroi/gshtool'
import * as gxtex from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import * as nottool from '../mnroi/nottool'
import * as nvbtool from '../mnroi/nvbtool'
import * as ngmtool from '../mnroi/ngmtool'
import * as bundle from '../model/bundle'
import { Fit, type MaterialSlots } from '../model/fit'
import { Model } from '../model/glb'
import { Skeleton } from '../model/skeleton'
import { type Character, image as readImage, type Material, problems, type Placement } from '../package/imperfect'
import * as effects from './effects'
import * as basemoves from './basemoves'
import * as portraits from './portraits'
import * as shaders from './shaders'
import * as templates from './templates'
import * as tuning from './tuning'
import * as ui from './ui'

const LIFT_BITS: Record<string, [number, number]> = { light: [0, 0x30], medium: [0x10, 0x20], heavy: [0x20, 0] }
export const WIRE = 0x80

export type Progress = (stage: string, done?: number, total?: number) => void

export class Result {
  dol: Uint8Array | null = null
  // the effect cache main.dol needs, when a tint outgrows the game's
  cache: number | null = null
  sets = new Map<string, Uint8Array>()
  adds = new Map<string, Uint8Array>()
  notes: string[] = []
}

export function colorInt(color: string): number {
  return parseInt(color.replace(/^#+/, '').slice(0, 6), 16)
}

export function glowRgba(color: string): [number, number, number, number] {
  const c = color.replace(/^#+/, '')
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16), c.length === 8 ? parseInt(c.slice(6, 8), 16) : 110]
}

export class Builder {
  src: GameSource
  c: Character
  progress: Progress
  base: R.BaseCharacter
  r = new Result()
  texture2 = 'ge_charlight'
  bundleAdds = new Map<string, Uint8Array>()
  uiAdds = new Map<string, Uint8Array>()
  fit: Fit | null = null
  model: Model | null
  selectId = ui.NEW_ID
  tint: string | null = null

  constructor(source: GameSource, character: Character, progress?: Progress, model?: Model) {
    this.src = source
    this.c = character
    this.progress = progress ?? (() => {})
    this.base = new R.BaseCharacter(source, character.base)
    this.model = model ?? null
  }

  note(text: string) {
    this.r.notes.push(text)
  }

  checkNames() {
    const c = this.c, n = c.internalName.toLowerCase()
    const errors = problems(c).filter(([level]) => level === 'error').map(([, msg]) => msg)
    if (errors.length) throw new LabError(errors.join('; '))
    const t = new R.Templates(this.src.entry('Misc/Global.not'))
    for (const name of templates.templateNames(c.internalName)) {
      if (t.has(name)) throw new LabError(`the game already has a character template ${name}: pick another internal name`)
    }
    for (const costume of ['', '_alt']) {
      if (this.src.has(`Bundles/${n}${costume}.ngm`)) throw new LabError(`the game already has a model bundle ${n}${costume}: pick another internal name`)
    }
    if (this.src.has(`Misc/PLAYER_${c.internalName}.nvb`)) throw new LabError(`the game already has a tuning file for ${c.internalName}: pick another internal name`)
    if (c.baseMoves.throw_reach !== undefined) {
      for (const name of [`Motions/${basemoves.motionSetName(c.internalName)}`, `Bundles/${n}.ngb`]) {
        if (this.src.has(name)) throw new LabError(`the game already has ${name}: pick another internal name`)
      }
    }
    const hud = gshtool.readGsh(this.src.entry('HUD/hudENG.1.gsh'))
    if (hud.records.has('plr_' + n) || hud.records.has('plr_alt' + n)) throw new LabError(`the game already has HUD portraits named plr_${n}: pick another internal name`)
  }

  build(): Result {
    this.checkNames()
    const c = this.c
    this.progress('Roster')
    this.r.dol = D.patch(this.src.dol, c.internalName, c.displayName, c.stats.normal, c.stats.alt)
    this.buildFiles()
    if (this.r.cache !== null) this.r.dol = D.growEffectCache(this.r.dol, this.r.cache)
    if (c.baseMoves.throw_reach !== undefined) this.r.dol = D.mirrorSkip(this.r.dol)
    return this.r
  }

  // Every file but main.dol.
  buildFiles(): Result {
    this.progress('Model')
    const materials = this.buildModel()
    this.progress('Templates, materials and tuning')
    const [effect1, power, projectiles] = this.effects()
    const description = this.tuning(power)
    const motionSet = this.baseMoves()
    this.templates(effect1, description, projectiles, motionSet)
    this.r.sets.set('Materials/Shaders/shaders.nsa', shaders.build(this.src.entry('Materials/Shaders/shaders.nsa'), materials, this.texture2))
    this.progress('Select screen, portraits and HUD')
    this.ui()
    this.r.adds = new Map([...this.uiAdds, ...this.bundleAdds, ...this.r.adds])
    return this.r
  }

  materialImages(model: Model): [Material, RgbaImage, RgbaImage][] {
    const c = this.c
    const out: [Material, RgbaImage, RgbaImage][] = []
    for (const m of c.materials) {
      if (!m.include) continue
      let im: RgbaImage
      if (m.texture) {
        im = readImage(c.files.get(m.texture)!)
      } else {
        const idx = m.gltfMaterial < model.materials.length ? model.materials[m.gltfMaterial].image : null
        if (idx === null) throw new LabError(`material ${m.name} has no texture in the GLB: give it a PNG`)
        im = model.image(idx)
      }
      let alt: RgbaImage
      if (m.alt === 'same') alt = im
      else if (m.alt.startsWith('hue:')) alt = hueShift(im, parseFloat(m.alt.slice(4)))
      else {
        const body = c.files.get(m.alt)
        if (!body) throw new LabError(`the costume 2 texture of ${m.name} is missing`)
        alt = readImage(body)
      }
      out.push([m, im, alt])
    }
    return out
  }

  buildModel(): string[] {
    const c = this.c, base = this.base
    const model = this.model ?? new Model(c.glb!)
    const sk = Skeleton.ofBase(base)
    const f = new Fit(model, sk, c.mapping, c.overrides, c.fit.scale, c.fit.torso_squash ?? true, c.fit.flip)
    const included = c.materials.filter((m) => m.include)
    const slots: MaterialSlots = new Map()
    for (const m of c.materials) slots.set(m.gltfMaterial, [null, false])
    included.forEach((m, i) => slots.set(m.gltfMaterial, [i, m.twoSided, m.bind]))
    for (const m of included) {
      if (m.bind !== null && m.bind >= sk.nodes.length) throw new LabError(`material ${m.name} is bound to game bone ${m.bind}, which ${base.label} does not have`)
    }
    const tris = f.triangles(slots)
    const imgs = this.materialImages(model)
    const normals = new bundle.NormalIndex(bundle.readNormals(this.src.entry('Misc/NormalTable.ngn')))
    const nsa = shaders.blocks(this.src.entry('Materials/Shaders/shaders.nsa'))
    this.texture2 = 'ge_charlight'
    this.bundleAdds = new Map()
    const allMaterials: string[] = []
    const stats = new bundle.Stats()
    const first = (v: string | undefined) => shaders.firstWord(v).toLowerCase()
    for (const [costume, alt] of [['', false], ['_alt', true]] as [string, boolean][]) {
      const [ngm, ngt, tpl] = base.bundleFiles(alt)
      const [, models] = ngmtool.read(ngm)
      const renderBase = models[0]
      const replaced = new Set<string>(), keptByOthers = new Set<string>()
      for (const part of renderBase.parts) {
        const keys = nsa.get(part.toLowerCase()) ?? new Map<string, string>()
        replaced.add(part.toLowerCase())
        for (const k of ['texture', 'texture2', 'envmap']) if (keys.get(k)) replaced.add(first(keys.get(k)))
        if (!alt && shaders.firstWord(keys.get('shader')) === 'charlight' && keys.get('texture2') && this.texture2 === 'ge_charlight') {
          this.texture2 = shaders.firstWord(keys.get('texture2'))
        }
      }
      for (const m of models.slice(1)) {
        for (const part of m.parts) {
          const keys = nsa.get(part.toLowerCase()) ?? new Map<string, string>()
          keptByOthers.add(part.toLowerCase())
          for (const k of ['texture', 'texture2', 'envmap']) if (keys.get(k)) keptByOthers.add(first(keys.get(k)))
        }
      }
      const names = latin1(ngt).split(/\s+/).filter(Boolean)
      const keep = names.filter((n) => !replaced.has(n.toLowerCase()) || keptByOthers.has(n.toLowerCase()) || n.toLowerCase() === this.texture2.toLowerCase())
      let extra: [string, gxtex.TplImage][] = []
      if (!names.some((n) => n.toLowerCase() === this.texture2.toLowerCase())) {
        const joNames = latin1(this.src.entry('Bundles/johnnyohm.ngt')).split(/\s+/).filter(Boolean).map((n) => n.toLowerCase())
        const [joIms] = gxtex.readTpl(this.src.entry('Bundles/johnnyohm.tpl'))
        const at = joNames.indexOf(this.texture2.toLowerCase())
        if (at < 0) throw new LabError(`Johnny Ohm's bundle has no texture ${this.texture2}`)
        extra = [[this.texture2, joIms[at]]]
      }
      const mats = included.map((m) => c.internalName + costume + m.suffix)
      allMaterials.push(...mats)
      const nm = templates.modelNames(c.internalName, costume)
      const plr = alt ? base.alt : base.plr
      const renames = new Map<string, string>()
      for (const [pid, key] of [[R.P_PHYSMODEL, 'PHYSMODEL'], [R.P_SHADOWMODEL, 'SHADOWMODEL']] as [number, 'PHYSMODEL' | 'SHADOWMODEL'][]) {
        const old = R.text(base.t.prop(plr, pid))
        if (old) renames.set(old.toLowerCase(), nm[key])
      }
      const copy = new Map([...tris].map(([k, v]) => [k, [...v]]))
      const render = bundle.renderModel(renderBase, copy, normals, nm.MODEL, mats,
        renderBase.meshes.length ? renderBase.meshes[0][5] : [0, 0, 0], stats)
      if (c.baseMoves.throw_reach !== undefined) basemoves.hitSegment(render)
      const [data] = bundle.buildNgm(ngm, render, renames)
      const otherNames = new Set(models.slice(1).map((m) => m.name.toLowerCase()))
      const missing = [...renames.keys()].filter((old) => !otherNames.has(old))
      if (missing.length) this.note(`the base bundle has no model named ${missing.join(', ')}`)
      const textures: [string, RgbaImage, [number, number]][] = mats.map((mat, i) => {
        const [m, im, imAlt] = imgs[i]
        return [mat, alt ? imAlt : im, m.size]
      })
      const [tplOut, ngtOut] = bundle.buildTpl(tpl, ngt, textures, keep, extra)
      const b = c.internalName.toLowerCase() + costume
      this.bundleAdds.set(`Bundles/${b}.ngm`, data)
      this.bundleAdds.set(`Bundles/${b}.ngt`, ngtOut)
      this.bundleAdds.set(`Bundles/${b}.tpl`, tplOut)
      if (!alt) {
        const st = render.streams[0]
        this.note(`model: ${render.meshes.length} parts, ${st.vertices.length} positions, ${st.refs.length} vertices, ${render.indices.length / 3} triangles; scale ${f.S.toFixed(3)}; .ngm ${data.length} bytes, .tpl ${tplOut.length} bytes`)
      }
    }
    if (stats.clampedUvs) this.note(`warning: ${stats.clampedUvs} UVs were outside the range the game stores and were clamped`)
    this.fit = f
    return allMaterials
  }

  effects(): [[string, string] | null, Map<number, string[]> | null, nottool.Template[]] {
    const c = this.c, base = this.base
    if (c.aura.mode !== 'tint') return [null, null, []]
    const fx = new effects.Effects(this.src.entry('Misc/game.nfx'))
    const tun = new tuning.Tuning(this.src, base)
    const level = this.tint ?? (c.aura.tint === 'all' ? effects.tintLevel(effects.tintPlans(this.src, base), 'all') : c.aura.tint)
    if (this.tint === null && level !== c.aura.tint) this.note(`aura tint: ${base.label}'s full tint needs more memory than a match can spare; its idle and power-up effects are tinted`)
    const [rootsN, rootsA] = effects.roots(fx, tun, base, level)
    if (!rootsN.length && !rootsA.length) throw new LabError(`${base.label} has no effects to tint; use the Base or Swap aura`)
    const mn = fx.tinted(rootsN, c.aura.color, effects.copyPrefix(c.internalName, false))
    const ma = fx.tinted(rootsA, c.aura.alt_color, effects.copyPrefix(c.internalName, true))
    this.r.sets.set('Misc/game.nfx', fx.build())
    const size = effects.cacheSize(fx.used())
    if (size > nfxtool.CACHE_SIZE) this.r.cache = size
    this.note(`aura tint: ${mn.size + ma.size} effect blocks copied, ${fx.used()} of ${size} bytes of effect cache used`)
    const pick = (m: Map<string, string>, name: string | null) => m.get((name ?? '').toLowerCase()) ?? name!
    const effect1: [string, string] | null = base.effect1 ? [pick(mn, base.effect1), pick(ma, base.altEffect1)] : null
    // Every effect field naming a tinted block follows it.
    const power = new Map<number, string[]>()
    const slotsOf = (fid: number) => Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(fid, s) as string)
    for (const fid of tun.fieldsOf(nvbtool.T_EFFECT)) {
      const vals = slotsOf(fid)
      const next = vals.map((v, s) => pick(s === tuning.SLOTS - 1 ? ma : mn, v))
      if (next.some((v, s) => v !== vals[s])) power.set(fid, next)
    }
    // A projectile's effects are named by its templates: those are copied too.
    const extra: nottool.Template[] = []
    const copies = [new Map<string, string>(), new Map<string, string>()]
    const taken = new Set<string>()
    let k = 0
    const newName = (old: string) => {
      let n: string
      do n = `${old.split('_')[0]}_${c.internalName}${k++}`
      while (base.t.has(n) || taken.has(n.toLowerCase()))
      taken.add(n.toLowerCase())
      return n
    }
    for (const fid of tun.fieldsOf(nvbtool.T_TEMPLATE)) {
      const vals = slotsOf(fid)
      const next = vals.map((v, s) => {
        const alt = s === tuning.SLOTS - 1 ? 1 : 0
        if (!copies[alt].has(v.toLowerCase())) {
          const r = templates.retarget(base.t, v, alt ? ma : mn, newName)
          if (r) extra.push(...r[1])
          copies[alt].set(v.toLowerCase(), r ? r[0] : v)
        }
        return copies[alt].get(v.toLowerCase())!
      })
      if (next.some((v, s) => v !== vals[s])) power.set(fid, next)
    }
    return [effect1, power, extra]
  }

  tuning(power: Map<number, string[]> | null): string | null {
    const c = this.c
    const fields = tuningFields(c)
    if (!Object.keys(fields).length && !(power && power.size)) return null
    const tun = new tuning.Tuning(this.src, this.base)
    const [name, nvb, listed] = tun.build(c.internalName, fields, power)
    this.r.adds.set(name, nvb)
    this.r.sets.set('Misc/nvblist.txt', listed)
    return c.internalName
  }

  // The character's own motion set, when a move changes an animation.
  baseMoves(): string | null {
    const reach = this.c.baseMoves.throw_reach
    if (reach === undefined) return null
    const m = basemoves.throwFiles(this.src, this.base, this.c.internalName, reach)
    for (const [k, v] of m.files) this.r.adds.set(k, v)
    this.note(`baton throw: reaches ${reach} m (${this.base.label}'s about 8)`)
    return m.motionSet
  }

  templates(effect1: [string, string] | null, description: string | null, extra: nottool.Template[], motionSet: string | null = null) {
    const c = this.c, gp = c.gameplay
    let on = 0, off = 0
    if (gp.lift) {
      const [a, b] = LIFT_BITS[gp.lift]
      on |= a
      off |= b
    }
    if (gp.wire_swing !== undefined && gp.wire_swing !== null) {
      if (gp.wire_swing) on |= WIRE
      else off |= WIRE
    }
    const mode = c.aura.mode === 'swap' ? 'swap' : 'base'
    this.r.sets.set('Misc/Global.not', templates.build(this.src.entry('Misc/Global.not'), this.base, c.internalName, mode, effect1, description,
      on || off ? [on, off] : null, gp.health ?? null, extra, motionSet, c.baseMoves.throw_cable ?? true))
  }

  picture(slot: string): RgbaImage | null {
    const body = this.c.files.get(`ui/${slot}.png`)
    return body ? readImage(body) : null
  }

  ui() {
    const c = this.c, base = this.base, src = this.src
    const P = ui.P
    const sets = this.r.sets, adds = new Map<string, Uint8Array>()
    let voice: number | null = null
    if (c.ui.ready_voice) {
      const values = ui.sfxValues(src.entry(P + 'main.big'))
      if (!values.has(c.ui.ready_voice)) throw new LabError(`the game has no select-screen voice ${c.ui.ready_voice}`)
      voice = values.get(c.ui.ready_voice)!
    }
    const id = this.selectId
    sets.set(P + 'screens/clashCharSelect.big', ui.patchCharselect(src.entry(P + 'screens/clashCharSelect.big'), voice, id))
    const tiles = [this.picture('tile'), this.picture('tile_selected')]
    if (tiles[0] && !tiles[1]) tiles[1] = tiles[0]
    const thumbs = src.entry(P + 'screens/clashCharSelect_thumbs.big')
    sets.set(P + 'screens/clashCharSelect_thumbs.big', ui.patchThumbs(thumbs, base.selectId, tiles[0] ? [tiles[0], tiles[1]!] : null, id))
    for (const name of ['main.big', 'mainBE.big']) sets.set(P + name, ui.patchMain(src.entry(P + name), c.displayName, colorInt(c.nameColor), id))
    this.hud()
    const ready = this.picture('select_ready')
    if (ready === null) {
      for (const [name, data] of portraits.renamed(src, base.selectId, id)) (src.has(name) ? sets : adds).set(name, data)
      this.note(`no select-screen portrait: ${base.label}'s portraits are used`)
    } else {
      for (const [k, v] of this.selectPortrait(ready)) (src.has(k) ? sets : adds).set(k, v)
      for (const alt of [false, true]) {
        const name = portraits.archiveName('cvs', id, alt)
        ;(src.has(name) ? sets : adds).set(name, portraits.loadingArchive(src, this.strips(ready, alt), alt, id))
      }
    }
    this.uiAdds = adds
  }

  selectPortrait(ready: RgbaImage): Map<string, Uint8Array> {
    const c = this.c
    const layout = new portraits.SelectLayout(this.src)
    const sel = c.ui.select
    const rest = this.picture('select_rest')
    const pictures: Record<string, RgbaImage> = { rest: rest ?? ready, ready, readyalt: this.picture('select_readyalt') ?? ready }
    const def = sel.ready ?? defaultPlacement(ready)
    const poses = new Map<string, [RgbaImage, number, [number, number], portraits.Rgba | null]>()
    for (const pose of portraits.POSES) {
      const p = sel[pose] ?? (pose !== 'rest' || rest === null ? def : defaultPlacement(pictures.rest))
      poses.set(pose, [pictures[pose], p.scale, p.anchor, p.glow ? glowRgba(p.glow) : null])
    }
    return new Map([[portraits.archiveName('c', this.selectId), layout.build(poses, c.ui.fade ?? portraits.FADE, this.selectId)]])
  }

  strips(ready: RgbaImage, alt: boolean): RgbaImage[] {
    let own = alt ? [this.picture('load_wide_alt'), this.picture('load_narrow_alt')] : [this.picture('load_wide'), this.picture('load_narrow')]
    if (alt && !own.every(Boolean)) own = [this.picture('load_wide'), this.picture('load_narrow')]
    const sizes = portraits.stripSizes(this.src, alt)
    if (own.every(Boolean) && sizes.length === own.length && own.every((im, i) => im!.width === sizes[i][0] && im!.height === sizes[i][1])) return own as RgbaImage[]
    const sel = this.c.ui.select
    const p = (alt ? sel.readyalt : sel.ready) ?? sel.ready ?? defaultPlacement(ready)
    const altPic = alt ? this.picture('select_readyalt') : null
    const pic = altPic ?? ready
    const scale = this.c.ui.strip_scale || 3.0 * p.scale
    return portraits.stripCrop(this.src, pic, p.anchor, scale, alt)
  }

  hud() {
    const c = this.c, base = this.base, src = this.src
    const n = c.internalName.toLowerCase(), b = base.hudName
    const icon = this.picture('hud'), rage = this.picture('hud_rage')
    const iconAlt = this.picture('hud_alt'), rageAlt = this.picture('hud_alt_rage')
    const added: [string, [string, RgbaImage | null]][] = [
      [`plr_${n}`, [`plr_${b}`, icon]],
      [`plr_${n}_rage`, [`plr_${b}_rage`, rage ?? icon]],
      [`plr_alt${n}`, [`plr_alt${b}`, iconAlt ?? icon]],
      [`plr_alt${n}_rage`, [`plr_alt${b}_rage`, rageAlt ?? rage ?? iconAlt ?? icon]],
    ]
    const pics = new Map<string, [string, RgbaImage]>()
    const copies = new Map<string, string>()
    for (const [k, [tmpl, im]] of added) {
      if (im !== null) pics.set(k, [tmpl, im])
      else copies.set(k, tmpl)
    }
    const banner = c.ui.banner ?? true ? this.picture('banner') : null
    for (const lang of R.LANGS) {
      const name = `HUD/hud${lang}.1.gsh`
      this.r.sets.set(name, ui.addBankImages(src.entry(name), pics, copies))
      if (banner !== null) {
        const name2 = `HUD/hud${lang}.2.gsh`
        const tmpl = `ovr_${b}${lang}`
        const size = ui.bankImageSize(src.entry(name2), tmpl)
        if (size === null) {
          this.note(`no ${lang} banner to copy for ${base.label}`)
          continue
        }
        const im = banner.width === size[0] && banner.height === size[1] ? banner : fitBanner(banner, size)
        this.r.sets.set(name2, ui.addBankImages(src.entry(name2), new Map([[`ovr_${n}${lang}`, [tmpl, im]]])))
      }
    }
    if (copies.size) this.note(`HUD portraits not supplied (${[...copies.keys()].sort().join(', ')}): ${base.label}'s are used`)
  }
}

// The gameplay fields that go in the character's own tuning file.
export function tuningFields(c: Character): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(c.gameplay).filter(([k]) => k in tuning.FIELDS || k === 'damage_taken'))
  if (c.baseMoves.throw_reach !== undefined) out.throw_reach = c.baseMoves.throw_reach
  return out
}

export function defaultPlacement(picture: RgbaImage): Placement {
  const bbox = picture.bbox() ?? [0, 0, picture.width, picture.height]
  const scale = 330.0 / Math.max(1, bbox[3] - bbox[1])
  return { scale, anchor: [(bbox[0] + bbox[2]) / 2.0, bbox[1] + (bbox[3] - bbox[1]) * 0.12], glow: null }
}

export function fitBanner(im: RgbaImage, size: [number, number]): RgbaImage {
  const [w, h] = size
  const k = Math.min(w / im.width, h / im.height)
  const small = resizeLanczos(im, Math.max(1, Math.trunc(im.width * k)), Math.max(1, Math.trunc(im.height * k)))
  const out = new RgbaImage(w, h)
  out.paste(small, Math.floor((w - small.width) / 2), Math.floor((h - small.height) / 2))
  return out
}

export interface PatchOutput {
  sink: Sink
  freeSpace?: number
}

export async function patch(source: GameSource, character: Character, out: PatchOutput, progress: Progress = () => {}, isVerified = false, model?: Model): Promise<Result> {
  return write(source, out, progress, isVerified, () => new Builder(source, character, progress, model).build())
}

export async function write(source: GameSource, out: PatchOutput, progress: Progress, isVerified: boolean, build: () => Result): Promise<Result> {
  if (out.freeSpace !== undefined && out.freeSpace < GC_DISC_SIZE + (64 << 20)) throw new LabError('not enough free space (a patched disc takes 1.4 GB)')
  if (!isVerified) {
    progress('Checking the source disc')
    source.verify((done, total) => progress('Checking the source disc', done, total))
  }
  const r = build()
  const repack = planRepack(source, r.sets, r.adds)
  let bigTotal = 0
  for (const [, , size] of repack.plan) bigTotal += size
  let written = 0
  progress('Writing', 0, bigTotal)
  await writeIso(out.sink, source.disc, r.dol!, new Map<string, Uint8Array | { size: number; write: (s: Sink) => Promise<void> }>([
    ['CLASH.BH', repack.bh],
    ['CLASH.BIG', { size: repack.total, write: async (s: Sink) => { await writeBig(source, repack, s, (n) => { written += n; progress('Writing', written, bigTotal) }) } }],
  ]))
  return r
}

export function report(characters: Character | Character[], result: Result): string {
  const chars = Array.isArray(characters) ? characters : [characters]
  const lines = ['ImperfectLab patch report', '']
  for (const c of chars) lines.push(`Character: ${c.displayName} (${c.internalName}), base ${R.label(c.base)}`)
  lines.push('')
  if (chars.length === 1) lines.push('main.dol: roster record 19, select-screen limits 18 -> 19')
  else lines.push(`main.dol: roster records 19 to ${18 + chars.length} in a new data section, select-screen limits 18 -> ${18 + chars.length}`, `main.dol: arena starts at 0x${D.arenaLo(result.dol!).toString(16).toUpperCase()}`)
  if (chars.some((c) => c.baseMoves.throw_reach !== undefined)) lines.push('main.dol: fn_8019DB24 mirrors a long baton throw\'s return on a hit')
  const cache = result.dol ? D.readEffectCache(result.dol) : null
  if (cache && cache !== nfxtool.CACHE_SIZE) lines.push(`main.dol: effect cache ${nfxtool.CACHE_SIZE} -> ${cache} bytes`)
  const sorted = (m: Map<string, Uint8Array>) => [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [k, v] of sorted(result.sets)) lines.push(`changed: ${k} (${v.length} bytes)`)
  for (const [k, v] of sorted(result.adds)) lines.push(`added:   ${k} (${v.length} bytes)`)
  lines.push('', ...result.notes)
  for (const c of chars) {
    const credits = c.credits
    if (credits.author || credits.assets.length) {
      lines.push('', `Credits${chars.length > 1 ? ` (${c.displayName})` : ''}: ${credits.author}`)
      for (const a of credits.assets) lines.push(`  ${a.what} by ${a.by} (${a.license}) ${a.url}`)
    }
  }
  return lines.join('\n') + '\n'
}

