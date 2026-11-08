// Projectile swap (manifest `projectile`): use a tinted copy of another base's projectile, and change the spawn location.
// Field slots 0-4 are costume 1's, the rest are costume 2's.
import { latin1 } from '../bytes'
import { LabError } from '../errors'
import * as R from '../game/roster'
import type { GameSource } from '../game/source'
import * as nfxtool from '../mnroi/nfxtool'
import * as ngmtool from '../mnroi/ngmtool'
import type * as nottool from '../mnroi/nottool'
import type { Skeleton } from '../model/skeleton'
import { PROJECTILE_LEAD, type Projectile } from '../package/imperfect'
import { type Effects, hexAlpha, recolor, spawnedBy } from './effects'
import { attachment, GREY_BUNDLE } from './flames'
import { FIELDS, filled, LAUNCH_INDEX, SPAWN_KIND } from './projectiles'
import * as shaders from './shaders'
import * as templates from './templates'
import * as tuning from './tuning'

export interface Donor {
  label: string
  template: string
  bytes: number
}

// From the costume whose sprites tint best: Iron Man's, Heatwave's and Human Torch's costume 2 draw black-and-white or grey ones.
export const DONORS: Record<string, Donor> = {
  thing: { label: "Thing's shock wave", template: 'proj_thingShockForce', bytes: 160 },
  elektra: { label: "Elektra's throwing star", template: 'proj_elektraThrowStar', bytes: 320 },
  johnnyohm: { label: "Johnny Ohm's lightning bolt", template: 'proj_jOhmRangeAttL', bytes: 1200 },
  spiderman: { label: "Spider-Man's web ball", template: 'proj_spidMnWebBall', bytes: 420 },
  storm: { label: "Storm's lightning", template: 'proj_strmLightning', bytes: 980 },
  venom: { label: "Venom's web ball", template: 'proj_venomWebBall', bytes: 560 },
  heatwave: { label: "Heatwave's heat blast", template: 'proj_altheatwRangeAtt', bytes: 1240 },
  humantorch: { label: "Human Torch's fireball", template: 'proj_althtFireball', bytes: 1150 },
  ironman: { label: "Iron Man's repulsor", template: 'proj_altIronManRepulsor', bytes: 780 },
  megalith: { label: "Megalith's plasma bomb", template: 'proj_megArmShot', bytes: 720 },
  magneto: { label: "Magneto's magnetic blast", template: 'proj_magProjectile', bytes: 1080 },
  biohazard: { label: "Biohazard's slime blob", template: 'proj_bioHazBlob', bytes: 1450 },
  defcon: { label: "DefCon's mine trail", template: 'proj_dc1RangeAtt', bytes: 1840 },
  roekel: { label: "Van Roekel's plasma bomb", template: 'proj_vrLghtRepulsor', bytes: 500 },
}

// Donors whose shot draws a model of its own (Elektra's star, the plasma bomb), copied into the bundle.
export const MODELED = ['elektra', 'megalith', 'roekel']

const P_SOUND = 0x70
const GLOBAL = 'global'

export interface Shot {
  donor: R.BaseCharacter
  label: string
  fields: number[]
  values: string[]
  templates: nottool.Template[]
  borrow: [string, string][][]
  models: ngmtool.Model[][]
}

const textureNames = (src: GameSource, bundle: string) =>
  new Set(latin1(src.entry(`Bundles/${bundle}.ngt`)).split(/\s+/).filter(Boolean).map((n) => n.toLowerCase()))

const keyed = (fx: Effects, roots: string[], key: string): string[] =>
  [...new Set(fx.tree(roots).flatMap((b) => b.lines.slice(1).map(nfxtool.tokens).filter((t) => t.length >= 2 && t[0].toLowerCase() === key).map((t) => t[1])))]

const effectRoots = (fx: Effects, ts: nottool.Template[]): string[] => ts.flatMap((t) => {
  const s = R.text(t.get(R.P_EFFECT1))
  return s && fx.has(s) ? [s] : []
})

function spawnedOf(T: R.Templates, fx: Effects, template: string): string[] {
  const out: string[] = []
  for (let grew = true; grew;) {
    grew = false
    for (const b of fx.tree(effectRoots(fx, templates.chains(T, [template, ...out])))) {
      for (const n of spawnedBy(b)) {
        if (T.has(n) && n !== template.toLowerCase() && !out.includes(n)) {
          out.push(n)
          grew = true
        }
      }
    }
  }
  return out.map((n) => T.get(n).name)
}

const modelName = (n: string) => n.toLowerCase().replace(/\.nod$/, '')

// newName: templates.namer's, shared with the aura tint's copies.
export function build(src: GameSource, base: R.BaseCharacter, fx: Effects, p: Projectile, internal: string, newName: (old: string) => string): Shot {
  const donorInfo = DONORS[p.base]
  if (!donorInfo) throw new LabError(`there is no projectile ${p.base} to swap in`)
  const T = base.t
  if (!T.has(donorInfo.template)) throw new LabError(`Global.not has no ${donorInfo.template}`)
  const tun = new tuning.Tuning(src, base)
  const fields = FIELDS.filter((_, i) => filled(tun)[i])
  if (!fields.length) throw new LabError(`${base.label} launches no projectiles to replace`)
  const spawned = spawnedOf(T, fx, donorInfo.template)
  const own = templates.chain(T, donorInfo.template).map((t) => t.name.toLowerCase())
  const all = templates.chains(T, [donorInfo.template, ...spawned])
  const roots = effectRoots(fx, all)
  const prefix = `${internal.slice(0, 2).toLowerCase()}pj`
  const out: nottool.Template[] = []
  const made = new Map<string, string>()
  const copiesOf = new Map<string, nottool.Template[]>()
  const names = [0, tuning.SLOTS - 1].map((slot, costume) => {
    const color = costume ? p.alt_color : p.color
    const replaced = String(tun.value(fields[0], slot))
    const sound = T.has(replaced) ? T.get(replaced).get(P_SOUND) : null
    const key = `${color.toLowerCase()} ${sound ? [...sound].join(',') : ''}`
    if (!made.has(key)) {
      const renamed = new Map(all.map((t) => [t.name.toLowerCase(), newName(t.name)]))
      const map = fx.tinted(roots, color, prefix, recolor, new Map(spawned.map((n) => [n.toLowerCase(), renamed.get(n.toLowerCase())!])))
      const r = templates.retarget(T, donorInfo.template, map, (old) => renamed.get(old.toLowerCase())!, spawned)
      if (!r) throw new LabError(`${donorInfo.label} has no effects to tint`)
      const [name, copies] = r
      const shot = copies.find((t) => t.name.toLowerCase() === name.toLowerCase())!
      if (sound) shot.set(P_SOUND, sound.slice())
      else shot.props = shot.props.filter(([pid]) => pid !== P_SOUND)
      const ownCopies = new Set(own.map((n) => renamed.get(n)!.toLowerCase()))
      for (const t of copies) if (!ownCopies.has(t.name.toLowerCase())) t.props = t.props.filter(([pid]) => pid !== P_SOUND)
      if (!hexAlpha(color)) for (const t of copies) t.props = t.props.filter(([pid]) => pid !== R.P_MODEL)
      out.push(...copies)
      made.set(key, name)
      copiesOf.set(name, copies)
    }
    return made.get(key)!
  })
  const values = Array.from({ length: tuning.SLOTS }, (_, s) => names[s === tuning.SLOTS - 1 ? 1 : 0])
  const donor = new R.BaseCharacter(src, p.base, T)
  const global = textureNames(src, GLOBAL)
  const defs = shaders.blocks(src.entry('Materials/Shaders/definitions.nsa'))
  const nsa = shaders.blocks(src.entry('Materials/Shaders/shaders.nsa'))
  const models = [false, true].map((alt) => {
    const copies = copiesOf.get(names[alt ? 1 : 0])!
    const wanted = new Set([...copies.flatMap((t) => R.text(t.get(R.P_MODEL)) ?? []), ...keyed(fx, effectRoots(fx, copies), 'model')].map(modelName))
    const have = new Set(ngmtool.read(base.bundleFiles(alt)[0])[1].map((m) => modelName(m.name)))
    const from = ngmtool.read(donor.bundleFiles(alt)[0])[1]
    return [...wanted].filter((n) => !have.has(n)).map((n) => {
      const m = from.find((x) => modelName(x.name) === n)
      if (!m) throw new LabError(`${donorInfo.label} draws the model ${n}, which ${donor.label}'s bundle does not have`)
      return m
    })
  })
  const borrow = [false, true].map((alt): [string, string][] => {
    const copies = copiesOf.get(names[alt ? 1 : 0])!
    const ownTextures = textureNames(src, alt ? base.altBundle : base.bundle)
    const drawn = keyed(fx, effectRoots(fx, copies), 'material').map((m) => shaders.firstWord(defs.get(m.toLowerCase())?.get('texture')) || m)
    const parts = models[alt ? 1 : 0].flatMap((m) => m.parts).flatMap((part) => ['texture', 'texture2', 'envmap'].map((k) => shaders.firstWord(nsa.get(part.toLowerCase())?.get(k))).filter(Boolean))
    const needed = [...new Map([...drawn, ...parts].map((t) => [t.toLowerCase(), t])).values()]
    return needed.filter((m) => !global.has(m.toLowerCase()) && !ownTextures.has(m.toLowerCase())).map((m) => {
      const from = [alt ? donor.altBundle : donor.bundle, donor.bundle, donor.altBundle, GREY_BUNDLE].find((b) => textureNames(src, b).has(m.toLowerCase()))
      if (!from) throw new LabError(`${donorInfo.label} draws ${m}, which no bundle the character can borrow from has`)
      return [from, m]
    })
  })
  return { donor, label: donorInfo.label, fields, values, templates: out, borrow, models }
}

// How far ahead of the eyes the head's spot is put to hide the shot's first-frame tail (PROJECTILE_LEAD).
export const lead = (p: Projectile): number => PROJECTILE_LEAD[p.base] ?? 0

function boneOf(sk: Skeleton, p: Projectile): number {
  const node = sk.node(p.bone)
  if (node === undefined) throw new LabError(`the base has no ${p.bone} bone to launch projectiles from`)
  return node
}

export function marker(render: ngmtool.Model, sk: Skeleton, p: Projectile) {
  render.attachments = [...render.attachments.filter(([, kind, index]) => !(kind === SPAWN_KIND && index === LAUNCH_INDEX)), attachment(boneOf(sk, p), SPAWN_KIND, LAUNCH_INDEX, p.position)]
}

export function launchPoint(sk: Skeleton, p: Projectile): [[number, number, number], [number, number, number]] {
  const at = sk.nodes[boneOf(sk, p)].pos
  return [[...at], [0, 1, 2].map((i) => at[i] + p.position[i]) as [number, number, number]]
}

// The effect cache a projectile swap takes: one copy, or one per costume when their colors differ.
export function bytes(p: Projectile): number {
  if (!p.on || !DONORS[p.base]) return 0
  return DONORS[p.base].bytes * (p.color.toUpperCase() === p.alt_color.toUpperCase() ? 1 : 2)
}