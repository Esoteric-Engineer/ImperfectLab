// EA SCHl streams (Sounds/ASF/<lang>/*.asf), the audio of the cutscenes: a PT header, SCCl (the block count), SCDl blocks and SCEl.
// Block sizes are little-endian and everything inside a block big-endian.
import { ByteWriter, latin1, u32be, u32le } from '../bytes'
import * as eaxa from '../audio/eaxa'
import { LabError } from '../errors'

export const RATE = 32000
const EAXA = 0x0a
// The shipped streams' blocks: 77 frames, then 76.
const FIRST_BLOCK = 77 * eaxa.FRAME_SAMPLES
const BLOCK = 76 * eaxa.FRAME_SAMPLES
// FC-FE are markers with no size.
const MARKER = (t: number) => t >= 0xfc && t <= 0xfe

export type Tag = [number, Uint8Array | null]

export interface Block {
  samples: number
  channels: Uint8Array[]
}

export interface Asf {
  tags: Tag[]
  blocks: Block[]
}

export interface Info {
  channels: number
  rate: number
  samples: number
  codec: number
}

function tag(a: Asf, id: number): number | null {
  const v = a.tags.find(([t]) => t === id)?.[1]
  return v ? v.reduce((n, b) => n * 256 + b, 0) : null
}

export function info(a: Asf): Info {
  return { channels: tag(a, 0x82) ?? 1, rate: tag(a, 0x84) ?? 0, samples: tag(a, 0x85) ?? 0, codec: tag(a, 0xa0) ?? -1 }
}

export const seconds = (a: Asf) => {
  const i = info(a)
  return i.rate ? i.samples / i.rate : 0
}

function chunk(d: Uint8Array, p: number, want: string): [number, number] {
  if (p + 8 > d.length || latin1(d, p, p + 4) !== want) throw new LabError(`the audio stream has no ${want} block at 0x${p.toString(16)}`)
  const size = u32le(d, p + 4)
  if (size < 8 || p + size > d.length) throw new LabError(`the audio stream's ${want} block runs past the end`)
  return [p + 8, p + size]
}

export function read(d: Uint8Array): Asf {
  let [p, end] = chunk(d, 0, 'SCHl')
  if (latin1(d, p, p + 4) !== 'PT\x06\x00') throw new LabError('the audio stream has no PT header')
  const tags: Tag[] = []
  for (p += 4; ;) {
    if (p >= end) throw new LabError('the audio stream header has no end')
    const t = d[p++]
    if (t === 0xff) break
    if (MARKER(t)) {
      tags.push([t, null])
      continue
    }
    tags.push([t, d.slice(p + 1, p + 1 + d[p])])
    p += 1 + d[p]
  }
  if (((p + 3) & ~3) !== end || d.subarray(p, end).some((b) => b)) throw new LabError('the audio stream header has a bad size')
  const a: Asf = { tags, blocks: [] }
  const channels = info(a).channels
  ;[p, end] = chunk(d, end, 'SCCl')
  const count = u32be(d, p)
  for (let i = 0; i < count; i++) {
    ;[p, end] = chunk(d, end, 'SCDl')
    const base = p + 4 + 4 * channels
    const offs = Array.from({ length: channels }, (_, c) => base + u32be(d, p + 4 + 4 * c))
    if (offs[0] !== base || offs.some((o, c) => o > (offs[c + 1] ?? end))) throw new LabError(`block ${i} of the audio stream has bad channel offsets`)
    a.blocks.push({ samples: u32be(d, p), channels: offs.map((o, c) => d.slice(o, offs[c + 1] ?? end)) })
  }
  ;[, end] = chunk(d, end, 'SCEl')
  if (end !== d.length) throw new LabError('the audio stream has data after its end')
  return a
}

export function build(a: Asf): Uint8Array {
  const head = new ByteWriter(64).latin1('PT\x06\x00')
  for (const [t, v] of a.tags) {
    head.byte(t)
    if (v) head.byte(v.length).bytes(v)
  }
  head.byte(0xff).zeros((4 - ((head.length + 8) % 4)) % 4)
  const out = new ByteWriter(1 << 16).latin1('SCHl').u32le(head.length + 8).bytes(head.finish())
  out.latin1('SCCl').u32le(12).u32be(a.blocks.length)
  for (const b of a.blocks) {
    const size = 12 + 4 * b.channels.length + b.channels.reduce((n, c) => n + c.length, 0)
    out.latin1('SCDl').u32le(size).u32be(b.samples)
    let off = 0
    for (const c of b.channels) {
      out.u32be(off)
      off += c.length
    }
    for (const c of b.channels) out.bytes(c)
  }
  return out.latin1('SCEl').u32le(8).finish()
}

export function decode(a: Asf): Int16Array[] {
  const i = info(a)
  if (i.codec !== EAXA) throw new LabError(`the audio stream is not EA-XA (codec 0x${i.codec.toString(16)})`)
  const total = a.blocks.reduce((n, b) => n + b.samples, 0)
  const out = Array.from({ length: i.channels }, () => new Int16Array(total))
  const hist = out.map((): eaxa.History => ({ h1: 0, h2: 0 }))
  let pos = 0
  for (const [k, b] of a.blocks.entries()) {
    b.channels.forEach((d, c) => {
      const used = eaxa.decode(d, 0, b.samples, hist[c], out[c], pos)
      if (used > d.length || d.length - used > 1) throw new LabError(`block ${k} of the audio stream does not match its sample count`)
    })
    pos += b.samples
  }
  return out
}

const num = (v: number) => {
  const out: number[] = []
  do {
    out.unshift(v & 255)
    v = Math.floor(v / 256)
  } while (v)
  return Uint8Array.from(out)
}

export function encode(channels: Int16Array[], rate = RATE): Asf {
  const n = channels[0].length
  if (!n || channels.some((c) => c.length !== n)) throw new LabError('the channels of a sound must be the same length')
  const tags: Tag[] = [[0x06, num(0x65)], [0x0b, num(2)], [0xfd, null], [0x80, num(3)], [0x85, num(n)],
    [0x82, num(channels.length)], [0x84, num(rate)], [0xa0, num(EAXA)], [0x8c, num(4)]]
  const hist = channels.map((): eaxa.History => ({ h1: 0, h2: 0 }))
  const blocks: Block[] = []
  for (let at = 0; at < n;) {
    const k = Math.min(blocks.length ? BLOCK : FIRST_BLOCK, n - at)
    blocks.push({
      samples: k,
      channels: channels.map((c, i) => {
        const f = eaxa.encode(c, at, k, hist[i])
        if (f.length % 2 === 0) return f
        const padded = new Uint8Array(f.length + 1)
        padded.set(f)
        return padded
      }),
    })
    at += k
  }
  return { tags, blocks }
}

export function padded(a: Asf, samples: number): Asf {
  return encode(decode(a).map((c) => {
    const out = new Int16Array(Math.max(samples, c.length))
    out.set(c)
    return out
  }), info(a).rate)
}

export function check(d: Uint8Array, maxSeconds: number): Asf {
  const a = read(d)
  const i = info(a)
  if (i.codec !== EAXA || i.rate !== RATE || i.channels < 1 || i.channels > 2) throw new LabError(`the audio stream must be EA-XA at ${RATE} Hz, mono or stereo`)
  if (a.blocks.reduce((n, b) => n + b.samples, 0) !== i.samples) throw new LabError("the audio stream's header disagrees with its data")
  if (i.samples / i.rate > maxSeconds) throw new LabError(`the audio stream is longer than ${maxSeconds} seconds`)
  decode(a)
  return a
}
