// Animation events start effects named by the performer's own tuning: param k (1-26) is field EFFECT_FIELDS[k - 1] (fn_8005A534).
import * as tuning from './tuning'

export const EFFECT_FIELDS = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 98, 99, 100, 101, 102, 94, 95, 96, 97, 71, 237, 238, 242, 243, 248, 249]
// The events that name a field of the actor playing them (start, stop, and the same on the target).
export const OWN_EFFECTS = new Set([0x48, 0x49, 0x5d, 0x5e])
// Fields the game also reads in play (fn_800E673C's 79 + n, fn_800F1644's 94 + n, the power-up's 98-102).
const IN_PLAY = new Set([80, 81, 82, 83, 84, 85, 86, 94, 95, 96, 97, 98, 99, 100, 101, 102])
// The only k a shipped victim animation or victim actor uses; those play on whoever is thrown (checked in the tests).
export const VICTIM_SLOTS = [5]

export const effectNames = (tun: tuning.Tuning, k: number) => Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(EFFECT_FIELDS[k - 1], s) as string)

export class Slots {
  free: number[]
  // effect names per slot -> the k that names them for the character
  given = new Map<string, number>()
  owned: Set<string>
  tun: tuning.Tuning

  // used: every k an animation or cutscene of the character may still fire
  constructor(tun: tuning.Tuning, used: Iterable<number>) {
    this.tun = tun
    const taken = new Set([...VICTIM_SLOTS, ...used])
    this.free = EFFECT_FIELDS.flatMap((fid, i) => {
      const k = i + 1
      const empty = Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(fid, s)).every((v) => !v)
      return !IN_PLAY.has(fid) && !taken.has(k) && empty ? [k] : []
    })
    // the base's own slots first, as an effect it already names elsewhere costs no free one
    for (let k = EFFECT_FIELDS.length; k >= 1; k--) this.given.set(JSON.stringify(effectNames(tun, k)), k)
    this.owned = new Set(this.given.keys())
  }

  // The other base's k -> the k that names the same effects for the character, and how many found no free slot.
  assign(from: tuning.Tuning, ks: Iterable<number>, rename: (names: string[]) => string[] = (n) => n): [Map<number, number>, number] {
    const map = new Map<number, number>()
    let missed = 0
    for (const k of [...new Set(ks)].filter((k) => k >= 1 && k <= EFFECT_FIELDS.length).sort((a, b) => a - b)) {
      const want = rename(effectNames(from, k))
      if (want.every((v, s) => v === effectNames(this.tun, k)[s])) continue
      const key = JSON.stringify(want)
      const to = this.given.get(key) ?? this.free.shift()
      if (to === undefined) {
        missed++
        continue
      }
      this.given.set(key, to)
      map.set(k, to)
    }
    return [map, missed]
  }

  // The fields given new effects.
  fields(): Map<number, string[]> {
    const out = new Map<number, string[]>()
    for (const [key, k] of this.given) {
      const names = JSON.parse(key) as string[]
      if (!this.owned.has(key) && names.some(Boolean)) out.set(EFFECT_FIELDS[k - 1], names)
    }
    return out
  }
}