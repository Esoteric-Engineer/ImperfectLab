import { airThrows, type Character, damageStages, gunOf, longThrows, shieldThrows, throwReturns } from '../package/imperfect'
import { laserOf, ownSounds, splitsCharge, stretchReturns, throwsDamage } from './patch'

// What a character needs from main.dol patches, for targets that have to provide it another way.
export type DolFeature =
  | 'long_throw' | 'stretch_return' | 'charge_rate' | 'air_throw' | 'shield_throw' | 'throw_return' | 'throw_damage' | 'sounds'
  | 'z_energy' | 'z_stealth' | 'z_costume' | 'z_stats' | 'z_size' | 'z_bullet_time' | 'damage_stages' | 'gun' | 'laser'
  | 'impersonate_moves' | 'impersonate_model' | 'impersonate_stats'

export function dolFeatures(c: Character): DolFeature[] {
  const z = c.zButton
  const out: [DolFeature, boolean][] = [
    ['long_throw', longThrows(c)],
    ['stretch_return', stretchReturns(c)],
    ['charge_rate', splitsCharge(c)],
    ['air_throw', airThrows(c)],
    ['shield_throw', shieldThrows(c)],
    ['throw_return', throwReturns(c)],
    ['throw_damage', throwsDamage(c)],
    ['sounds', ownSounds(c)],
    ['z_energy', Boolean(z?.requires.energy)],
    ['z_stealth', Boolean(z?.stealth)],
    ['z_costume', Boolean(z?.costume)],
    ['z_stats', Boolean(z?.stats)],
    ['z_size', z?.size != null],
    ['z_bullet_time', z?.bullet != null],
    ['damage_stages', damageStages(c).length > 0],
    ['gun', gunOf(c) !== null],
    ['laser', laserOf(c) !== null],
    ['impersonate_moves', Boolean(z?.impersonate?.moves)],
    ['impersonate_model', Boolean(z?.impersonate?.model)],
    ['impersonate_stats', Boolean(z?.impersonate?.stats)],
  ]
  return out.flatMap(([f, on]) => (on ? [f] : []))
}