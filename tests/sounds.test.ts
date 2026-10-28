import { describe, expect, it } from 'vitest'
import * as dsp from '../src/core/audio/dspadpcm'
import { buildBatch, checkBatch } from '../src/core/build/batch'
import { Builder, report } from '../src/core/build/patch'
import * as sounds from '../src/core/build/sounds'
import { equal, u32be } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as D from '../src/core/game/dol'
import * as R from '../src/core/game/roster'
import * as abktool from '../src/core/mnroi/abktool'
import names from '../src/core/game/sounds.json'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb, pngBytes } from './helpers'

function tone(n: number, rate: number, hz: number[], noise = 0): Int16Array {
  let seed = 1
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  return Int16Array.from({ length: n }, (_, i) => Math.round(hz.reduce((acc, f) => acc + Math.sin((2 * Math.PI * f * i) / rate), 0) * 8000 / hz.length + noise * rand()))
}

function snr(a: Int16Array, b: Int16Array): number {
  let s = 0, e = 0
  for (let i = 0; i < a.length; i++) { s += a[i] * a[i]; e += (a[i] - b[i]) ** 2 }
  return 10 * Math.log10(s / Math.max(e, 1))
}

describe('DSP ADPCM', () => {
  it('encodes tones, chords and noise closely', () => {
    for (const [pcm, floor] of [[tone(22050, 22050, [440]), 30], [tone(22050, 22050, [220, 1330, 3100]), 20], [tone(9000, 16000, [700], 3000), 12]] as [Int16Array, number][]) {
      const a = dsp.encode(pcm)
      expect(a.data.length).toBe(dsp.dataSize(pcm.length))
      expect(snr(pcm, dsp.decode(a))).toBeGreaterThan(floor)
    }
  })

  it('encodes silence and a single sample', () => {
    expect([...dsp.decode(dsp.encode(new Int16Array(30)))]).toEqual(new Array(30).fill(0))
    expect(dsp.decode(dsp.encode(Int16Array.of(1000)))[0]).toBeCloseTo(1000, -2)
  })

  it('gives the decoder state at a loop', () => {
    const a = dsp.encode(tone(500, 22050, [300]))
    const pcm = dsp.decode(a)
    expect(dsp.contextAt(a, 100)).toEqual({ ps: a.data[7 * 8], hist1: pcm[99], hist2: pcm[98] })
    expect(dsp.contextAt(a, 0)).toEqual({ ps: a.data[0], hist1: 0, hist2: 0 })
  })

  it('writes and reads .dsp files', () => {
    const a = dsp.encode(tone(1000, 16000, [500]))
    const file: dsp.DspFile = { ...a, rate: 16000, loop: [0, 999], loopContext: dsp.contextAt(a, 0) }
    const body = dsp.writeDsp(file)
    expect(u32be(body, 4)).toBe(Math.floor(999 / 14) * 16 + (999 % 14) + 3)
    expect(dsp.readDsp(body)).toEqual(file)
    expect(dsp.readDsp(dsp.writeDsp({ ...file, loop: null })).loop).toBeNull()
  })

  it('refuses bad .dsp files', () => {
    const body = dsp.writeDsp({ ...dsp.encode(tone(16000, 16000, [500])), rate: 16000, loop: null, loopContext: { ps: 0, hist1: 0, hist2: 0 } })
    expect(() => dsp.readDsp(body.slice(0, -1))).toThrow('does not match')
    expect(() => dsp.readDsp(body, 0.5)).toThrow('longer than')
    const fast = body.slice()
    fast.set([0, 0, 0xbb, 0x80], 8)
    expect(() => dsp.readDsp(fast)).toThrow('rate')
  })
})

function soundFile(seconds = 0.5, rate = 16000): Uint8Array {
  const a = dsp.encode(tone(Math.round(seconds * rate), rate, [600]))
  return dsp.writeDsp({ ...a, rate, loop: null, loopContext: { ps: 0, hist1: 0, hist2: 0 } })
}

describe('sounds in .imperfect files', () => {
  const character = () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Loud'
    c.displayName = 'LOUD'
    c.base = 'wolverine'
    c.glb = makeGlb()
    c.materials = [imperfect.newMaterial(0, 'skin')]
    c.files = new Map([['sounds/roar.dsp', soundFile()]])
    c.sounds = { 3: { file: 'sounds/roar.dsp' }, 10: { game: 'spiderman:4' } }
    return c
  }

  it('saves and loads them', () => {
    const c = character()
    const d = imperfect.load(imperfect.save(c))
    expect(d.sounds).toEqual(c.sounds)
    expect(d.files.get('sounds/roar.dsp')).toEqual(c.files.get('sounds/roar.dsp'))
  })

  it('leaves the key out when no sound changes', () => {
    const c = character()
    c.sounds = {}
    expect(imperfect.manifest(c).sounds).toBeUndefined()
  })

  it('refuses bad ones', () => {
    const c = character()
    c.sounds = { 3: { game: 'nobody:1' } }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('unknown character'))).toBe(true)
    c.sounds = { 3: { file: 'sounds/gone.dsp' } }
    expect(imperfect.problems(c).some(([l, m]) => l === 'error' && m.includes('missing'))).toBe(true)
    expect(() => imperfect.checkMember('sounds/x.dsp', new Uint8Array(10))).toThrow(LabError)
    expect(() => imperfect.checkMember('sounds/x.dsp', soundFile(imperfect.MAX_SOUND_SECONDS + 1, 8000))).toThrow('longer than')
  })
})

describe('sound names', () => {
  it('names sounds by base and number from 1', () => {
    for (const [base, sounds] of Object.entries(names)) {
      expect(R.BASES).toHaveProperty(base)
      for (const [n, name] of Object.entries(sounds)) {
        expect(n).toMatch(/^[1-9]\d*$/)
        expect(typeof name).toBe('string')
      }
    }
  })

  it('gives null for a sound without a name', () => {
    expect(sounds.soundName('wolverine', 999)).toBeNull()
    expect(sounds.soundName('nobody', 0)).toBeNull()
    expect(sounds.soundName('constructor', 0)).toBeNull()
  })
})

describe.skipIf(!ISO)('sound banks on the disc', () => {
  const src = () => gameSource()

  it('rebuilds every .abk byte for byte', () => {
    const names = src().names('Sounds/', '.abk')
    expect(names.length).toBe(47)
    for (const name of names) {
      const data = src().entry(name)
      expect(equal(abktool.build(abktool.read(data), new Map(), true), data), name).toBe(true)
    }
  })

  it('replaces one sample and keeps the rest', () => {
    const bank = abktool.read(src().entry('Sounds/SFX_Wolv1.abk'))
    const a = dsp.encode(tone(40000, 18000, [523]))
    const out = abktool.build(bank, new Map([[5, { ...a, rate: 18000, loop: false }], [21, { ...a, rate: 18000, loop: true }]]))
    expect(u32be(out, 0x14)).toBe(out.length)
    const again = abktool.read(out)
    expect(again.modules).toEqual(bank.modules)
    expect(again.samples.length).toBe(bank.samples.length)
    expect(abktool.info(again.samples[5])).toMatchObject({ rate: 18000, samples: 40000, channels: 1, loop: null })
    expect(abktool.channel0(again.samples[5])).toEqual(a)
    const looped = again.samples[21]
    expect(abktool.info(looped).loop).toEqual([0, 39999])
    expect([...looped.tags.get(0x8d)!]).toEqual([0, 0, 0, 0, a.data[0]])
    bank.samples.forEach((s, i) => { if (i !== 5 && i !== 21) expect(abktool.sameSample(s, again.samples[i]), `sample ${i}`).toBe(true) })
    const b = u32be(out, 0x20)
    expect(u32be(out, 0x24)).toBe(Math.ceil((u32be(out, b + 8) + u32be(out, b + 12)) / 0x80) * 0x80)
    const delta = out.length - bank.abk.length, oldT38 = u32be(bank.abk, 0x38), t38 = u32be(out, 0x38)
    expect(t38).toBe(oldT38 + delta)
    const tail = out.slice(u32be(out, 0x30)), oldTail = bank.abk.slice(u32be(bank.abk, 0x30))
    for (let k = 0; k < u32be(out, t38); k++) {
      const p = u32be(out, t38 + 8 + 12 * k), q = u32be(bank.abk, oldT38 + 8 + 12 * k)
      expect(p).toBe(q + delta)
      expect(equal(out.subarray(p, p + 12), bank.abk.subarray(q, q + 12))).toBe(true)
      tail.fill(0, t38 + 8 + 12 * k - u32be(out, 0x30), t38 + 12 + 12 * k - u32be(out, 0x30))
      oldTail.fill(0, oldT38 + 8 + 12 * k - u32be(bank.abk, 0x30), oldT38 + 12 + 12 * k - u32be(bank.abk, 0x30))
    }
    expect(equal(tail, oldTail)).toBe(true)
  })

  it('reads every base sound', () => {
    const cat = sounds.catalog(src())
    expect(Object.keys(cat).length).toBe(18)
    expect(cat.wolverine).toMatchObject({ bank: 'SFX_Wolv1', bytes: 694700 })
    expect(cat.wolverine.sounds.length).toBe(80)
    for (const [base, b] of Object.entries(cat)) expect(Object.keys((names as Record<string, object>)[base])).toEqual(b.sounds.map((_, i) => String(i + 1)))
    expect(Math.max(...Object.values(cat).map((b) => b.bytes))).toBe(sounds.MAX_BANK)
    const [pcm, rate] = sounds.pcm(src(), 'wolverine', 0)
    expect([pcm.length, rate]).toEqual([8808, abktool.DEFAULT_RATE])
  })

  it('rewrites fn_80114420 and nothing else', () => {
    const dol = src().dol
    const out = D.soundBanks(dol, ['Loud', 'Doctordoom'])
    const at = D.fileOffset(dol, 0x80114420)
    const diff = [...out.keys()].filter((i) => out[i] !== dol[i])
    expect(Math.min(...diff)).toBeGreaterThanOrEqual(at)
    expect(Math.max(...diff)).toBeLessThan(at + 0x3b4)
    const table = at + 0x17c
    expect(u32be(out, table)).toBe(0)
    expect(u32be(out, table + 4)).toBe(0x8049790c)
    const text = new TextDecoder('latin1').decode(out.subarray(table + 76, at + 0x3b4))
    expect(text.startsWith('plr_loud\0plr_altLoud\0SFX_Loud\0plr_doctordoom\0plr_altDoctordoom\0SFX_Doctordoom\0\0')).toBe(true)
    expect(() => D.soundBanks(out, ['Loud'])).toThrow(LabError)
    expect(() => D.soundBanks(dol, Array.from({ length: 9 }, (_, i) => `Abcdefghi${i}`))).not.toThrow()
  })

  const character = (name: string, base = 'wolverine') => {
    const c = imperfect.newCharacter()
    c.internalName = name
    c.displayName = name.toUpperCase()
    c.base = base
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()], ['sounds/roar.dsp', soundFile()]])
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src(), c.base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    c.sounds = { 0: { file: 'sounds/roar.dsp' }, 1: { game: 'ironman:0' } }
    return c
  }

  it('builds a character with its own sounds', () => {
    const c = character('Loud')
    const r = new Builder(src(), c).build()
    const bank = abktool.read(r.adds.get('Sounds/SFX_Loud.abk')!)
    expect(abktool.info(bank.samples[0])).toMatchObject({ rate: 16000, samples: 8000 })
    const iron = abktool.read(src().entry('Sounds/SFX_Iron2.abk')).samples[0]
    expect(abktool.channel0(bank.samples[1])).toEqual(abktool.channel0(iron))
    expect(abktool.info(bank.samples[1]).channels).toBe(1)
    expect(equal(r.dol!, D.soundBanks(D.patch(src().dol, 'Loud', 'LOUD', c.stats.normal, c.stats.alt), ['Loud']))).toBe(true)
    expect(report(c, r)).toContain('fn_80114420')
  })

  it('stores a sound used for several slots once', () => {
    const c = character('Loud')
    const one = new Builder(src(), c).build().adds.get('Sounds/SFX_Loud.abk')!
    c.sounds = { 0: { file: 'sounds/roar.dsp' }, 1: { game: 'ironman:0' }, 2: { file: 'sounds/roar.dsp' }, 21: { file: 'sounds/roar.dsp' } }
    const out = new Builder(src(), c).build().adds.get('Sounds/SFX_Loud.abk')!
    const bank = abktool.read(out)
    const at = (i: number) => u32be(bank.samples[i].tags.get(0x88)!, 0)
    expect(at(2)).toBe(at(0))
    expect(at(21)).toBe(at(0))
    expect(abktool.channel0(bank.samples[21])).toEqual(abktool.channel0(bank.samples[0]))
    expect(abktool.info(bank.samples[21]).loop).toEqual([0, 7999])
    expect(out.length).toBeLessThan(one.length)
  })

  it('refuses a bank larger than a match can load', () => {
    const c = character('Loud', 'roekel')
    c.files.set('sounds/long.dsp', soundFile(20, 22050))
    c.sounds = { 0: { file: 'sounds/long.dsp' } }
    expect(() => new Builder(src(), c).build()).toThrow('more than')
  })

  it('patches several characters with sounds together', () => {
    const chars = [character('Loud'), character('Louder'), character('Calm', 'storm')]
    chars[2].sounds = {}
    const r = buildBatch(src(), chars)
    expect(r.adds.has('Sounds/SFX_Loud.abk') && r.adds.has('Sounds/SFX_Louder.abk')).toBe(true)
    expect(r.adds.has('Sounds/SFX_Calm.abk')).toBe(false)
    const [check] = checkBatch(src(), chars)
    expect(check.problems.some(([l, m]) => l === 'note' && m.includes("first player's sounds"))).toBe(true)
  })
})
