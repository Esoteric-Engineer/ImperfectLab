// Motion trails: ribbons swept between joints, as the game's blade trails (ddBatonSTrl), named in EFFECT2 with the flames.
import { LabError } from '../errors'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Tri } from '../model/fit'
import type { Skeleton } from '../model/skeleton'
import type { Flames, Trails } from '../package/imperfect'
import { Effects, hexAlpha, hexRgb, num } from './effects'
import * as flames from './flames'

export const TRAIL_KIND = 68 // unused by any shipped model or effect

const JOINTS: { bone?: string; part?: string }[] = [
  { bone: 'R.upper_arm' }, { bone: 'R.forearm' }, { part: 'r_hand' },
  { bone: 'L.upper_arm' }, { bone: 'L.forearm' }, { part: 'l_hand' },
  { bone: 'R.thigh' }, { bone: 'R.calf' }, { bone: 'R.foot' },
  { bone: 'L.thigh' }, { bone: 'L.calf' }, { bone: 'L.foot' },
  { bone: 'pelvis' }, { bone: 'neck' }, { part: 'head' },
]

export const SEGMENTS: Record<string, [number, number][]> = {
  arms: [[0, 1], [1, 2], [3, 4], [4, 5]],
  legs: [[6, 7], [7, 8], [9, 10], [10, 11]],
  body: [[12, 13]],
  head: [[13, 14]],
}

const TRAIL = nfxtool.TYPES.indexOf('trail'), CONTROLLER = nfxtool.TYPES.indexOf('controller')

export const hasAny = (t: Trails) => t.parts.length > 0

export function markers(render: ngmtool.Model, sk: Skeleton, tris: Map<number, Tri[]>, parts: string[]) {
  const joints = new Set(parts.flatMap((p) => SEGMENTS[p].flat()))
  for (const j of [...joints].sort((a, b) => a - b)) {
    const { bone, part } = JOINTS[j]
    if (part) {
      const [anchor, off] = flames.partMiddle(sk, tris, part)
      render.attachments.push(flames.attachment(anchor, TRAIL_KIND, j, off ?? [0, 0, 0]))
      continue
    }
    const node = sk.node(bone!)
    if (node === undefined) throw new LabError(`the base has no ${bone} bone for its motion trails`)
    render.attachments.push(flames.attachment(node, TRAIL_KIND, j, [0, 0, 0]))
  }
}

function ribbon(color: string, length: number): string[] {
  const [r, g, b] = hexRgb(color)
  return [
    `startcol (${hexAlpha(color)},${r},${g},${b})`,
    `endcol (0,${r},${g},${b})`,
    `sampledelay ${num(Math.max(0.005, length / 50))}`,
    'max_particles 50',
    `part_life ${num(length)}`,
    `markertype ${TRAIL_KIND}`,
    `endmarker ${TRAIL_KIND}`,
    'type_flags 0x1',
    'flags 0x20100000',
  ]
}

const GROUPS = [['arms'], ['legs'], ['body', 'head']]

export function effectNames(fx: Effects, t: Trails, internal: string): [string, string] | null {
  if (!hasAny(t)) return null
  const prefix = `${internal.slice(0, 2).toLowerCase()}tr`
  const costume = (color: string): string => {
    const trail = flames.add(fx, TRAIL, ribbon(color, t.length), prefix)
    const groups = GROUPS.map((g) => g.filter((p) => t.parts.includes(p))).filter((g) => g.length).map((g) =>
      flames.add(fx, CONTROLLER, g.flatMap((p) => SEGMENTS[p].flatMap(([a, b]) => [`effectname ${trail}`, `marker_index ${a}`, `endmarker_id ${b}`])), prefix))
    return groups.length === 1 ? groups[0] : flames.add(fx, CONTROLLER, groups.map((n) => `effectname ${n}`), prefix)
  }
  return [costume(t.color), costume(t.alt_color)]
}

export function alwaysOn(fx: Effects, f: Flames, t: Trails, internal: string): [string, string] | null {
  const fire = flames.effectNames(fx, f, internal)
  const trails = effectNames(fx, t, internal)
  if (!fire || !trails) return fire ?? trails
  const prefix = `${internal.slice(0, 2).toLowerCase()}tr`
  const both = (i: number) => flames.add(fx, CONTROLLER, [`effectname ${fire[i]}`, `effectname ${trails[i]}`], prefix)
  return [both(0), both(1)]
}

export const label = (f: Flames, t: Trails) => [flames.hasAny(f) ? 'flames' : '', hasAny(t) ? 'motion trails' : ''].filter(Boolean).join(' and ')

export function cost(f: Flames, t: Trails): number {
  if (!flames.hasAny(f) && !hasAny(t)) return 0
  const fx = new Effects(new Uint8Array())
  fx.append([new nfxtool.Block(nfxtool.TYPES.indexOf('partsys'), flames.BODY, [`partsys ${flames.BODY}`, 'material x', 'end'], true)])
  const before = fx.used()
  alwaysOn(fx, f, t, 'xx')
  return fx.used() - before
}
