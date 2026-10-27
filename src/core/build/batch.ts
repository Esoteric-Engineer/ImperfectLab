// One to nine characters at once, as select-screen entries 19 to 27 (ids 18 to 26), the select grid's third row.
// Each is built on the files the ones before it changed, and main.dol gets all their roster records (dol.ts, patchMany).
import { LabError } from '../errors'
import * as D from '../game/dol'
import * as R from '../game/roster'
import { type GameSource, LayeredSource } from '../game/source'
import * as nfxtool from '../mnroi/nfxtool'
import { Model } from '../model/glb'
import * as mapping from '../model/mapping'
import { Skeleton } from '../model/skeleton'
import { type Character, hasCutscenes, problems as characterProblems, type Problem } from '../package/imperfect'
import * as effects from './effects'
import * as moves from './moves'
import { motionSetName, SLOTS } from './moves'
import { Builder, mirrors, ownMotions, ownSounds, paintsReach, type PatchOutput, type Progress, Result, tuningFields, write, zCharacters } from './patch'
import { templateNames } from './templates'
import * as tuning from './tuning'
import * as ui from './ui'

export type Batch = Character[]
export const MAX_BATCH = D.MAX_NEW

// 19th, 20th, 21st, ... for the character at index i.
export function ordinal(i: number): string {
  const n = 19 + i
  const end = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'
  return `${n}${end}`
}

const lower = (level: string | null) => (level === 'all' ? 'power' : level)

// The tint levels they get: as asked, unless together (with their flames) they grow the effect cache by more than one full tint may.
export function batchTints(source: GameSource, chars: Batch): [(string | null)[], number] {
  const bases = chars.map((c) => new R.BaseCharacter(source, c.base))
  const asked = chars.map((c) => (c.aura.mode === 'tint' ? c.aura.tint : null))
  const full = asked.flatMap((t, i) => (t === 'all' ? [i] : [])).reverse()
  const cut = (which: number[]) => asked.map((t, i) => (which.includes(i) ? lower(t) : t))
  const tries = [asked, ...full.map((i) => cut([i])), ...full.slice(1).map((_, k) => cut(full.slice(0, k + 2)))]
  const lines = (fx: effects.Effects) => chars.forEach((c, i) => {
    if (c.moveLines.color === null && c.moveLines.alt_color === null) return
    const prefixes: [string, string] = [`x${i}f`, `x${i}a`]
    if (Object.values(c.moveEffects).includes('theirs')) moves.planEffects(source, bases[i], c.moveEffects, fx, c.moveLines, prefixes, [], moves.movedEffects(source, bases[i], c.moves))
    if (paintsReach(c)) {
      const fids = moves.reachLineFields(source, bases[i], c.moveReach, c.moves, c.moveEffects, fx)
      moves.paintLines(fx, new tuning.Tuning(source, bases[i]), fids, c.moveLines, prefixes)
    }
  })
  const seen = new Map<string, number>()
  for (const t of tries) {
    const key = t.join()
    if (!seen.has(key)) seen.set(key, effects.sharedExtra(source, t.map((level, i) => [bases[i], level, effects.hidden(chars[i].aura.color, chars[i].aura.alt_color)]), chars.map((c) => c.flames), lines))
    if (seen.get(key)! <= effects.TINT_ALL_LIMIT) return [t, seen.get(key)!]
  }
  const last = tries[tries.length - 1]
  return [last, seen.get(last.join())!]
}

export function withVoices(chars: Batch): [Batch, string[]] {
  const last = chars.findLastIndex((c) => c.ui.ready_voice)
  const notes: string[] = []
  const out = chars.map((c, i) => {
    if (i > last || c.ui.ready_voice) return c
    const voice = R.VOICES[c.base]
    notes.push(`${c.displayName}: no ready voice, but ${chars[last].displayName} has one, so ${c.displayName} uses ${R.label(c.base)}'s (${voice})`)
    return { ...c, ui: { ...c.ui, ready_voice: voice } }
  })
  return [out, notes]
}

function setIn(map: Map<string, Uint8Array>, name: string, data: Uint8Array) {
  for (const k of map.keys()) {
    if (k.toLowerCase() === name.toLowerCase()) {
      map.set(k, data)
      return
    }
  }
  map.set(name, data)
}

function sameNames(chars: Batch): [number, number][] {
  const out: [number, number][] = []
  chars.forEach((a, i) => chars.forEach((b, j) => {
    if (i < j && a.internalName.toLowerCase() === b.internalName.toLowerCase()) out.push([i, j])
  }))
  return out
}

export function buildBatch(source: GameSource, chars: Batch, progress: Progress = () => {}, models: (Model | undefined)[] = []): Result {
  if (!chars.length || chars.length > MAX_BATCH) throw new LabError(`a patch takes 1 to ${MAX_BATCH} characters, not ${chars.length}`)
  const same = sameNames(chars)[0]
  if (same) throw new LabError(`the ${ordinal(same[0])} and ${ordinal(same[1])} characters both have the internal name ${chars[same[0]].internalName}: one of them needs another`)
  const [batch, notes] = withVoices(chars)
  const [tints] = batchTints(source, batch)
  batch.forEach((c, i) => {
    if (c.aura.mode === 'tint' && tints[i] !== c.aura.tint) notes.push(`${c.displayName}: aura tint: the tints together need more effect memory than a match can spare; its idle and power-up effects are tinted`)
  })

  const r = new Result()
  const added = new Set<string>()
  const results: Result[] = []
  let src = source
  batch.forEach((c, i) => {
    const name = batch.length > 1 ? `${c.displayName} (${i + 1} of ${batch.length})` : c.displayName
    const b = new Builder(src, c, (stage, done, total) => progress(`${name}: ${stage}`, done, total), models[i])
    b.selectId = ui.NEW_ID + i
    b.tint = tints[i]
    b.checkNames()
    const x = b.buildFiles()
    results.push(x)
    for (const [k, v] of x.sets) setIn(added.has(k.toLowerCase()) ? r.adds : r.sets, k, v)
    for (const [k, v] of x.adds) {
      setIn(r.adds, k, v)
      added.add(k.toLowerCase())
    }
    if (i < batch.length - 1) src = new LayeredSource(source, new Map([...r.sets, ...r.adds]))
  })

  progress('Roster')
  const records = batch.map((c) => ({ internal: c.internalName, display: c.displayName, stats: c.stats.normal, altStats: c.stats.alt }))
  r.dol = records.length === 1 ? D.patch(source.dol, records[0].internal, records[0].display, records[0].stats, records[0].altStats) : D.patchMany(source.dol, records)
  // each tint was measured with the earlier ones' copies already in the file
  const caches = results.map((x) => x.cache).filter((x) => x !== null)
  if (caches.length) {
    r.cache = Math.max(...caches)
    r.dol = D.growEffectCache(r.dol, r.cache)
  }
  if (batch.some(mirrors)) r.dol = D.mirrorSkip(r.dol)
  if (batch.some(ownSounds)) r.dol = D.soundBanks(r.dol, batch.filter(ownSounds).map((c) => c.internalName))
  if (batch.some((c) => c.zButton)) r.dol = D.zActions(r.dol, zCharacters(batch))
  r.notes = [...notes, ...results.flatMap((x, i) => x.notes.map((n) => `${batch[i].displayName}: ${n}`))]
  return r
}

export async function patchBatch(source: GameSource, chars: Batch, out: PatchOutput, progress: Progress = () => {}, isVerified = false, models: (Model | undefined)[] = []): Promise<Result> {
  return write(source, out, progress, isVerified, () => buildBatch(source, chars, progress, models))
}

export interface BatchCheck {
  problems: Problem[]
  // each one's model bundle (.ngm and .tpl, the larger costume), and the largest of the game's own
  models: [string, number][]
  largest: number
  // how much the effect cache grows by, over the game's 300,000 bytes
  cacheExtra: number
  notes: string[]
}

// The names a character adds to the game's files, lowercased.
function claims(c: Character): Set<string> {
  const n = c.internalName.toLowerCase()
  return new Set([
    ...templateNames(c.internalName).map((t) => t.toLowerCase()),
    `bundles/${n}`, `bundles/${n}_alt`, `misc/player_${n}.nvb`,
    `plr_${n}_rage`, `plr_alt${n}_rage`, ...R.LANGS.map((l) => `ovr_${n}${l.toLowerCase()}`),
    ...(ownMotions(c) ? [`motions/${motionSetName(c.internalName).toLowerCase()}`, ...SLOTS.map((slot) => `bundles/${n}${slot}.ngb`)] : []),
    ...(ownSounds(c) ? [`sounds/sfx_${n}.abk`] : []),
  ])
}

// Whether the character gets its own tuning file, and so a line in Misc/nvblist.txt (Builder.tuning).
const tuned = (c: Character) => c.aura.mode === 'tint' || Object.keys(tuningFields(c)).length > 0 || hasCutscenes(c.cutscenes) || Object.values(c.moveEffects).includes('theirs') || paintsReach(c)

const gameBundle = (source: GameSource, name: string) => ['ngm', 'tpl'].reduce((n, ext) => n + (source.index.byName.get(`bundles/${name}.${ext}`)?.size ?? 0), 0)
const builtBundle = (adds: Map<string, Uint8Array>, name: string) => ['ngm', 'tpl'].reduce((n, ext) => n + (adds.get(`Bundles/${name}.${ext}`)?.length ?? 0), 0)

// Everything that would stop the batch or that a match might not survive, cheapest first; the build is only tried when nothing simpler is wrong.
export function checkBatch(source: GameSource, chars: Batch, progress: Progress = () => {}, models: (Model | undefined)[] = []): [BatchCheck, Result | null] {
  const out: BatchCheck = { problems: [], models: [], largest: 0, cacheExtra: 0, notes: [] }
  const add = (level: Problem[0], text: string) => out.problems.push([level, text])
  const errors = () => out.problems.some(([l]) => l === 'error')
  const named = chars.map((c, i) => `${ordinal(i)} (${c.displayName})`)

  if (!chars.length || chars.length > MAX_BATCH) {
    add('error', `choose 1 to ${MAX_BATCH} characters`)
    return [out, null]
  }
  chars.forEach((c, i) => {
    for (const [level, msg] of characterProblems(c)) add(level, `${named[i]}: ${msg}`)
    if (!c.glb || !(c.base in R.BASES)) return
    try {
      const sk = Skeleton.ofBase(new R.BaseCharacter(source, c.base))
      for (const [level, msg] of mapping.check(models[i] ?? new Model(c.glb), sk, c.mapping, c.overrides)) add(level, `${named[i]}: ${msg}`)
    } catch (e) {
      if (!(e instanceof LabError)) throw e
      add('error', `${named[i]}: ${e.message}`)
    }
  })
  if (errors()) return [out, null]

  chars.forEach((c, i) => {
    try {
      new Builder(source, c).checkNames()
    } catch (e) {
      if (!(e instanceof LabError)) throw e
      add('error', `${named[i]}: ${e.message}`)
    }
  })
  const same = sameNames(chars)
  for (const [i, j] of same) add('error', `${named[i]} and ${named[j]} both have the internal name ${chars[i].internalName}: one of them needs another`)
  chars.forEach((a, i) => chars.forEach((b, j) => {
    if (i >= j || same.some(([x, y]) => x === i && y === j)) return
    const both = [...claims(a)].filter((n) => claims(b).has(n))
    if (both.length) add('error', `${named[i]} and ${named[j]} both would add ${both.join(', ')} to the game: change one internal name`)
  }))
  const lines = chars.flatMap((c, i) => (tuned(c) ? [i] : []))
  const need = lines.reduce((n, i) => n + tuning.listCost(chars[i].internalName), 0)
  const room = tuning.listRoom(source.entry('Misc/nvblist.txt'))
  if (need > room) {
    add('error', `${lines.map((i) => named[i]).join(', ')} each need their own tuning file (a tinted aura, changed gameplay or cutscenes), and their lines in the game's tuning list take ${need} bytes where it has ${room} free (a line costs its internal name's length plus 8): give some of them the Base or Swap aura, default gameplay and their base's cutscenes, or shorter internal names`)
  }
  if (errors()) return [out, null]

  const [batch, voiceNotes] = withVoices(chars)
  for (const n of voiceNotes) add('warning', n)
  const [tints, extra] = batchTints(source, batch)
  batch.forEach((c, i) => {
    if (c.aura.mode === 'tint' && tints[i] !== c.aura.tint) {
      add('warning', `${named[i]}: the tints together need more effect memory than a match can spare (the patch can grow it by ${effects.TINT_ALL_LIMIT.toLocaleString('en-US')} bytes), so only its idle and power-up effects are tinted`)
    }
  })
  chars.forEach((a, i) => chars.forEach((b, j) => {
    if (i < j && a.base === b.base && (ownSounds(a) || ownSounds(b))) {
      add('note', `${named[i]} and ${named[j]} share a base, so in a match between them both fighters use the first player's sounds`)
    }
  }))
  if (extra > effects.TINT_ALL_LIMIT) add('warning', `even cut back, the tints and flames grow the effect cache by ${extra.toLocaleString('en-US')} bytes, more than has been tested`)

  let r: Result
  try {
    r = buildBatch(source, chars, progress, models)
  } catch (e) {
    if (!(e instanceof LabError)) throw e
    add('error', `the patch cannot be built: ${e.message}`)
    return [out, null]
  }
  out.notes = r.notes
  out.cacheExtra = (r.cache ?? nfxtool.CACHE_SIZE) - nfxtool.CACHE_SIZE
  for (const key of R.keys()) {
    const b = new R.BaseCharacter(source, key)
    out.largest = Math.max(out.largest, gameBundle(source, b.bundle), gameBundle(source, b.altBundle))
  }
  out.models = chars.map((c, i) => {
    const n = c.internalName.toLowerCase()
    return [named[i], Math.max(builtBundle(r.adds, n), builtBundle(r.adds, n + '_alt'))]
  })
  out.models.forEach(([name, size]) => {
    if (size > out.largest) add('warning', `${name}: its model takes ${kb(size)}, more than any of the game's own (${kb(out.largest)}): a match may run out of memory and crash on the loading screen`)
  })
  // A match loads two: the two largest are the most it can be asked for.
  const [first, second] = [...out.models].sort((a, b) => b[1] - a[1])
  if (second) {
    const total = first[1] + second[1]
    if (total > 2 * out.largest && out.models.every(([, size]) => size <= out.largest)) {
      add('warning', `${chars.length === 2 ? 'the two models' : `the two largest models, the ${first[0]} and the ${second[0]},`} together take ${kb(total)}, more than any two of the game's own: a match between them may run out of memory`)
    }
  }
  return [out, r]
}

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`
