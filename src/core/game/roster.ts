// The 18 playable characters a new one can be based on.
// Only what is fixed in the code is listed; stats, models, effects, body class and banner sizes are read from the user's disc.
import { cstring, f32le, u32le } from '../bytes'
import { LabError } from '../errors'
import * as nottool from '../mnroi/nottool'
import * as D from './dol'
import type { GameSource } from './source'

export const SELECT_ID = 18

export const BASES: Record<string, [string, number, number, number, string, number | null]> = {
  thing: ['Thing', 0, 10, 10, 'Thing', null],
  wolverine: ['Wolverine', 1, 2, 1, 'Wolverine', null],
  paradox: ['Paradox', 2, 15, 14, 'Paradox', null],
  elektra: ['Elektra', 3, 6, 6, 'Elektra', null],
  johnnyohm: ['Johnny Ohm', 4, 14, 16, 'JohnnyOhm', 3],
  spiderman: ['Spider-Man', 5, 3, 3, 'SpiderMan', null],
  daredevil: ['Daredevil', 6, 9, 9, 'Daredevil', null],
  storm: ['Storm', 7, 7, 7, 'Storm', 6],
  aftershock: ['Aftershock', 8, 13, 15, 'Aftershock', null],
  venom: ['Venom', 9, 4, 4, 'Venom', null],
  heatwave: ['Heatwave', 10, 16, 18, 'Heatwave', 10],
  humantorch: ['Human Torch', 11, 8, 8, 'HumanTorch', 4],
  ironman: ['Iron Man', 12, 1, 2, 'IronMan', 5],
  megalith: ['Megalith', 13, 17, 12, 'Megalith', 7],
  magneto: ['Magneto', 14, 5, 5, 'Magneto', null],
  biohazard: ['Biohazard', 15, 12, 17, 'Biohazard', 9],
  defcon: ['DefCon', 16, 11, 13, 'DefCon', null],
  roekel: ['Van Roekel', 17, 18, 11, 'Roekel', 8],
}
export const VOICES: Record<string, string> = {
  thing: 'FE_SFX_THING', wolverine: 'FE_SFX_WOLVERINE', paradox: 'FE_SFX_WINK', elektra: 'FE_SFX_ELEKTRA',
  johnnyohm: 'FE_SFX_OHM', spiderman: 'FE_SFX_SPIDEY', daredevil: 'FE_SFX_DAREDEVIL', storm: 'FE_SFX_STORM',
  aftershock: 'FE_SFX_FAULTZONE', venom: 'FE_SFX_VENOM', heatwave: 'FE_SFX_SOLARA', humantorch: 'FE_SFX_TORCH',
  ironman: 'FE_SFX_IRONMAN', megalith: 'FE_SFX_BRIGADE', magneto: 'FE_SFX_MAGNETO', biohazard: 'FE_SFX_HAZMAT',
  defcon: 'FE_SFX_DEFCON', roekel: 'FE_SFX_ROEKEL',
}
const BODY_CLASSES: Record<number, string> = { 0: 'male', 1: 'female', 2: 'brute' }
export const LANGS = ['ENG', 'FRA', 'GER', 'ITA']

export const P_MODEL = 0x0a, P_PHYSMODEL = 0x0f, P_MOTIONSET = 0x13, P_CASTID = 0x14, P_DESCRIPTIONID = 0x15
export const P_SKELETONID = 0x27, P_EFFECT1 = 0x28, P_EFFECT2 = 0x29, P_ACTOR_FLAGS = 0x30, P_ABILITIES = 0x32
export const P_HEALTH = 0x33, P_MAXHEALTH = 0x34, P_SHADOWMODEL = 0x75

export function keys(): string[] {
  return Object.keys(BASES)
}

export function label(key: string): string {
  return BASES[key][0]
}

export function text(v: Uint8Array | null): string | null {
  return v !== null ? cstring(v) : null
}

export function u32(v: Uint8Array | null): number | null {
  return v !== null ? u32le(v, 0) : null
}

export function f32(v: Uint8Array | null): number | null {
  return v !== null ? f32le(v, 0) : null
}

export class Templates {
  list: nottool.Template[]
  by: Map<string, nottool.Template>

  constructor(data: Uint8Array) {
    this.list = nottool.parse(data)
    this.by = new Map()
    for (const t of this.list) this.by.set(t.name.toLowerCase(), t)
  }

  get(name: string): nottool.Template {
    const t = this.by.get(name.toLowerCase())
    if (!t) throw new LabError(`Global.not has no template ${name}`)
    return t
  }

  has(name: string): boolean {
    return this.by.has(name.toLowerCase())
  }

  prop(name: string | null, pid: number): Uint8Array | null {
    const seen = new Set<string>()
    while (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      const t = this.by.get(name.toLowerCase())
      if (!t) return null
      const v = t.get(pid)
      if (v !== null) return v
      name = text(t.get(0x00))
    }
    return null
  }
}

export class BaseCharacter {
  key: string
  label: string
  selectId: number
  rosterIndex: number
  typeId: number
  auraIndex: number | null
  source: GameSource
  t: Templates
  act: string
  plr: string
  alt: string
  stats: number[]
  altStats: number[]
  entity: string
  hudName: string
  bundle: string
  altBundle: string
  bodyClass: number
  effect1: string | null
  altEffect1: string | null
  abilities: number
  description: string | null

  constructor(source: GameSource, key: string, templates?: Templates) {
    if (!Object.hasOwn(BASES, key)) throw new LabError(`unknown base character ${JSON.stringify(key)}`)
    this.key = key
    let stem: string
    ;[this.label, this.selectId, this.rosterIndex, this.typeId, stem, this.auraIndex] = BASES[key]
    this.source = source
    this.t = templates ?? new Templates(source.entry('Misc/Global.not'))
    this.act = 'act_' + stem
    this.plr = 'plr_' + stem
    this.alt = 'plr_alt' + stem
    for (const n of [this.act, this.plr, this.alt]) this.t.get(n)
    const record = D.readRecord(source.dol, D.NORMAL_TABLE, this.rosterIndex)
    const altRecord = D.readRecord(source.dol, D.ALT_TABLE, this.rosterIndex)
    this.stats = record.stats
    this.altStats = altRecord.stats
    this.entity = record.name
    this.hudName = this.entity.slice('plr_'.length).toLowerCase()
    const model = text(this.t.prop(this.plr, P_MODEL))!
    this.bundle = stripExt(model).toLowerCase()
    this.altBundle = stripExt(text(this.t.prop(this.alt, P_MODEL))!).toLowerCase()
    this.bodyClass = u32(this.t.prop(this.plr, P_SKELETONID)) || 0
    this.effect1 = text(this.t.prop(this.plr, P_EFFECT1))
    this.altEffect1 = text(this.t.prop(this.alt, P_EFFECT1))
    this.abilities = u32(this.t.prop(this.plr, P_ABILITIES)) || 0
    this.description = text(this.t.prop(this.plr, P_DESCRIPTIONID))
  }

  get body(): string {
    return BODY_CLASSES[this.bodyClass] ?? 'male'
  }

  nvbName(): string {
    const want = `misc/player_${(this.description ?? '').toLowerCase()}.nvb`
    for (const n of this.source.names('Misc/', '.nvb')) if (n.toLowerCase() === want) return n
    throw new LabError(`no tuning file for ${this.description}`)
  }

  bundleFiles(alt = false): [Uint8Array, Uint8Array, Uint8Array] {
    const b = 'Bundles/' + (alt ? this.altBundle : this.bundle)
    return [this.source.entry(b + '.ngm'), this.source.entry(b + '.ngt'), this.source.entry(b + '.tpl')]
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? name : name.slice(0, i)
}
