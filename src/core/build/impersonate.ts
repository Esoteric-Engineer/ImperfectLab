// Z's Impersonation (z_button.impersonate): the tables game/impersonate.s reads.
import type { ImpersonationData } from '../game/dol'
import { loadTable } from '../model/skeleton'
import { THROW_FIELD } from './damage'
import { boneMap, throwStates } from './moves'
import * as energy from './energy'
import { FIELDS, RESISTANCE } from './tuning'

// The body classes in actor +0x200 (SKELETONID) order.
export const CLASSES = ['male', 'female', 'brute'] as const
// Health regeneration (fn_8009D71C).
const HEALTH_REGEN = [43, 44]
const UNMAPPED = 0xff
// Nodes without a role that every class has under the same name.
const SHARED = ['Root', 'Jaw', 'Jaw 2', 'Jaw 3', 'Hips', 'Ground marker', 'Root marker', 'Center marker']

export function statFields(): number[] {
  return [...new Set([...Object.values(FIELDS), ...RESISTANCE, ...HEALTH_REGEN, energy.CHARGE, THROW_FIELD])].sort((a, b) => a - b)
}

function baseNodes(body: string): number {
  return (loadTable(body) as unknown as { base_nodes: number }).base_nodes
}

// A node's name across classes: its role, or one of the names they share.
function keys(body: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const [i, info] of Object.entries(loadTable(body).nodes)) {
    const key = info.role ?? (info.name && SHARED.includes(info.name) ? info.name : null)
    if (key !== null && Number(i) < baseNodes(body)) out.set(key, Number(i))
  }
  return out
}

// The player's node for each of the opponent's base nodes, by role or shared name; UNMAPPED takes its parent's rotation.
export function nodeMap(opponent: string, player: string): number[] {
  const n = baseNodes(opponent)
  if (opponent === player) return Array.from({ length: n }, (_, i) => i)
  const theirs = loadTable(opponent).nodes, ours = keys(player)
  return Array.from({ length: n }, (_, i) => {
    const info = theirs[String(i)]
    const key = info?.role ?? (info?.name && SHARED.includes(info.name) ? info.name : undefined)
    return key !== undefined ? (ours.get(key) ?? UNMAPPED) : UNMAPPED
  })
}

// A clip's bones renumbered onto another class's, as for a taken move; UNMAPPED drops the track. Male has the most, 88.
export const CLIP_BONES = 88
export function clipMap(from: string, to: string): number[] {
  const map = boneMap(from, to, 128)
  return Array.from({ length: CLIP_BONES }, (_, i) => map.get(i) ?? UNMAPPED)
}

export function impersonationData(): ImpersonationData {
  return {
    stats: statFields(),
    bases: CLASSES.map(baseNodes) as [number, number, number],
    maps: CLASSES.map((co) => CLASSES.map((cs) => nodeMap(co, cs))),
    throws: throwStates(),
    clipMaps: CLASSES.map((from) => CLASSES.map((to) => clipMap(from, to))),
  }
}
