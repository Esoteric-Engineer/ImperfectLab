import { LabError } from '../core/errors'

// Below this the start and end of an upload count as silence and are cut.
const SILENCE = 0.004

// A mono file goes in both channels, and one channel is a mix of all of them; silence at either end is trimmed.
export async function decodeSound(file: Blob, rate: number, maxSeconds: number, channels = 2): Promise<Int16Array[]> {
  let decoded: AudioBuffer
  try {
    decoded = await new OfflineAudioContext(channels, 1, 44100).decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new LabError('the browser could not read this sound file (WAV, MP3, OGG and M4A work in most)')
  }
  const length = Math.max(1, Math.ceil(Math.min(decoded.duration, maxSeconds + 1) * rate))
  const ctx = new OfflineAudioContext(channels, length, rate)
  const node = ctx.createBufferSource()
  node.buffer = decoded
  node.connect(ctx.destination)
  node.start()
  const out = await ctx.startRendering()
  const chans = Array.from({ length: channels }, (_, c) => out.getChannelData(c))
  const loud = (i: number) => chans.some((ch) => Math.abs(ch[i]) >= SILENCE)
  let start = 0, end = length
  while (start < end && !loud(start)) start++
  while (end > start && !loud(end - 1)) end--
  if (end === start) throw new LabError('the sound file is silent')
  const n = Math.min(end - start, Math.floor(maxSeconds * rate))
  return chans.map((ch) => Int16Array.from({ length: n }, (_, i) => Math.max(-32768, Math.min(32767, Math.round(ch[start + i] * 32767)))))
}

let ctx: AudioContext | null = null
let playing: AudioBufferSourceNode | null = null

export function stop() {
  playing?.stop()
  playing = null
}

export function play(channels: Int16Array[], rate: number) {
  ctx ??= new AudioContext()
  stop()
  const buf = ctx.createBuffer(channels.length, channels[0].length, rate)
  channels.forEach((pcm, c) => {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
  })
  const node = ctx.createBufferSource()
  node.buffer = buf
  node.connect(ctx.destination)
  node.start()
  playing = node
}

export function wav(channels: Int16Array[], rate: number): Uint8Array {
  const n = channels[0].length, k = channels.length
  const out = new Uint8Array(44 + 2 * n * k)
  const v = new DataView(out.buffer)
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)))
  tag(0, 'RIFF')
  v.setUint32(4, out.length - 8, true)
  tag(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, k, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2 * k, true)
  v.setUint16(32, 2 * k, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, 2 * n * k, true)
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) v.setInt16(44 + 2 * (i * k + c), channels[c][i], true)
  return out
}
