// Cutscenes taken from other bases, their effects and new cutscene audio (manifest `cutscenes`).
// The names are tuning strings, so a cutscene is copied only when its bones, effects or audio change.
import { putU32le } from '../bytes'
import { LabError } from '../errors'
import * as R from '../game/roster'
import type { GameSource } from '../game/source'
import * as asftool from '../mnroi/asftool'
import * as cuttool from '../mnroi/cuttool'
import * as ngbtool from '../mnroi/ngbtool'
import * as ngmtool from '../mnroi/ngmtool'
import { type Character, CUTSCENE_KINDS, type CutsceneKind, type Cutscenes } from '../package/imperfect'
import { boneMap, motionSetOf, remapBone, SLOTS as MOVE_SLOTS, stemOf } from './moves'
import * as tuning from './tuning'

export const FIELDS: Record<CutsceneKind, number[]> = { intro: [170, 171, 172], victory: [173, 174, 175], finisher: [206, 207, 208] }
export const LABELS: Record<CutsceneKind, string> = { intro: 'Intro', victory: 'Victory', finisher: 'Finisher' }
const STREAMS = 'Sounds/ASF/english/'
const FIXED = /^nis_camera|^victim$/i

export interface AudioSlot {
  key: string
  label: string
  stream: string
  seconds: number
  samples: number
}

export interface KindInfo {
  cuts: string[]
  slots: AudioSlot[]
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

  constructor(src: GameSource) {
    this.src = src
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

export function catalog(src: GameSource): Catalog {
  const r = new Reader(src)
  const t = new R.Templates(src.entry('Misc/Global.not'))
  const out: Catalog = {}
  for (const key of R.keys()) {
    const base = new R.BaseCharacter(src, key, t)
    const kinds = {} as Record<CutsceneKind, KindInfo>
    for (const kind of CUTSCENE_KINDS) {
      const names = r.names(base, kind)
      kinds[kind] = { cuts: [...new Set(names.map((s) => s[0].trim()))], slots: slots(r, kind, names) }
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

// Animation events start effects named by the performer's own tuning: param k (1-26) is field EFFECT_FIELDS[k - 1] (fn_8005A534).
export const EFFECT_FIELDS = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 98, 99, 100, 101, 102, 94, 95, 96, 97, 71, 237, 238, 242, 243, 248, 249]
// The events that name a field of the actor playing them (start, stop, and the same on the target).
const OWN_EFFECTS = new Set([0x48, 0x49, 0x5d, 0x5e])
// Fields the game also reads in play (fn_800E673C's 79 + n, fn_800F1644's 94 + n, the power-up's 98-102).
const IN_PLAY = new Set([80, 81, 82, 83, 84, 85, 86, 94, 95, 96, 97, 98, 99, 100, 101, 102])
// The only k a shipped victim animation or victim actor uses; those play on whoever is thrown (checked in the tests).
export const VICTIM_SLOTS = [5]

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

function freeSlots(src: GameSource, base: R.BaseCharacter, moves: Record<string, string>, tun: tuning.Tuning, cuts: cuttool.Cut[]): number[] {
  const used = new Set(VICTIM_SLOTS)
  const stems = new Set([base, ...Object.values(moves).map((k) => new R.BaseCharacter(src, k, base.t))].map((b) => stemOf(motionSetOf(b))))
  for (const stem of stems) {
    for (const slot of MOVE_SLOTS) {
      const name = `Bundles/${stem}${slot}.ngb`
      if (!src.has(name)) continue
      for (const r of ngbtool.parse(src.entry(name))) for (const [, type, k] of r.events) if (OWN_EFFECTS.has(type)) used.add(k)
    }
  }
  for (const cut of cuts) for (const a of performers(cut)) for (const i of effectEvents(a)) used.add(param(a, i))
  return EFFECT_FIELDS.flatMap((fid, i) => {
    const k = i + 1
    const empty = Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(fid, s)).every((v) => !v)
    return !IN_PLAY.has(fid) && !used.has(k) && empty ? [k] : []
  })
}

const effectNames = (tun: tuning.Tuning, k: number) => Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(EFFECT_FIELDS[k - 1], s) as string)

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
  fields: Map<number, string[]>
}

function assignEffects(src: GameSource, r: Reader, base: R.BaseCharacter, tun: tuning.Tuning, kinds: Taken, theirs: CutsceneKind[], moves: Record<string, string>): Effects {
  const out: Effects = { retargets: new Map(), missed: new Map(), fields: new Map() }
  if (!theirs.length) return out
  const free = freeSlots(src, base, moves, tun, kinds.flatMap((k) => k.names.flat().map((v) => r.cut(v))))
  // the base's own slots first, as an effect it already names elsewhere costs no free one
  const given = new Map<string, number>()
  for (let k = EFFECT_FIELDS.length; k >= 1; k--) given.set(JSON.stringify(effectNames(tun, k)), k)
  const owned = new Set(given.keys())
  for (const { kind, from, names } of kinds) {
    if (!theirs.includes(kind) || from === base) continue
    const tunFrom = new tuning.Tuning(src, from)
    const ks = new Set(names.flat().flatMap((v) => performers(r.cut(v)).flatMap((a) => [...effectEvents(a)].map((i) => param(a, i)))))
    const map = new Map<number, number>()
    for (const k of [...ks].filter((k) => k >= 1 && k <= EFFECT_FIELDS.length).sort((a, b) => a - b)) {
      const want = effectNames(tunFrom, k)
      if (want.every((v, s) => v === effectNames(tun, k)[s])) continue
      const key = JSON.stringify(want)
      const to = given.get(key) ?? free.shift()
      if (to === undefined) {
        out.missed.set(kind, (out.missed.get(kind) ?? 0) + 1)
        continue
      }
      given.set(key, to)
      map.set(k, to)
    }
    out.retargets.set(kind, map)
  }
  for (const [key, k] of given) {
    const names = JSON.parse(key) as string[]
    if (!owned.has(key) && names.some(Boolean)) out.fields.set(EFFECT_FIELDS[k - 1], names)
  }
  return out
}

export type EffectFit = Partial<Record<CutsceneKind, { fit: number; total: number; chosen: boolean }>>

export function effectFit(src: GameSource, baseKey: string, cutscenes: Cutscenes, moves: Record<string, string>): EffectFit {
  const r = new Reader(src)
  const base = new R.BaseCharacter(src, baseKey)
  const tun = new tuning.Tuning(src, base)
  const kinds = taken(src, r, base, cutscenes)
  const out: EffectFit = {}
  for (const { kind, from } of kinds) {
    if (from === base) continue
    const chosen = cutscenes.effects[kind] === 'theirs'
    const e = assignEffects(src, r, base, tun, kinds, chosen ? theirKinds(cutscenes) : [...theirKinds(cutscenes), kind], moves)
    const fit = e.retargets.get(kind)?.size ?? 0
    out[kind] = { fit, total: fit + (e.missed.get(kind) ?? 0), chosen }
  }
  return out
}

export function plan(src: GameSource, base: R.BaseCharacter, c: Character): Plan {
  const out: Plan = { fields: new Map(), files: new Map(), notes: [] }
  const r = new Reader(src)
  const prefix = c.internalName.toLowerCase()
  const tun = new tuning.Tuning(src, base)
  const kinds = taken(src, r, base, c.cutscenes)
  const { retargets, missed, fields } = assignEffects(src, r, base, tun, kinds, theirKinds(c.cutscenes), c.moves)
  for (const [fid, names] of fields) out.fields.set(fid, names)
  let nodes: number | null = null
  for (const { kind, from, names } of kinds) {
    const clips = Object.entries(c.cutscenes.audio).filter(([k]) => k.startsWith(kind + '_'))
    const effects = retargets.get(kind) ?? new Map<number, number>()
    if (from === base && !clips.length) continue
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
    let copies = 0
    for (const slotNames of names) {
      const own = cuttool.streams(r.cut(slotNames[0]))
      for (const v of slotNames) {
        const key = v.trim().toLowerCase()
        if (renamed.has(key)) continue
        const theirs = cuttool.streams(r.cut(v))
        const changes = own.flatMap((s, j): [number, string][] => (clipFor.has(s.toLowerCase()) && theirs[j] ? [[j, clipFor.get(s.toLowerCase())!]] : []))
        const effectCopy = effects.size > 0 && usesAny(r.cut(v), effects)
        const stripCopy = c.cutscenes.effects[kind] === 'none' && performers(r.cut(v)).some((a) => !effectEvents(a).next().done)
        if (!cross && !changes.length && !effectCopy && !stripCopy) {
          renamed.set(key, v)
          continue
        }
        const cut = cuttool.read(cuttool.build(r.cut(v)))
        if (cross) remap(cut, boneMap(from.body, base.body, nodes!))
        if (effectCopy) retarget(cut, effects)
        if (stripCopy) strip(cut)
        for (const [j, n] of changes) cuttool.setStream(cut, j, n)
        const name = `${prefix}_${kind}${++copies}`
        if (src.has(cutPath(name))) throw new LabError(`the game already has ${cutPath(name)}: pick another internal name`)
        out.files.set(cutPath(name), cuttool.build(cut))
        renamed.set(key, name)
      }
    }
    for (const [f, fid] of FIELDS[kind].entries()) out.fields.set(fid, names[f].map((v) => renamed.get(v.trim().toLowerCase())!))
    const what = [from !== base ? `${from.label}'s` : '', clips.length ? `${clips.length} new audio` : ''].filter(Boolean).join(', ')
    let note = `cutscenes: ${LABELS[kind].toLowerCase()} ${what}`
    if (c.cutscenes.effects[kind] === 'theirs' && from !== base) {
      const lost = missed.get(kind) ?? 0
      note += `; ${effects.size} of ${from.label}'s effects${lost ? `, ${lost} more left as ${base.label}'s (no free effect slot)` : ''}`
    }
    if (c.cutscenes.effects[kind] === 'none') note += '; no effects'
    out.notes.push(note + (cross ? `; ${from.body} animations on a ${base.body} skeleton, so approximate` : ''))
  }
  return out
}