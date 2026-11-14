// PSP Captain America's shield throw (`base_moves.shield_throw`), with the values of the PSP's proj_captamericashield
import type { ShieldCharacter } from '../game/dol'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import * as nottool from '../mnroi/nottool'
import * as bundle from '../model/bundle'
import type { Tri } from '../model/fit'
import type { Vec3 } from '../model/glb'
import type { ShieldReturn } from '../package/imperfect'
import type { Effects } from './effects'
import * as holster from './holster'
import { FIRE, LAUNCH_INDEX, PICK, repick, respawn, SPAWN_KIND } from './projectiles'

export const FIELD = 90
export const DONOR = 'proj_elektraThrowStar' // the star's one-node model is the shield's skeleton
// The button always plays SuperRangedAttack (fn_800F0328, 0x61); Daredevil has none, so it gets RangedAttack's
export const STATES = ['rangedattack', 'superrangedattack']
export const ADDED = 'SuperRangedAttack'
// Super + Attack at range, where Daredevil throws the baton
export const FAR = 'superattackfar'
// Without one of 0x810004 (fn_80086374) the super attack never steps aside for the super ranged attack
export const RANGED_ABILITY = 0x10000
export const DAMAGE = 21
const LIFE: Record<ShieldReturn, number> = { physics: 2000, fly_back: 4000 }
const RADIUS_BODY = 0.25
// club volume on and off, hit skip, mirror skip: the projectile hits instead
const CLUB_EVENTS = [0x56, 0x57, 0x53, 0x7e]

export const templateName = (internal: string, alt: boolean) => `proj_${internal}${alt ? 'Alt' : ''}Shield`
export const modelName = (internal: string, alt: boolean) => `${internal}${alt ? 'Alt' : ''}Shield.nod`
// Own materials: the character's charlight goes dark on a projectile
export const materialName = (internal: string, alt: boolean, suffix: string) => `${internal}${alt ? '_altsh' : '_sh'}${suffix}`

// Ids from the PSP's property table, as in Global.not
const P = { TIMER: 0x04, TYPE: 0x05, MOVETYPE: 0x06, COLLIDETYPE: 0x07, RADIUS: 0x08, MODEL: 0x0a, SOUNDTYPE: 0x12, EFFECT1: 0x28, FLAGS: 0x4a, DAMAGE: 0x4b,
  DAMAGETYPE: 0x4c, DAMAGEFLAGS: 0x4d, PHYSICS: 0x5a, VELOCITY: 0x5c, ROTVEL: 0x5d, FRICTION: 0x5e, MASS: 0x61, ELASTICITY: 0x62 }

function vVec([x, y, z]: Vec3): Uint8Array {
  const v = new Uint8Array(0x20)
  const dv = new DataView(v.buffer)
  dv.setFloat32(0, x, true)
  dv.setFloat32(4, y, true)
  dv.setFloat32(8, z, true)
  return v
}

export function template(internal: string, alt: boolean, how: ShieldReturn): nottool.Template {
  const t = new nottool.Template(nottool.name32(templateName(internal, alt)), [], new Uint8Array([0]))
  t.set(0x00, nottool.vStr('_projectile'))
  t.set(P.TYPE, nottool.vInt(4))
  t.set(P.TIMER, nottool.vInt(LIFE[how]))
  // sphere body as DefCon's shot has; the PSP's 7 builds it from the mesh
  t.set(P.COLLIDETYPE, nottool.vInt(1))
  t.set(P.RADIUS, nottool.vFloat(RADIUS_BODY))
  t.set(P.MOVETYPE, nottool.vInt(3))
  t.set(P.MODEL, nottool.vStr(modelName(internal, alt)))
  t.set(P.SOUNDTYPE, nottool.vInt(2))
  t.set(P.FLAGS, nottool.vInt(0x401))
  t.set(P.DAMAGE, nottool.vInt(DAMAGE))
  t.set(P.DAMAGETYPE, nottool.vInt(0))
  t.set(P.DAMAGEFLAGS, nottool.vInt(0x210))
  t.set(P.PHYSICS, nottool.vInt(5))
  t.set(P.VELOCITY, vVec([0, 70, 0]))
  t.set(P.ROTVEL, vVec([0, 0, 0]))
  t.set(P.FRICTION, nottool.vFloat(15))
  t.set(P.MASS, nottool.vFloat(500))
  t.set(P.ELASTICITY, nottool.vFloat(0.7))
  return t
}

const TRAIL = nfxtool.TYPES.indexOf('trail'), PARTSYS = nfxtool.TYPES.indexOf('partsys'), CONTROLLER = nfxtool.TYPES.indexOf('controller')

function add(fx: Effects, type: number, body: string[], prefix: string): string {
  const same = fx.same(type, body)
  if (same) return same
  const [name] = fx.fresh(prefix)
  fx.append([new nfxtool.Block(type, name, [`${nfxtool.TYPES[type]} ${name}`, ...body, 'end'], true)])
  return name
}

// Trail and glint use only textures every match loads (Bundles/global)
export function effects(fx: Effects, internal: string): { trail: string; glint: string } {
  const prefix = `${internal.slice(0, 2).toLowerCase()}sh`
  const streak = add(fx, TRAIL, ['startcol (200,215,225,255)', 'endcol (0,150,170,220)', 'startsize 0.3', 'endsize 0', 'part_life 0.25',
    'sampledelay 0.02', 'renderradius 20', 'max_particles 15'], prefix)
  const glow = add(fx, PARTSYS, ['max_particles 1', 'part_size0 1', 'part_size1 0.5', 'type_flags2 0x80001', 'material GE_PAR_LensFlare1_blue',
    'startcol (180,180,180,180)', 'turbulence 0.0', 'gravity 0.0', 'partfadein 0.0', 'spawn_delay 0.0', 'duration 0.0', 'part_life 0.4'], prefix)
  const trail = add(fx, CONTROLLER, [`effectname ${streak}`, `effectname ${glow}`, 'renderradius -1', 'flags 0x400'], prefix)
  const glint = add(fx, PARTSYS, ['material GE_PAR_lensFlare_01_BW', 'endcol (255,255,255,255)', 'max_particles 1', 'spawn_delay 0', 'part_life 0.8',
    'part_size0 0.9', 'part_size1 0.05', 'lerpin 0.1', 'lerpout 0.9', 'partfadeout 0.8', 'rotate_speed 360', 'gravity 0', `markertype ${SPAWN_KIND}`,
    'type_flags 0x081', 'type_flags2 0x26101', 'modflags 0x800'], prefix)
  return { trail, glint }
}

export function templatesFor(internal: string, how: ShieldReturn, trail: string): nottool.Template[] {
  return [false, true].map((alt) => {
    const t = template(internal, alt, how)
    t.set(P.EFFECT1, nottool.vStr(trail))
    return t
  })
}

// Costume 1's template per tuning slot, costume 2's in the last
export const fieldValues = (internal: string, slots: number): string[] =>
  Array.from({ length: slots }, (_, s) => templateName(internal, s === slots - 1))

export function propTris(tris: Map<number, Tri[]>, bone: number): Map<number, Tri[]> {
  const out = new Map<number, Tri[]>()
  for (const [slot, list] of tris) {
    const mine = list.filter((t) => t.every(([, , , w]) => w.every(([b, x]) => b === bone || x <= 0)))
    if (mine.length) out.set(slot, mine)
  }
  return out
}

// Axes of the prop's spread, longest first (power iteration on the covariance)
function axes(points: Vec3[], center: Vec3): [Vec3, Vec3, Vec3] {
  const C = [0, 1, 2].map((r) => [0, 1, 2].map((c) => points.reduce((s, p) => s + (p[r] - center[r]) * (p[c] - center[c]), 0)))
  const found: Vec3[] = []
  for (let k = 0; k < 2; k++) {
    let v: Vec3 = k === 0 ? [1, 0.3, 0.2] : holster.cross(found[0], [0.3, 1, 0.1])
    for (let i = 0; i < 64; i++) {
      let w = holster.apply(C as ngbtool.Mat3, v)
      for (const f of found) w = holster.sub(w, holster.scale(f, holster.dot(w, f)))
      if (holster.norm(w) < 1e-12) break
      v = holster.unit(w)
    }
    found.push(holster.unit(v))
  }
  return [found[0], found[1], holster.unit(holster.cross(found[0], found[1]))]
}

// The prop as a one-node model about its middle, thinnest axis up
export function model(star: ngmtool.Model, prop: Map<number, Tri[]>, parts: string[], nidx: bundle.NormalIndex, name: string,
  meshFlags: [number, number, number], size: number): ngmtool.Model {
  const points = [...prop.values()].flat().flatMap((t) => t.map(([p]) => p))
  const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])))
  const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3
  const [a, b, up] = axes(points, center)
  // longest spread along x, next along y (the flight), thinnest up
  const R: ngbtool.Mat3 = [a, b, up]
  const slots = [...prop.keys()].sort((x, y) => x - y)
  const local = new Map(slots.map((slot, i) => [i, prop.get(slot)!.map((t) => t.map(([p, n, uv]) => [
    holster.scale(holster.apply(R, holster.sub(p, center)), size), holster.apply(R, n), uv, [[0, 1]]]) as Tri)]))
  return bundle.renderModel(star, local, nidx, name, slots.map((s) => parts[s]), meshFlags)
}

// flames.attachment's form, not imported so moves.ts can use this file
export function marker(render: ngmtool.Model, bone: number, center: Vec3, bind: Vec3) {
  const [x, y, z] = holster.sub(center, bind)
  render.attachments = [...render.attachments.filter(([, kind, index]) => !(kind === SPAWN_KIND && index === LAUNCH_INDEX)),
    [bone, SPAWN_KIND, LAUNCH_INDEX, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]]]
}

// Launches field 90 from the prop's marker, without the club's events
export function throwRecord(rec: ngbtool.Record): ngbtool.Record {
  const kept = { ...rec, events: rec.events.filter(([, t]) => !CLUB_EVENTS.includes(t)) }
  return respawn(repick(kept, 0), LAUNCH_INDEX)
}

export const noLaunch = (rec: ngbtool.Record): ngbtool.Record =>
  rec.events.some(([, t]) => t === FIRE) ? { ...rec, events: rec.events.filter(([, t]) => t !== FIRE && t !== PICK) } : rec

export const CHEST = 1.1
export const RADIUS = 1.0
const RETURN_SPEED = 30
export const THROW_SPEED = 70

export function character(internal: string, how: ShieldReturn, glint: string, bone: number, bind: Vec3, size: number): ShieldCharacter {
  return {
    internal,
    templates: [templateName(internal, false), templateName(internal, true)],
    glint,
    bone,
    flyBack: how === 'fly_back',
    marker: LAUNCH_INDEX,
    chest: CHEST * size,
    radius: RADIUS * size,
    minMs: 200,
    speed: RETURN_SPEED,
    out: 20,
    outMs: 600,
    lifeMs: LIFE[how] + 1000,
    blocking: 0.8,
    hit: 0.9,
    bind: holster.scale(bind, size),
    throwSpeed: THROW_SPEED,
  }
}
