// .imperfect files (docs/FORMAT.md): a character as a recipe plus the author's own assets.
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex, utf8 } from '../bytes'
import { LabError } from '../errors'
import { decodeImage } from '../image/decode'
import { encodePng, pngSize } from '../image/png'
import type { RgbaImage } from '../image/rgba'
import { MOVE_IDS } from '../build/moves'
import { BASES } from '../game/roster'
import * as asftool from '../mnroi/asftool'
import { GLB, type Json } from '../mnroi/gltf'
import { VERSION as APP_VERSION } from '../version'
import { listZip, readEntry, writeZip } from './zip'

const FORMAT = 'imperfect'
export const VERSION = 1
const GAME = 'GVLE69-0'
const MAX_TOTAL = 64 << 20
const MAX_RATIO = 200
export const MAX_IMAGE_SIDE = 4096
const STAT_RANGE = [1, 7]

export const UI_SLOTS = ['select_rest', 'select_ready', 'select_readyalt', 'load_wide', 'load_narrow', 'load_wide_alt',
  'load_narrow_alt', 'tile', 'tile_selected', 'hud', 'hud_rage', 'hud_alt', 'hud_alt_rage', 'banner']
export const MEMBER = new RegExp(`^(manifest\\.json|model/model\\.glb|textures/[A-Za-z0-9_-]{1,48}\\.png|ui/(${UI_SLOTS.join('|')})\\.png|cutscenes/[A-Za-z0-9_-]{1,48}\\.asf)$`)
const INTERNAL = /^[A-Za-z][A-Za-z0-9]{0,9}$/
const DISPLAY = /^[A-Z0-9 .'&!-]{1,16}$/
const SUFFIX = /^(_[A-Za-z0-9]{1,7})?$/
const COLOR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/
export const AURA_MODES = ['base', 'swap', 'tint']
export const AURA_TINTS = ['all', 'power']
export const FLAME_PARTS = ['head', 'chest', 'r_hand', 'l_hand', 'r_foot', 'l_foot']
export const FLAME_SIZE: [number, number] = [0.5, 2.0]
export const LIFT = ['light', 'medium', 'heavy']
export const GAMEPLAY: Record<string, [number, number, boolean]> = {
  damage_taken: [0.1, 3.0, false], health: [10, 1000, true], run_speed: [1.0, 30.0, false],
  sprint_speed: [1.0, 40.0, false], rage_per_super: [0.0, 100.0, false], rage_duration: [1000, 120000, true],
}
export const BASE_MOVES: Record<string, (keyof BaseMoves)[]> = { daredevil: ['throw_reach', 'throw_cable'] }
export const THROW_REACH: [number, number] = [8, 35]
export const POSES = ['rest', 'ready', 'readyalt'] as const
export const CUTSCENE_KINDS = ['intro', 'victory', 'finisher'] as const
export type CutsceneKind = (typeof CUTSCENE_KINDS)[number]
const AUDIO_SLOT = /^(intro|victory|finisher)_[1-9]$/
const AUDIO_MEMBER = /^cutscenes\/[A-Za-z0-9_-]{1,48}\.asf$/
export const MAX_AUDIO_SECONDS = 60
export type Pose = (typeof POSES)[number]

export interface Material {
  gltfMaterial: number
  name: string
  include: boolean
  suffix: string
  size: [number, number]
  twoSided: boolean
  texture: string | null
  alt: string
  bind: number | null
}

export interface Placement {
  scale: number
  anchor: [number, number]
  glow: string | null
}

export interface Credit {
  what: string
  by: string
  license: string
  url: string
}

export type Gameplay = Partial<Record<'damage_taken' | 'health' | 'run_speed' | 'sprint_speed' | 'rage_per_super' | 'rage_duration', number>> & {
  lift?: string
  wire_swing?: boolean
}

export interface BaseMoves {
  throw_reach?: number
  throw_cable?: boolean
}

export interface Flames {
  parts: string[]
  body: boolean
  color: string | null
  alt_color: string | null
  size: number
  base_effect: boolean
}

export const CUTSCENE_EFFECTS = ['theirs', 'none'] as const
export type CutsceneEffects = (typeof CUTSCENE_EFFECTS)[number]
export type Cutscenes = Partial<Record<CutsceneKind, string>> & { audio: Record<string, string>; effects: Partial<Record<CutsceneKind, CutsceneEffects>> }

export interface Character {
  internalName: string
  displayName: string
  nameColor: string
  base: string
  credits: { author: string; description: string; assets: Credit[] }
  glb: Uint8Array | null
  mapping: Map<number, string>
  overrides: Map<string, number>
  fit: { scale: number | null; torso_squash: boolean; flip: boolean | null; floor_from_mesh?: boolean }
  materials: Material[]
  aura: { mode: string; tint: string; color: string; alt_color: string }
  flames: Flames
  stats: { normal: number[]; alt: number[] }
  gameplay: Gameplay
  baseMoves: BaseMoves
  moves: Record<string, string>
  cutscenes: Cutscenes
  ui: { select: Partial<Record<Pose, Placement>>; fade: number; strip_scale: number | null; ready_voice: string | null; banner: boolean }
  files: Map<string, Uint8Array>
}

export function defaultStats() {
  return { normal: [4, 4, 4, 4, 4, 4], alt: [4, 4, 4, 4, 4, 4] }
}

export function defaultFlames(): Flames {
  return { parts: [], body: false, color: null, alt_color: null, size: 1, base_effect: true }
}

export function hasCutscenes(c: Cutscenes): boolean {
  return CUTSCENE_KINDS.some((k) => c[k] !== undefined) || Object.keys(c.audio).length > 0
}

export function hasFlames(f: Flames): boolean {
  return f.parts.length > 0 || f.body || f.color !== null || f.alt_color !== null || f.size !== 1 || !f.base_effect
}

export function newMaterial(gltfMaterial: number, name: string, include = true, suffix = '', size: [number, number] = [256, 256]): Material {
  return { gltfMaterial, name, include, suffix, size, twoSided: false, texture: null, alt: 'same', bind: null }
}

export function newCharacter(): Character {
  return {
    internalName: 'NewHero',
    displayName: 'NEW HERO',
    nameColor: '#FFFFFF',
    base: 'johnnyohm',
    credits: { author: '', description: '', assets: [] },
    glb: null,
    mapping: new Map(),
    overrides: new Map(),
    fit: { scale: null, torso_squash: true, flip: null },
    materials: [],
    aura: { mode: 'base', tint: 'all', color: '#40A0FF', alt_color: '#50FF50' },
    flames: defaultFlames(),
    stats: defaultStats(),
    gameplay: {},
    baseMoves: {},
    moves: {},
    cutscenes: { audio: {}, effects: {} },
    ui: { select: {}, fade: 36, strip_scale: null, ready_voice: null, banner: true },
    files: new Map(),
  }
}

export function copyCharacter(c: Character): Character {
  return structuredClone(c)
}

// For undo history. Arrays are only ever replaced, never edited in place.
export function snapshotCharacter(c: Character): Character {
  const copy: Character = structuredClone({ ...c, glb: null, files: new Map<string, Uint8Array>() })
  copy.glb = c.glb
  copy.files = new Map(c.files)
  return copy
}

export function textureMember(name: string): string {
  return `textures/${name}.png`
}

function materialJson(m: Material): Json {
  return { gltf_material: m.gltfMaterial, name: m.name, include: m.include, suffix: m.suffix, size: [...m.size],
    two_sided: m.twoSided, texture: m.texture, alt: m.alt, bind: m.bind }
}

function sha(body: Uint8Array): string {
  return toHex(sha256(body))
}

function fitJson(fit: Character['fit']): Json {
  const { floor_from_mesh: floor, ...rest } = fit
  return floor ? { ...rest, floor_from_mesh: true } : rest
}

export function manifest(c: Character): Json {
  const files = new Map(c.files)
  if (c.glb !== null) files.set('model/model.glb', c.glb)
  return {
    format: FORMAT, version: VERSION, game: GAME, generator: `ImperfectLab ${APP_VERSION}`,
    character: { internal_name: c.internalName, display_name: c.displayName, name_color: c.nameColor },
    base: c.base,
    credits: c.credits,
    model: {
      mapping: Object.fromEntries([...c.mapping].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])),
      overrides: Object.fromEntries([...c.overrides].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))),
      fit: fitJson(c.fit),
      materials: c.materials.map(materialJson),
    },
    aura: c.aura,
    flames: hasFlames(c.flames) ? c.flames : undefined,
    stats: { display: c.stats, gameplay: c.gameplay },
    ui: c.ui,
    base_moves: c.baseMoves,
    moves: c.moves,
    cutscenes: hasCutscenes(c.cutscenes) ? { ...c.cutscenes, effects: Object.keys(c.cutscenes.effects).length ? c.cutscenes.effects : undefined } : undefined,
    files: Object.fromEntries([...files].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, sha(v)])),
  }
}

export type Problem = ['error' | 'warning' | 'note', string]

export function problems(c: Character): Problem[] {
  const out: Problem[] = []
  if (!INTERNAL.test(c.internalName || '')) out.push(['error', 'the internal name must be 1-10 letters and digits, starting with a letter'])
  if (!DISPLAY.test(c.displayName || '')) out.push(['error', 'the display name must be 1-16 characters: A-Z, 0-9, space and . \' & ! -'])
  if (!Object.hasOwn(BASES, c.base)) out.push(['error', 'pick a base character'])
  if (c.glb === null) out.push(['error', 'import a model (.glb)'])
  if (!c.materials.some((m) => m.include) && c.glb !== null) out.push(['error', 'every material is excluded: nothing would be drawn'])
  const suffixes = c.materials.filter((m) => m.include).map((m) => m.suffix)
  if (new Set(suffixes).size !== suffixes.length) out.push(['error', 'two materials have the same game name suffix'])
  for (const m of c.materials) if (m.texture && !c.files.has(m.texture)) out.push(['error', `the texture of ${m.name} is missing`])
  const unsupported = Object.keys(c.baseMoves).filter((k) => !(BASE_MOVES[c.base] ?? []).includes(k as keyof BaseMoves))
  if (unsupported.length) out.push(['error', `${unsupported.join(', ')} only apply to a ${movesBases(unsupported[0])} base: untick them on the Moves page`])
  for (const [id, from] of Object.entries(c.moves)) {
    const move = MOVE_IDS.get(id)
    if (!move) out.push(['error', `there is no move ${id}`])
    else if (!Object.hasOwn(BASES, from)) out.push(['error', `${move.label} is taken from an unknown character`])
    else if (from === c.base) out.push(['error', `${move.label} is taken from ${BASES[from][0]}, the base itself: set it back to the base's on the Moves page`])
  }
  if (c.moves.SuperAttackFar && c.baseMoves.throw_reach !== undefined) out.push(['error', 'the baton throw reach changes the base\'s own super attack far: set that move back to the base\'s, or untick the reach'])
  if (c.flames.body && c.flames.parts.length) out.push(['error', 'flames are on the whole body or on chosen parts, not both: pick one on the Aura page'])
  for (const kind of CUTSCENE_KINDS) {
    const from = c.cutscenes[kind]
    if (from === undefined) continue
    if (!Object.hasOwn(BASES, from)) out.push(['error', `the ${kind} cutscenes are taken from an unknown character`])
    else if (from === c.base) out.push(['error', `the ${kind} cutscenes are taken from ${BASES[from][0]}, the base itself: set them back to the base's on the Cutscenes page`])
  }
  for (const kind of CUTSCENE_KINDS) if (c.cutscenes.effects[kind] && c.cutscenes[kind] === undefined) out.push(['error', `the ${kind} cutscenes are the base's own, so their effects can't be changed`])
  for (const [slot, member] of Object.entries(c.cutscenes.audio)) {
    if (!AUDIO_SLOT.test(slot)) out.push(['error', `there is no cutscene audio ${slot}`])
    else if (!c.files.has(member)) out.push(['error', `the new cutscene audio for ${slot.replace('_', ' ')} is missing`])
  }
  if (!c.files.get('ui/select_ready.png')) out.push(['warning', "no select-screen portrait: the base's portraits are used"])
  return out
}

function movesBases(key: string): string {
  return Object.keys(BASE_MOVES).filter((b) => BASE_MOVES[b].includes(key as keyof BaseMoves)).map((b) => BASES[b][0]).join(' or ')
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function typed<T>(v: unknown, kind: 'string' | 'object' | 'array' | 'boolean', what: string): T {
  const ok = kind === 'array' ? Array.isArray(v) : kind === 'object' ? isObj(v) : typeof v === kind
  if (!ok) throw new LabError(`manifest: ${what} has the wrong type`)
  return v as T
}

function str(v: unknown, what: string, limit = 200, pattern?: RegExp, optional = false): string | null {
  if ((v === null || v === undefined) && optional) return null
  const s = typed<string>(v, 'string', what)
  if ([...s].length > limit || (pattern && !pattern.test(s))) throw new LabError(`manifest: ${what} is not valid`)
  return s
}

function num(v: unknown, what: string, lo: number, hi: number, optional = true, integer = false): number | null {
  if ((v === null || v === undefined) && optional) return null
  if (typeof v !== 'number' || (integer && !Number.isInteger(v))) throw new LabError(`manifest: ${what} must be a number`)
  if (!(lo <= v && v <= hi)) throw new LabError(`manifest: ${what} must be from ${lo} to ${hi}`)
  return v
}

function keys(d: unknown, allowed: string[], what: string): Record<string, unknown> {
  const o = typed<Record<string, unknown>>(d, 'object', what)
  const extra = Object.keys(o).filter((k) => !allowed.includes(k)).sort()
  if (extra.length) throw new LabError(`manifest: unknown key(s) in ${what}: ${extra.join(', ')}`)
  return o
}

const color = (v: unknown, what: string) => str(v, what, 9, COLOR)!

function upgrade(m: Record<string, unknown>): Record<string, unknown> {
  const v = m.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new LabError('not a valid .imperfect file (no version)')
  if (v > VERSION) throw new LabError(`this file needs a newer ImperfectLab (format version ${v}; this one reads ${VERSION})`)
  return m
}

export function fromManifest(m0: unknown, files: Map<string, Uint8Array>): Character {
  const m = keys(m0, ['format', 'version', 'game', 'generator', 'character', 'base', 'credits', 'model', 'aura', 'flames', 'stats', 'ui', 'base_moves', 'moves', 'cutscenes', 'files'], 'the manifest')
  if (m.format !== FORMAT) throw new LabError('not a .imperfect file')
  upgrade(m)
  if (m.game !== GAME) throw new LabError(`this file is for ${m.game}, not ${GAME}`)
  const c = newCharacter()
  const ch = keys(m.character, ['internal_name', 'display_name', 'name_color'], 'character')
  c.internalName = str(ch.internal_name, 'internal_name', 10, INTERNAL)!
  c.displayName = str(ch.display_name, 'display_name', 16, DISPLAY)!
  c.nameColor = color(ch.name_color ?? '#FFFFFF', 'name_color')
  c.base = str(m.base, 'base', 20)!
  if (!Object.hasOwn(BASES, c.base)) throw new LabError(`manifest: unknown base character ${JSON.stringify(c.base)}`)
  const cr = keys(m.credits ?? {}, ['author', 'description', 'assets'], 'credits')
  const assets = typed<unknown[]>(cr.assets ?? [], 'array', 'credits.assets').slice(0, 32)
  c.credits = {
    author: str(cr.author ?? '', 'credits.author', 200)!,
    description: str(cr.description ?? '', 'credits.description', 4000)!,
    assets: assets.map((a) => {
      const o = keys(a, ['what', 'by', 'license', 'url'], 'credits.assets')
      return { what: str(o.what ?? '', 'credits.assets', 500)!, by: str(o.by ?? '', 'credits.assets', 500)!,
        license: str(o.license ?? '', 'credits.assets', 500)!, url: str(o.url ?? '', 'credits.assets', 500)! }
    }),
  }
  const mo = keys(m.model ?? {}, ['mapping', 'overrides', 'fit', 'materials'], 'model')
  const mapping = typed<Record<string, unknown>>(mo.mapping ?? {}, 'object', 'model.mapping')
  if (Object.keys(mapping).length > 256) throw new LabError('manifest: the mapping is too long')
  for (const [k, v] of Object.entries(mapping)) {
    if (!/^\d{1,3}$/.test(k)) throw new LabError('manifest: model.mapping keys are game bone numbers')
    c.mapping.set(parseInt(k, 10), str(v, 'model.mapping', 200)!)
  }
  const overrides = typed<Record<string, unknown>>(mo.overrides ?? {}, 'object', 'model.overrides')
  if (Object.keys(overrides).length > 512) throw new LabError('manifest: too many overrides')
  for (const [k, v] of Object.entries(overrides)) c.overrides.set(str(k, 'model.overrides', 200)!, num(v, 'model.overrides', 0, 255, true, true)!)
  const fit = keys(mo.fit ?? {}, ['scale', 'torso_squash', 'flip', 'floor_from_mesh'], 'model.fit')
  c.fit = {
    scale: num(fit.scale, 'fit.scale', 0.0001, 10000.0),
    torso_squash: typed<boolean>(fit.torso_squash ?? true, 'boolean', 'fit.torso_squash'),
    flip: typeof fit.flip === 'boolean' ? fit.flip : null,
    floor_from_mesh: typed<boolean>(fit.floor_from_mesh ?? false, 'boolean', 'fit.floor_from_mesh'),
  }
  const mats = typed<unknown[]>(mo.materials ?? [], 'array', 'model.materials')
  if (mats.length > 16) throw new LabError('manifest: at most 16 materials')
  for (const d0 of mats) {
    const d = keys(d0, ['gltf_material', 'name', 'include', 'suffix', 'size', 'two_sided', 'texture', 'alt', 'bind'], 'a material')
    const size = typed<unknown[]>(d.size ?? [256, 256], 'array', 'material size')
    if (size.length !== 2 || size.some((s) => num(s, 'material size', 8, 1024, false, true)! & ((s as number) - 1))) {
      throw new LabError('manifest: material sizes are powers of two from 8 to 1024')
    }
    const tex = str(d.texture, 'material texture', 80, MEMBER, true)
    const alt = str(d.alt ?? 'same', 'material alt', 80)!
    if (alt !== 'same' && !alt.startsWith('hue:') && !MEMBER.test(alt)) throw new LabError("manifest: a material's alt texture is not valid")
    if (alt.startsWith('hue:')) num(/^hue:-?\d{1,3}(\.\d+)?$/.test(alt) ? parseFloat(alt.slice(4)) : null, 'alt hue', -360, 360, false)
    c.materials.push({
      gltfMaterial: num(d.gltf_material, 'gltf_material', 0, 255, false, true)!,
      name: str(d.name ?? '', 'material name', 100)!,
      include: Boolean(d.include ?? true),
      suffix: str(d.suffix ?? '', 'material suffix', 8, SUFFIX)!,
      size: [size[0] as number, size[1] as number],
      twoSided: Boolean(d.two_sided ?? false),
      texture: tex,
      alt,
      bind: num(d.bind, 'material bind', 0, 255, true, true),
    })
  }
  const au = keys(m.aura ?? {}, ['mode', 'tint', 'color', 'alt_color'], 'aura')
  c.aura = { mode: str(au.mode ?? 'base', 'aura.mode', 8)!, tint: str(au.tint ?? 'all', 'aura.tint', 8)!, color: color(au.color ?? '#40A0FF', 'aura.color'), alt_color: color(au.alt_color ?? '#50FF50', 'aura.alt_color') }
  if (!AURA_MODES.includes(c.aura.mode)) throw new LabError('manifest: unknown aura mode')
  if (!AURA_TINTS.includes(c.aura.tint)) throw new LabError('manifest: unknown aura tint')
  const fl = keys(m.flames ?? {}, ['parts', 'body', 'color', 'alt_color', 'size', 'base_effect'], 'flames')
  const parts = typed<unknown[]>(fl.parts ?? [], 'array', 'flames.parts').map((p) => str(p, 'flames.parts', 10)!)
  for (const p of parts) if (!FLAME_PARTS.includes(p)) throw new LabError(`manifest: unknown flame part ${JSON.stringify(p)}`)
  c.flames = {
    parts: FLAME_PARTS.filter((p) => parts.includes(p)),
    body: typed<boolean>(fl.body ?? false, 'boolean', 'flames.body'),
    color: fl.color === null || fl.color === undefined ? null : color(fl.color, 'flames.color'),
    alt_color: fl.alt_color === null || fl.alt_color === undefined ? null : color(fl.alt_color, 'flames.alt_color'),
    size: num(fl.size ?? 1, 'flames.size', FLAME_SIZE[0], FLAME_SIZE[1], false)!,
    base_effect: typed<boolean>(fl.base_effect ?? true, 'boolean', 'flames.base_effect'),
  }
  if (c.flames.body && c.flames.parts.length) throw new LabError('manifest: flames are on the whole body or on parts, not both')
  const st = keys(m.stats ?? {}, ['display', 'gameplay'], 'stats')
  const disp = keys(st.display ?? defaultStats(), ['normal', 'alt'], 'stats.display')
  for (const k of ['normal', 'alt'] as const) {
    const v = typed<unknown[]>(disp[k], 'array', 'stats.display')
    if (v.length !== 6) throw new LabError('manifest: six display stats per costume')
    c.stats[k] = v.map((x) => num(x, 'a display stat', STAT_RANGE[0], STAT_RANGE[1], false, true)!)
  }
  const gp = keys(st.gameplay ?? {}, [...Object.keys(GAMEPLAY), 'lift', 'wire_swing'], 'stats.gameplay')
  c.gameplay = {}
  for (const [k, [lo, hi, integer]] of Object.entries(GAMEPLAY)) {
    if (gp[k] !== null && gp[k] !== undefined) (c.gameplay as Record<string, number>)[k] = num(gp[k], k, lo, hi, true, integer)!
  }
  if (gp.lift !== null && gp.lift !== undefined) {
    if (!LIFT.includes(gp.lift as string)) throw new LabError('manifest: lift is light, medium or heavy')
    c.gameplay.lift = gp.lift as string
  }
  if (gp.wire_swing !== null && gp.wire_swing !== undefined) c.gameplay.wire_swing = typed<boolean>(gp.wire_swing, 'boolean', 'wire_swing')
  const ui = keys(m.ui ?? {}, ['select', 'fade', 'strip_scale', 'ready_voice', 'banner'], 'ui')
  const sel = keys(ui.select ?? {}, [...POSES], 'ui.select')
  c.ui = {
    select: {},
    fade: num(ui.fade ?? 36, 'ui.fade', 0, 256, false, true)!,
    strip_scale: num(ui.strip_scale, 'ui.strip_scale', 0.01, 50.0),
    ready_voice: str(ui.ready_voice, 'ui.ready_voice', 40, /^FE_SFX_[A-Z0-9_]+$/, true),
    banner: Boolean(ui.banner ?? true),
  }
  for (const [pose, p0] of Object.entries(sel)) {
    const p = keys(p0, ['scale', 'anchor', 'glow'], 'ui.select.' + pose)
    const anchor = typed<unknown[]>(p.anchor, 'array', 'anchor')
    if (anchor.length !== 2) throw new LabError('manifest: an anchor is two numbers')
    c.ui.select[pose as Pose] = {
      scale: num(p.scale, 'scale', 0.001, 100.0, false)!,
      anchor: [num(anchor[0], 'anchor', -8192, 8192, false)!, num(anchor[1], 'anchor', -8192, 8192, false)!],
      glow: p.glow ? color(p.glow, 'glow') : null,
    }
  }
  const mv = keys(m.base_moves ?? {}, ['throw_reach', 'throw_cable'], 'base_moves')
  c.baseMoves = {}
  const reach = num(mv.throw_reach, 'base_moves.throw_reach', THROW_REACH[0], THROW_REACH[1])
  if (reach !== null) c.baseMoves.throw_reach = reach
  if (mv.throw_cable !== null && mv.throw_cable !== undefined) c.baseMoves.throw_cable = typed<boolean>(mv.throw_cable, 'boolean', 'base_moves.throw_cable')
  for (const k of Object.keys(c.baseMoves)) {
    if (!(BASE_MOVES[c.base] ?? []).includes(k as keyof BaseMoves)) throw new LabError(`manifest: base_moves.${k} only applies to a ${movesBases(k)} base`)
  }
  const moves = typed<Record<string, unknown>>(m.moves ?? {}, 'object', 'moves')
  c.moves = {}
  for (const [id, from] of Object.entries(moves)) {
    if (!MOVE_IDS.has(id)) throw new LabError(`manifest: unknown move ${JSON.stringify(id.slice(0, 40))}`)
    const key = str(from, `moves.${id}`, 20)!
    if (!Object.hasOwn(BASES, key)) throw new LabError(`manifest: moves.${id} names an unknown base character`)
    if (key === c.base) throw new LabError(`manifest: moves.${id} is taken from the base itself`)
    c.moves[id] = key
  }
  const cs = keys(m.cutscenes ?? {}, [...CUTSCENE_KINDS, 'audio', 'effects'], 'cutscenes')
  c.cutscenes = { audio: {}, effects: {} }
  for (const kind of CUTSCENE_KINDS) {
    if (cs[kind] === undefined) continue
    const key = str(cs[kind], `cutscenes.${kind}`, 20)!
    if (!Object.hasOwn(BASES, key)) throw new LabError(`manifest: cutscenes.${kind} names an unknown base character`)
    if (key === c.base) throw new LabError(`manifest: cutscenes.${kind} is taken from the base itself`)
    c.cutscenes[kind] = key
  }
  for (const [slot, member] of Object.entries(typed<Record<string, unknown>>(cs.audio ?? {}, 'object', 'cutscenes.audio'))) {
    if (!AUDIO_SLOT.test(slot)) throw new LabError(`manifest: unknown cutscene audio ${JSON.stringify(slot.slice(0, 40))}`)
    const file = str(member, `cutscenes.audio.${slot}`, 80, AUDIO_MEMBER)!
    if (!files.has(file)) throw new LabError(`manifest: cutscenes.audio.${slot} names ${file}, which the file lacks`)
    c.cutscenes.audio[slot] = file
  }
  // a list of kinds is the first form, all `theirs`
  const fx = Array.isArray(cs.effects) ? Object.fromEntries(cs.effects.map((k) => [k, 'theirs'])) : (cs.effects ?? {})
  if (Array.isArray(cs.effects) && Object.keys(fx).length !== cs.effects.length) throw new LabError('manifest: cutscenes.effects repeats a kind')
  for (const [kind, how] of Object.entries(keys(fx, [...CUTSCENE_KINDS], 'cutscenes.effects'))) {
    if (!CUTSCENE_EFFECTS.includes(how as CutsceneEffects)) throw new LabError(`manifest: cutscenes.effects.${kind} is theirs or none`)
    if (c.cutscenes[kind as CutsceneKind] === undefined) throw new LabError(`manifest: cutscenes.effects names ${kind}, which is the base's own`)
    c.cutscenes.effects[kind as CutsceneKind] = how as CutsceneEffects
  }
  c.glb = files.get('model/model.glb') ?? null
  files.delete('model/model.glb')
  c.files = files
  return c
}

export function load(data: Uint8Array): Character {
  const infos = listZip(data)
  if (infos.length > 64) throw new LabError('the file has too many members')
  let total = 0
  for (const info of infos) {
    const name = info.name
    if (info.isDir || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || !MEMBER.test(name)) {
      throw new LabError(`the file contains an unexpected member: ${JSON.stringify(name.slice(0, 80))}`)
    }
    total += info.size
    if (total > MAX_TOTAL) throw new LabError('the file is too large once unpacked')
    if (info.size > 1 << 20 && info.size > MAX_RATIO * Math.max(info.compressedSize, 1)) throw new LabError(`a member compresses suspiciously well: ${name}`)
  }
  const names = infos.map((i) => i.name)
  if (new Set(names).size !== names.length) throw new LabError('the file has duplicate members')
  if (!names.includes('manifest.json')) throw new LabError('the file has no manifest.json')
  const raw = new Map<string, Uint8Array>()
  for (const info of infos) raw.set(info.name, readEntry(data, info))
  let m: unknown
  try {
    m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.get('manifest.json')!))
  } catch {
    throw new LabError('manifest.json is not valid JSON')
  }
  raw.delete('manifest.json')
  if (!isObj(m)) throw new LabError('manifest.json is not an object')
  const hashes = typed<Record<string, unknown>>(m.files ?? {}, 'object', 'files')
  const listed = Object.keys(hashes).sort(), present = [...raw.keys()].sort()
  if (listed.length !== present.length || listed.some((k, i) => k !== present[i])) throw new LabError("the manifest's file list does not match the archive")
  for (const [name, body] of raw) {
    if (sha(body) !== hashes[name]) throw new LabError(`${name} is damaged (its checksum does not match)`)
    checkMember(name, body)
  }
  return fromManifest(m, raw)
}

export function checkMember(name: string, body: Uint8Array) {
  if (name.endsWith('.png')) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (body.length < 8 || sig.some((b, i) => body[i] !== b)) throw new LabError(`${name} is not a PNG image`)
    const [w, h] = pngSize(body)
    if (!(w > 0 && w <= MAX_IMAGE_SIDE && h > 0 && h <= MAX_IMAGE_SIDE)) throw new LabError(`${name} is larger than ${MAX_IMAGE_SIDE} pixels a side`)
  } else if (name.endsWith('.asf')) {
    try {
      asftool.check(body, MAX_AUDIO_SECONDS)
    } catch (e) {
      throw new LabError(`${name}: ${(e as Error).message}`)
    }
  } else if (name.endsWith('.glb')) {
    if (body.length < 20 || body[0] !== 0x67 || body[1] !== 0x6c || body[2] !== 0x54 || body[3] !== 0x46) throw new LabError(`${name} is not a GLB model`)
  }
}

export function image(body: Uint8Array): RgbaImage {
  return decodeImage(body)
}

export function png(im: RgbaImage): Uint8Array {
  return encodePng(im)
}

function stableJson(v: unknown, indent: number, depth = 0): string {
  const pad = (d: number) => '\n' + ' '.repeat(indent * d)
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return '[' + v.map((x) => pad(depth + 1) + stableJson(x, indent, depth + 1)).join(',') + pad(depth) + ']'
  }
  if (isObj(v)) {
    const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort()
    if (!ks.length) return '{}'
    return '{' + ks.map((k) => pad(depth + 1) + JSON.stringify(k) + ': ' + stableJson(v[k], indent, depth + 1)).join(',') + pad(depth) + '}'
  }
  return JSON.stringify(v)
}

export function save(c: Character): Uint8Array {
  const m = manifest(c)
  const files = new Map(c.files)
  if (c.glb !== null) files.set('model/model.glb', c.glb)
  const members: [string, Uint8Array][] = [['manifest.json', utf8(stableJson(m, 1))]]
  for (const [name, body] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) members.push([name, body])
  for (const [name] of members) if (!MEMBER.test(name)) throw new LabError(`cannot store ${name} in a .imperfect file`)
  return writeZip(members)
}

export function slimGlb(data: Uint8Array, keepImages: Set<number>): Uint8Array {
  const g = new GLB(data)
  const j: Json = structuredClone(g.j)
  delete j.animations
  const baseTex = (mat: Json) => [mat.pbrMetallicRoughness?.baseColorTexture, mat.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture]
  for (const mat of j.materials ?? []) {
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete mat[k]
    if (mat.pbrMetallicRoughness) delete mat.pbrMetallicRoughness.metallicRoughnessTexture
    const sg = mat.extensions?.KHR_materials_pbrSpecularGlossiness
    if (sg) delete sg.specularGlossinessTexture
  }
  const usedTex = new Set<number>()
  for (const mat of j.materials ?? []) {
    for (const t of baseTex(mat)) {
      if (t === undefined || t === null) continue
      if (keepImages.has(j.textures[t.index].source)) usedTex.add(t.index)
      else {
        if (mat.pbrMetallicRoughness) delete mat.pbrMetallicRoughness.baseColorTexture
        const sg = mat.extensions?.KHR_materials_pbrSpecularGlossiness
        if (sg) delete sg.diffuseTexture
      }
    }
  }
  const sortedTex = [...usedTex].sort((a, b) => a - b)
  const texMap = new Map(sortedTex.map((old, i) => [old, i]))
  const sources = [...new Set(sortedTex.map((t) => j.textures[t].source).filter((s: unknown) => s !== undefined && s !== null))].sort((a, b) => (a as number) - (b as number)) as number[]
  const imgMap = new Map(sources.map((old, i) => [old, i]))
  j.textures = sortedTex.map((t) => {
    const out = { ...j.textures[t] }
    const s = imgMap.get(j.textures[t].source)
    if (s === undefined) out.source = null
    else out.source = s
    return out
  })
  j.images = sources.map((i) => j.images[i])
  for (const mat of j.materials ?? []) for (const t of baseTex(mat)) if (t !== undefined && t !== null) t.index = texMap.get(t.index)
  for (const k of ['textures', 'images']) if (!j[k].length) delete j[k]
  const usedAcc = new Set<number>()
  for (const mesh of j.meshes ?? []) {
    for (const p of mesh.primitives) {
      for (const v of Object.values(p.attributes)) usedAcc.add(v as number)
      if (p.indices !== undefined) usedAcc.add(p.indices)
      delete p.targets
    }
  }
  for (const sk of j.skins ?? []) if (sk.inverseBindMatrices !== undefined) usedAcc.add(sk.inverseBindMatrices)
  const accOrder = [...usedAcc].sort((a, b) => a - b)
  const accMap = new Map(accOrder.map((old, i) => [old, i]))
  const accessors = accOrder.map((i) => ({ ...j.accessors[i] }))
  const views = [...new Set([...accessors.filter((a) => a.bufferView !== undefined).map((a) => a.bufferView),
    ...(j.images ?? []).filter((im: Json) => im.bufferView !== undefined).map((im: Json) => im.bufferView)])].sort((a, b) => a - b) as number[]
  const viewMap = new Map(views.map((old, i) => [old, i]))
  const parts: Uint8Array[] = []
  let blobLen = 0
  const newViews = views.map((v) => {
    const bv = { ...j.bufferViews[v] }
    const pad = (4 - (blobLen % 4)) % 4
    if (pad) {
      parts.push(new Uint8Array(pad))
      blobLen += pad
    }
    const off = bv.byteOffset ?? 0
    parts.push(g.bin.subarray(off, off + bv.byteLength))
    bv.byteOffset = blobLen
    bv.buffer = 0
    blobLen += bv.byteLength
    return bv
  })
  for (const a of accessors) if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView)
  for (const im of j.images ?? []) if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView)
  for (const mesh of j.meshes ?? []) {
    for (const p of mesh.primitives) {
      p.attributes = Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, accMap.get(v as number)]))
      if (p.indices !== undefined) p.indices = accMap.get(p.indices)
    }
  }
  for (const sk of j.skins ?? []) if (sk.inverseBindMatrices !== undefined) sk.inverseBindMatrices = accMap.get(sk.inverseBindMatrices)
  j.accessors = accessors
  j.bufferViews = newViews
  const tail = (4 - (blobLen % 4)) % 4
  if (tail) {
    parts.push(new Uint8Array(tail))
    blobLen += tail
  }
  j.buffers = [{ byteLength: blobLen }]
  let js = utf8(JSON.stringify(j))
  const jpad = (4 - (js.length % 4)) % 4
  if (jpad) {
    const padded = new Uint8Array(js.length + jpad).fill(0x20)
    padded.set(js)
    js = padded
  }
  const total = 12 + 8 + js.length + 8 + blobLen
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46])
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, js.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(js, 20)
  let o = 20 + js.length
  dv.setUint32(o, blobLen, true)
  dv.setUint32(o + 4, 0x004e4942, true)
  o += 8
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

