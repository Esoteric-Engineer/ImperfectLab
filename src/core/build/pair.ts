// Two characters at once, as select-screen entries 19 and 20 (ids 18 and 19).
// The second is built on the files the first one changed, and main.dol gets both roster records (dol.ts, patchTwo).
import { LabError } from '../errors'
import * as D from '../game/dol'
import * as R from '../game/roster'
import { type GameSource, LayeredSource } from '../game/source'
import type { Model } from '../model/glb'
import type { Character } from '../package/imperfect'
import * as effects from './effects'
import { Builder, type PatchOutput, type Progress, Result, write } from './patch'
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
