// The actual character patcher.
// The builder works out every changed and added file as bytes, then patch() streams the new disc image.
import { latin1 } from '../bytes'
import { LabError } from '../errors'
import { formatG } from '../format'
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
import type * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import * as bundle from '../model/bundle'
import { Fit, type MaterialSlots } from '../model/fit'
import { Model } from '../model/glb'
import { Skeleton } from '../model/skeleton'
import { type Character, hasCutscenes, image as readImage, type Material, problems, type Placement, WALL, type WallKey, type ZCostume, zTexture } from '../package/imperfect'
import * as cutscenes from './cutscenes'
import * as damage from './damage'
import * as effects from './effects'
import * as basemoves from './basemoves'
import * as flames from './flames'
import * as holster from './holster'
import * as moves from './moves'
import * as portraits from './portraits'
import * as reach from './reach'
import * as shaders from './shaders'
import * as sounds from './sounds'
import * as templates from './templates'
import * as tuning from './tuning'
import * as ui from './ui'

const LIFT_BITS: Record<string, [number, number]> = { light: [0, 0x30], medium: [0x10, 0x20], heavy: [0x20, 0] }
export const WIRE = 0x80
const WALL_BITS: Record<WallKey, number> = { wall_climb: 0x2, wall_run: 0x4000000 }
const RANGE_GRAB_BIT = 0x2000
const FLIGHT = 0x100001
const LOW_ENERGY_STUN = 0x8000

export type Progress = (stage: string, done?: number, total?: number) => void

export class Result {
  dol: Uint8Array | null = null
  // the effect cache main.dol needs, when a tint or flames outgrow the game's
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
  greyTint: [boolean, boolean] = [false, false] // whether tinted effects draw the grey fire sprite
  moveFx: moves.EffectPlan | null = null
  propCenter: [number, number, number] | null = null

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
    if (ownMotions(c)) {
      for (const name of [`Motions/${moves.motionSetName(c.internalName)}`, ...moves.SLOTS.map((slot) => `Bundles/${n}${slot}.ngb`)]) {
        if (this.src.has(name)) throw new LabError(`the game already has ${name}: pick another internal name`)
      }
    }
    if (ownSounds(c) && this.src.has(sounds.bankPath(D.soundBankName(c.internalName)))) {
      throw new LabError(`the game already has a sound bank ${D.soundBankName(c.internalName)}: pick another internal name`)
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
    if (mirrors(c)) this.r.dol = D.mirrorSkip(this.r.dol)
    if (splitsCharge(c)) this.r.dol = D.chargeRate(this.r.dol)
    if (throwsDamage(c)) this.r.dol = D.throwDamage(this.r.dol)
    if (ownSounds(c)) this.r.dol = D.soundBanks(this.r.dol, [c.internalName])
    if (c.zButton) this.r.dol = D.zActions(this.r.dol, zCharacters([c]))
    return this.r
  }

  // Every file but main.dol.
  buildFiles(): Result {
    this.progress('Effects')
    const [effect1, power, projectiles, effect2] = this.effects()
    this.progress('Model')
    const materials = this.buildModel()
    this.progress('Templates, materials and tuning')
    const description = this.tuning(power)
    const motionSet = this.motions()
    this.templates(effect1, description, projectiles, motionSet, effect2)
    this.sounds()
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

  // Each included material's texture while Z is held, as [name, image or null when it is the costume's own].
  zImages(imgs: [Material, RgbaImage, RgbaImage][], alt: boolean): [string, RgbaImage | null][] {
    const c = this.c, z = c.zButton!
    const costume: ZCostume = alt ? 'alt' : 'normal'
    return imgs.map(([m, im, imAlt]) => {
      const v = zTexture(z, costume, m.gltfMaterial)
      const name = c.internalName + (alt ? '_altz' : '_z') + m.suffix
      if (v === costume) return [name, null]
      if (v === 'normal') return [name, im]
      if (v === 'alt') return [name, imAlt]
      if (v.startsWith('hue:')) return [name, hueShift(im, parseFloat(v.slice(4)))]
      const body = c.files.get(v)
      if (!body) throw new LabError(`the Z costume texture of ${m.name} is missing`)
      return [name, readImage(body)]
    })
  }

  buildModel(): (string | [string, string])[] {
    const c = this.c, base = this.base
    const model = this.model ?? new Model(c.glb!)
    const sk = Skeleton.ofBase(base)
    const f = new Fit(model, sk, c.mapping, c.overrides, c.fit.scale, c.fit.torso_squash ?? true, c.fit.flip, c.fit.floor_from_mesh ?? false)
    const included = c.materials.filter((m) => m.include)
    const slots: MaterialSlots = new Map()
    for (const m of c.materials) slots.set(m.gltfMaterial, [null, false])
    included.forEach((m, i) => slots.set(m.gltfMaterial, [i, m.twoSided, m.bind]))
    for (const m of included) {
      if (m.bind !== null && m.bind >= sk.nodes.length) throw new LabError(`material ${m.name} is bound to game bone ${m.bind}, which ${base.label} does not have`)
    }
    const tris = f.triangles(slots)
    this.propCenter = c.baseMoves.holster ? holster.center(tris.values()) : null
    const far = Object.keys(c.moveReach).length ? moves.farLimb(this.src, base, c.moveReach, c.moves) : null
    const imgs = this.materialImages(model)
    const normals = new bundle.NormalIndex(bundle.readNormals(this.src.entry('Misc/NormalTable.ngn')))
    const nsa = shaders.blocks(this.src.entry('Materials/Shaders/shaders.nsa'))
    this.texture2 = 'ge_charlight'
    this.bundleAdds = new Map()
    const allMaterials: (string | [string, string])[] = []
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
      const extra: [string, gxtex.TplImage][] = []
      if (!names.some((n) => n.toLowerCase() === this.texture2.toLowerCase())) extra.push(this.borrowTexture('johnnyohm', "Johnny Ohm's", this.texture2))
      if (((alt ? c.flames.alt_color : c.flames.color) !== null && flames.hasAny(c.flames)) || this.greyTint[alt ? 1 : 0]) {
        extra.push(this.borrowTexture(flames.GREY_BUNDLE, "Human Torch's costume 2", flames.GREY_SPRITE))
      }
      const mats = included.map((m) => c.internalName + costume + m.suffix)
      allMaterials.push(...mats)
      const zs = c.zButton?.costume ? this.zImages(imgs, alt) : []
      const kept = zs.length ? included.map((m) => c.internalName + (alt ? '_altzo' : '_zo') + m.suffix) : []
      allMaterials.push(...zs.map(([name, im], i): [string, string] => [name, im ? name : mats[i]]), ...kept.map((name, i): [string, string] => [name, mats[i]]))
      const nm = templates.modelNames(c.internalName, costume)
      const plr = alt ? base.alt : base.plr
      const renames = new Map<string, string>()
      for (const [pid, key] of [[R.P_PHYSMODEL, 'PHYSMODEL'], [R.P_SHADOWMODEL, 'SHADOWMODEL']] as [number, 'PHYSMODEL' | 'SHADOWMODEL'][]) {
        const old = R.text(base.t.prop(plr, pid))
        if (old) renames.set(old.toLowerCase(), nm[key])
      }
      const copy = new Map([...tris].map(([k, v]) => [k, [...v]]))
      const render = bundle.renderModel(renderBase, copy, normals, nm.MODEL, [...mats, ...zs.map(([name]) => name), ...kept],
        renderBase.meshes.length ? renderBase.meshes[0][5] : [0, 0, 0], stats)
      if (c.baseMoves.throw_reach !== undefined) basemoves.hitSegment(render)
      if (far && reach.farVolume(render, far, reach.bonesOf(sk)[far]) && !alt) {
        this.note(`reach: ${base.label}'s long hit segment (attachments 43 and 44) moves to the ${reach.LIMB_LABELS[far]}, so moves that hit with it hit from there`)
      }
      if (c.flames.parts.length) {
        const empty = flames.markers(render, sk, copy, c.flames.parts)
        if (!alt && empty.length) this.note(`flames: no part of the model follows the ${empty.join(', ')} bone, so its flame sits on the bone itself`)
      }
      const [data] = bundle.buildNgm(ngm, render, renames, c.size)
      const otherNames = new Set(models.slice(1).map((m) => m.name.toLowerCase()))
      const missing = [...renames.keys()].filter((old) => !otherNames.has(old))
      if (missing.length) this.note(`the base bundle has no model named ${missing.join(', ')}`)
      const textures: [string, RgbaImage, [number, number]][] = mats.map((mat, i) => {
        const [m, im, imAlt] = imgs[i]
        return [mat, alt ? imAlt : im, m.size]
      })
      zs.forEach(([name, im], i) => {
        if (im) textures.push([name, im, imgs[i][0].size])
      })
      const [tplOut, ngtOut] = bundle.buildTpl(tpl, ngt, textures, keep, extra)
      if (zs.length) this.note(`Z costume${alt ? ' (costume 2)' : ''}: ${zs.filter(([, im]) => im).length} of ${zs.length} materials draw their own texture`)
      const b = c.internalName.toLowerCase() + costume
      this.bundleAdds.set(`Bundles/${b}.ngm`, data)
      this.bundleAdds.set(`Bundles/${b}.ngt`, ngtOut)
      this.bundleAdds.set(`Bundles/${b}.tpl`, tplOut)
      if (!alt) {
        const st = render.streams[0]
        this.note(`model: ${render.meshes.length} parts, ${st.vertices.length} positions, ${st.refs.length} vertices, ${render.indices.length / 3} triangles; scale ${f.S.toFixed(3)}${c.size !== 1 ? `; size ${formatG(c.size)}x the base's` : ''}; .ngm ${data.length} bytes, .tpl ${tplOut.length} bytes`)
      }
    }
    const named = allMaterials.map((m) => (typeof m === 'string' ? m : m[0]).toLowerCase())
    const twice = named.find((n, i) => named.indexOf(n) !== i)
    if (twice) throw new LabError(`two materials would both be named ${twice}: change a material's suffix on the Materials page`)
    if (stats.clampedUvs) this.note(`warning: ${stats.clampedUvs} UVs were outside the range the game stores and were clamped`)
    this.fit = f
    return allMaterials
  }

  borrowTexture(bundleName: string, label: string, texture: string): [string, gxtex.TplImage] {
    const names = latin1(this.src.entry(`Bundles/${bundleName}.ngt`)).split(/\s+/).filter(Boolean).map((n) => n.toLowerCase())
    const [ims] = gxtex.readTpl(this.src.entry(`Bundles/${bundleName}.tpl`))
    const at = names.indexOf(texture.toLowerCase())
    if (at < 0) throw new LabError(`${label} bundle has no texture ${texture}`)
    return [texture, ims[at]]
  }

  // The aura tint's copies, the flames' blocks and the swapped and stretched moves' recolored lines, in one effect file.
  effects(): [[string, string] | null, Map<number, string[]> | null, nottool.Template[], [string, string] | null] {
    const c = this.c
    const tinted = c.aura.mode === 'tint', fire = flames.hasAny(c.flames), theirs = Object.values(c.moveEffects).includes('theirs'), lined = paintsReach(c)
    if (!tinted && !fire && !theirs && !lined) return [null, null, [], null]
    const fx = new effects.Effects(this.src.entry('Misc/game.nfx'))
    const before = fx.used()
    const prefixes: [string, string] = [effects.copyPrefix(c.internalName, false), effects.copyPrefix(c.internalName, true)]
    if (theirs) {
      const used = hasCutscenes(c.cutscenes) ? cutscenes.effectKs(this.src, this.base, c.cutscenes) : []
      this.moveFx = moves.planEffects(this.src, this.base, c.moveEffects, fx, c.moveLines, prefixes, used, moves.movedEffects(this.src, this.base, c.moves))
    }
    const [effect1, tintPower, extra] = tinted ? this.tinted(fx) : [null, null, []]
    let power = tintPower
    if (lined) {
      const fids = moves.reachLineFields(this.src, this.base, c.moveReach, c.moves, c.moveEffects, fx)
      const paints = moves.paintLines(fx, new tuning.Tuning(this.src, this.base), fids, c.moveLines, prefixes, power ?? new Map())
      if (paints.size) {
        power = new Map([...(power ?? []), ...paints])
        this.note(`reach: ${paints.size} line effect${paints.size === 1 ? '' : 's'} recolored, in every move that draws ${paints.size === 1 ? 'it' : 'them'}`)
      }
    }
    const effect2 = flames.effectNames(fx, c.flames, c.internalName)
    if (fire) this.note(`flames: ${c.flames.body ? "over the whole body (Human Torch's body fire)" : `on the ${c.flames.parts.join(', ')}`}`)
    // the game's own body fire adds nothing
    if (fx.used() === before) return [effect1, power, extra, effect2]
    this.r.sets.set('Misc/game.nfx', fx.build())
    const size = effects.cacheSize(fx.used())
    if (size > nfxtool.CACHE_SIZE) this.r.cache = size
    this.note(`effects: ${fx.used() - before} bytes added, ${fx.used()} of ${size} bytes of effect cache used`)
    return [effect1, power, extra, effect2]
  }

  private tinted(fx: effects.Effects): [[string, string] | null, Map<number, string[]>, nottool.Template[]] {
    const c = this.c, base = this.base
    const tun = new tuning.Tuning(this.src, base)
    const hide = effects.hidden(c.aura.color, c.aura.alt_color)
    const level = this.tint ?? (c.aura.tint === 'all' ? effects.tintLevel(effects.tintPlans(this.src, base), 'all', flames.cost(c.flames), hide) : c.aura.tint)
    if (this.tint === null && level !== c.aura.tint) this.note(`aura tint: ${base.label}'s full tint needs more memory than a match can spare; its idle and power-up effects are tinted`)
    const [rootsN, rootsA] = effects.roots(fx, tun, base, level)
    if (!rootsN.length && !rootsA.length) throw new LabError(`${base.label} has no effects to tint; use the Base or Swap aura`)
    this.greyTint = [!hide[0] && fx.drawsFire(rootsN), !hide[1] && fx.drawsFire(rootsA)]
    const mn = fx.tinted(rootsN, c.aura.color, effects.copyPrefix(c.internalName, false))
    const ma = fx.tinted(rootsA, c.aura.alt_color, effects.copyPrefix(c.internalName, true))
    const hiddenIn = ['1', '2'].filter((_, i) => hide[i])
    this.note(`aura tint: ${new Set([...mn.values(), ...ma.values()]).size} effect blocks added${hiddenIn.length ? `; costume ${hiddenIn.join(' and ')}'s effects hidden` : ''}`)
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
    const strings = new Map(power)
    if (fields.pickup_range !== undefined) this.note(`pickup: props can be grabbed from ${fields.pickup_range} m away`)
    const onBack = this.onBack()
    if (hasCutscenes(c.cutscenes) || onBack) {
      let stow: ((rec: ngbtool.Record) => ngbtool.Record) | null = null
      if (onBack) {
        const own = ngmtool.read(this.base.bundleFiles()[0])[1][0]
        const model = c.size !== 1 ? bundle.scaleModel(own, c.size) : own, plan = holster.sized(onBack, c.size)
        stow = (rec) => holster.stow(rec, model, plan)
      }
      const cuts = cutscenes.plan(this.src, this.base, c, this.moveFx?.slots ?? cutscenes.moveSlots(this.src, this.base, c), stow)
      for (const [fid, names] of cuts.fields) strings.set(fid, names)
      for (const [k, v] of cuts.files) this.r.adds.set(k, v)
      for (const n of cuts.notes) this.note(n)
    }
    for (const [fid, names] of this.moveFx?.slots.fields() ?? []) strings.set(fid, names)
    if (!Object.keys(fields).length && !strings.size) return null
    const tun = new tuning.Tuning(this.src, this.base)
    const [name, nvb, listed] = tun.build(c.internalName, fields, strings)
    this.r.adds.set(name, nvb)
    this.r.sets.set('Misc/nvblist.txt', listed)
    return c.internalName
  }

  // The holster's plan, once the model has given the prop's middle.
  onBack(): holster.Plan | null {
    const h = this.c.baseMoves.holster
    return h && this.propCenter ? { ...h, center: this.propCenter } : null
  }

  // The character's own motion set, when a move changes an animation.
  motions(): string | null {
    const c = this.c
    if (!ownMotions(c)) return null
    const thrown = c.baseMoves.throw_reach
    const fx = Object.keys(c.moveReach).length ? new effects.Effects(this.src.entry('Misc/game.nfx')) : null
    const m = moves.motionFiles(this.src, this.base, c.internalName, c.moves, thrown, c.moveEffects, this.moveFx, c.moveReach, fx, c.size, c.moveIdle, this.onBack(), throwsDamage(c))
    for (const [k, v] of m.files) this.r.adds.set(k, v)
    if (thrown !== undefined) this.note(`baton throw: reaches ${thrown} m (${this.base.label}'s about 8)`)
    if (throwsDamage(c)) this.note(`baton throw: hits for ${c.gameplay.attack_damage_throw}`)
    for (const n of m.notes) this.note(n)
    return m.motionSet
  }

  sounds() {
    const c = this.c
    const bank = sounds.build(this.src, c)
    if (!bank) return
    this.r.adds.set(sounds.bankPath(D.soundBankName(c.internalName)), bank)
    this.note(`sounds: ${Object.keys(c.sounds).length} of ${this.base.label}'s replaced; ${D.soundBankName(c.internalName)} is ${bank.length} of ${sounds.MAX_BANK} bytes`)
  }

  templates(effect1: [string, string] | null, description: string | null, extra: nottool.Template[], motionSet: string | null = null,
    effect2: [string, string] | null = null) {
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
    if (gp.flight === false) off |= FLIGHT
    if (gp.low_energy_stun) on |= LOW_ENERGY_STUN
    else if (gp.low_energy_stun === false) off |= LOW_ENERGY_STUN
    for (const w of WALL) if (gp[w.key]) on |= WALL_BITS[w.key]
    if (c.baseMoves.range_grab) on |= RANGE_GRAB_BIT
    if (stretchReturns(c)) on |= reach.RETURN_ABILITY
    const mode = c.aura.mode === 'swap' ? 'swap' : 'base'
    this.r.sets.set('Misc/Global.not', templates.build(this.src.entry('Misc/Global.not'), this.base, c.internalName, mode, effect1, description,
      on || off ? [on, off] : null, gp.health ?? null, extra, motionSet, (c.baseMoves.throw_cable ?? true) && c.flames.base_effect, effect2, c.size))
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

// Whether the character gets its own motion set and animation bundles (Builder.motions).
export function ownMotions(c: Character): boolean {
  return c.baseMoves.throw_reach !== undefined || c.baseMoves.holster !== undefined || throwsDamage(c) || Object.keys(c.moves).length > 0 || Object.keys(c.moveReach).length > 0 || c.moveIdle.length > 0 || c.size !== 1
}

// A stretched hit that comes back from where it lands needs RETURN_ABILITY and main.dol's mirrored skip.
export const stretchReturns = (c: Character) => reach.RETURNS.some((id) => c.moveReach[id])
export const mirrors = (c: Character) => c.baseMoves.throw_reach !== undefined || stretchReturns(c)
export const splitsCharge = (c: Character) => c.gameplay.energy_regen !== undefined || c.gameplay.energy_charge !== undefined
export const throwsDamage = (c: Character) => c.gameplay.attack_damage_throw !== undefined

// Whether stretched moves' own lines are recolored, which takes the character's tuning file.
export const paintsReach = (c: Character) => Object.keys(c.moveReach).some((id) => !reach.JUMPS.includes(id)) && (c.moveLines.color !== null || c.moveLines.alt_color !== null)

export function ownSounds(c: Character): boolean {
  return Object.keys(c.sounds).length > 0
}

export function zCharacters(chars: Character[]): D.ZCharacter[] {
  return chars.flatMap((c) => {
    const z = c.zButton
    if (!z) return []
    const st = z.stats ?? {}
    return [{
      internal: c.internalName, seconds: z.requires.energy?.seconds ?? 0, regen: z.requires.energy?.regen ?? false,
      undetected: z.stealth?.undetected ?? false, untouchable: z.stealth?.untouchable ?? false, visible: z.stealth?.visible ?? 1,
      costume: z.costume !== null, damage: damage.KEYS.map((k) => st[k] ?? null), taken: st.damage_taken ?? null, lift: st.lift ?? null,
      size: z.size,
    }]
  })
}

// The gameplay fields that go in the character's own tuning file.
export function tuningFields(c: Character): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(c.gameplay).filter(([k]) => k in tuning.FIELDS || k === 'damage_taken' || k === 'energy_charge' || k === damage.THROW_KEY))
  if (c.baseMoves.throw_reach !== undefined) out.throw_reach = c.baseMoves.throw_reach
  const far = c.moveReach.SuperAttackFar?.distance
  if (far !== undefined) out.throw_reach = far
  const pickup = reach.PULLS.map((id) => c.moveReach[id]?.distance).find((d) => d !== undefined)
  if (pickup !== undefined) out.pickup_range = pickup
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
  if (chars.some(mirrors)) lines.push('main.dol: fn_8019DB24 mirrors a long throw\'s or stretch\'s return on a hit')
  if (chars.some(splitsCharge)) lines.push('main.dol: fn_8009D71C adds tuning field 245 to the energy recharge rate while holding R')
  if (chars.some(throwsDamage)) lines.push('main.dol: fn_800E1788 reads tuning field 217 for an animation\'s damage event with param 5 (the baton throw)')
  if (chars.some(ownSounds)) lines.push('main.dol: fn_80114420 loads a new character\'s own sound bank, and one bank per type ID')
  if (chars.some((c) => c.zButton)) {
    const names: [keyof NonNullable<Character['zButton']>, string][] = [['stealth', 'Stealth Mode'], ['costume', 'Costume Change'], ['stats', 'Stat Change'], ['size', 'Change Size']]
    const used = names.filter(([k]) => chars.some((c) => c.zButton?.[k])).map(([, label]) => label)
    lines.push(`main.dol: Z is bound for every human player; fn_80137494 and fn_80148B50 are rewritten to run ${used.join(', ')}, hooked from fn_800FB944, fn_80085F4C, fn_800E07A4, fn_80150200, fn_80461948, fn_8014F8BC and fn_801A479C; fn_800B1884 and fn_80086C80 are rewritten in place`)
  }
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

