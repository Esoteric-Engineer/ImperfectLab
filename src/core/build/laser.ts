// Z's laser beam (z_button.laser): Iron Man's finisher beam, tinted. game/laser.s drives it.
import { LabError } from '../errors'
import * as gxtex from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import type * as ngmtool from '../mnroi/ngmtool'
import type { Skeleton } from '../model/skeleton'
import type { Laser } from '../package/imperfect'
import { type Effects, paint } from './effects'
import { add, attachment } from './flames'

export const KIND = 67, INDEX = 0
// The finisher's scorch decal is left out. HIT is the sparks at the shaft's end (childflag 0x200).
export const ROOTS = ['altIrnManBeamFXA', 'altIrnManBeamFXB']
const HIT = 'altIrnManBeamHit'
const DONOR_KIND = 9
const DYNGEOM = nfxtool.TYPES.indexOf('dyngeom')
const CONTROLLER = nfxtool.TYPES.indexOf('controller')
// Fraction laser.s finds the beam's dyngeoms by in their length1.
export const SIGN = 0.125
const SHAFT = 5
// Dyngeom type flag that ends the piece at its target (fn_803FEBD8).
const AIMED = 0x4000000
// Textures only Iron Man's bundle and some stages have: grey copies under names of their own, so a tint sets their color.
export const TEXTURES: [string, string][] = [['GE_BlueLightning', 'IL_LaserBolt'], ['GE_PAR_ElectricParticles', 'IL_LaserSpark']]
export const TEXTURE_BUNDLE = 'ironman_alt'

export function signed(length: number, range: number): number {
  return length >= SHAFT ? range + SIGN : Math.max(1, Math.floor(length)) + SIGN
}

function edited(line: string, dyngeom: boolean, hit: boolean, range: number): string {
  const t = nfxtool.tokens(line)
  if (t.length < 2) return line
  const key = t[0].toLowerCase()
  if (key === 'markertype' && Number(t[1]) === DONOR_KIND) return `${t[0]} ${KIND}`
  if (key === 'length1' && dyngeom && !hit) return `${t[0]} ${signed(Number(t[1]), range)}`
  if (key === 'type_flags' && dyngeom && !hit) return `${t[0]} 0x${((Number(t[1]) & ~AIMED) >>> 0).toString(16)}`
  if (key === 'material') {
    const swap = TEXTURES.find(([from]) => from.toLowerCase() === t[1].toLowerCase())
    if (swap) return `${t[0]} ${swap[1]}`
  }
  return line
}

function costume(fx: Effects, color: string, range: number, prefix: string): string {
  for (const name of [...ROOTS, HIT]) if (!fx.has(name)) throw new LabError(`the game's effects have no ${name}`)
  const hit = new Set(fx.tree([HIT]).map((b) => b.name.toLowerCase()))
  const originals = fx.tree(ROOTS)
  const map = fx.tinted(ROOTS, color, prefix, paint)
  for (const b of originals) {
    const name = map.get(b.name.toLowerCase())
    if (!name) continue
    const copy = fx.by.get(name.toLowerCase())!
    copy.lines = copy.lines.map((line, i) => (i ? edited(line, b.type === DYNGEOM, hit.has(b.name.toLowerCase()), range) : line))
  }
  return add(fx, CONTROLLER, [...ROOTS.map((r) => `effectname ${map.get(r.toLowerCase()) ?? r}`), 'renderradius -1', 'type_flags 0x4'], prefix)
}

export function build(fx: Effects, l: Laser, internal: string): [string, string] {
  const prefix = `${internal.slice(0, 2).toLowerCase()}lz`
  const made = new Map<string, string>()
  return [l.color, l.alt_color].map((color) => {
    const key = color.toLowerCase()
    if (!made.has(key)) made.set(key, costume(fx, color, l.range, prefix))
    return made.get(key)!
  }) as [string, string]
}

export function bytes(fresh: () => Effects, l: Laser): number {
  const fx = fresh()
  const before = fx.used()
  build(fx, l, 'xx')
  return fx.used() - before
}

function boneOf(sk: Skeleton, l: Laser): number {
  const node = sk.node(l.bone)
  if (node === undefined) throw new LabError(`the base has no ${l.bone} bone to fire the laser from`)
  return node
}

export function marker(render: ngmtool.Model, sk: Skeleton, l: Laser) {
  render.attachments = [...render.attachments.filter(([, kind, index]) => !(kind === KIND && index === INDEX)), attachment(boneOf(sk, l), KIND, INDEX, l.position)]
}

export function origin(sk: Skeleton, l: Laser): [[number, number, number], [number, number, number]] {
  const at = sk.nodes[boneOf(sk, l)].pos
  return [[...at], [0, 1, 2].map((i) => at[i] + l.position[i]) as [number, number, number]]
}

export function grey(im: gxtex.TplImage): gxtex.TplImage {
  const parts: Uint8Array[] = []
  let at = 0
  for (const [w, h] of gxtex.levels(im.width, im.height, im.mipmaps)) {
    const size = gxtex.dataSize(im.format, w, h)
    const rgba = gxtex.decode(im.format, im.data.subarray(at, at + size), w, h)
    for (let i = 0; i < rgba.length; i += 4) {
      const v = gxtex.gray(rgba.subarray(i, i + 3))
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v
    }
    parts.push(gxtex.encode(im.format, rgba, w, h))
    at += size
  }
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    data.set(p, o)
    o += p.length
  }
  return new gxtex.TplImage(im.header, data)
}