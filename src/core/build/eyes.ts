// Glowing eyes: Iron Man's eye glow (irnManFX) on two eye markers on the head bone, named in EFFECT2 with the flames and trails.
// The markers are the game's own eye kind (20), so a base's eye effects (Storm's power-up arcs) follow them too.
import { LabError } from '../errors'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Skeleton } from '../model/skeleton'
import type { Eyes } from '../package/imperfect'
import { type Effects, hexAlpha, hexRgb, hidden, num } from './effects'
import * as flames from './flames'

export const EYE_KIND = 20
const BILLBOARD = nfxtool.TYPES.indexOf('billboard')
// irnManFX's alpha and size
const ALPHA = 180, SIZE = 0.1

export const hasAny = (e: Eyes) => e.on && hidden(e.color, e.alt_color).includes(false)

function head(sk: Skeleton): number {
  const node = sk.node('head')
  if (node === undefined) throw new LabError('the base has no head bone for the glowing eyes')
  return node
}

// Each eye's offset from the head bone: index 1 on -X, index 2 on +X.
export const offsets = (e: Eyes): [number, number, number][] => [[-e.position[0], e.position[1], e.position[2]], [...e.position]]

// The base's eye markers give way to the two eyes.
export function markers(render: ngmtool.Model, sk: Skeleton, e: Eyes) {
  const node = head(sk)
  render.attachments = [...render.attachments.filter(([, kind]) => kind !== EYE_KIND), ...offsets(e).map((off, i) => flames.attachment(node, EYE_KIND, i + 1, off))]
}

// Where the eyes are in the model, at bind.
export function positions(sk: Skeleton, e: Eyes): [number, number, number][] {
  const at = sk.nodes[head(sk)].pos
  return offsets(e).map((off) => [0, 1, 2].map((i) => at[i] + off[i]) as [number, number, number])
}

function glow(color: string, size: number): string[] {
  const [r, g, b] = hexRgb(color), a = Math.round(ALPHA * hexAlpha(color) / 255)
  return [
    'material GE_PAR_lensFlare_01_BW',
    `startcol (${a},${r},${g},${b})`,
    `height ${num(SIZE * size)}`,
    `width ${num(SIZE * size)}`,
    'change_speed 0',
    'type_flags 0x1',
    `markertype ${EYE_KIND}`,
    `endcol (${a},${r},${g},${b})`,
  ]
}

export function effectNames(fx: Effects, e: Eyes, internal: string): [string | null, string | null] | null {
  if (!hasAny(e)) return null
  const prefix = `${internal.slice(0, 2).toLowerCase()}ey`
  const hide = hidden(e.color, e.alt_color)
  return [e.color, e.alt_color].map((color, i) => (hide[i] ? null : flames.add(fx, BILLBOARD, glow(color, e.size), prefix))) as [string | null, string | null]
}