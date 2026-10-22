// Misc/Global.not: the new character's act_/plr_/plr_alt templates, copies of the base's.
import { LabError } from '../errors'
import * as R from '../game/roster'
import { roundHalfEven } from '../mnroi/gxtex'
import * as nottool from '../mnroi/nottool'

const AURA_SWAP = [R.P_EFFECT1, R.P_CASTID, R.P_ACTOR_FLAGS]

export function modelNames(internal: string, costume: string): Record<'MODEL' | 'PHYSMODEL' | 'SHADOWMODEL', string> {
  return { MODEL: `${internal}${costume}.nod`, PHYSMODEL: `${internal}${costume}_phys.nod`, SHADOWMODEL: `${internal}${costume}_shadow.nod` }
}

export function templateNames(internal: string): [string, string, string] {
  return ['act_' + internal, 'plr_' + internal, 'plr_alt' + internal]
}

function clone(src: nottool.Template, newName: string, parent?: string): nottool.Template {
  const t = new nottool.Template(nottool.name32(newName), src.props.map(([p, v]) => [p, v.slice()]), new Uint8Array([0]))
  if (parent) t.set(0x00, nottool.vStr(parent))
  return t
}

export function build(data: Uint8Array, base: R.BaseCharacter, internal: string, aura = 'base', effect1: [string, string] | null = null,
  description: string | null = null, abilities: [number, number] | null = null, health: number | null = null): Uint8Array {
  const T = new R.Templates(data)
  const [actN, plrN, altN] = templateNames(internal)
  for (const n of [actN, plrN, altN]) if (T.has(n)) throw new LabError(`Global.not already has a template ${n}`)
  const act = clone(T.get(base.act), actN)
  const plr = clone(T.get(base.plr), plrN, actN)
  const alt = clone(T.get(base.alt), altN, actN)
  for (const [t, costume] of [[act, ''], [alt, '_alt']] as [nottool.Template, string][]) {
    const nm = modelNames(internal, costume)
    t.set(R.P_MODEL, nottool.vStr(nm.MODEL))
    t.set(R.P_SHADOWMODEL, nottool.vStr(nm.SHADOWMODEL))
    t.set(R.P_PHYSMODEL, nottool.vStr(nm.PHYSMODEL))
  }
  if (aura === 'swap') {
    for (const pid of AURA_SWAP) {
      const normal = T.prop(base.plr, pid), other = T.prop(base.alt, pid)
      if (normal !== null && other !== null) {
        plr.set(pid, other)
        alt.set(pid, normal)
      }
    }
  } else if (aura !== 'base') {
    throw new LabError(`unknown aura mode ${JSON.stringify(aura)}`)
  }
  if (effect1) {
    plr.set(R.P_EFFECT1, nottool.vStr(effect1[0]))
    alt.set(R.P_EFFECT1, nottool.vStr(effect1[1]))
  }
  if (description) {
    for (const t of [act, plr, alt]) if (t === act || t.get(R.P_DESCRIPTIONID) !== null) t.set(R.P_DESCRIPTIONID, nottool.vStr(description))
  }
  if (abilities) {
    const [on, off] = abilities
    for (const [t, src] of [[act, base.act], [plr, base.plr], [alt, base.alt]] as [nottool.Template, string][]) {
      if (t === act || T.get(src).get(R.P_ABILITIES) !== null) {
        const v = R.u32(T.prop(src, R.P_ABILITIES)) || 0
        t.set(R.P_ABILITIES, nottool.vInt(((v | on) & ~off) >>> 0))
      }
    }
  }
  if (health !== null && health !== undefined) {
    act.set(R.P_HEALTH, nottool.vInt(roundHalfEven(health)))
    act.set(R.P_MAXHEALTH, nottool.vInt(roundHalfEven(health)))
  }
  return nottool.build([...T.list, act, plr, alt])
}
