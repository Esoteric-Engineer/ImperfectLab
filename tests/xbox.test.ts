import { describe, expect, it } from 'vitest'
import { equal, f32le, u32le } from '../src/core/bytes'
import * as D from '../src/core/game/dol'
import * as asftool from '../src/core/mnroi/asftool'
import * as abk from '../src/core/xbox/abk'
import * as asf from '../src/core/xbox/asf'
import { parseBig, saveBig } from '../src/core/xbox/big'
import { XboxDisc } from '../src/core/xbox/disc'
import { decodeDxt1, encodeDxt1 } from '../src/core/xbox/dxt'
import * as SX from '../src/core/xbox/shpx'
import { dxt1Format, readXpr, texBytes, writeXpr } from '../src/core/xbox/xpr'
import { fileReader, gameSource, ISO } from './helpers'

const XBOX = process.env.IMPERFECTLAB_XBOX

describe('Xbox formats', () => {
  it('round-trips DXT1, keeping flat colors and see-through pixels', () => {
    const w = 8, h = 4, px = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) px.set(i % w < 4 ? [200, 40, 40, 255] : [0, 0, 0, 0], 4 * i)
    const back = decodeDxt1(encodeDxt1(px, w, h), w, h)
    for (let i = 0; i < w * h; i++) {
      if (i % w < 4) expect([...back.subarray(4 * i, 4 * i + 4)].map((v, k) => Math.abs(v - [200, 40, 40, 255][k]) <= 8)).toEqual([true, true, true, true])
      else expect(back[4 * i + 3]).toBe(0)
    }
  })

  it('round-trips XPR packs and BIGF archives', () => {
    const format = dxt1Format(4, 4, 1)
    const texs = [{ name: 'a', format, data: new Uint8Array(texBytes(format)).fill(7) }]
    expect(readXpr(writeXpr(texs))).toEqual(texs)
    const files: [string, Uint8Array][] = [['x.apt', Uint8Array.of(1, 2, 3)], ['x.const', Uint8Array.of(4)]]
    const [back, tag] = parseBig(saveBig(files, Uint8Array.of(9, 9)))
    expect(back).toEqual(files)
    expect([...tag]).toEqual([9, 9])
  })

  it('writes main.dol tables little-endian after a count', () => {
    const h = D.healthTableLE([{ internal: 'Synth', stages: [0.75, 0.25], kept: 1, z: null }])
    expect(u32le(h, 0)).toBe(1)
    expect(f32le(h, 4)).toBe(0.75)
    expect(f32le(h, 12)).toBe(-1)
  })

  it('keeps sound through Xbox IMA ADPCM', () => {
    const pcm = Int16Array.from({ length: 640 }, (_, i) => Math.round(6000 * Math.sin(i / 5)))
    const back = abk.imaDecode(abk.imaEncode(pcm), pcm.length)
    const err = pcm.reduce((n, v, i) => n + Math.abs(v - back[i]), 0) / pcm.length
    expect(err).toBeLessThan(300)
  })
})

describe.skipIf(!ISO)('cutscene voices for the Xbox', () => {
  it('converts a GameCube stream to the Xbox rate and container', () => {
    const name = gameSource().names('Sounds/ASF/', '.asf').find((n) => /english/i.test(n))!
    const x = asf.readXbox(asf.gcToXbox(gameSource().entry(name)))
    expect(asftool.info(x).rate).toBe(asf.XBOX_RATE)
  })
})

describe.skipIf(!XBOX)('retail Xbox files', () => {
  const disc = () => new XboxDisc(fileReader(XBOX!))

  it('reads the disc and rebuilds texture packs and image banks byte for byte', () => {
    const x = disc()
    const packs = x.list('Bundles/').filter((n) => /^Bundles\/[a-z]+(_alt)?\.xpr$/.test(n))
    expect(packs.length).toBeGreaterThan(0)
    for (const p of packs) expect(equal(writeXpr(readXpr(x.entry(p))), x.entry(p)), p).toBe(true)
    const banks = x.list('HUD/').filter((n) => n.toLowerCase().endsWith('.xsh'))
    for (const b of banks) expect(equal(SX.buildBank(SX.readBank(x.entry(b))), x.entry(b)), b).toBe(true)
  })

  it('rebuilds a sound bank unchanged when nothing is replaced', () => {
    const x = disc()
    const bank = x.list('Sounds/').find((n) => /SFX_Iron/i.test(n))!
    const d = x.entry(bank)
    expect(abk.read(abk.build(abk.read(d), new Map())).samples.length).toBe(abk.read(d).samples.length)
  })
})