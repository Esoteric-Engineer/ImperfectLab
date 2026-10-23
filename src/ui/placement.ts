// Shared by the portrait placement dialog and the art generator's placement tab.
import { defaultPlacement } from '../core/build/patch'
import type { RgbaImage } from '../core/image/rgba'
import { type Character, type Placement, type Pose, POSES } from '../core/package/imperfect'

export const POSE_LABELS: [Pose, string][] = [['ready', 'READY (costume 1 picked)'], ['readyalt', 'READY (costume 2 picked)'], ['rest', 'REST (cursor on the tile)']]

export const PLACEMENT_HELP = "Drag a picture to move it, and set its size. Johnny Ohm's picture won't render in the game, but is useful for placement. Put your character's face about where his is."

export function startingPlacements(sel: Character['ui']['select'], picture: (p: Pose) => RgbaImage): Record<Pose, Placement> {
  const out = {} as Record<Pose, Placement>
  for (const p of POSES) {
    const v = sel[p] ?? (p !== 'rest' ? sel.ready : undefined) ?? defaultPlacement(picture(p))
    out[p] = { scale: v.scale, anchor: [v.anchor[0], v.anchor[1]], glow: v.glow }
  }
  return out
}