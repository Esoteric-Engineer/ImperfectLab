// Misc/game.nfx: recolored copies of the base's effects for the aura tint, and the blocks flames.ts adds.
// A tree of effect blocks (a block and every block its effectname/effect0-3 keys name) is copied under new names with every color turned to the chosen hue/lightness.
// The copies are appended; nothing of the base's changes. Memory limits: docs/LIMITATIONS.md.
import { latin1 } from '../bytes'
import { LabError } from '../errors'
import { formatG } from '../format'
import { type BaseCharacter, text } from '../game/roster'
import type { GameSource } from '../game/source'
import { readTpl, roundHalfEven } from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import * as nvbtool from '../mnroi/nvbtool'
import { AURA_TINTS, type Flames } from '../package/imperfect'
import { hlsToRgb, rgbToHls } from './colorsys'
import * as flames from './flames'
import * as templates from './templates'
import * as tuning from './tuning'

const REFERENCES = ['effectname', 'effect0', 'effect1', 'effect2', 'effect3']
const COLOR_KEYS = ['startcol', 'endcol', 'startcol2', 'endcol2']
const HEX_KEYS = ['startcolor', 'endcolor', 'startcolor2', 'endcolor2']
const PARTICLES = ['partsys', 'partsysdam', 'billboard', 'billboardomni', 'partcylinder', 'partsubfx']
const ACTIONS = ['damage', 'ctrldamage', 'spawner']
const CONTROLLER = nfxtool.TYPES.indexOf('controller')
export const CACHE_MAX = 0x50000
const CACHE_MARGIN = 0x800

// The most a full tint may grow the cache by before it falls back to 'power'.
export const TINT_ALL_LIMIT = 8224

export function cacheSize(used: number): number {
  return used <= nfxtool.CACHE_SIZE ? nfxtool.CACHE_SIZE : Math.ceil((used + CACHE_MARGIN) / 0x400) * 0x400
}

// What a tint copies, per costume.
export function roots(fx: Effects, tun: tuning.Tuning, base: BaseCharacter, level = 'all'): [string[], string[]] {
  const normal = [base.effect1], alt = [base.altEffect1]
  for (const fid of tun.fieldsOf(nvbtool.T_EFFECT)) {
    const n = tun.value(fid) as string, a = tun.value(fid, 5) as string
    if (tuning.POWER_EFFECTS.includes(fid) || (level === 'all' && n.toLowerCase() !== a.toLowerCase())) {
      normal.push(n)
      alt.push(a)
    }
  }
  const named = (t: string) => templates.chain(base.t, t).flatMap((c) => c.props.map(([, v]) => text(v)))
  for (const fid of level === 'all' ? tun.fieldsOf(nvbtool.T_TEMPLATE) : []) {
    const n = tun.value(fid) as string, a = tun.value(fid, 5) as string
    if (n.toLowerCase() !== a.toLowerCase()) {
      normal.push(...named(n))
      alt.push(...named(a))
    }
  }
  const unique = (names: (string | null)[]) => [...new Map(names.filter((r) => fx.has(r)).map((r) => [r!.toLowerCase(), r!])).values()]
  return [unique(normal), unique(alt)]
}

export interface TintPlan {
  roots: string[]
  alt: string[]
  bytes: number
  extra: number
  used: number
  grey: [number, number]
}

export type Hidden = [boolean, boolean]
export const hidden = (color: string, altColor: string): Hidden => [hexAlpha(color) === 0, hexAlpha(altColor) === 0]
const stand = (hide: boolean) => (hide ? '#80808000' : '#808080')

// tintPlans' key for a level and the costumes it hides.
export function planKey(level: string, hide: Hidden = [false, false]): string {
  return hide[0] || hide[1] ? `${level} hide${hide.map(Number).join('')}` : level
}

const HIDES: Hidden[] = [[false, false], [true, false], [false, true], [true, true]]

// The bytes of the grey fire sprite a costume borrows from Human Torch costume 2 (0 when its own bundle has it).
export function greyBytes(source: GameSource, base: BaseCharacter, alt: boolean): number {
  const at = (bundle: string) => latin1(source.entry(`Bundles/${bundle}.ngt`)).split(/\s+/).filter(Boolean)
    .findIndex((n) => n.toLowerCase() === flames.GREY_SPRITE.toLowerCase())
  if (at(alt ? base.altBundle : base.bundle) >= 0) return 0
  const i = at(flames.GREY_BUNDLE)
  return i < 0 ? 0 : readTpl(source.entry(`Bundles/${flames.GREY_BUNDLE}.tpl`))[0][i].data.length
}

// Measured by making the copies the patch would make.
export function tintPlans(source: GameSource, base: BaseCharacter): Record<string, TintPlan> {
  const tun = new tuning.Tuning(source, base)
  return Object.fromEntries(AURA_TINTS.flatMap((level) => {
    const first = new Effects(source.entry('Misc/game.nfx'))
    const [normal, alt] = roots(first, tun, base, level)
    const fire = [first.drawsFire(normal) ? greyBytes(source, base, false) : 0, first.drawsFire(alt) ? greyBytes(source, base, true) : 0]
    return HIDES.map((hide, h) => {
      const fx = h ? new Effects(source.entry('Misc/game.nfx')) : first
      const before = fx.used()
      fx.tinted(normal, stand(hide[0]), copyPrefix('xx', false))
      fx.tinted(alt, stand(hide[1]), copyPrefix('xx', true))
      const grey: [number, number] = [hide[0] ? 0 : fire[0], hide[1] ? 0 : fire[1]]
      return [planKey(level, hide), { roots: normal, alt, bytes: fx.used() - before, extra: cacheSize(fx.used()) - nfxtool.CACHE_SIZE, used: fx.used(), grey }]
    })
  }))
}

// How much several characters' tints and flames grow the cache together.
export function sharedExtra(source: GameSource, tints: [BaseCharacter, string | null, Hidden?][], fires: (Flames | null)[] = [], more: (fx: Effects) => void = () => {}): number {
  const fx = new Effects(source.entry('Misc/game.nfx'))
  tints.forEach(([base, level, hide = [false, false]], i) => {
    if (level === null) return
    const [normal, alt] = roots(fx, new tuning.Tuning(source, base), base, level)
    fx.tinted(normal, stand(hide[0]), copyPrefix(`x${i}`, false))
    fx.tinted(alt, stand(hide[1]), copyPrefix(`x${i}`, true))
  })
  fires.forEach((f, i) => {
    if (f) flames.effectNames(fx, f, `x${i}`)
  })
  more(fx)
  return cacheSize(fx.used()) - nfxtool.CACHE_SIZE
}

export function planExtra(p: TintPlan, more = 0): number {
  return more ? cacheSize(p.used + more) - nfxtool.CACHE_SIZE : p.extra
}

export function tintLevel(plans: Record<string, TintPlan>, level: string, more = 0, hide: Hidden = [false, false]): string {
  const all = plans[planKey('all', hide)]
  return level === 'all' && all && planExtra(all, more) > TINT_ALL_LIMIT ? 'power' : level
}

export function copyPrefix(internal: string, alt: boolean): string {
  return internal.slice(0, 2).toLowerCase() + (alt ? 'a' : 'f')
}

export function hexRgb(color: string): [number, number, number] {
  const c = color.replace(/^#+/, '')
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

// The opacity of #RRGGBBAA, 0-255 (255 when there is no AA).
export function hexAlpha(color: string): number {
  const c = color.replace(/^#+/, '')
  return c.length >= 8 ? parseInt(c.slice(6, 8), 16) : 255
}

export function tint(rgb: number[], target: number[]): [number, number, number] {
  const [, l] = rgbToHls(...(rgb.map((c) => Math.max(0.0, Math.min(255.0, c)) / 255.0) as [number, number, number]))
  const [th, , ts] = rgbToHls(...(target.map((c) => c / 255.0) as [number, number, number]))
  return hlsToRgb(th, l, ts).map((c) => 255.0 * c) as [number, number, number]
}

export const num = (x: number) => formatG(x).replace(/\.0$/, '')

// The game's orange fire sprite, and its mean color over the grey sprite's (82,48,19 over 50,50,50).
export const FIRE_SPRITE = 'GE_PAR_FireSprite_04'
const FIRE_COLOR = [82 / 50, 48 / 50, 19 / 50]

const draws = (sprite: string) => (line: string): boolean => {
  const t = nfxtool.tokens(line)
  return t.length >= 2 && t[0].toLowerCase() === 'material' && t[1].toLowerCase() === sprite.toLowerCase()
}
const isFire = draws(FIRE_SPRITE)

function onGrey(body: string[]): string[] {
  const fold = (rgb: number[]) => rgb.map((c, i) => Math.min(255, roundHalfEven(c * FIRE_COLOR[i])))
  const keys = new Set<string>()
  const out = body.map((line) => {
    const t = nfxtool.tokens(line)
    const key = t.length ? t[0].toLowerCase() : ''
    keys.add(key)
    if (isFire(line)) return `material ${flames.GREY_SPRITE}`
    if (COLOR_KEYS.includes(key) && t.length >= 2) {
      const vals = nfxtool.scanFloats(t[1], 4)
      if (vals.length === 4) return `${t[0]} (${num(vals[0])},${fold(vals.slice(1)).join(',')})`
    } else if (HEX_KEYS.includes(key) && t.length >= 2) {
      const v = nfxtool.scanHex(t[1])
      if (v) {
        const [r, g, b] = fold([(v >>> 16) & 255, (v >>> 8) & 255, v & 255])
        return `${t[0]} 0x${((v >>> 24) * 0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).padStart(8, '0')}`
      }
    }
    return line
  })
  for (const [col, hex] of [['startcol', 'startcolor'], ['endcol', 'endcolor']]) {
    if (!keys.has(col) && !keys.has(hex)) out.push(`${col} (255,${fold([255, 255, 255]).join(',')})`)
  }
  return out
}

export function recolor(type: number, body: string[], color: string): string[] {
  if (body.some(isFire)) body = onGrey(body)
  const alpha = hexAlpha(color), opacity = alpha / 255
  const dim = body.some(draws(flames.GREY_SPRITE)) ? opacity : 1
  const target = hexRgb(color)
  let colored = false
  const out = body.map((line) => {
    const t = nfxtool.tokens(line)
    const key = t.length ? t[0].toLowerCase() : ''
    if (COLOR_KEYS.includes(key) && t.length >= 2) {
      const vals = nfxtool.scanFloats(t[1], 4)
      if (vals.length === 4) {
        const [r, g, bl] = tint(vals.slice(1), target).map((c) => c * dim)
        colored = true
        return `${t[0]} (${num(vals[0] * opacity)},${roundHalfEven(r)},${roundHalfEven(g)},${roundHalfEven(bl)})`
      }
    } else if (HEX_KEYS.includes(key) && t.length >= 2) {
      const v = nfxtool.scanHex(t[1])
      if (v) {
        const [r, g, bl] = tint([(v >>> 16) & 255, (v >>> 8) & 255, v & 255], target).map((c) => c * dim)
        const out = roundHalfEven((v >>> 24) * opacity) * 0x1000000 + roundHalfEven(r) * 0x10000 + roundHalfEven(g) * 0x100 + roundHalfEven(bl)
        colored = true
        return `${t[0]} 0x${out.toString(16).padStart(8, '0')}`
      }
    }
    return line
  })
  if (!colored && PARTICLES.includes(nfxtool.TYPES[type])) out.push(`endcol (${alpha},${target.map((c) => roundHalfEven(c * dim)).join(',')})`)
  return out
}

// Every color set to color, its AA scaling the alpha as a tint's does.
export function paint(_type: number, body: string[], color: string): string[] {
  const [r, g, b] = hexRgb(color), opacity = hexAlpha(color) / 255
  return body.map((line) => {
    const t = nfxtool.tokens(line)
    const key = t.length ? t[0].toLowerCase() : ''
    if (COLOR_KEYS.includes(key) && t.length >= 2) {
      const vals = nfxtool.scanFloats(t[1], 4)
      if (vals.length === 4) return `${t[0]} (${num(vals[0] * opacity)},${r},${g},${b})`
    } else if (HEX_KEYS.includes(key) && t.length >= 2) {
      const v = nfxtool.scanHex(t[1])
      if (v) return `${t[0]} 0x${(roundHalfEven((v >>> 24) * opacity) * 0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).padStart(8, '0')}`
    }
    return line
  })
}

function hasColor(b: nfxtool.Block): boolean {
  return b.lines.slice(1).some((line) => {
    const t = nfxtool.tokens(line)
    if (t.length < 2) return false
    const key = t[0].toLowerCase()
    return (COLOR_KEYS.includes(key) && nfxtool.scanFloats(t[1], 4).length === 4) || (HEX_KEYS.includes(key) && Boolean(nfxtool.scanHex(t[1])))
  })
}

export class Effects {
  items: nfxtool.Item[]
  by = new Map<string, nfxtool.Block>()
  paints = new Map<string, string>()

  constructor(data: Uint8Array) {
    this.items = nfxtool.readNfx(data)
    for (const b of nfxtool.blocks(this.items)) if (!this.by.has(b.name.toLowerCase())) this.by.set(b.name.toLowerCase(), b)
  }

  has(name: string | null | undefined): boolean {
    return Boolean(name) && this.by.has(name!.toLowerCase())
  }

  tree(roots: (string | null)[]): nfxtool.Block[] {
    const out: nfxtool.Block[] = []
    const todo = roots.filter((r) => this.has(r)) as string[]
    const seen = new Set<string>()
    while (todo.length) {
      const name = todo.shift()!
      if (seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      const block = this.by.get(name.toLowerCase())!
      out.push(block)
      for (const line of block.lines.slice(1)) {
        const t = nfxtool.tokens(line)
        if (t.length >= 2 && REFERENCES.includes(t[0].toLowerCase()) && this.has(t[1])) todo.push(t[1])
      }
    }
    return out
  }

  // The blocks of tree(roots) a tint changes.
  changed(roots: (string | null)[]): nfxtool.Block[] {
    const blocks = this.tree(roots)
    const low = (b: nfxtool.Block) => b.name.toLowerCase()
    const refs = (b: nfxtool.Block) => b.lines.slice(1).map(nfxtool.tokens)
      .filter((t) => t.length >= 2 && REFERENCES.includes(t[0].toLowerCase())).map((t) => t[1].toLowerCase())
    const out = new Set(blocks.filter((b) => PARTICLES.includes(nfxtool.TYPES[b.type]) || hasColor(b)).map(low))
    for (let grew = true; grew;) {
      grew = false
      for (const b of blocks) {
        if (!out.has(low(b)) && refs(b).some((r) => out.has(r))) {
          out.add(low(b))
          grew = true
        }
      }
    }
    return blocks.filter((b) => out.has(low(b)))
  }

  drawsFire(roots: (string | null)[]): boolean {
    return this.changed(roots).some((b) => b.lines.some(isFire))
  }

  // A grab line: a constraint drawn between the two fighters (ddNeckAtt, spidSupAttL).
  isLine(name: string): boolean {
    return this.tree([name]).some((b) => nfxtool.TYPES[b.type] === 'constraint')
  }

  // Each constraint in the effect's tree, null when unset.
  lines(name: string | null): { start: [number, number] | null; end: [number, number] | null }[] {
    return this.tree([name]).filter((b) => nfxtool.TYPES[b.type] === 'constraint').map((b) => {
      const kv = new Map(b.lines.slice(1).map(nfxtool.tokens).filter((t) => t.length >= 2).map((t) => [t[0].toLowerCase(), Number(t[1])]))
      const at = (kind: string, index: string): [number, number] | null => (kv.has(kind) ? [kv.get(kind)!, kv.get(index) ?? 0] : null)
      return { start: at('markertype', 'marker_index'), end: at('endmarker', 'endmarker_id') }
    })
  }

  painted(name: string, color: string, prefix: string): string {
    const key = `${name.toLowerCase()} ${color.toLowerCase()}`
    if (!this.paints.has(key)) this.paints.set(key, this.tinted([name], color, prefix, paint).get(name.toLowerCase()) ?? name)
    return this.paints.get(key)!
  }

  used(): number {
    return nfxtool.cacheUse(this.items)[1]
  }

  free(): number {
    return CACHE_MAX - this.used()
  }

  // The first name prefix + a base-36 counter (from k) that no block has and taken does not hold.
  fresh(prefix: string, taken: Set<string> = new Set(), k = 0): [string, number] {
    for (;;) {
      const next = `${prefix}${k.toString(36)}`
      k++
      if (!this.has(next) && !taken.has(next.toLowerCase())) {
        if (next.length > 31) throw new LabError(`effect name ${next} is too long`)
        return [next, k]
      }
    }
  }

  same(type: number, body: string[]): string | null {
    const want = body.join('\n')
    for (const b of nfxtool.blocks(this.items)) {
      if (b.type === type && b.ended && b.lines.length === body.length + 2 && b.lines.slice(1, -1).join('\n') === want) return b.name
    }
    return null
  }

  append(copies: nfxtool.Block[]) {
    const items = this.items
    const at = items.length && items[items.length - 1] === '' ? items.length - 1 : items.length
    items.splice(at, 0, ...copies)
    for (const c of copies) if (!this.by.has(c.name.toLowerCase())) this.by.set(c.name.toLowerCase(), c)
  }

  tinted(roots: (string | null)[], color: string, prefix: string, how = recolor): Map<string, string> {
    if (how === recolor && hexAlpha(color) === 0) return this.hide(roots, prefix)
    return this.copied(this.changed(roots), prefix, new Map(), (type, body) => how(type, body, color))
  }

  hide(roots: (string | null)[], prefix: string): Map<string, string> {
    const blocks = this.changed(roots)
    const low = (b: nfxtool.Block) => b.name.toLowerCase()
    const refs = (b: nfxtool.Block) => b.lines.slice(1).map(nfxtool.tokens)
      .filter((t) => t.length >= 2 && REFERENCES.includes(t[0].toLowerCase()) && this.has(t[1])).map((t) => t[1].toLowerCase())
    const drawn = new Set(blocks.filter((b) => b.type !== CONTROLLER && !ACTIONS.includes(nfxtool.TYPES[b.type])).map(low))
    for (let grew = true; grew;) {
      grew = false
      for (const b of blocks) {
        if (b.type === CONTROLLER && !drawn.has(low(b)) && refs(b).every((r) => drawn.has(r))) {
          drawn.add(low(b))
          grew = true
        }
      }
    }
    if (!drawn.size) return this.copied(blocks, prefix, new Map(), (_type, body) => body)
    const [none] = this.fresh(prefix)
    this.append([new nfxtool.Block(CONTROLLER, none, [`controller ${none}`, 'end'], true)])
    const names = new Map(blocks.filter((b) => drawn.has(low(b))).map((b) => [low(b), none]))
    return this.copied(blocks.filter((b) => !drawn.has(low(b))), prefix, names, (_type, body) => body)
  }

  // Copies blocks under fresh names, their references following names.
  private copied(blocks: nfxtool.Block[], prefix: string, names: Map<string, string>, how: (type: number, body: string[]) => string[]): Map<string, string> {
    const taken = new Set([...names.values()].map((n) => n.toLowerCase()))
    let k = 0, next: string
    for (const b of blocks) {
      ;[next, k] = this.fresh(prefix, taken, k)
      taken.add(next.toLowerCase())
      names.set(b.name.toLowerCase(), next)
    }
    const copies: nfxtool.Block[] = []
    for (const b of blocks) {
      const body = b.lines.slice(1, b.lines.length - (b.ended ? 1 : 0)).map((line) => {
        const t = nfxtool.tokens(line)
        const key = t.length ? t[0].toLowerCase() : ''
        return REFERENCES.includes(key) && t.length >= 2 && names.has(t[1].toLowerCase()) ? `${t[0]} ${names.get(t[1].toLowerCase())}` : line
      })
      const name = names.get(b.name.toLowerCase())!
      copies.push(new nfxtool.Block(b.type, name, [`${nfxtool.TYPES[b.type]} ${name}`, ...how(b.type, body), 'end'], true))
    }
    this.append(copies)
    return names
  }

  build(): Uint8Array {
    const [problems] = nfxtool.problems(this.items, CACHE_MAX)
    const bad = problems.filter((p) => p.includes('cache:') || p.includes('records'))
    if (bad.length) throw new LabError(`the effect file would be over its limits: ${bad.join('; ')}`)
    return nfxtool.buildNfx(this.items)
  }
}
