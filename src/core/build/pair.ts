// Two characters at once, as select-screen entries 19 and 20 (ids 18 and 19).
// The second is built on the files the first one changed, and main.dol gets both roster records (dol.ts, patchTwo).
import { LabError } from '../errors'
import * as D from '../game/dol'
import * as R from '../game/roster'
import { type GameSource, LayeredSource } from '../game/source'
import * as nfxtool from '../mnroi/nfxtool'
import { Model } from '../model/glb'
import * as mapping from '../model/mapping'
import { Skeleton } from '../model/skeleton'
import { type Character, problems as characterProblems, type Problem } from '../package/imperfect'
import * as effects from './effects'
import { Builder, type PatchOutput, type Progress, Result, write } from './patch'
import { templateNames } from './templates'
import * as ui from './ui'

export type Pair = [Character, Character]

const lower = (level: string | null) => (level === 'all' ? 'power' : level)

// The tint levels the two get: as asked, unless together they grow the effect cache by more than one full tint may.
export function pairTints(source: GameSource, chars: Pair): [(string | null)[], number] {
  const bases = chars.map((c) => new R.BaseCharacter(source, c.base))
  const asked = chars.map((c) => (c.aura.mode === 'tint' ? c.aura.tint : null))
  const tries = [asked, [asked[0], lower(asked[1])], [lower(asked[0]), asked[1]], asked.map(lower)]
  const seen = new Map<string, number>()
  for (const t of tries) {
    const key = t.join()
    if (!seen.has(key)) seen.set(key, effects.sharedExtra(source, [[bases[0], t[0]], [bases[1], t[1]]]))
    if (seen.get(key)! <= effects.TINT_ALL_LIMIT) return [t, seen.get(key)!]
  }
  return [tries[3], seen.get(tries[3].join())!]
}

// The first character with no ready voice gets its base's when the second has one.
export function withVoices(chars: Pair): [Pair, string[]] {
  const [a, b] = chars
  if (!b.ui.ready_voice || a.ui.ready_voice) return [chars, []]
  const voice = R.VOICES[a.base]
  return [[{ ...a, ui: { ...a.ui, ready_voice: voice } }, b], [`${a.displayName}: no ready voice, but ${b.displayName} has one, so ${a.displayName} uses ${R.label(a.base)}'s (${voice})`]]
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

export function buildPair(source: GameSource, chars: Pair, progress: Progress = () => {}, models: [Model?, Model?] = []): Result {
  if (chars[0].internalName.toLowerCase() === chars[1].internalName.toLowerCase()) {
    throw new LabError(`both characters have the internal name ${chars[0].internalName}: one of them needs another`)
  }
  const [pair, notes] = withVoices(chars)
  const [tints] = pairTints(source, pair)
  pair.forEach((c, i) => {
    if (c.aura.mode === 'tint' && tints[i] !== c.aura.tint) notes.push(`${c.displayName}: aura tint: the two tints together need more effect memory than a match can spare; its idle and power-up effects are tinted`)
  })

  const results: Result[] = []
  let src = source
  pair.forEach((c, i) => {
    const b = new Builder(src, c, (stage, done, total) => progress(`${c.displayName}: ${stage}`, done, total), models[i])
    b.selectId = ui.NEW_ID + i
    b.tint = tints[i]
    b.checkNames()
    results.push(b.buildFiles())
    if (i === 0) src = new LayeredSource(source, new Map([...results[0].sets, ...results[0].adds]))
  })

  // A file the first added and the second changed stays an addition.
  const [r1, r2] = results
  const r = new Result()
  r.sets = new Map(r1.sets)
  r.adds = new Map(r1.adds)
  const added = new Set([...r1.adds.keys()].map((k) => k.toLowerCase()))
  for (const [k, v] of r2.sets) setIn(added.has(k.toLowerCase()) ? r.adds : r.sets, k, v)
  for (const [k, v] of r2.adds) setIn(r.adds, k, v)

  progress('Roster')
  r.dol = D.patchTwo(source.dol, pair.map((c) => ({ internal: c.internalName, display: c.displayName, stats: c.stats.normal, altStats: c.stats.alt })) as [D.NewCharacter, D.NewCharacter])
  // the second's tint was measured with the first's copies already in the file
  const caches = results.map((x) => x.cache).filter((x) => x !== null)
  if (caches.length) {
    r.cache = Math.max(...caches)
    r.dol = D.growEffectCache(r.dol, r.cache)
  }
  r.notes = [...notes, ...results.flatMap((x, i) => x.notes.map((n) => `${pair[i].displayName}: ${n}`))]
  return r
}

export async function patchPair(source: GameSource, chars: Pair, out: PatchOutput, progress: Progress = () => {}, isVerified = false, models: [Model?, Model?] = []): Promise<Result> {
  return write(source, out, progress, isVerified, () => buildPair(source, chars, progress, models))
}

export interface PairCheck {
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
  ])
}

const gameBundle = (source: GameSource, name: string) => ['ngm', 'tpl'].reduce((n, ext) => n + (source.index.byName.get(`bundles/${name}.${ext}`)?.size ?? 0), 0)
const builtBundle = (adds: Map<string, Uint8Array>, name: string) => ['ngm', 'tpl'].reduce((n, ext) => n + (adds.get(`Bundles/${name}.${ext}`)?.length ?? 0), 0)

// Everything that would stop the pair or that a match might not survive, cheapest first; the build is only tried when nothing simpler is wrong.
export function checkPair(source: GameSource, chars: Pair, progress: Progress = () => {}, models: [Model?, Model?] = []): [PairCheck, Result | null] {
  const out: PairCheck = { problems: [], models: [], largest: 0, cacheExtra: 0, notes: [] }
  const add = (level: Problem[0], text: string) => out.problems.push([level, text])
  const errors = () => out.problems.some(([l]) => l === 'error')
  const named = chars.map((c, i) => `${i === 0 ? '19th' : '20th'} (${c.displayName})`)

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
  if (chars[0].internalName.toLowerCase() === chars[1].internalName.toLowerCase()) {
    add('error', `both have the internal name ${chars[0].internalName}: one of them needs another`)
  } else {
    const both = [...claims(chars[0])].filter((n) => claims(chars[1]).has(n))
    if (both.length) add('error', `both would add ${both.join(', ')} to the game: change one internal name`)
  }
  if (errors()) return [out, null]

  const [pair, voiceNotes] = withVoices(chars)
  for (const n of voiceNotes) add('warning', n)
  const [tints, extra] = pairTints(source, pair)
  pair.forEach((c, i) => {
    if (c.aura.mode === 'tint' && tints[i] !== c.aura.tint) {
      add('warning', `${named[i]}: both tints together need more effect memory than a match can spare (the patch can grow it by ${effects.TINT_ALL_LIMIT.toLocaleString('en-US')} bytes), so only its idle and power-up effects are tinted`)
    }
  })
  if (extra > effects.TINT_ALL_LIMIT) add('warning', `even cut back, the two tints grow the effect cache by ${extra.toLocaleString('en-US')} bytes, more than has been tested`)

  let r: Result
  try {
    r = buildPair(source, chars, progress, models)
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
  const total = out.models[0][1] + out.models[1][1]
  if (total > 2 * out.largest && out.models.every(([, size]) => size <= out.largest)) {
    add('warning', `the two models together take ${kb(total)}, more than any two of the game's own: a match between them may run out of memory`)
  }
  return [out, r]
}

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`
