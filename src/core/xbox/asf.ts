// Cutscene streams for the Xbox: the GameCube's EA-XA at 44.1 kHz, with little-endian counts and offsets.
import { LabError } from '../errors'
import * as eaxa from '../audio/eaxa'
import * as asftool from '../mnroi/asftool'
import { Wr } from './bin'

export const XBOX_RATE = 44100
const BLOCK = 105 * eaxa.FRAME_SAMPLES   // the same time as the GameCube's 77 frames
const latin = (d: Uint8Array, a: number, b: number) => String.fromCharCode(...d.subarray(a, b))
const num = (v: number) => { const out: number[] = []; do { out.unshift(v & 255); v = Math.floor(v / 256) } while (v); return out }

export function readXbox(d: Uint8Array): asftool.Asf {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
  if (latin(d, 0, 4) !== 'SCHl' || latin(d, 8, 12) !== 'PT\x07\x00') throw new LabError('not an Xbox audio stream')
  let p = 12; const end0 = v.getUint32(4, true); const tags: asftool.Tag[] = []
  for (;;) { if (p >= end0) throw new LabError('the audio stream header has no end'); const t = d[p++]; if (t === 0xff) break; if (t >= 0xfc && t <= 0xfe) { tags.push([t, null]); continue } tags.push([t, d.slice(p + 1, p + 1 + d[p])]); p += 1 + d[p] }
  const ch = (tags.find(([t]) => t === 0x82)?.[1] ?? [1])[0]
  const codec = (tags.find(([t]) => t === 0xa0)?.[1] ?? [0])[0]
  if (codec !== 0x0a) throw new LabError(`the audio stream is not EA-XA (codec 0x${codec.toString(16)})`)
  p = end0
  if (latin(d, p, p + 4) !== 'SCCl') throw new LabError('no SCCl block')
  const count = v.getUint32(p + 8, true); p += v.getUint32(p + 4, true)
  const blocks: asftool.Block[] = []
  for (let i = 0; i < count; i++) {
    if (latin(d, p, p + 4) !== 'SCDl') throw new LabError(`block ${i}: no SCDl at 0x${p.toString(16)}`)
    const size = v.getUint32(p + 4, true), base = p + 12 + 4 * ch, e = p + size
    if (size < 12 || e > d.length) throw new LabError(`block ${i} runs past the end`)
    const offs = Array.from({ length: ch }, (_, c) => base + v.getUint32(p + 12 + 4 * c, true))
    blocks.push({ samples: v.getUint32(p + 8, true), channels: offs.map((o, c) => d.slice(o, offs[c + 1] ?? e)) })
    p = e
  }
  return { tags, blocks }
}

export function buildXbox(a: asftool.Asf): Uint8Array {
  const head: number[] = [0x50, 0x54, 0x07, 0x00]
  for (const [t, val] of a.tags) { head.push(t); if (val) head.push(val.length, ...val) }
  head.push(0xff); while ((head.length + 8) % 4) head.push(0)
  const w = new Wr(true, 1 << 16)
  w.bytes([0x53, 0x43, 0x48, 0x6c]).u32(head.length + 8).bytes(head)
  w.bytes([0x53, 0x43, 0x43, 0x6c]).u32(12).u32(a.blocks.length)
  for (const b of a.blocks) {
    w.bytes([0x53, 0x43, 0x44, 0x6c]).u32(12 + 4 * b.channels.length + b.channels.reduce((n, c) => n + c.length, 0)).u32(b.samples)
    let off = 0; for (const c of b.channels) { w.u32(off); off += c.length }
    for (const c of b.channels) w.bytes(c)
  }
  return w.bytes([0x53, 0x43, 0x45, 0x6c]).u32(8).finish()
}

export function resample(x: Int16Array, from: number, to: number): Int16Array {
  const n = Math.round((x.length * to) / from), out = new Int16Array(n), ratio = from / to, cut = Math.min(1, to / from), TAPS = 16
  for (let i = 0; i < n; i++) {
    const c = i * ratio, c0 = Math.floor(c); let s = 0, wsum = 0
    for (let k = c0 - TAPS + 1; k <= c0 + TAPS; k++) {
      if (k < 0 || k >= x.length) continue
      const t = c - k, a = Math.PI * t * cut
      const sinc = t === 0 ? 1 : Math.sin(a) / a
      const wv = 0.42 + 0.5 * Math.cos((Math.PI * t) / (TAPS + 1)) + 0.08 * Math.cos((2 * Math.PI * t) / (TAPS + 1))
      s += x[k] * sinc * wv; wsum += sinc * wv
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s / (wsum || 1))))
  }
  return out
}

export function gcToXbox(gc: Uint8Array): Uint8Array {
  const a = asftool.read(gc), info = asftool.info(a)
  const pcm = asftool.decode(a).map((c) => (info.rate === XBOX_RATE ? c : resample(c, info.rate, XBOX_RATE)))
  const n = pcm[0].length
  const tags: asftool.Tag[] = [[0x06, Uint8Array.from(num(0x65))], [0x0b, Uint8Array.from(num(2))], [0xfd, null], [0x80, Uint8Array.from(num(3))], [0x85, Uint8Array.from(num(n))],
    [0x82, Uint8Array.from(num(pcm.length))], [0x84, Uint8Array.from(num(XBOX_RATE))], [0xa0, Uint8Array.from(num(0x0a))], [0x8c, Uint8Array.from(num(0x24))]]
  const hist = pcm.map((): eaxa.History => ({ h1: 0, h2: 0 }))
  const blocks: asftool.Block[] = []
  for (let at = 0; at < n;) {
    const k = Math.min(BLOCK, n - at)
    blocks.push({ samples: k, channels: pcm.map((c, i) => { const f = eaxa.encode(c, at, k, hist[i]); if (f.length % 2 === 0) return f; const p = new Uint8Array(f.length + 1); p.set(f); return p }) })
    at += k
  }
  return buildXbox({ tags, blocks })
}