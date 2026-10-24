// Moves taken from other bases (manifest `moves`).
// The character's own copies of the base's motion set and bundles take the other base's lines and records, into the same bundles.
// The thrower's records are remapped onto the base's skeleton by bone name; the victim's are already on the opponent's. The game keeps the first of two records with one name (fn_8019E7D4), so a changed record gets a new one.
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '../bytes'
import { LabError } from '../errors'
import * as R from '../game/roster'
import type { GameSource } from '../game/source'
import * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import * as nmstool from '../mnroi/nmstool'
import { loadTable } from '../model/skeleton'
import type { MoveEffect, MoveLines } from '../package/imperfect'
import * as basemoves from './basemoves'
import type { Effects } from './effects'
import { effectNames, OWN_EFFECTS, Slots } from './effectslots'
import * as tuning from './tuning'

export const SLOTS = ['', '-t0', '-t1', '-t2']
const VICTIM = /victim/i

// Every state the 18 characters' motion sets and their base sets use; FinishingMove is left out (it is a cutscene).
const STATES = (
  'Fall Flail FlailLand RunLand Turn180 StrafeLeft StrafeRight StrafeBack ProneIdle StandToRun StandToRunLeft StandToRunRight StandToRunBack ' +
  'BlockHardRedirect BlockSoftRedirect BlockBreakZero BlockBreakLight BlockBreakMedium BlockBreakLarge AttackHardRedirect AttackSoftRedirect ' +
  'HitReactStab HitReactGroin HitReactShock HitReactLight HitReactLightLeft HitReactLightRight HitReactMedium HitReactMediumLeft HitReactMediumRight ' +
  'HitReactLarge HitReactLargeLeft HitReactLargeRight HitReactUp LowReactMedium LowReactLarge BlockreactZero BlockreactLight BlockreactMedium ' +
  'BlockReactLarge AirReactMedium AirReactLarge ProneReactMedium ProneReactLarge HugeReact HugeReactLoop HugeReactLoopDesc HugeReactFloor ' +
  'HugeReactWall HugeReact2 HugeReactLoop2 HugeReactFloor2 HugeReactWall2 HugeReact3 HugeReactLoop3 HugeReactLoop3Desc HugeReactFloor3 ' +
  'HugeReactWall3 HugeReact4 HugeReactLoop4 HugeReactLoop4Desc HugeReactFloor4 HugeReactWall4 HugeReact5 HugeReactLoop5 HugeReactLoop5Desc ' +
  'HugeReactFloor5 HugeReactWall5 HugeReactUp HugeReactUpLoop HugeReactUpFloor HugeReactUpWall ThrowMiss CarryLiftSmall CarryIdleSmall ' +
  'CarryWalkSmall CarryRunSmall CarryTossSmall CarryFallSmall CarryLandSmall CarryLiftLarge CarryIdleLarge CarryWalkLarge CarryTossLarge ' +
  'CarryFallLarge CarryLandLarge SwatObject WieldPickupWall WieldPickupFloor WieldStand WieldSwing WieldSwing2 WieldThrow WieldJump ' +
  'WieldJumpAttack WieldStomp WieldWalk WieldRun WieldLand PullUp ConstraintPose CatchObjectLarge CatchObject CarryLiftMiss CarryTossSmash ' +
  'ProneGetup HugeReactAir HugeReactAirLoop HugeReactAirLoopDesc HugeReactAirWall HugeReactAirFloor CarryJumpLarge CarryJumpSmall ' +
  'CarryRunJumpLarge CarryRunJumpSmall CarryRunJumpLandSmall CarryRunJumpLandLarge HitReactFire WieldLiftMiss CarryRunLarge WieldFall ' +
  'WieldTakeOff WieldTakeOffLarge WieldFly WieldFlyLarge Walk Run Stand Jump RunJump Land WalkLand Attack1 Attack2 AttackFar AttackStomp ' +
  'JumpAttackPeak WallAttackStart WallAttackEnd Block BlockStart BlockEnd HugeReactFloorRecover2 HugeReactWallRecover2 HugeReactUpFloorRecover ' +
  'HugeReactUpWallRecover SuperJump SuperLand JumpAttackDesc JumpAttackDescLand WieldFlySwing SuperRun SuperRunJump PowerOn PowerOff ' +
  'PowerStand LowAttack RiseAttack SuperAttack1 SuperAttack2 SuperAttackFar SuperAttackStomp SuperLowAttack SuperRiseAttack JumpAttackPeak2 ' +
  'SuperJumpAttack SuperJumpAttackDesc SuperJumpAttackDescLand SuperBlock DodgeForward DodgeLeft DodgeRight DodgeBack DodgeExitAttack ' +
  'DodgeExitSuperAttack HugeReactFloorRecover HugeReactWallRecover Throw ThrowFemale ThrowBrute SuperThrow SuperThrowFemale SuperThrowBrute ' +
  'ThrowVictim ThrowVictimFemale ThrowVictimBrute SuperThrowVictim SuperThrowVictimFemale SuperThrowVictimBrute AirThrow AirThrowFemale ' +
  'AirThrowBrute AirThrowVictim AirThrowVictimFemale AirThrowVictimBrute SuperAirThrow SuperAirThrowFemale SuperAirThrowBrute ' +
  'SuperAirThrowVictim SuperAirThrowVictimFemale SuperAirThrowVictimBrute LedgeGrab LedgeHang AirThrowVictimFlyer SuperAirThrowVictimFlyer ' +
  'Attack3 SuperAttack3 SuperWallAttackStart SuperWallAttackEnd WallRunLeft WallRunRight WallRunUp WallJumpOff WallJumpToWall WallRunJumpOff ' +
  'WallClimbDown WallClimbUp WallClimbLeft WallClimbRight WallClimbStand IKClaws HugeReactAirFloorRecover HugeReactAirWallRecover ' +
  'HugeReactFloorRecover3 HugeReactFloorRecover4 HugeReactFloorRecover5 HugeReactWallRecover3 HugeReactWallRecover4 HugeReactWallRecover5 ' +
  'WireExtend WireSwing WireSwingJump WireAttack SuperWireAttack SuperSwingAttack SwingAttack Special1 Attack4 SuperAttack4 SuperWallAttackLoop ' +
  'DodgeForwardLoop DodgeBackLoop SuperRangedAttack FlyUp FlyDown FlyTakeoff AirAttack AirAttackFar RangedAttack SuperAirRangedAttack ' +
  'HugeReactAirRecover HugeReactUpAirRecover FlyCarryTossSmall FlyCarrySmall FlyCarryTakeoffSmall FlyCarryTossLarge FlyCarryLarge ' +
  'FlyCarryTakeoffLarge IKFlyLeft IKFlyRight FlyIdle SuperRunLand WirePull WallClimbRangedAttack IKAimUp IKAimDown WallAttackLoop ' +
  'HugeReactAirRecover2 LowEnergyStun WieldThrowLarge WirePullFly CatchObjectFly'
).split(' ')

const throwing = (s: string) => [s, s + 'Female', s + 'Brute', s + 'Victim', s + 'VictimFemale', s + 'VictimBrute']
// States that play one after another, or are one throw against each body class, change together.
const GROUPS: [string, string[]][] = [
  ['Throw', throwing('Throw')],
  ['SuperThrow', throwing('SuperThrow')],
  ['AirThrow', [...throwing('AirThrow'), 'AirThrowVictimFlyer']],
  ['SuperAirThrow', [...throwing('SuperAirThrow'), 'SuperAirThrowVictimFlyer']],
  ['JumpAttackDesc', ['JumpAttackDesc', 'JumpAttackDescLand']],
  ['SuperJumpAttackDesc', ['SuperJumpAttackDesc', 'SuperJumpAttackDescLand']],
  ['WallAttackStart', ['WallAttackStart', 'WallAttackLoop', 'WallAttackEnd']],
  ['SuperWallAttackStart', ['SuperWallAttackStart', 'SuperWallAttackLoop', 'SuperWallAttackEnd']],
  ['Block', ['BlockStart', 'Block', 'BlockEnd']],
  ['DodgeForward', ['DodgeForward', 'DodgeForwardLoop']],
  ['DodgeBack', ['DodgeBack', 'DodgeBackLoop']],
]
const LABELS: Record<string, string> = {
  Throw: 'Throw', SuperThrow: 'Super throw (the R + X grab)', AirThrow: 'Air throw', SuperAirThrow: 'Super air throw',
  SuperAttackFar: 'Super attack far (R + attack at range)', JumpAttackDesc: 'Jump attack descending', SuperJumpAttackDesc: 'Super jump attack descending',
  WallAttackStart: 'Wall attack', SuperWallAttackStart: 'Super wall attack', Block: 'Block', DodgeForward: 'Dodge forward', DodgeBack: 'Dodge back',
}

export const CATEGORIES = ['Attacks', 'Super attacks', 'Air and wall attacks', 'Ranged attacks', 'Throws', 'Defence', 'Reactions', 'Carrying and weapons', 'Movement and other']

function category(id: string): string {
  if (/Ranged/.test(id)) return 'Ranged attacks'
  if (/Wield|Carry|Swat|Catch/.test(id)) return 'Carrying and weapons'
  if (/Throw/.test(id)) return 'Throws'
  if (/Redirect|Block|Dodge(?!Exit)/.test(id)) return 'Defence'
  if (/JumpAttack|WallAttack|AirAttack|SwingAttack|WireAttack/.test(id)) return 'Air and wall attacks'
  if (/^Super.*Attack|SuperAttack/.test(id)) return 'Super attacks'
  if (/Attack/.test(id)) return 'Attacks'
  if (/React|Flail|Stun|Getup/.test(id)) return 'Reactions'
  return 'Movement and other'
}

function words(id: string): string {
  const w = id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(' ')
  return w.map((x, i) => (i === 0 || /^[A-Z]{2,}$/.test(x) ? x : x.toLowerCase())).join(' ')
}

export interface Move {
  id: string
  label: string
  category: string
  states: string[]
}

export const MOVES: Move[] = (() => {
  const grouped = new Map<string, [string, string[]]>()
  for (const g of GROUPS) for (const s of g[1]) grouped.set(s, g)
  const out: Move[] = [], done = new Set<string>()
  for (const s of STATES) {
    const [id, states] = grouped.get(s) ?? [s, [s]]
    if (done.has(id)) continue
    done.add(id)
    out.push({ id, label: LABELS[id] ?? words(id), category: category(id), states })
  }
  return out
})()
export const MOVE_IDS = new Map(MOVES.map((m) => [m.id, m]))

export function motionSetName(internal: string): string {
  return `${internal}.nms`
}

export function motionSetOf(base: R.BaseCharacter): string {
  const set = R.text(base.t.prop(base.act, R.P_MOTIONSET))
  if (!set) throw new LabError(`${base.label} has no motion set`)
  return set
}

export const stemOf = (set: string) => set.replace(/\.nms$/i, '').toLowerCase()

// The motions the game ends up with: the base set's, then the set's own, dropping any whose animation no bundle has.
function resolved(src: GameSource, own: nmstool.MotionSet, has: (anim: string) => boolean): Map<string, nmstool.Motion> {
  const out = new Map<string, nmstool.Motion>()
  const based = own.basedon && src.has(`Motions/${own.basedon}.nms`) ? nmstool.parse(src.entry(`Motions/${own.basedon}.nms`)).motions() : new Map<string, nmstool.Motion>()
  for (const list of [based, own.motions()]) for (const [k, m] of list) if (has(m.anim)) out.set(k, m)
  return out
}

// Each base's animations by lowercased state, and its super throw range, for the Moves page.
export interface BaseMotions {
  body: string
  motions: Record<string, string>
  range: number
}
export type Catalog = Record<string, BaseMotions>

export function catalog(src: GameSource): Catalog {
  const t = new R.Templates(src.entry('Misc/Global.not'))
  const out: Catalog = {}
  for (const key of R.keys()) {
    try {
      const base = new R.BaseCharacter(src, key, t)
      const set = motionSetOf(base), stem = stemOf(set)
      const names = new Set<string>()
      for (const slot of SLOTS) {
        if (src.has(`Bundles/${stem}${slot}.ngb`)) for (const n of ngbtool.names(src.entry(`Bundles/${stem}${slot}.ngb`))) names.add(n.toLowerCase())
      }
      const m = resolved(src, nmstool.parse(src.entry(`Motions/${set}`)), (a) => names.has(a.toLowerCase()))
      const range = new tuning.Tuning(src, base).num(tuning.FIELDS.super_throw_range)
      out[key] = { body: base.body, motions: Object.fromEntries([...m].map(([k, v]) => [k, v.anim])), range }
    } catch (e) {
      if (!(e instanceof LabError)) throw e
    }
  }
  return out
}

export function animations(cat: Catalog, base: string, move: Move): (string | null)[] | null {
  const own = cat[base]
  if (!own) return null
  const out = move.states.map((s) => own.motions[s.toLowerCase()] ?? null)
  return out.some((a) => a !== null) ? out : null
}

export interface MoveOption {
  // the bases that have these animations; the first is the one stored
  from: string[]
  body: string
  anims: (string | null)[]
}

function grouped(cat: Catalog, base: string, move: Move, mine: (string | null)[]): MoveOption[] {
  const out = new Map<string, MoveOption>()
  for (const key of R.keys()) {
    const theirs = key === base ? null : animations(cat, key, move)
    if (!theirs || mine.some((a, i) => a !== null && theirs[i] === null)) continue
    const k = theirs.map((a) => (a ?? '').toLowerCase())
    if (k.every((a, i) => a === (mine[i] ?? '').toLowerCase())) continue
    const id = `${cat[key].body}|${k.join('|')}`
    if (out.has(id)) out.get(id)!.from.push(key)
    else out.set(id, { from: [key], body: cat[key].body, anims: theirs })
  }
  return [...out.values()]
}

export function options(cat: Catalog, base: string, move: Move): MoveOption[] {
  const mine = animations(cat, base, move)
  return mine ? grouped(cat, base, move, mine) : []
}

// Wall climbing for a base without it (manifest `stats.gameplay.wall_climb`, ability bit 0x2): these states are added, not swapped.
export const WALL_CLIMB = ['WallClimbUp', 'WallClimbDown', 'WallClimbLeft', 'WallClimbRight', 'WallClimbStand']
export const WALL_JUMPS = ['WallJumpOff', 'WallJumpToWall', 'WallRunJumpOff']
export const WALL_STATES = [...WALL_CLIMB, ...WALL_JUMPS]

export function addOptions(cat: Catalog, base: string, move: Move): MoveOption[] {
  return grouped(cat, base, move, move.states.map(() => null))
}

const boneKey = (name: string) => name.replace(/\s*\([LRC]\)$/, '').toLowerCase().replace(/hand marker$/, 'palm')

// Bone numbers from one body class to another, matched by name; within a class they stay the same.
export function boneMap(from: string, to: string, nodes: number): Map<number, number> {
  const out = new Map<number, number>()
  if (from === to) {
    for (let i = 0; i < nodes; i++) out.set(i, i)
    return out
  }
  const target = new Map<string, number>()
  for (const [i, n] of Object.entries(loadTable(to).nodes)) {
    if (n.name && Number(i) < nodes && !target.has(boneKey(n.name))) target.set(boneKey(n.name), Number(i))
  }
  for (const [i, n] of Object.entries(loadTable(from).nodes)) {
    const j = n.name ? target.get(boneKey(n.name)) : undefined
    if (j !== undefined) out.set(Number(i), j)
  }
  return out
}

// A track's bone word is the node in its low 16 bits and flags above, which stay.
export function remapBone(word: number, map: Map<number, number>): number | undefined {
  const to = map.get(word & 0xffff)
  return to === undefined ? undefined : ((word & 0xffff0000) | to) >>> 0
}

export function remapRecord(rec: ngbtool.Record, map: Map<number, number>): ngbtool.Record {
  const keep = rec.tracks.flatMap((t, i): [ngbtool.Track, number][] => (map.has(t[0] & 0xffff) ? [[t, rec.pointers[i] ?? 0]] : []))
  return { ...rec, tracks: keep.map(([[bone, ch, keys]]): ngbtool.Track => [remapBone(bone, map)!, ch, keys]), pointers: keep.map(([, p]) => p) }
}

// The original name cut to fit plus a hash of the motion, at most 31 characters.
export function ownName(rec: ngbtool.Record): string {
  const hash = toHex(sha256(ngbtool.writeRecord({ ...rec, name: '' }))).slice(0, 6)
  return `${rec.name.replace(/\.nad$/i, '').slice(0, 20)}_${hash}.nad`
}

function loadBundles(src: GameSource, stem: string): Map<string, ngbtool.Record[]> {
  const out = new Map<string, ngbtool.Record[]>()
  for (const slot of SLOTS) if (src.has(`Bundles/${stem}${slot}.ngb`)) out.set(slot, ngbtool.parse(src.entry(`Bundles/${stem}${slot}.ngb`)))
  return out
}

const holds = (bundles: Map<string, ngbtool.Record[]>) => {
  const names = new Set([...bundles.values()].flatMap((rs) => rs.map((r) => r.name.toLowerCase())))
  return (anim: string) => names.has(anim.toLowerCase())
}

interface Source {
  other: R.BaseCharacter
  bundles: Map<string, ngbtool.Record[]>
  motions: Map<string, nmstool.Motion>
}

function source(src: GameSource, base: R.BaseCharacter, from: string): Source {
  const other = new R.BaseCharacter(src, from, base.t)
  const set = motionSetOf(other)
  const bundles = loadBundles(src, stemOf(set))
  return { other, bundles, motions: resolved(src, nmstool.parse(src.entry(`Motions/${set}`)), holds(bundles)) }
}

const effectKs = (recs: ngbtool.Record[]) => recs.flatMap((r) => r.events.filter(([, t]) => OWN_EFFECTS.has(t)).map(([, , k]) => k))

// Every k the base's own animations fire.
export function baseEffects(src: GameSource, base: R.BaseCharacter): number[] {
  return effectKs([...loadBundles(src, stemOf(motionSetOf(base))).values()].flat())
}

export interface Moved {
  from: R.BaseCharacter
  ks: number[]
}

export interface MovedEffects {
  own: number[]
  moves: Map<string, Moved>
}

// The k the base's animations fire, and each swapped move's on the thrower's side; the victim's side plays on the opponent.
export function movedEffects(src: GameSource, base: R.BaseCharacter, moves: Record<string, string>): MovedEffects {
  const out: MovedEffects = { own: baseEffects(src, base), moves: new Map() }
  for (const [id, from] of Object.entries(moves)) {
    const move = MOVE_IDS.get(id)
    if (!move) continue
    const s = source(src, base, from)
    const anims = new Set(move.states.filter((st) => !VICTIM.test(st)).flatMap((st) => s.motions.get(st.toLowerCase())?.anim.toLowerCase() ?? []))
    out.moves.set(id, { from: s.other, ks: [...new Set(effectKs([...s.bundles.values()].flat().filter((r) => anims.has(r.name.toLowerCase()))))] })
  }
  return out
}

export interface MoveFit {
  fit: number
  total: number
  line: boolean
}

export interface EffectPlan {
  slots: Slots
  retargets: Map<string, Map<number, number>>
  fits: Map<string, MoveFit>
}

// Gives the 'theirs' moves' effects free slots before anything else; used holds the k the character's cutscenes fire.
// A line in a color of lines is copied in that color into fx, prefixes naming the copies per costume.
export function planEffects(src: GameSource, base: R.BaseCharacter, choice: Record<string, MoveEffect>, fx: Effects, lines: MoveLines,
  prefixes: [string, string], used: Iterable<number>, moved: MovedEffects): EffectPlan {
  const slots = new Slots(new tuning.Tuning(src, base), [...moved.own, ...[...moved.moves.values()].flatMap((m) => m.ks), ...used])
  const out: EffectPlan = { slots, retargets: new Map(), fits: new Map() }
  const alt = tuning.SLOTS - 1
  const rename = (names: string[]) => names.map((n, s) => {
    const color = s === alt ? lines.alt_color : lines.color
    return n && color && fx.isLine(n) ? fx.painted(n, color, prefixes[s === alt ? 1 : 0]) : n
  })
  for (const [id, m] of moved.moves) {
    const from = new tuning.Tuning(src, m.from)
    const line = m.ks.some((k) => effectNames(from, k).some((n) => n && fx.isLine(n)))
    if (choice[id] !== 'theirs') {
      out.fits.set(id, { fit: 0, total: 0, line })
      continue
    }
    const [map, missed] = slots.assign(from, m.ks, rename)
    out.retargets.set(id, map)
    out.fits.set(id, { fit: map.size, total: map.size + missed, line })
  }
  return out
}

export interface MoveEffectFit extends MoveFit {
  chosen: boolean
}

// For each swapped move whose animations fire effects: how many of them get a slot, chosen or as if chosen.
export function effectFit(src: GameSource, base: R.BaseCharacter, choice: Record<string, MoveEffect>, lines: MoveLines, used: number[],
  fresh: () => Effects, moved: MovedEffects): Record<string, MoveEffectFit> {
  const prefixes: [string, string] = ['xxf', 'xxa']
  const plan = planEffects(src, base, choice, fresh(), lines, prefixes, used, moved)
  const out: Record<string, MoveEffectFit> = {}
  for (const [id, f] of plan.fits) {
    if (!moved.moves.get(id)!.ks.length) continue
    const chosen = choice[id] === 'theirs'
    const fit = chosen ? f : planEffects(src, base, { ...choice, [id]: 'theirs' }, fresh(), lines, prefixes, used, moved).fits.get(id)!
    if (fit.total || fit.line) out[id] = { ...fit, chosen }
  }
  return out
}

export interface MotionFiles {
  motionSet: string
  files: Map<string, Uint8Array>
  notes: string[]
}

export function motionFiles(src: GameSource, base: R.BaseCharacter, internal: string, moves: Record<string, string>, reach?: number,
  choice: Record<string, MoveEffect> = {}, plan: EffectPlan | null = null): MotionFiles {
  const set = motionSetOf(base), stem = stemOf(set), name = internal.toLowerCase()
  const own = nmstool.parse(src.entry(`Motions/${set}`))
  const bundles = loadBundles(src, stem)
  const before = [...bundles.values()].reduce((n, rs) => n + rs.reduce((k, r) => k + ngbtool.writeRecord(r).length, 0), 0)
  const [, models] = ngmtool.read(base.bundleFiles()[0])
  const mine = resolved(src, own, holds(bundles))
  const notes: string[] = []
  const displaced = new Set<string>()
  if (reach !== undefined) {
    const main = bundles.get('') ?? []
    const at = main.findIndex((r) => r.name.toLowerCase() === basemoves.THROW)
    if (at < 0) throw new LabError(`${base.label}'s animations have no ${basemoves.THROW}`)
    const rec = basemoves.longThrow(main[at], models[0], reach)
    rec.name = ownName(rec)
    own.rename(main[at].name, rec.name)
    main[at] = rec
  }
  for (const [id, from] of Object.entries(moves)) {
    const move = MOVE_IDS.get(id)
    if (!move) throw new LabError(`there is no move ${id}`)
    const { other, bundles: theirBundles, motions: theirs } = source(src, base, from)
    const map = boneMap(other.body, base.body, models[0].nodes.length)
    const how = choice[id], to = plan?.retargets.get(id)
    const effects = (rec: ngbtool.Record): ngbtool.Record => {
      if (how === 'none') return { ...rec, events: rec.events.filter(([, t]) => !OWN_EFFECTS.has(t)) }
      if (!to?.size) return rec
      return { ...rec, events: rec.events.map(([f, t, k, v]): ngbtool.Event => [f, t, OWN_EFFECTS.has(t) ? (to.get(k) ?? k) : k, v]) }
    }
    let copied = 0
    for (const state of move.states) {
      const m = theirs.get(state.toLowerCase()), old = mine.get(state.toLowerCase())
      if (!m) {
        if (old) throw new LabError(`${other.label} has no ${state} to take the place of ${base.label}'s`)
        continue
      }
      if (old) displaced.add(old.anim.toLowerCase())
      const found = SLOTS.flatMap((slot): [string, ngbtool.Record, ngbtool.Record][] => {
        const rec = theirBundles.get(slot)?.find((r) => r.name.toLowerCase() === m.anim.toLowerCase())
        return rec ? [[slot, rec, VICTIM.test(state) ? rec : effects(remapRecord(rec, map))]] : []
      })
      // One name in every slot: the set names one animation, and the game loads the slot for the opponent's body class, whose record can differ.
      const changed = found.find(([, rec, moved]) => !ngbtool.sameMotion(moved, rec))
      const anim = changed ? ownName(changed[2]) : (found[0]?.[1].name ?? m.anim)
      for (const [slot, , moved] of found) {
        const copy = { ...moved, name: anim }
        if (!bundles.has(slot)) bundles.set(slot, [])
        const into = bundles.get(slot)!
        if (!into.some((r) => r.name.toLowerCase() === copy.name.toLowerCase())) {
          into.push(copy)
          copied++
        }
      }
      own.set({ state: m.state, anim, opts: m.opts })
    }
    const cross = other.body !== base.body ? `; ${other.body} animations on a ${base.body} skeleton, so approximate` : ''
    const fit = plan?.fits.get(id)
    let fx = ''
    if (how === 'none') fx = '; no effects'
    else if (how === 'theirs' && fit?.total) fx = `; ${fit.fit} of ${other.label}'s effects${fit.total > fit.fit ? `, ${fit.total - fit.fit} more left as ${base.label}'s (no free effect slot)` : ''}`
    notes.push(`moves: ${move.label} from ${other.label} (${copied} animation${copied === 1 ? '' : 's'} copied${cross}${fx})`)
  }
  // the base's records the moves replaced, unless another state still plays them
  const used = new Set([...resolved(src, own, () => true).values()].map((m) => m.anim.toLowerCase()))
  for (const l of own.lines) if (l.motion) used.add(l.motion.anim.toLowerCase())
  for (const [slot, recs] of bundles) bundles.set(slot, recs.filter((r) => !displaced.has(r.name.toLowerCase()) || used.has(r.name.toLowerCase())))
  const files = new Map<string, Uint8Array>([[`Motions/${motionSetName(internal)}`, own.build()]])
  let after = 0
  for (const [slot, recs] of bundles) {
    const data = ngbtool.build(recs)
    after += data.length
    files.set(`Bundles/${name}${slot}.ngb`, data)
  }
  if (Object.keys(moves).length) notes.push(`moves: animations ${Math.round(after / 1024)} KB (${base.label}'s ${Math.round(before / 1024)} KB)`)
  return { motionSet: motionSetName(internal), files, notes }
}
