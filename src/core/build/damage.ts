// Attack damage (manifest `stats.gameplay.attack_damage_1` to `_5`): tuning fields 22-26 are five values, and every hit takes one of them.
import type * as ngbtool from '../mnroi/ngbtool'
import { HIT_ON } from './reach'

export type DamageKey = 'attack_damage_1' | 'attack_damage_2' | 'attack_damage_3' | 'attack_damage_4' | 'attack_damage_5'
export const KEYS: DamageKey[] = ['attack_damage_1', 'attack_damage_2', 'attack_damage_3', 'attack_damage_4', 'attack_damage_5']
export const THROW_KEY = 'attack_damage_throw'
export const THROW_PARAM = 5
export const THROW_FIELD = 217
export const THROW_TIER = 2

const TIERS: Record<string, number> = {
  LowAttack: 0,
  Attack1: 1, Attack2: 1, Attack3: 1, Attack4: 1, AttackFar: 1, JumpAttackDesc: 1, AirAttack: 1, AirThrow: 1, AirThrowFemale: 1, AirThrowBrute: 1,
  RiseAttack: 2, SuperAttack1: 2, SuperAttack2: 2, SuperLowAttack: 2, JumpAttackPeak: 2, JumpAttackPeak2: 2, SuperJumpAttackDesc: 2, AirAttackFar: 2,
  SuperAirAttack: 2, SwingAttack: 2, WireAttack: 2, DodgeExitAttack: 2, Throw: 2, ThrowFemale: 2, ThrowBrute: 2, WieldJumpAttack: 2, WieldStomp: 2,
  AttackStomp: 3, SuperAttack3: 3, SuperAttack4: 3, SuperAttackFar: 3, SuperJumpAttack: 3, WallAttackStart: 3, SuperSwingAttack: 3, SuperWireAttack: 3,
  DodgeExitSuperAttack: 3, SuperThrow: 3, SuperThrowFemale: 3, SuperThrowBrute: 3, SuperAirThrow: 3, SuperAirThrowFemale: 3, SuperAirThrowBrute: 3,
  WieldSwing: 3, WieldSwing2: 3, WieldFlySwing: 3,
  SuperAttackStomp: 4, SuperRiseAttack: 4, SuperWallAttackStart: 4,
}
// switches to the value its param names, above 4 the second (fn_800E1788)
export const TIER_EVENT = 0x1b
export const OWN = -1

// The values an animation's hits take, OWN for the motion's own; empty when it neither hits nor switches.
export function strikes(events: ngbtool.Event[]): number[] {
  let tier = OWN, hit = false
  const out = new Set<number>()
  for (const [, type, param] of [...events].sort((a, b) => a[0] - b[0])) {
    if (type === TIER_EVENT) tier = param === THROW_PARAM ? THROW_PARAM : param > 4 ? 1 : param
    else if (HIT_ON.includes(type)) {
      out.add(tier)
      hit = true
    }
  }
  return hit ? [...out] : tier === OWN ? [] : [tier]
}

// The values a state's hits take, given its animation's strikes, or none when it isn't an attack.
export function tiers(state: string, hits: number[] | undefined): number[] {
  const own = TIERS[state]
  const list = hits?.length ? hits : own !== undefined ? [OWN] : []
  return [...new Set(list.map((t) => (t === OWN ? own ?? 1 : t)))]
}

export function throwRecord(rec: ngbtool.Record): ngbtool.Record {
  const events = rec.events.map(([f, t, p, v]): ngbtool.Event => [f, t, t === TIER_EVENT ? THROW_PARAM : p, v])
  if (!events.some(([f, t]) => t === TIER_EVENT && f <= 0)) events.unshift([0, TIER_EVENT, THROW_PARAM, 0])
  return { ...rec, events }
}
