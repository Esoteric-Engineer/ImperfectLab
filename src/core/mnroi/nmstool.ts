// Motion sets (Motions/<name>.nms), ported from mnroi tools/nmstool.py (commit 2c95a269), kept line for line so a set can be edited and written back.
// Text, read by fn_80090034 one fgets(0x1FF) line at a time; a line whose first byte is ';' is a comment, and tokens are split on " \r\t\n":
//   basedon <base>          the preloaded set (male, female, brute, female2, humanpeon, brutepeon) whose states fill in the ones this file leaves out
//   overlay [<name>]        starts the next overlay
//   <State> <file.nad> opt  one motion: [fps f] [dist f] [move f] [flags...], until the line ends or a token starts with ';'
// A last line with no newline is dropped, as the game drops it.
import { encodeLatin1, latin1 } from '../bytes'
import { LabError } from '../errors'

export const BASES = ['male', 'female', 'brute', 'female2', 'humanpeon', 'brutepeon']
const LINE = 0x1fe
const DELIM = /[ \r\t\n]+/

export interface Motion {
  state: string
  anim: string
  opts: string[]
}

interface Line {
  raw: string
  // the overlay it is in (the first is 0), or -1 for a line the game never reads
  overlay: number
  motion: Motion | null
}

export class MotionSet {
  lines: Line[]
  basedon: string | null

  constructor(lines: Line[], basedon: string | null) {
    this.lines = lines
    this.basedon = basedon
  }

  // The first overlay's motions by lowercased state; a state listed twice keeps its first line.
  motions(): Map<string, Motion> {
    const out = new Map<string, Motion>()
    for (const l of this.lines) {
      if (l.motion && l.overlay === 0 && !out.has(l.motion.state.toLowerCase())) out.set(l.motion.state.toLowerCase(), l.motion)
    }
    return out
  }

  // Puts m in the first overlay in place of the state's lines, or after its last line when the set has none.
  set(m: Motion) {
    const key = m.state.toLowerCase()
    const line = { raw: format(m), overlay: 0, motion: { ...m, opts: [...m.opts] } }
    const at = this.lines.findIndex((l) => l.overlay === 0 && l.motion?.state.toLowerCase() === key)
    if (at >= 0) {
      this.lines[at] = line
      this.lines = this.lines.filter((l, i) => i <= at || l.overlay !== 0 || l.motion?.state.toLowerCase() !== key)
      return
    }
    let last = -1
    this.lines.forEach((l, i) => {
      if (l.overlay === 0) last = i
    })
    this.lines.splice(last + 1, 0, line)
  }

  // Every motion line naming the animation old names next instead.
  rename(old: string, next: string) {
    const o = old.toLowerCase()
    this.lines = this.lines.map((l) => {
      if (!l.motion || l.overlay < 0 || l.motion.anim.toLowerCase() !== o) return l
      const m = { ...l.motion, anim: next }
      return { raw: format(m), overlay: l.overlay, motion: m }
    })
  }

  build(): Uint8Array {
    return encodeLatin1(this.lines.map((l) => l.raw).join(''))
  }
}

export function format(m: Motion): string {
  const raw = `${m.state.padEnd(32)} ${m.anim.padEnd(32)} ${m.opts.join(' ')} \r\n`
  if (raw.length > LINE) throw new LabError(`motion line for ${m.state} is longer than the game reads`)
  return raw
}

export function parse(data: Uint8Array): MotionSet {
  const text = latin1(data)
  const lines: Line[] = []
  let basedon: string | null = null
  let overlay = 0
  let off = 0
  while (off < text.length) {
    let end = text.indexOf('\n', off)
    end = Math.min(end < 0 ? text.length : end + 1, off + LINE)
    const raw = text.slice(off, end)
    off = end
    if (end >= text.length && !text.endsWith('\n')) {
      lines.push({ raw, overlay: -1, motion: null })
      break
    }
    const line: Line = { raw, overlay, motion: null }
    lines.push(line)
    if (raw[0] === ';') continue
    const tok = raw.split(DELIM).filter(Boolean)
    if (!tok.length) continue
    const key = tok[0].toLowerCase()
    if (key === 'numoverlays') continue
    if (key === 'basedon') {
      if (tok.length > 1 && BASES.includes(tok[1].toLowerCase())) basedon = tok[1].toLowerCase()
      continue
    }
    if (key === 'overlay') {
      line.overlay = ++overlay
      continue
    }
    if (tok.length < 2) continue
    const opts: string[] = []
    for (const t of tok.slice(2)) {
      if (t[0] === ';') break
      opts.push(t)
    }
    line.motion = { state: tok[0], anim: tok[1], opts }
  }
  return new MotionSet(lines, basedon)
}
