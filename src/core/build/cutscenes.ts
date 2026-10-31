// Cutscenes taken from other bases, their effects, new cutscene audio and new animations (manifest `cutscenes`).
// The names are tuning strings, so a cutscene is copied only when its bones, effects or audio change.
import { putU32le } from '../bytes'
import * as cutanim from './cutanim'
import { LabError } from '../errors'
import * as R from '../game/roster'
import type { GameSource } from '../game/source'
import * as asftool from '../mnroi/asftool'
import * as cuttool from '../mnroi/cuttool'
import type * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import { type Character, CUTSCENE_KINDS, type CutsceneKind, type Cutscenes } from '../package/imperfect'
import * as fxs from './effects'
import { OWN_EFFECTS, Slots } from './effectslots'
import * as moves from './moves'
import { boneMap, remapBone } from './moves'
import * as tuning from './tuning'

export const FIELDS: Record<CutsceneKind, number[]> = { intro: [170, 171, 172], victory: [173, 174, 175], finisher: [206, 207, 208] }
export const LABELS: Record<CutsceneKind, string> = { intro: 'Intro', victory: 'Victory', finisher: 'Finisher' }
const STREAMS = 'Sounds/ASF/english/'
const FIXED = /^nis_camera|^victim$/i
const VICTIM = /_(male|female|brute)_/i

export interface AudioSlot {
  key: string
  label: string
  stream: string
  seconds: number
  samples: number
}

export interface AnimationSlot {
  key: string
  label: string
  cut: string
}

export interface KindInfo {
  cuts: string[]
  slots: AudioSlot[]
  animations: AnimationSlot[]
}

export interface BaseCutscenes {
  body: string
  kinds: Record<CutsceneKind, KindInfo>
}

export type Catalog = Record<string, BaseCutscenes>

export const cutPath = (name: string) => `Cutscenes/${name.trim().replace(/\.cut$/i, '')}.cut`
// Seconds new audio may run past the stream it replaces.
export const AUDIO_SLACK = 0.05

export function removeAudio(c: Character, key: string) {
  const member = c.cutscenes.audio[key]
  delete c.cutscenes.audio[key]
  if (member && !Object.values(c.cutscenes.audio).includes(member)) c.files.delete(member)
}

export function removeAnimation(c: Character, key: string) {
  const member = c.cutscenes.animation[key]
  delete c.cutscenes.animation[key]
  if (member && !Object.values(c.cutscenes.animation).includes(member)) c.files.delete(member)
}

// Remove a kind's new animations, which fit only the cutscenes they were made from.
export function dropAnimations(c: Character, kind: CutsceneKind): string[] {
  const dropped = Object.keys(c.cutscenes.animation).filter((k) => k.startsWith(kind + '_'))
  for (const k of dropped) removeAnimation(c, k)
  return dropped
}

// Remove a kind's new audio that does not fit where the kind is now taken from.
export function dropUnfitAudio(c: Character, cat: Catalog, kind: CutsceneKind): string[] {
  const slots = cat[c.cutscenes[kind] ?? c.base]?.kinds[kind].slots ?? []
  const fits = (k: string) => {
    const s = slots.find((n) => n.key === k)
    const body = c.files.get(c.cutscenes.audio[k])
    return s !== undefined && body !== undefined && asftool.seconds(asftool.read(body)) <= s.seconds + AUDIO_SLACK
  }
  const dropped = Object.keys(c.cutscenes.audio).filter((k) => k.startsWith(kind + '_') && !fits(k))
  for (const k of dropped) removeAudio(c, k)
  return dropped
}

class Reader {
  src: GameSource
  cuts = new Map<string, cuttool.Cut>()
  rigs = new Map<string, cutanim.Rig>()
  private bodies: Map<string, string> | null = null

  constructor(src: GameSource) {
    this.src = src
  }

  rig(key: string): cutanim.Rig {
    if (!this.rigs.has(key)) this.rigs.set(key, cutanim.rig(new R.BaseCharacter(this.src, key)))
    return this.rigs.get(key)!
  }

  actorRigs(name: string, from: string): cutanim.Rigs {
    if (!this.bodies) {
      const t = new R.Templates(this.src.entry('Misc/Global.not'))
      this.bodies = new Map()
      for (const k of R.keys()) {
        const body = new R.BaseCharacter(this.src, k, t).body
        if (!this.bodies.has(body)) this.bodies.set(body, k)
      }
    }
    const out: cutanim.Rigs = new Map()
    const victim = this.bodies.get(VICTIM.exec(name)?.[1].toLowerCase() ?? '')
    for (const r of this.cut(name).records) {
      const actor = cuttool.recordName(r).toLowerCase()
      if (cutanim.CAMERA.test(actor)) continue
      if (actor !== 'victim') out.set(actor, this.rig(from))
      else if (victim) out.set(actor, this.rig(victim))
    }
    return out
  }

  cut(name: string): cuttool.Cut {
    const key = name.trim().toLowerCase()
    if (!this.cuts.has(key)) {
      const path = cutPath(name)
      if (!this.src.has(path)) throw new LabError(`the game has no cutscene ${name}`)
      this.cuts.set(key, cuttool.read(this.src.entry(path)))
    }
    return this.cuts.get(key)!
  }

  names(base: R.BaseCharacter, kind: CutsceneKind): string[][] {
    const tun = new tuning.Tuning(this.src, base)
    return FIELDS[kind].map((fid) => Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(fid, s) as string))
  }

  // The streams a kind plays, first costume, each once, as [field index, stream index, name].
  streams(names: string[][]): [number, number, string][] {
    const seen = new Set<string>()
    const out: [number, number, string][] = []
    names.forEach((slots, f) => {
      cuttool.streams(this.cut(slots[0])).forEach((s, j) => {
        if (s && !seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase())
          out.push([f, j, s])
        }
      })
    })
    return out
  }
}

function slots(r: Reader, kind: CutsceneKind, names: string[][]): AudioSlot[] {
  const found = r.streams(names)
  const cuts = [...new Set(names.map((s) => s[0].trim().toLowerCase()))]
  return found.map(([f, j, stream], i) => {
    const n = cuts.indexOf(names[f][0].trim().toLowerCase())
    const sides = found.filter(([g]) => names[g][0].trim().toLowerCase() === cuts[n]).length
    let label = found.length === 1 ? LABELS[kind] : `${LABELS[kind]} ${n + 1}`
    if (sides > 1) label += `, player ${j + 1} side`
    const path = STREAMS + stream
    const a = r.src.has(path) ? asftool.read(r.src.entry(path)) : null
    return { key: `${kind}_${i + 1}`, label, stream, seconds: a ? asftool.seconds(a) : 0, samples: a ? asftool.info(a).samples : 0 }
  })
}

function animationSlots(kind: CutsceneKind, cuts: string[]): AnimationSlot[] {
  return cuts.map((cut, n) => {
    const body = VICTIM.exec(cut)?.[1].toLowerCase()
    const label = kind === 'finisher' && body ? `${LABELS[kind]} on a ${body} opponent` : cuts.length === 1 ? LABELS[kind] : `${LABELS[kind]} ${n + 1}`
    return { key: `${kind}_${n + 1}`, label, cut }
  })
}

function animationCuts(names: string[][]): [string, string[]][] {
  const out = new Map<string, string[]>()
  for (const slotNames of names) {
    const first = slotNames[0].trim().toLowerCase()
    if (!out.has(first)) out.set(first, [])
    const all = out.get(first)!
    for (const v of slotNames) if (!all.some((w) => w.trim().toLowerCase() === v.trim().toLowerCase())) all.push(v)
  }
  return [...out.entries()].map(([, all]) => [all[0], all])
}

function animationCut(r: Reader, base: string, kind: CutsceneKind, key: string): [string, string[]] {
  const n = Number(key.slice(kind.length + 1)) - 1
  const found = key.startsWith(kind + '_') ? animationCuts(r.names(new R.BaseCharacter(r.src, base), kind))[n] : undefined
  if (!found) throw new LabError(`${R.label(base)} has no cutscene ${key}`)
  return found
}

export function animationGlb(src: GameSource, base: string, kind: CutsceneKind, key: string): Uint8Array {
  const r = new Reader(src)
  const [cut] = animationCut(r, base, kind, key)
  return cutanim.toGlb(r.cut(cut), r.actorRigs(cut, base))
}

export function checkAnimation(src: GameSource, base: string, kind: CutsceneKind, key: string, glb: Uint8Array): string[] {
  const r = new Reader(src)
  const notes = new Set<string>()
  for (const [i, v] of animationCut(r, base, kind, key)[1].entries()) {
    const got = cutanim.fromGlb(glb, r.cut(v), r.actorRigs(v, base))
    if (!got.keyed.length) throw new LabError(`nothing in the glTF matches the cutscene's cameras or characters (${[...got.notes].join('; ')})`)
    for (const n of got.notes) notes.add(i ? `the other costume's copy: ${n}` : n)
  }
  return [...notes]
}

export function catalog(src: GameSource): Catalog {
  const r = new Reader(src)
  const t = new R.Templates(src.entry('Misc/Global.not'))
  const out: Catalog = {}
  for (const key of R.keys()) {
    const base = new R.BaseCharacter(src, key, t)
    const kinds = {} as Record<CutsceneKind, KindInfo>
    for (const kind of CUTSCENE_KINDS) {
      const names = r.names(base, kind)
      kinds[kind] = { cuts: [...new Set(names.map((s) => s[0].trim()))], slots: slots(r, kind, names), animations: animationSlots(kind, animationCuts(names).map(([cut]) => cut.trim())) }
    }
    out[key] = { body: base.body, kinds }
  }
  return out
}

export function pcm(src: GameSource, base: string, kind: CutsceneKind, key: string): [Int16Array[], number] {
  const r = new Reader(src)
  const slot = slots(r, kind, r.names(new R.BaseCharacter(src, base), kind)).find((s) => s.key === key)
  if (!slot) throw new LabError(`${R.label(base)} has no ${key} cutscene audio`)
  const a = asftool.read(src.entry(STREAMS + slot.stream))
  return [asftool.decode(a), asftool.info(a).rate]
}

export interface Plan {
  fields: Map<number, string[]>
  files: Map<string, Uint8Array>
  notes: string[]
}

const performers = (cut: cuttool.Cut) => cut.chunks.flatMap((ch) => ch.actors.filter((a) => !FIXED.test(cuttool.recordName(a.record))))

function* effectEvents(a: cuttool.Actor): Generator<number> {
  for (let i = 0; i < a.events.length; i += 12) if (OWN_EFFECTS.has(a.events[i + 4] | (a.events[i + 5] << 8))) yield i
}

const param = (a: cuttool.Actor, i: number) => a.events[i + 6] | (a.events[i + 7] << 8)

function remap(cut: cuttool.Cut, map: Map<number, number>) {
  for (const a of performers(cut)) {
    a.tracks = a.tracks.filter((t) => remapBone(cuttool.bone(t), map) !== undefined).map((t) => {
      const head = t.head.slice()
      putU32le(head, 0, remapBone(cuttool.bone(t), map)!)
      return { head, keys: t.keys }
    })
  }
}

function strip(cut: cuttool.Cut) {
  for (const a of performers(cut)) {
    const drop = new Set(effectEvents(a))
    const keep = new Uint8Array(a.events.length - 12 * drop.size)
    for (let i = 0, o = 0; i < a.events.length; i += 12) {
      if (drop.has(i)) continue
      keep.set(a.events.subarray(i, i + 12), o)
      o += 12
    }
    a.events = keep
  }
}

const theirKinds = (c: Cutscenes) => CUTSCENE_KINDS.filter((k) => c.effects[k] === 'theirs')

function retarget(cut: cuttool.Cut, slots: Map<number, number>) {
  for (const a of performers(cut)) {
    for (const i of effectEvents(a)) {
      const to = slots.get(param(a, i))
      if (to !== undefined) {
        a.events[i + 6] = to & 255
        a.events[i + 7] = to >> 8
      }
    }
  }
}

const usesAny = (cut: cuttool.Cut, slots: Map<number, number>) => performers(cut).some((a) => [...effectEvents(a)].some((i) => slots.has(param(a, i))))

type Taken = { kind: CutsceneKind; from: R.BaseCharacter; names: string[][] }[]

function taken(src: GameSource, r: Reader, base: R.BaseCharacter, cutscenes: Cutscenes): Taken {
  return CUTSCENE_KINDS.map((kind) => {
    const fromKey = cutscenes[kind] ?? base.key
    const from = fromKey === base.key ? base : new R.BaseCharacter(src, fromKey, base.t)
    return { kind, from, names: r.names(from, kind) }
  })
}

interface Effects {
  // per kind, the source's k -> the k that names its effect for the character
  retargets: Map<CutsceneKind, Map<number, number>>
  missed: Map<CutsceneKind, number>
}

const firedBy = (r: Reader, names: string[][]) => names.flat().flatMap((v) => performers(r.cut(v)).flatMap((a) => [...effectEvents(a)].map((i) => param(a, i))))

function assignEffects(src: GameSource, r: Reader, slots: Slots, kinds: Taken, theirs: CutsceneKind[]): Effects {
  const out: Effects = { retargets: new Map(), missed: new Map() }
  for (const { kind, from, names } of kinds) {
    if (!theirs.includes(kind) || from.key === slots.tun.base.key) continue
    const [map, missed] = slots.assign(new tuning.Tuning(src, from), firedBy(r, names))
    if (missed) out.missed.set(kind, missed)
    out.retargets.set(kind, map)
  }
  return out
}

// Every k the character's cutscenes fire.
export function effectKs(src: GameSource, base: R.BaseCharacter, cutscenes: Cutscenes): number[] {
  const r = new Reader(src)
  return taken(src, r, base, cutscenes).flatMap((k) => firedBy(r, k.names))
}

export type EffectChoices = Pick<Character, 'moves' | 'moveEffects' | 'moveLines' | 'cutscenes'>

export function moveSlots(src: GameSource, base: R.BaseCharacter, c: EffectChoices): Slots {
  const fx = new fxs.Effects(src.entry('Misc/game.nfx'))
  return moves.planEffects(src, base, c.moveEffects, fx, c.moveLines, ['xxf', 'xxa'], effectKs(src, base, c.cutscenes), moves.movedEffects(src, base, c.moves)).slots
}

export type EffectFit = Partial<Record<CutsceneKind, { fit: number; total: number; chosen: boolean }>>

export function effectFit(src: GameSource, baseKey: string, c: EffectChoices): EffectFit {
  const r = new Reader(src)
  const base = new R.BaseCharacter(src, baseKey)
  const cutscenes = c.cutscenes
  const kinds = taken(src, r, base, cutscenes)
  const out: EffectFit = {}
  for (const { kind, from } of kinds) {
    if (from === base) continue
    const chosen = cutscenes.effects[kind] === 'theirs'
    const e = assignEffects(src, r, moveSlots(src, base, c), kinds, chosen ? theirKinds(cutscenes) : [...theirKinds(cutscenes), kind])
    const fit = e.retargets.get(kind)?.size ?? 0
    out[kind] = { fit, total: fit + (e.missed.get(kind) ?? 0), chosen }
  }
  return out
}

// `stow` reworks the character's animation in the intros (the holster's club on the back).
export function plan(src: GameSource, base: R.BaseCharacter, c: Character, given = moveSlots(src, base, c),
  stow: ((rec: ngbtool.Record) => ngbtool.Record) | null = null): Plan {
  const out: Plan = { fields: new Map(), files: new Map(), notes: [] }
  const r = new Reader(src)
  const prefix = c.internalName.toLowerCase()
  const kinds = taken(src, r, base, c.cutscenes)
  const { retargets, missed } = assignEffects(src, r, given, kinds, theirKinds(c.cutscenes))
  for (const [fid, names] of given.fields()) out.fields.set(fid, names)
  let nodes: number | null = null
  for (const { kind, from, names } of kinds) {
    const clips = Object.entries(c.cutscenes.audio).filter(([k]) => k.startsWith(kind + '_'))
    const anims = Object.keys(c.cutscenes.animation).filter((k) => k.startsWith(kind + '_'))
    const effects = retargets.get(kind) ?? new Map<number, number>()
    const stowed = kind === 'intro' ? stow : null
    if (from === base && !clips.length && !stowed && !anims.length) continue
    const avail = slots(r, kind, names)
    const clipFor = new Map<string, string>()
    for (const [key, member] of clips) {
      const slot = avail.find((s) => s.key === key)
      if (!slot) throw new LabError(`${from.label}'s ${LABELS[kind].toLowerCase()} has no audio ${key}`)
      const asf = asftool.read(c.files.get(member) ?? new Uint8Array())
      if (asftool.seconds(asf) > slot.seconds + AUDIO_SLACK) {
        throw new LabError(`the new audio for ${slot.label.toLowerCase()} is longer than the ${slot.seconds.toFixed(1)} seconds it replaces`)
      }
      const name = `${prefix}_${key}.asf`
      if (src.has(STREAMS + name)) throw new LabError(`the game already has ${STREAMS + name}: pick another internal name`)
      out.files.set(STREAMS + name, asftool.info(asf).samples < slot.samples ? asftool.build(asftool.padded(asf, slot.samples)) : c.files.get(member)!)
      clipFor.set(slot.stream.toLowerCase(), name)
    }
    const cross = from.body !== base.body
    if (cross && nodes === null) nodes = ngmtool.read(base.bundleFiles()[0])[1][0].nodes.length
    const renamed = new Map<string, string>()
    const firsts = animationCuts(names).map(([cut]) => cut.trim().toLowerCase())
    const animNotes = new Set<string>()
    let copies = 0
    for (const slotNames of names) {
      const own = cuttool.streams(r.cut(slotNames[0]))
      const slot = `${kind}_${firsts.indexOf(slotNames[0].trim().toLowerCase()) + 1}`
      const member = c.cutscenes.animation[slot]
      const glb = member === undefined ? null : c.files.get(member)
      if (glb === undefined) throw new LabError(`the new animation for cutscene ${slot.replace('_', ' ')} is missing`)
      for (const v of slotNames) {
        const key = v.trim().toLowerCase()
        if (renamed.has(key)) continue
        const theirs = cuttool.streams(r.cut(v))
        const changes = own.flatMap((s, j): [number, string][] => (clipFor.has(s.toLowerCase()) && theirs[j] ? [[j, clipFor.get(s.toLowerCase())!]] : []))
        const effectCopy = effects.size > 0 && usesAny(r.cut(v), effects)
        const stripCopy = c.cutscenes.effects[kind] === 'none' && performers(r.cut(v)).some((a) => !effectEvents(a).next().done)
        if (!cross && !changes.length && !effectCopy && !stripCopy && !stowed && !glb) {
          renamed.set(key, v)
          continue
        }
        let cut = cuttool.read(cuttool.build(r.cut(v)))
        if (glb) {
          const got = cutanim.fromGlb(glb, cut, r.actorRigs(v, from.key))
          cut = got.cut
          for (const n of got.notes) animNotes.add(`${slot.replace('_', ' ')} (${v.trim()}): ${n}`)
        }
        if (cross) remap(cut, boneMap(from.body, base.body, nodes!))
        if (effectCopy) retarget(cut, effects)
        if (stripCopy) strip(cut)
        // a new animation places the club itself
        if (stowed && !glb) for (const a of performers(cut)) cuttool.setRecord(a, stowed(cuttool.record(a)))
        for (const [j, n] of changes) cuttool.setStream(cut, j, n)
        const name = `${prefix}_${kind}${++copies}`
        if (src.has(cutPath(name))) throw new LabError(`the game already has ${cutPath(name)}: pick another internal name`)
        out.files.set(cutPath(name), cuttool.build(cut))
        renamed.set(key, name)
      }
    }
    for (const [f, fid] of FIELDS[kind].entries()) out.fields.set(fid, names[f].map((v) => renamed.get(v.trim().toLowerCase())!))
    const what = [from !== base ? `${from.label}'s` : '', clips.length ? `${clips.length} new audio` : '', anims.length ? `${anims.length} new animation${anims.length === 1 ? '' : 's'}` : '', stowed && anims.length < firsts.length ? 'club on the back' : ''].filter(Boolean).join(', ')
    let note = `cutscenes: ${LABELS[kind].toLowerCase()} ${what}`
    if (c.cutscenes.effects[kind] === 'theirs' && from !== base) {
      const lost = missed.get(kind) ?? 0
      note += `; ${effects.size} of ${from.label}'s effects${lost ? `, ${lost} more left as ${base.label}'s (no free effect slot)` : ''}`
    }
    if (c.cutscenes.effects[kind] === 'none') note += '; no effects'
    out.notes.push(note + (cross ? `; ${from.body} animations on a ${base.body} skeleton, so approximate` : ''))
    for (const n of animNotes) out.notes.push(`cutscenes: ${n}`)
  }
  return out
}