// Misc/game.nfx: recolored copies of the base's effects for the aura tint.
// A tree of effect blocks (a block and every block its effectname/effect0-3 keys name) is copied under new names with every color turned to the chosen hue/lightness.
// The copies are appended; nothing of the base's changes.
import { LabError } from '../errors'
import { formatG } from '../format'
import type { BaseCharacter } from '../game/roster'
import type { GameSource } from '../game/source'
import { roundHalfEven } from '../mnroi/gxtex'
import * as nfxtool from '../mnroi/nfxtool'
import { hlsToRgb, rgbToHls } from './colorsys'
import * as tuning from './tuning'

const REFERENCES = ['effectname', 'effect0', 'effect1', 'effect2', 'effect3']
const COLOR_KEYS = ['startcol', 'endcol', 'startcol2', 'endcol2']
const HEX_KEYS = ['startcolor', 'endcolor', 'startcolor2', 'endcolor2']
const PARTICLES = ['partsys', 'partsysdam', 'billboard', 'billboardomni', 'partcylinder', 'partsubfx']

export function tintRoots(source: GameSource, base: BaseCharacter): [string[], string[], number, number] {
  const fx = new Effects(source.entry('Misc/game.nfx'))
  const tun = new tuning.Tuning(source, base)
  const roots = [base.effect1, ...tuning.POWER_EFFECTS.map((f) => tun.value(f) as string)].filter((r) => fx.has(r)) as string[]
  const alt = [base.altEffect1, ...tuning.POWER_EFFECTS.map((f) => tun.value(f, 5) as string)].filter((r) => fx.has(r)) as string[]
  return [roots, alt, fx.cost(roots) + fx.cost(alt), fx.free()]
}

export function hexRgb(color: string): [number, number, number] {
  const c = color.replace(/^#+/, '')
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

export function tint(rgb: number[], target: number[]): [number, number, number] {
  const [, l] = rgbToHls(...(rgb.map((c) => Math.max(0.0, Math.min(255.0, c)) / 255.0) as [number, number, number]))
  const [th, , ts] = rgbToHls(...(target.map((c) => c / 255.0) as [number, number, number]))
  return hlsToRgb(th, l, ts).map((c) => 255.0 * c) as [number, number, number]
}

const num = (x: number) => formatG(x).replace(/\.0$/, '')

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

  cost(roots: string[]): number {
    const used = new Map<string, number>()
    for (const [b, n] of nfxtool.cacheUse(this.items)[0]) used.set(b.name.toLowerCase(), n)
    let total = 0
    for (const b of this.tree(roots)) total += used.get(b.name.toLowerCase()) ?? 0
    return total
  }

  free(): number {
    return nfxtool.CACHE_SIZE - nfxtool.cacheUse(this.items)[1]
  }

  tinted(roots: (string | null)[], color: string, prefix: string): Map<string, string> {
    const blocks = this.tree(roots)
    const names = new Map<string, string>()
    let k = 0
    for (const b of blocks) {
      let next: string
      for (;;) {
        next = `${prefix}${k}`
        k++
        const taken = [...names.values()].some((v) => v.toLowerCase() === next.toLowerCase())
        if (!this.has(next) && !taken) break
      }
      if (next.length > 31) throw new LabError(`effect name ${next} is too long`)
      names.set(b.name.toLowerCase(), next)
    }
    const target = hexRgb(color)
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
            line = `${t[0]} (${num(vals[0])},${roundHalfEven(r)},${roundHalfEven(g)},${roundHalfEven(bl)})`
            colored = true
          }
        } else if (HEX_KEYS.includes(key) && t.length >= 2) {
          const v = nfxtool.scanHex(t[1])
          if (v) {
            const [r, g, bl] = tint([(v >>> 16) & 255, (v >>> 8) & 255, v & 255], target)
            const out = (v >>> 24) * 0x1000000 + roundHalfEven(r) * 0x10000 + roundHalfEven(g) * 0x100 + roundHalfEven(bl)
            line = `${t[0]} 0x${out.toString(16).padStart(8, '0')}`
            colored = true
          }
        }
        lines.push(line)
      }
      if (!colored && PARTICLES.includes(nfxtool.TYPES[b.type])) lines.push(`endcol (255,${target[0]},${target[1]},${target[2]})`)
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
    const [problems] = nfxtool.problems(this.items)
    const bad = problems.filter((p) => p.includes('cache:') || p.includes('records'))
    if (bad.length) throw new LabError(`the effect file would be over its limits: ${bad.join('; ')}`)
    return nfxtool.buildNfx(this.items)
  }
}
