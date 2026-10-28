// A character's own sound bank: a copy of its base's with some samples replaced (docs/LIMITATIONS.md, Sounds).
import * as dsp from '../audio/dspadpcm'
import { LabError } from '../errors'
import * as D from '../game/dol'
import { BASES } from '../game/roster'
import type { GameSource } from '../game/source'
import * as abktool from '../mnroi/abktool'
import type { Character, SoundSource } from '../package/imperfect'
import names from '../game/sounds.json'

// SFX_Roekel.abk, the largest character bank. A Roekel mirror match loads two, so a bank this size fits any match.
export const MAX_BANK = 969672

export const bankName = (base: string) => D.gameSoundBank(BASES[base][3])
export const bankPath = (name: string) => `Sounds/${name}.abk`

// Custom sound names (game doesn't ship any) pulled from sounds.json. THESE ARE NOT OFFICIAL NAMES.
const NAMES: Record<string, Record<string, string>> = names

export function soundName(base: string, index: number): string | null {
  return (Object.hasOwn(NAMES, base) && NAMES[base][String(index + 1)]) || null
}

export interface Sound {
  rate: number
  samples: number
  loop: boolean
  stereo: boolean
  bytes: number
}

export interface BankInfo {
  bank: string
  bytes: number
  sounds: Sound[]
}

export type Catalog = Record<string, BankInfo>

export function catalog(src: GameSource): Catalog {
  const out: Catalog = {}
  for (const base of Object.keys(BASES)) {
    const name = bankName(base), path = bankPath(name)
    if (!src.has(path)) continue
    const b = abktool.read(src.entry(path))
    out[base] = {
      bank: name,
      bytes: b.abk.length,
      sounds: b.samples.map((s) => {
        const i = abktool.info(s)
        return { rate: i.rate, samples: i.samples, loop: i.loop !== null, stereo: i.channels > 1, bytes: i.bytes }
      }),
    }
  }
  return out
}

export function gameRef(ref: string): [string, number] {
  const m = /^([a-z]+):(\d{1,3})$/.exec(ref)
  if (!m || !(m[1] in BASES)) throw new LabError(`there is no game sound ${JSON.stringify(ref.slice(0, 40))}`)
  return [m[1], Number(m[2])]
}

class Banks {
  src: GameSource
  cache = new Map<string, abktool.Bank>()

  constructor(src: GameSource) {
    this.src = src
  }

  get(base: string): abktool.Bank {
    if (!this.cache.has(base)) this.cache.set(base, abktool.read(this.src.entry(bankPath(bankName(base)))))
    return this.cache.get(base)!
  }

  sample(base: string, index: number): abktool.Sample {
    const s = this.get(base).samples[index]
    if (!s) throw new LabError(`${BASES[base][0]}'s sound bank has no sound ${index + 1}`)
    return s
  }
}

export function pcm(src: GameSource, base: string, index: number): [Int16Array, number] {
  const s = new Banks(src).sample(base, index)
  return [dsp.decode(abktool.channel0(s)), abktool.info(s).rate]
}

function adpcm(banks: Banks, c: Character, from: SoundSource): [dsp.Adpcm, number] {
  if ('file' in from) {
    const body = c.files.get(from.file)
    if (!body) throw new LabError(`the sound file ${from.file} is missing`)
    const d = dsp.readDsp(body)
    return [d, d.rate]
  }
  const s = banks.sample(...gameRef(from.game))
  return [abktool.channel0(s), abktool.info(s).rate]
}

export function build(src: GameSource, c: Character): Uint8Array | null {
  const slots = Object.entries(c.sounds)
  if (!slots.length) return null
  const banks = new Banks(src)
  const bank = banks.get(c.base)
  const reps = new Map<number, abktool.Replacement>()
  const sources = new Map<string, [dsp.Adpcm, number]>()
  for (const [slot, from] of slots) {
    const i = Number(slot)
    const target = banks.sample(c.base, i)
    const key = 'file' in from ? from.file : from.game
    if (!sources.has(key)) sources.set(key, adpcm(banks, c, from))
    const [a, rate] = sources.get(key)!
    reps.set(i, { ...a, rate, loop: abktool.info(target).loop !== null })
  }
  const out = abktool.build(bank, reps)
  if (out.length > MAX_BANK) {
    throw new LabError(`the new sounds make the sound bank ${out.length} bytes, more than the ${MAX_BANK} a match can load: shorten them or lower their rate`)
  }
  return out
}
