// Flames on body parts or the whole body, named in the templates' EFFECT2 (unused by shipped characters).
import { LabError } from '../errors'
import { roundHalfEven } from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Tri } from '../model/fit'
import type { Skeleton } from '../model/skeleton'
import { FLAME_PARTS, type Flames } from '../package/imperfect'
import { Effects, hexAlpha, hexRgb, num } from './effects'

// unused by any shipped model or effect
export const FLAME_KIND = 69

const PARTS: Record<string, { anchor: string; roles: string[]; groups: string[]; scale: number }> = {
  head: { anchor: 'head', roles: [], groups: ['face'], scale: 1.5 },
  chest: { anchor: 'chest', roles: [], groups: [], scale: 1.3 },
  r_hand: { anchor: 'R.hand', roles: [], groups: ['R hand'], scale: 1.0 },
  l_hand: { anchor: 'L.hand', roles: [], groups: ['L hand'], scale: 1.0 },
  r_foot: { anchor: 'R.foot', roles: ['R.toe'], groups: [], scale: 0.8 },
  l_foot: { anchor: 'L.foot', roles: ['L.toe'], groups: [], scale: 0.8 },
}

export const markerIndex = (part: string) => FLAME_PARTS.indexOf(part)

// Human Torch's htFireBallHandR
function partFlame(part: string, size: number): string[] {
  return [
    'material GE_PAR_FireSprite_04',
    'rotate_speed 180',
    'type_flags 0x1008081',
    'part_life 0.2',
    'velocity (0,0,1)',
    `part_size0 ${num(PARTS[part].scale * size)}`,
    'flags 0x60000000',
    `markertype ${FLAME_KIND}`,
    `marker_index ${markerIndex(part)}`,
    'partfadein 0.3',
  ]
}

export const BODY = 'htBodyFire'
function bodyFlame(size: number): string[] {
  return [
    'material GE_PAR_FireSprite_04',
    'startcol (200,200,200,200)',
    'endcol (200,200,200,200)',
    'max_particles 50',
    'spawn_delay 0.05',
    'part_life 0.3',
    `part_size0 ${num(0.35 * size)}`,
    'partfadeout 0.5',
    'gravity -0.1',
    'rotate_speed 90',
    'type_flags 0x1008081',
    'area_type 5',
    'ratio 0',
    'maxdist 1',
    'type_flags2 0x800200',
    'mass 0.1',
    'velocity (0,0,2)',
    'flags2 0xe00',
  ]
}

export const GREY_SPRITE = 'GE_PAR_FireSprite_grey', GREY_BUNDLE = 'torch_alt'

// The grey sprite is drawn additively, so a color's opacity darkens it
function colored(body: string[], color: string, alpha: number): string[] {
  const opacity = hexAlpha(color) / 255
  const [r, g, b] = hexRgb(color).map((v) => roundHalfEven(v * opacity)), a = num(alpha * opacity)
  const light = (v: number) => roundHalfEven(v + (255 * opacity - v) * 0.6)
  const kept = body.filter((line) => !/^(startcol|endcol)\s/i.test(line)).map((line) => (/^material\s/i.test(line) ? `material ${GREY_SPRITE}` : line))
  return [...kept, `startcol (${a},${light(r)},${light(g)},${light(b)})`, `endcol (${a},${r},${g},${b})`]
}

const PARTSYS = nfxtool.TYPES.indexOf('partsys'), CONTROLLER = nfxtool.TYPES.indexOf('controller')

export const hasAny = (f: Flames) => f.body || f.parts.length > 0

export function partMiddle(sk: Skeleton, tris: Map<number, Tri[]>, part: string, what: string): [number, number[] | null] {
  const p = PARTS[part]
  const anchor = sk.node(p.anchor)
  if (anchor === undefined) throw new LabError(`the base has no ${p.anchor} bone for the ${what}`)
  const bones = new Set([anchor, ...p.roles.map((r) => sk.node(r)).filter((n) => n !== undefined),
    ...sk.nodes.filter((n) => p.groups.includes(n.group)).map((n) => n.index)])
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const list of tris.values()) {
    for (const tri of list) {
      for (const [pos, , , w] of tri) {
        if (!w.length || !bones.has(w[0][0])) continue
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], pos[i])
          hi[i] = Math.max(hi[i], pos[i])
        }
      }
    }
  }
  const at = sk.nodes[anchor].pos
  return [anchor, lo[0] <= hi[0] ? [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2 - at[i]) : null]
}

export const attachment = (node: number, kind: number, index: number, off: number[]): ngmtool.Attachment =>
  [node, kind, index, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, off[0], off[1], off[2], 1]]

export function markers(render: ngmtool.Model, sk: Skeleton, tris: Map<number, Tri[]>, parts: string[]): string[] {
  const empty: string[] = []
  for (const part of parts) {
    const [anchor, off] = partMiddle(sk, tris, part, `${part} flame`)
    if (!off) empty.push(part)
    render.attachments.push(attachment(anchor, FLAME_KIND, markerIndex(part), off ?? [0, 0, 0]))
  }
  return empty
}

export function add(fx: Effects, type: number, body: string[], prefix: string): string {
  const same = fx.same(type, body)
  if (same) return same
  const [name] = fx.fresh(prefix)
  fx.append([new nfxtool.Block(type, name, [`${nfxtool.TYPES[type]} ${name}`, ...body, 'end'], true)])
  return name
}

export function effectNames(fx: Effects, f: Flames, internal: string): [string, string] | null {
  if (!hasAny(f)) return null
  const prefix = `${internal.slice(0, 2).toLowerCase()}fl`
  const costume = (color: string | null): string => {
    if (f.body) {
      if (color === null && f.size === 1) {
        if (!fx.has(BODY)) throw new LabError(`the game's effects have no ${BODY}`)
        return BODY
      }
      return add(fx, PARTSYS, color === null ? bodyFlame(f.size) : colored(bodyFlame(f.size), color, 200), prefix)
    }
    const children = f.parts.map((part) => add(fx, PARTSYS, color === null ? partFlame(part, f.size) : colored(partFlame(part, f.size), color, 255), prefix))
    return add(fx, CONTROLLER, children.map((n) => `effectname ${n}`), prefix)
  }
  return [costume(f.color), costume(f.alt_color)]
}
