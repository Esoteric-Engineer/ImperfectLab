// Misc/game.nfx: recolored copies of the base's effects for the aura tint.
// A tree of effect blocks (a block and every block its effectname/effect0-3 keys name) is copied under new names with every color turned to the chosen hue/lightness.
// The copies are appended; nothing of the base's changes. Memory limits: docs/LIMITATIONS.md.
import { LabError } from '../errors'
import { formatG } from '../format'
import { type BaseCharacter, text } from '../game/roster'
import type { GameSource } from '../game/source'
import { roundHalfEven } from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import * as nvbtool from '../mnroi/nvbtool'
import { AURA_TINTS } from '../package/imperfect'
import { hlsToRgb, rgbToHls } from './colorsys'
import * as templates from './templates'
import * as tuning from './tuning'

const REFERENCES = ['effectname', 'effect0', 'effect1', 'effect2', 'effect3']
const COLOR_KEYS = ['startcol', 'endcol', 'startcol2', 'endcol2']
const HEX_KEYS = ['startcolor', 'endcolor', 'startcolor2', 'endcolor2']
const PARTICLES = ['partsys', 'partsysdam', 'billboard', 'billboardomni', 'partcylinder', 'partsubfx']
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
}

// Measured by making the copies the patch would make.
export function tintPlans(source: GameSource, base: BaseCharacter): Record<string, TintPlan> {
  const tun = new tuning.Tuning(source, base)
  return Object.fromEntries(AURA_TINTS.map((level) => {
    const fx = new Effects(source.entry('Misc/game.nfx'))
    const [normal, alt] = roots(fx, tun, base, level)
    const before = fx.used()
    fx.tinted(normal, '#808080', copyPrefix('xx', false))
    fx.tinted(alt, '#808080', copyPrefix('xx', true))
    return [level, { roots: normal, alt, bytes: fx.used() - before, extra: cacheSize(fx.used()) - nfxtool.CACHE_SIZE }]
  }))
}

// How much several characters' tints grow the cache together (they share it), measured the same way. A null level tints nothing.
export function sharedExtra(source: GameSource, tints: [BaseCharacter, string | null][]): number {
  const fx = new Effects(source.entry('Misc/game.nfx'))
  tints.forEach(([base, level], i) => {
    if (level === null) return
    const [normal, alt] = roots(fx, new tuning.Tuning(source, base), base, level)
    fx.tinted(normal, '#808080', copyPrefix(`x${i}`, false))
    fx.tinted(alt, '#808080', copyPrefix(`x${i}`, true))
  })
  return cacheSize(fx.used()) - nfxtool.CACHE_SIZE
}

export function tintLevel(plans: Record<string, TintPlan>, level: string): string {
  return level === 'all' && plans.all && plans.all.extra > TINT_ALL_LIMIT ? 'power' : level
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

const num = (x: number) => formatG(x).replace(/\.0$/, '')

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

  used(): number {
    return nfxtool.cacheUse(this.items)[1]
  }

  free(): number {
    return CACHE_MAX - this.used()
  }

  tinted(roots: (string | null)[], color: string, prefix: string): Map<string, string> {
    const blocks = this.changed(roots)
    const names = new Map<string, string>()
    let k = 0
    for (const b of blocks) {
      let next: string
      for (;;) {
        next = `${prefix}${k.toString(36)}`
        k++
        const taken = [...names.values()].some((v) => v.toLowerCase() === next.toLowerCase())
        if (!this.has(next) && !taken) break
      }
      if (next.length > 31) throw new LabError(`effect name ${next} is too long`)
      names.set(b.name.toLowerCase(), next)
    }
    const target = hexRgb(color)
    // The color's opacity scales every alpha the effect has; at 0 the recolored effects are invisible.
    const alpha = hexAlpha(color), opacity = alpha / 255
    const copies: nfxtool.Block[] = []
    for (const b of blocks) {
      const lines = [`${nfxtool.TYPES[b.type]} ${names.get(b.name.toLowerCase())}`]
      let colored = false
      for (let line of b.lines.slice(1, b.lines.length - (b.ended ? 1 : 0))) {
        const t = nfxtool.tokens(line)
        const key = t.length ? t[0].toLowerCase() : ''
        if (REFERENCES.includes(key) && t.length >= 2 && names.has(t[1].toLowerCase())) {
          line = `${t[0]} ${names.get(t[1].toLowerCase())}`
        } else if (COLOR_KEYS.includes(key) && t.length >= 2) {
          const vals = nfxtool.scanFloats(t[1], 4)
          if (vals.length === 4) {
            const [r, g, bl] = tint(vals.slice(1), target)
            line = `${t[0]} (${num(vals[0] * opacity)},${roundHalfEven(r)},${roundHalfEven(g)},${roundHalfEven(bl)})`
            colored = true
          }
        } else if (HEX_KEYS.includes(key) && t.length >= 2) {
          const v = nfxtool.scanHex(t[1])
          if (v) {
            const [r, g, bl] = tint([(v >>> 16) & 255, (v >>> 8) & 255, v & 255], target)
            const out = roundHalfEven((v >>> 24) * opacity) * 0x1000000 + roundHalfEven(r) * 0x10000 + roundHalfEven(g) * 0x100 + roundHalfEven(bl)
            line = `${t[0]} 0x${out.toString(16).padStart(8, '0')}`
            colored = true
          }
        }
        lines.push(line)
      }
      if (!colored && PARTICLES.includes(nfxtool.TYPES[b.type])) lines.push(`endcol (${alpha},${target[0]},${target[1]},${target[2]})`)
      lines.push('end')
      copies.push(new nfxtool.Block(b.type, names.get(b.name.toLowerCase())!, lines, true))
    }
    const items = this.items
    const at = items.length && items[items.length - 1] === '' ? items.length - 1 : items.length
    items.splice(at, 0, ...copies)
    for (const c of copies) if (!this.by.has(c.name.toLowerCase())) this.by.set(c.name.toLowerCase(), c)
    return names
  }

  build(): Uint8Array {
    const [problems] = nfxtool.problems(this.items, CACHE_MAX)
    const bad = problems.filter((p) => p.includes('cache:') || p.includes('records'))
    if (bad.length) throw new LabError(`the effect file would be over its limits: ${bad.join('; ')}`)
    return nfxtool.buildNfx(this.items)
  }
}
