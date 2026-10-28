// Energy costs (manifest `stats.gameplay.energy_*`): tuning fields the game both checks the bar against and takes from it (fn_80084B68, fn_80084A60).
export type EnergyKey =
  | 'energy_super_attack' | 'energy_super_low' | 'energy_super_stomp' | 'energy_super_rise' | 'energy_super_jump_attack' | 'energy_super_jump_desc'
  | 'energy_super_wall' | 'energy_super_swing' | 'energy_dodge_super' | 'energy_super_throw' | 'energy_super_air_throw' | 'energy_super_ranged'
  | 'energy_super_run' | 'energy_super_jump' | 'energy_flight' | 'energy_flight_min' | 'energy_wire_extend'

export interface Cost {
  key: EnergyKey
  field: number
  label: string
  moves: string[]
  flight?: boolean
}

export const SUPER: Cost[] = [
  { key: 'energy_super_attack', field: 31, label: 'Super attack', moves: ['SuperAttack1', 'SuperAttack2', 'SuperAttack3', 'SuperAttack4', 'SuperAttackFar', 'SuperAirAttack', 'WallClimbRangedAttack'] },
  { key: 'energy_super_low', field: 36, label: 'Super low attack', moves: ['SuperLowAttack'] },
  { key: 'energy_super_stomp', field: 187, label: 'Super stomp', moves: ['SuperAttackStomp'] },
  { key: 'energy_super_rise', field: 227, label: 'Super rise attack', moves: ['SuperRiseAttack'] },
  { key: 'energy_super_jump_attack', field: 35, label: 'Super jump attack', moves: ['SuperJumpAttack'] },
  { key: 'energy_super_jump_desc', field: 225, label: 'Super jump attack descending', moves: ['SuperJumpAttackDesc'] },
  { key: 'energy_super_wall', field: 226, label: 'Super wall attack', moves: ['SuperWallAttackStart'] },
  { key: 'energy_super_swing', field: 230, label: 'Super swing and wire attacks', moves: ['SuperSwingAttack', 'SuperWireAttack'] },
  { key: 'energy_dodge_super', field: 228, label: 'Dodge exit super attack', moves: ['DodgeExitSuperAttack'] },
  { key: 'energy_super_throw', field: 37, label: 'Super throw', moves: ['SuperThrow'] },
  { key: 'energy_super_air_throw', field: 229, label: 'Super air throw', moves: ['SuperAirThrow'] },
  { key: 'energy_super_ranged', field: 32, label: 'Super ranged attack', moves: ['SuperRangedAttack'] },
]

export const OTHER: Cost[] = [
  { key: 'energy_super_run', field: 30, label: 'Super run (per second) and wire swing', moves: ['SuperRun', 'WireSwing'] },
  { key: 'energy_super_jump', field: 34, label: 'Super jump', moves: ['SuperJump'] },
  { key: 'energy_flight', field: 158, label: 'Flying up (per second)', moves: ['FlyUp'], flight: true },
  { key: 'energy_flight_min', field: 41, label: 'Needed to take off', moves: ['FlyTakeoff'], flight: true },
  { key: 'energy_wire_extend', field: 196, label: 'Wire extend', moves: ['WireExtend'] },
]

export const COSTS = [...SUPER, ...OTHER]
export const FIELDS: Record<string, number> = Object.fromEntries(COSTS.map((c) => [c.key, c.field]))

// fn_800DA884 caches these at +0x414 and replaces a 0 there with the super attack cost.
export const FALLBACK: EnergyKey[] = [
  'energy_super_low', 'energy_super_stomp', 'energy_super_rise', 'energy_super_jump_attack', 'energy_super_jump_desc',
  'energy_super_wall', 'energy_super_swing', 'energy_dodge_super', 'energy_super_air_throw',
]

// Recharge per second: field 45 refills the bar, and holding R (the Power state) swaps in field 45 × GLOBALS 57 + field 245 (fn_8009D71C, dol.ts chargeRate).
export type RechargeKey = 'energy_regen' | 'energy_charge'
export const REGEN = 45
export const CHARGE = 245
export const CHARGE_SCALE = 57
export const RECHARGE: { key: RechargeKey; label: string }[] = [
  { key: 'energy_regen', label: 'Passive (per second)' },
  { key: 'energy_charge', label: 'Holding R (per second)' },
]
