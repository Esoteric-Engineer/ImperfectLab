// Projectile swap (manifest `projectile`): use a tinted copy of another base's projectile, and change the spawn location.
// Field slots 0-4 are costume 1's, the rest are costume 2's.
import { latin1 } from '../bytes'
import { LabError } from '../errors'
import * as R from '../game/roster'
import type { GameSource } from '../game/source'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type * as nottool from '../mnroi/nottool'
import type { Skeleton } from '../model/skeleton'
import { PROJECTILE_LEAD, type Projectile } from '../package/imperfect'
import type { Effects } from './effects'
import { attachment } from './flames'
import { FIELDS, filled, LAUNCH_INDEX, SPAWN_KIND } from './projectiles'
import * as templates from './templates'
import * as tuning from './tuning'

export interface Donor {
  label: string
  template: string
  bytes: number
}

export const DONORS: Record<string, Donor> = {
  // using Iron Man costume 2's repulsor as it can be tinted. costume 1's is blue.
  ironman: { label: "Iron Man's repulsor", template: 'proj_altIronManRepulsor', bytes: 780 },
}

const P_SOUND = 0x70
const GLOBAL = 'global'

export interface Shot {
  donor: R.BaseCharacter
  label: string
  fields: number[]
  values: string[]
  templates: nottool.Template[]
  borrow: [string, string][][]
}

const textureNames = (src: GameSource, bundle: string) =>
  new Set(latin1(src.entry(`Bundles/${bundle}.ngt`)).split(/\s+/).filter(Boolean).map((n) => n.toLowerCase()))

function drawn(fx: Effects, roots: string[]): string[] {
  const out = new Set<string>()
  for (const b of fx.tree(roots)) {
    for (const line of b.lines.slice(1)) {
      const t = nfxtool.tokens(line)
      if (t.length >= 2 && t[0].toLowerCase() === 'material') out.add(t[1])
    }
  }
  return [...out]
}

// newName: templates.namer's, shared with the aura tint's copies.
export function build(src: GameSource, base: R.BaseCharacter, fx: Effects, p: Projectile, internal: string, newName: (old: string) => string): Shot {
  const donorInfo = DONORS[p.base]
  if (!donorInfo) throw new LabError(`there is no projectile ${p.base} to swap in`)
  const T = base.t
  if (!T.has(donorInfo.template)) throw new LabError(`Global.not has no ${donorInfo.template}`)
  const tun = new tuning.Tuning(src, base)
  const fields = FIELDS.filter((_, i) => filled(tun)[i])
  if (!fields.length) throw new LabError(`${base.label} launches no projectiles to replace`)
  const roots = templates.chain(T, donorInfo.template).flatMap((t) => {
    const s = R.text(t.get(R.P_EFFECT1))
    return s && fx.has(s) ? [s] : []
  })
  const prefix = `${internal.slice(0, 2).toLowerCase()}pj`
  const out: nottool.Template[] = []
  const made = new Map<string, string>()
  const effectsOf = new Map<string, string[]>()
  const names = [0, tuning.SLOTS - 1].map((slot, costume) => {
    const color = costume ? p.alt_color : p.color
    const own = String(tun.value(fields[0], slot))
    const sound = T.has(own) ? T.get(own).get(P_SOUND) : null
    const key = `${color.toLowerCase()} ${sound ? [...sound].join(',') : ''}`
    if (!made.has(key)) {
      const map = fx.tinted(roots, color, prefix)
      const r = templates.retarget(T, donorInfo.template, map, newName)
      if (!r) throw new LabError(`${donorInfo.label} has no effects to tint`)
      const [name, copies] = r
      const shot = copies.find((t) => t.name.toLowerCase() === name.toLowerCase())!
      if (sound) shot.set(P_SOUND, sound.slice())
      else shot.props = shot.props.filter(([pid]) => pid !== P_SOUND)
      out.push(...copies)
      made.set(key, name)
      effectsOf.set(name, copies.flatMap((t) => R.text(t.get(R.P_EFFECT1)) ?? []))
    }
    return made.get(key)!
  })
  const values = Array.from({ length: tuning.SLOTS }, (_, s) => names[s === tuning.SLOTS - 1 ? 1 : 0])
  const donor = new R.BaseCharacter(src, p.base, T)
  const global = textureNames(src, GLOBAL)
  const borrow = [false, true].map((alt): [string, string][] => {
    const own = textureNames(src, alt ? base.altBundle : base.bundle)
    return drawn(fx, effectsOf.get(names[alt ? 1 : 0])!).filter((m) => !global.has(m.toLowerCase()) && !own.has(m.toLowerCase())).map((m) => {
      const from = [donor.bundle, donor.altBundle].find((b) => textureNames(src, b).has(m.toLowerCase()))
      if (!from) throw new LabError(`${donorInfo.label} draws ${m}, which no bundle the character can borrow from has`)
      return [from, m]
    })
  })
  return { donor, label: donorInfo.label, fields, values, templates: out, borrow }
}

// How far ahead of the eyes the head's spot is put to hide the shot's first-frame tail (PROJECTILE_LEAD).
export const lead = (p: Projectile): number => PROJECTILE_LEAD[p.base] ?? 0

function boneOf(sk: Skeleton, p: Projectile): number {
  const node = sk.node(p.bone)
  if (node === undefined) throw new LabError(`the base has no ${p.bone} bone to launch projectiles from`)
  return node
}

// The chosen bone's launch marker, in place of any marker the base has at its index.
export function marker(render: ngmtool.Model, sk: Skeleton, p: Projectile) {
  render.attachments = [...render.attachments.filter(([, kind, index]) => !(kind === SPAWN_KIND && index === LAUNCH_INDEX)), attachment(boneOf(sk, p), SPAWN_KIND, LAUNCH_INDEX, p.position)]
}

// The bone and the launch point in the model, at bind.
export function launchPoint(sk: Skeleton, p: Projectile): [[number, number, number], [number, number, number]] {
  const at = sk.nodes[boneOf(sk, p)].pos
  return [[...at], [0, 1, 2].map((i) => at[i] + p.position[i]) as [number, number, number]]
}

// The effect cache a projectile swap takes: one copy, or one per costume when their colors differ.
export function bytes(p: Projectile): number {
  if (!p.on || !DONORS[p.base]) return 0
  return DONORS[p.base].bytes * (p.color.toUpperCase() === p.alt_color.toUpperCase() ? 1 : 2)
}
