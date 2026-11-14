// Effect sets in place of a base's own: Doctor Doom's, from the PSP's game.ffx.
import { LabError } from '../errors'
import { encodeLatin1 } from '../bytes'
import * as gxtex from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngbtool from '../mnroi/ngbtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Tri } from '../model/fit'
import type { Skeleton } from '../model/skeleton'
import { RgbaImage } from '../image/rgba'
import { text, type Templates } from '../game/roster'
import type { Effects } from './effects'
import { OWN_EFFECTS } from './effectslots'
import * as projectiles from './projectiles'
import * as templates from './templates'
import type * as tuning from './tuning'

export const ARC_KIND = 64, PALM_KIND = 65, JET_KIND = 66 // PSP's 24, 50 and 19, unused by any GC model/effect
export const EYE_KIND = 20 // the game's eye markers
const EFFECT_ON = 0x48, EFFECT_OFF = 0x49
const FPS = 30

type Row = [number, number, number]
// PSP marker rotations (rows), as on the GC's own hand markers
const ARM: Row[] = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
const JET: Row[] = [[1, 0, 0], [0, -0.244, -0.97], [0, 0.97, -0.244]]
const FLAT: Row[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

// A PSP marker on a GC bone (the PSP rig is the GC male's).
interface MarkerSpec {
  kind: number
  index: number
  role: string
  at: Row
  rot: Row[]
  fit: 'body' | 'arm' | 'ring' | 'back'
}

type Hand = 'right' | 'left'
// GameCube models' hand markers: kind 21 where a shot leaves, kind 7 where Johnny Ohm's bolts end their beams
const HANDS: Record<Hand, { spawn: number; beam: number }> = { right: { spawn: 1, beam: 0 }, left: { spawn: 2, beam: 1 } }
const BEAM_KIND = 7

export interface SetEvent {
  ms: number
  on: boolean
  effect: string
}

export interface EffectSet {
  key: string
  label: string
  parts: string[]
  moves: string
  blocks: string
  effect1: string
  effect1Label: string
  // the base's own effects the set leaves (shots, move effects) take it unless a full tint colors them
  color: string
  hand: Hand | null
  power: string[] // roots the 'power' tint level copies;
  fields: [number, string][]
  fired: string[] // effects the animations start, for event slots
  events: [string, number, SetEvent[]][]
  castid: [string, string]
  markers: MarkerSpec[]
  texture: { name: string; size: number; data: string }
}

const block = (ms: number, on: boolean): SetEvent => ({ ms, on, effect: 'doomBlock' })
const charge = (ms: number, on: boolean): SetEvent => ({ ms, on, effect: 'doomHandChargeR' })
const repulsor = [block(120, true), block(810, false)]
const peak = [block(122.1, true), block(570, false)]

const ring = (role: string, x: number, at: [number, number][], first: number): MarkerSpec[] =>
  at.map(([y, z], i) => ({ kind: ARC_KIND, index: first + i, role, at: [x, y, z], rot: ARM, fit: 'ring' }))

export const DOOM: EffectSet = {
  key: 'doom',
  label: "Doctor Doom's (PSP)",
  parts: ['an orange glow on the forearms and palms in power mode', 'a full-body glow while super-blocking', 'side jets in flight',
    'electric arcs on the forearms in block, ranged and super attacks', 'a mask glow'],
  moves: '',
  blocks: `
billboard doomMaskGlow
material GE_PAR_lensFlare_01_BW
markertype 20
change_speed 0
width 0.13
height 0.1
startcol (130,255,0,85)
endcol (130,255,0,85)
type_flags 0x1
end
controller doomPowerOn
flags 0x60000000
effectname doomDarkGauntletL
effectname doomDarkGauntletR
effectname doomPowerLight
end
controller doomFlyFX
type_flags 0x40
flags 0x60000000
effectname doomSideJetGlw
markertype 66
marker_index 0
effectname doomSideJetGlw
markertype 66
marker_index 1
effectname doomSideJet
markertype 66
marker_index 0
effectname doomSideJet
markertype 66
marker_index 1
end
controller doomHandChargeR
type_flags 0x2
flags 0x60000000
effectname doomHandSuck
markertype 65
marker_index 1
effectname doomElecGauntletR
end
controller doomBlock
flags 0x60000000
effectname doomElecGauntletR
end
controller doomSuperBlock
flags 0x60000000
effectname doomDarkBody
effectname doomDarkBody2
effectname doomDarkSpots
markertype 31
marker_index 2
end
controller doomDarkGauntletL
effectname doomDarkArm
markertype 64
marker_index 10
effectname doomDarkArm2
markertype 64
marker_index 10
effectname doomDarkSpots
markertype 64
marker_index 10
effectname doomDarkPalm
markertype 65
marker_index 0
end
controller doomDarkGauntletR
effectname doomDarkArm
markertype 64
marker_index 11
effectname doomDarkArm2
markertype 64
marker_index 11
effectname doomDarkSpots
markertype 64
marker_index 11
effectname doomDarkPalm
markertype 65
marker_index 1
end
light doomPowerLight
flags 0x40000000
startcol (255,200,77,234)
size 6
intensity 0.6
type_flags 0x1
end
partsys doomSideJetGlw
material GE_PAR_lensFlare_01_BW
flags 0x60000000
max_particles 2
partfadeout 0.1
part_life 0.2
part_size1 0.4
startcol (30,255,50,0)
endcol (30,255,50,0)
type_flags 0x80
type_flags2 0x21
end
controller doomSideJet
effectname doomSideJet0
effectname doomSideJet1
effectname doomSideJet2
end
controller doomHandSuck
effectname doomBeamSuckQuick
effectname doomBeamSuckQuick
effectname doomBeamSuckQuick
effectname doomBeamSuckQuick
effectname doomBeamSuckQuick
end
controller doomElecGauntletR
effectname doomElecArc
markertype 64
effectname doomElecArc
markertype 64
end
actorglow doomDarkBody
material GE_par_DoomPwrup_01
flags 0x60000000
part_size0 0.35
part_size1 0.35
width0 0.15
width1 1
startcol (255,100,0,0)
endcol (255,100,0,0)
type_flags 0x501
rotate_speed 0.08
speed 0.05
lerpspeed 6
fadein 0.25
fadeout 0.75
scale 2
end
actorglow doomDarkBody2
material GE_par_DoomPwrup_01
flags 0x60000000
part_size0 0.28
part_size1 0.28
width0 0.1
width1 0.7
startcol (255,218,61,0)
endcol (255,218,61,0)
type_flags 0x501
rotate_speed 0.05
speed 0.05
lerpspeed 7
fadein 0.25
fadeout 0.75
scale 3
end
partsys doomDarkSpots
material GE_par_DoomPwrup_01
flags 0x60000000
max_particles 16
mass 1
drag 1
partfadeout 0.9
part_life 0.65
part_size0 0.06
startcol (255,100,0,0)
endcol (255,100,0,0)
type_flags 0x1000001
type_flags2 0x480000
velocity (0,0,1)
minspread 1
maxspread 1
area_type 4
turbulence 0
gravity -1
end
partcylinder doomDarkArm
material GE_par_DoomPwrup_01
max_particles 2
part_life -1
part_size0 0.27
part_size1 0.3
partfadein 0.25
partfadeout 0.75
rotate_speed 0.1
startcol (255,255,0,0)
endcol (150,255,0,0)
type_flags 0x8
flags 0x60000000
end
partcylinder doomDarkArm2
material GE_par_DoomPwrup_01
max_particles 4
part_life -1
part_size0 0.22
part_size1 0.25
partfadein 0.25
partfadeout 0.75
rotate_speed 0.4
startcol (255,218,61,0)
endcol (255,218,61,0)
type_flags 0x8
flags 0x60000000
end
partcylinder doomDarkPalm
material GE_par_DoomPwrup_01
max_particles 2
part_life -1
part_size0 0.19
part_size1 0.19
partfadein 0.25
partfadeout 0.75
rotate_speed 0.08
startcol (255,255,0,0)
endcol (150,255,0,0)
type_flags 0x8
flags 0x60000000
end
dyngeom doomSideJet0
material GE_PAR_ElectricParticles
flags 0x60000000
angle 180
scale 0
radius0 0.05
radius1 0.05
fadein 0.6
fadeout 0.7
startcol (255,255,0,0)
endcol (255,255,0,0)
max_particles 4
max_particles2 4
length0 0.4
length1 0.4
area_x 2.2
area_y 2.2
force -10
type_flags 0x2143c
end
dyngeom doomSideJet1
material GE_PAR_ElectricParticles
flags 0x60000000
angle 180
scale 0
radius0 0.05
radius1 0.05
fadein 0.6
fadeout 0.7
startcol (255,255,255,255)
endcol (255,255,255,255)
max_particles 4
max_particles2 4
length0 0.5
length1 0.5
area_x 2.2
area_y 2.2
force -10
type_flags 0x2043c
end
partsys doomSideJet2
material GE_par_DoomPwrup_01
flags 0x60000000
max_particles 8
partfadeout 2
part_life 0.3
part_size0 0.3
part_size1 0.4
width 0.2
startcol (255,255,100,0)
endcol (255,255,100,0)
rotate_speed 33
type_flags 0x1008091
type_flags2 0x20090001
velocity (0,1,0)
maxspread 0
modsize (1.5,1.5,1.5)
gravity 0
end
energybeam doomBeamSuckQuick
part_size0 2
part_size1 2
turbulence 0.05
type_flags 0xc2490
renderradius 4
height 0.1
offset (3,3,3)
max_particles 6
endcol (180,255,100,0)
ratio 5
ratio2 5
part_life 0.2
startcol (180,255,100,0)
fadeout 0.9
length0 2
fadein 0.7
duration 0.2
force 100
width 0.3
end
energybeam doomElecArc
part_size0 1
part_size1 1
turbulence 0.005
type_flags 0x30a88410
renderradius 5
height 0.03
max_particles 6
endcol (180,218,60,0)
ratio 10
ratio2 2
part_life 0.5
startcol (100,218,60,0)
fadeout 0.7
force 100
scale 0.1
flags2 0x400
end
`,
  effect1: 'doomMaskGlow',
  effect1Label: 'his mask glow',
  color: '#DA3C00', // PSP shot's doomShotBeam
  hand: 'right',
  power: ['doomMaskGlow', 'doomPowerOn'],
  fields: [[98, 'doomPowerOn'], [99, ''], [101, 'doomFlyFX'], [102, ''], [203, 'doomSuperBlock'], [204, '']],
  fired: ['doomBlock', 'doomHandChargeR'],
  events: [
    ['BlockStart', 15, [block(300, true)]],
    ['Block', 57, [block(0, true)]],
    ['BlockEnd', 15, [block(30, false)]],
    ['RangedAttack', 45, repulsor],
    ['SuperRangedAttack', 45, repulsor],
    ['SuperLowAttack', 45, repulsor],
    ['SuperAttack3', 45, [block(300, true), block(1020, false)]],
    ['SuperAttackStomp', 60, [block(229.2, true), block(649.2, false)]],
    ['SuperRiseAttack', 28, [block(90, true), block(420, false)]],
    ['SuperJumpAttack', 80, peak],
    ['SuperJumpAttackDesc', 80, peak],
    ['SuperAirRangedAttack', 30, [charge(60, true), charge(660, false)]],
    ['RunJump', 36, [charge(150, true), charge(780, false)]],
  ],
  castid: ['DRDOOM', 'ALT_DRDOOM'],
  markers: [
    { kind: JET_KIND, index: 0, role: 'pelvis', at: [0.072, -0.144, -0.011], rot: JET, fit: 'back' },
    { kind: JET_KIND, index: 1, role: 'pelvis', at: [-0.067, -0.144, -0.011], rot: JET, fit: 'back' },
    { kind: ARC_KIND, index: 0, role: 'chest', at: [0, 0.004, 0.247], rot: FLAT, fit: 'body' },
    { kind: EYE_KIND, index: 1, role: 'head', at: [-0.033, 0.15, 0.046], rot: FLAT, fit: 'body' },
    { kind: EYE_KIND, index: 2, role: 'head', at: [0.033, 0.15, 0.046], rot: FLAT, fit: 'body' },
    ...ring('L.forearm', -0.043, [[0.099, -0.02], [-0.001, 0.102], [-0.12, -0.019], [0.002, -0.098]], 1),
    ...ring('R.forearm', 0.043, [[0.083, -0.02], [-0.013, 0.105], [-0.142, -0.009], [-0.019, -0.119]], 5),
    { kind: ARC_KIND, index: 9, role: 'R.hand', at: [0.097, 0.016, -0.011], rot: ARM, fit: 'arm' },
    { kind: ARC_KIND, index: 5, role: 'L.hand', at: [-0.113, 0.018, -0.025], rot: ARM, fit: 'arm' },
    { kind: ARC_KIND, index: 10, role: 'L.hand', at: [0.116, 0.001, 0], rot: ARM, fit: 'arm' },
    { kind: ARC_KIND, index: 11, role: 'R.hand', at: [-0.121, 0, 0], rot: ARM, fit: 'arm' },
    { kind: PALM_KIND, index: 0, role: 'L.hand', at: [-0.113, 0.018, -0.025], rot: ARM, fit: 'arm' },
    { kind: PALM_KIND, index: 1, role: 'R.hand', at: [0.097, 0.016, -0.011], rot: ARM, fit: 'arm' },
  ],
  // GE_par_DoomPwrup_01: the PSP draws it adding color by its alpha, so its grey is multiplied by the alpha for the GC's add shader
  texture: { name: 'GE_par_DoomPwrup_01', size: 64, data: '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' },
}

export const SETS: Record<string, EffectSet> = { doom: DOOM }

export function setOf(key: string): EffectSet | null {
  if (key === 'base') return null
  const s = SETS[key]
  if (!s) throw new LabError(`there is no effect set ${JSON.stringify(key)}`)
  return s
}

const parsedSets = new WeakMap<EffectSet, nfxtool.Block[]>()

function parsed(set: EffectSet): nfxtool.Block[] {
  let out = parsedSets.get(set)
  if (!out) {
    out = nfxtool.blocks(nfxtool.readNfx(encodeLatin1(set.blocks.trim().split('\n').join('\r\n') + '\r\n')))
    parsedSets.set(set, out)
  }
  return out
}

// Every root the set names, for a full tint.
export const roots = (set: EffectSet): string[] => [set.effect1, ...set.fields.map(([, n]) => n).filter(Boolean), ...set.fired]

export const replaced = (set: EffectSet): Set<number> => new Set(set.fields.map(([fid]) => fid))

// Appends the set's blocks the effect file doesn't have yet (characters with the same set share them).
export function add(fx: Effects, set: EffectSet) {
  const missing = parsed(set).filter((b) => !fx.has(b.name)).map((b) => new nfxtool.Block(b.type, b.name, [...b.lines], b.ended))
  if (missing.length) fx.append(missing)
}

// The effect cache the set's blocks take.
export function bytes(set: EffectSet): number {
  return nfxtool.cacheUse(parsed(set))[1]
}

export function textureImage(set: EffectSet, template: gxtex.TplImage, header: (t: gxtex.TplImage, w: number, h: number) => number[]): gxtex.TplImage {
  const n = set.texture.size
  const grey = Uint8Array.from(atob(set.texture.data), (c) => c.charCodeAt(0))
  const im = new RgbaImage(n, n)
  grey.forEach((v, i) => im.data.set([v, v, v, 255], i * 4))
  return new gxtex.TplImage(header(template, n, n), gxtex.encode(gxtex.CMPR, im.bytes(), n, n))
}

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i])
const len = (v: number[]) => Math.hypot(...v)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[s.length >> 1] : null
}

// The male rig's lengths and Doom's mesh measurements the markers are fitted to.
const MALE = { forearm: 0.27, torso: 0.215, ring: 0.06, back: 0.163 }

// How far the mesh around bone from..to sits from its axis, by the bones its vertices follow first.
function limbRadius(tris: Map<number, Tri[]>, bones: Set<number>, from: number[], to: number[]): number | null {
  const axis = sub(to, from), l = len(axis)
  if (!l) return null
  const d: number[] = []
  for (const list of tris.values()) {
    for (const tri of list) {
      for (const [pos, , , w] of tri) {
        if (!w.length || !bones.has(w[0][0])) continue
        const p = sub(pos, from)
        const t = (p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]) / (l * l)
        if (t < 0 || t > 1) continue
        d.push(len(sub(p, axis.map((a) => a * t))))
      }
    }
  }
  return median(d)
}

// The mesh's back (lowest y) at height z near x, from the torso's vertices.
function backAt(tris: Map<number, Tri[]>, bones: Set<number>, x: number, z: number): number | null {
  let back: number | null = null
  for (const list of tris.values()) {
    for (const tri of list) {
      for (const [pos, , , w] of tri) {
        if (!w.length || !bones.has(w[0][0]) || Math.abs(pos[0] - x) > 0.05 || Math.abs(pos[2] - z) > 0.08) continue
        if (back === null || pos[1] < back) back = pos[1]
      }
    }
  }
  return back
}

interface Placed {
  kind: number
  index: number
  node: number
  at: number[]
  rot: Row[]
}

// The set's markers on the render model; returns the roles the skeleton lacks.
export function markers(render: ngmtool.Model, sk: Skeleton, tris: Map<number, Tri[]>, set: EffectSet, skip: number[] = []): string[] {
  const [all, missing] = placements(sk, tris, set)
  const placed = all.filter((p) => !skip.includes(p.kind))
  const kinds = new Set(placed.map((p) => p.kind))
  render.attachments = render.attachments.filter(([, kind]) => !kinds.has(kind))
  for (const { kind, index, node, at, rot: r } of placed) render.attachments.push([node, kind, index, [...r[0], 0, ...r[1], 0, ...r[2], 0, at[0], at[1], at[2], 1]])
  return missing
}

// The set's markers fitted to the skeleton's bones and the mesh around them.
function placements(sk: Skeleton, tris: Map<number, Tri[]>, set: EffectSet): [Placed[], string[]] {
  const missing: string[] = [], placed: Placed[] = []
  const pos = (role: string) => {
    const n = sk.node(role)
    return n === undefined ? null : sk.nodes[n].pos
  }
  const pelvis = pos('pelvis'), chest = pos('chest')
  const torso = pelvis && chest ? (chest[2] - pelvis[2]) / MALE.torso : 1
  const arm = (side: string) => {
    const f = pos(`${side}.forearm`), h = pos(`${side}.hand`)
    return f && h ? len(sub(h, f)) / MALE.forearm : torso
  }
  const nodesOf = (...roles: string[]) => new Set(roles.flatMap((r) => sk.node(r) ?? []))
  const rings = new Map<string, number>()
  const ringScale = (side: string) => {
    if (!rings.has(side)) {
      const f = pos(`${side}.forearm`), h = pos(`${side}.hand`)
      const r = f && h ? limbRadius(tris, nodesOf(`${side}.forearm`, `${side}.forearm_twist`), f, h) : null
      rings.set(side, r ? Math.min(2, Math.max(0.5, r / MALE.ring)) : arm(side))
    }
    return rings.get(side)!
  }
  for (const m of set.markers) {
    const node = sk.node(m.role)
    if (node === undefined) {
      if (!missing.includes(m.role)) missing.push(m.role)
      continue
    }
    const side = m.role.slice(0, 1)
    let at: number[]
    if (m.fit === 'body') at = m.at.map((v) => v * torso)
    else if (m.fit === 'arm') at = m.at.map((v) => v * arm(side))
    else if (m.fit === 'ring') at = [m.at[0] * arm(side), m.at[1] * ringScale(side), m.at[2] * ringScale(side)]
    else {
      const p = sk.nodes[node].pos, x = p[0] + m.at[0] * torso, z = p[2] + m.at[2] * torso
      const back = backAt(tris, nodesOf('pelvis', 'spine', 'chest'), x, z)
      const depth = back !== null && back < p[1] ? Math.min(2, Math.max(0.5, (p[1] - back) / MALE.back)) : torso
      at = [m.at[0] * torso, m.at[1] * depth, m.at[2] * torso]
    }
    placed.push({ kind: m.kind, index: m.index, node, at, rot: m.rot })
  }
  return [placed, missing]
}

// A record of state with the set's events at the PSP's times (scaled to the record's length).
export function withEvents(set: EffectSet, state: string, rec: ngbtool.Record, ks: Map<string, number>, keep: boolean): ngbtool.Record {
  const plan = set.events.find(([s]) => s.toLowerCase() === state.toLowerCase())
  const kept = keep ? rec.events : rec.events.filter(([, t]) => !OWN_EFFECTS.has(t))
  if (!plan) return kept.length === rec.events.length ? rec : { ...rec, events: kept }
  const [, frames, evs] = plan
  const added: ngbtool.Event[] = evs.flatMap((e) => {
    const k = ks.get(e.effect.toLowerCase())
    if (k === undefined) return []
    const f = Math.min(rec.length, Math.round(((e.ms * FPS) / 1000) * (rec.length / frames) * 100) / 100)
    return [[f, e.on ? EFFECT_ON : EFFECT_OFF, k, 0] as ngbtool.Event]
  })
  return { ...rec, events: [...kept, ...added].sort((a, b) => a[0] - b[0]) }
}

export interface ShotPlan {
  to: Map<number, number> // projectile index to beam end
  spawn: number
  beams: (number | null)[] // hand marker the projectile beams end on (null: none, or both hands)
  beam: number
}

function beamEnd(fx: Effects, names: string[]): number | null {
  const ends = new Set<number>()
  for (const b of fx.tree(names)) {
    let kind: number | null = null
    for (const [key, value] of b.lines.slice(1).map(nfxtool.tokens)) {
      if (key === 'effectname') kind = null
      else if (key === 'endmarker') kind = Number(value)
      else if (key === 'endmarker_id' && kind === BEAM_KIND) ends.add(Number(value))
    }
  }
  return ends.size === 1 ? [...ends][0] : null
}

// How the base's shots move to the set's hand.
export function shotPlan(set: EffectSet, tun: tuning.Tuning, T: Templates, fx: Effects): ShotPlan | null {
  if (!set.hand) return null
  const { spawn, beam } = HANDS[set.hand]
  const beams = projectiles.FIELDS.map((fid) => {
    const t = tun.value(fid) as string
    return t ? beamEnd(fx, templates.chain(T, t).flatMap((c) => c.props.map(([, v]) => text(v) ?? ''))) : null
  })
  const mine = beams.indexOf(beam)
  const to = new Map(mine < 0 ? [] : beams.flatMap((b, i): [number, number][] => (b !== null && b !== beam ? [[i, mine]] : [])))
  return { to, spawn, beams, beam }
}

// A one-handed shot leaves the set's hand: the projectile whose beam ends there, launched from that hand when spawn.
export function handShot(rec: ngbtool.Record, plan: ShotPlan, spawn: boolean): ngbtool.Record {
  const at = projectiles.pickAt(rec)
  if (at === null) return rec
  const to = plan.to.get(at)
  const out = to === undefined ? rec : projectiles.repick(rec, to)
  const ends = plan.beams[to ?? at]
  return spawn && (ends === plan.beam || plan.beams.every((b) => b === null)) ? projectiles.respawn(out, plan.spawn) : out
}