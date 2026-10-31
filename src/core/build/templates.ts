// Misc/Global.not: the new character's act_/plr_/plr_alt templates, copies of the base's.
import { LabError } from '../errors'
import * as R from '../game/roster'
import { roundHalfEven } from '../mnroi/gxtex'
import * as nottool from '../mnroi/nottool'
import { scaleTemplates } from './size'

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

// A template and every template its props name (projectile and explosion).
export function chain(T: R.Templates, name: string | null): nottool.Template[] {
  const out: nottool.Template[] = []
  const todo = name ? [name] : []
  const seen = new Set<string>()
  while (todo.length) {
    const n = todo.shift()!
    if (!T.has(n) || seen.has(n.toLowerCase())) continue
    seen.add(n.toLowerCase())
    const t = T.get(n)
    out.push(t)
    for (const [pid, v] of t.props) {
      const s = R.text(v)
      if (pid !== 0x00 && s && T.has(s)) todo.push(s)
    }
  }
  return out
}

export function retarget(T: R.Templates, name: string, effects: Map<string, string>, newName: (old: string) => string): [string, nottool.Template[]] | null {
  const ts = chain(T, name)
  const names = (t: nottool.Template) => t.props.map(([, v]) => (R.text(v) ?? '').toLowerCase())
  if (!ts.some((t) => names(t).some((s) => effects.has(s)))) return null
  const renamed = new Map(ts.map((t) => [t.name.toLowerCase(), newName(t.name)]))
  const copies = ts.map((t) => {
    const c = clone(t, renamed.get(t.name.toLowerCase())!)
    for (const [pid, v] of c.props) {
      const s = (R.text(v) ?? '').toLowerCase()
      const next = pid === 0x00 ? undefined : (renamed.get(s) ?? effects.get(s))
      if (next) c.set(pid, nottool.vStr(next))
    }
    return c
  })
  return [renamed.get(name.toLowerCase())!, copies]
}

export function build(data: Uint8Array, base: R.BaseCharacter, internal: string, aura = 'base', effect1: [string, string] | null = null,
  description: string | null = null, abilities: [number, number] | null = null, health: number | null = null, extra: nottool.Template[] = [],
  motionSet: string | null = null, effect1Kept = true, effect2: [string | null, string | null] | null = null, size = 1): Uint8Array {
  const T = new R.Templates(data)
  const [actN, plrN, altN] = templateNames(internal)
  for (const n of [actN, plrN, altN, ...extra.map((t) => t.name)]) if (T.has(n)) throw new LabError(`Global.not already has a template ${n}`)
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
  if (effect2?.[0]) plr.set(R.P_EFFECT2, nottool.vStr(effect2[0]))
  if (effect2?.[1]) alt.set(R.P_EFFECT2, nottool.vStr(effect2[1]))
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
  if (motionSet) act.set(R.P_MOTIONSET, nottool.vStr(motionSet))
  if (!effect1Kept) for (const t of [act, plr, alt]) t.props = t.props.filter(([pid]) => pid !== R.P_EFFECT1)
  if (health !== null && health !== undefined) {
    act.set(R.P_HEALTH, nottool.vInt(roundHalfEven(health)))
    act.set(R.P_MAXHEALTH, nottool.vInt(roundHalfEven(health)))
  }
  if (size !== 1) scaleTemplates(T, [[act, base.act], [plr, base.plr], [alt, base.alt]], size)
  return nottool.build([...T.list, act, plr, alt, ...extra])
}
