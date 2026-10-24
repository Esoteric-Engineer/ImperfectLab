import { describe, expect, it } from 'vitest'
import * as eaxa from '../src/core/audio/eaxa'
import { buildBatch, checkBatch } from '../src/core/build/batch'
import * as cutscenes from '../src/core/build/cutscenes'
import { EFFECT_FIELDS, VICTIM_SLOTS } from '../src/core/build/effectslots'
import { Builder } from '../src/core/build/patch'
import * as tuning from '../src/core/build/tuning'
import { equal, u32le } from '../src/core/bytes'
import * as R from '../src/core/game/roster'
import * as asftool from '../src/core/mnroi/asftool'
import * as cuttool from '../src/core/mnroi/cuttool'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import * as nvbtool from '../src/core/mnroi/nvbtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb, pngBytes } from './helpers'

function snr(a: Int16Array, b: Int16Array): number {
  let sig = 0, err = 0
  for (let i = 0; i < a.length; i++) {
    sig += a[i] * a[i]
    err += (a[i] - b[i]) ** 2
  }
  return 10 * Math.log10(sig / Math.max(err, 1))
}

function tone(n: number, noise = 0): Int16Array {
  let seed = 1
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  return Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin(i * 0.05) + 3000 * Math.sin(i * 0.31) + noise * rnd()))
}

describe('EA-XA', () => {
  it('encodes and decodes a tone and noise closely', () => {
    for (const [x, min] of [[tone(5000), 30], [tone(5000, 6000), 18]] as [Int16Array, number][]) {
      const h = { h1: 0, h2: 0 }
      const frames = eaxa.encode(x, 0, x.length, h)
      const y = new Int16Array(x.length)
      const end = eaxa.decode(frames, 0, x.length, { h1: 0, h2: 0 }, y, 0)
      expect(end).toBe(frames.length)
      expect(snr(x, y)).toBeGreaterThan(min)
    }
  })

  it('writes a stream laid out like the game\'s, and reads it back', () => {
    const left = tone(10000), right = tone(10000, 2000)
    const data = asftool.build(asftool.encode([left, right]))
    const a = asftool.check(data, 1)
    expect(asftool.info(a)).toEqual({ channels: 2, rate: 32000, samples: 10000, codec: 0x0a })
    expect(a.blocks.map((b) => b.samples)).toEqual([2156, 2128, 2128, 2128, 1460])
    expect(asftool.build(a)).toEqual(data)
    const [l, r] = asftool.decode(a)
    expect(snr(left, l)).toBeGreaterThan(25)
    expect(snr(right, r)).toBeGreaterThan(25)
    expect(() => asftool.check(data, 0.2)).toThrow(/longer/)
  })
})

describe('new cutscene audio', () => {
  it('drops audio that does not fit where a kind is taken from', () => {
    const slot = (key: string, seconds: number) => ({ key, label: key, stream: `${key}.asf`, seconds, samples: Math.round(seconds * asftool.RATE) })
    const kinds = (intro: cutscenes.AudioSlot[]) => ({ intro: { cuts: [], slots: intro }, victory: { cuts: [], slots: [] }, finisher: { cuts: [], slots: [] } })
    const cat: cutscenes.Catalog = { wolverine: { body: 'male', kinds: kinds([slot('intro_1', 2), slot('intro_2', 2)]) }, thing: { body: 'brute', kinds: kinds([slot('intro_1', 1)]) } }
    const c = imperfect.newCharacter()
    c.base = 'wolverine'
    c.cutscenes.audio = { intro_1: 'cutscenes/intro_1.asf', intro_2: 'cutscenes/intro_2.asf', victory_1: 'cutscenes/victory_1.asf' }
    c.files = new Map([['cutscenes/intro_1.asf', clip(1)], ['cutscenes/intro_2.asf', clip(1)], ['cutscenes/victory_1.asf', clip(1)]])
    expect(cutscenes.dropUnfitAudio(c, cat, 'intro')).toEqual([])
    c.base = 'thing'
    expect(cutscenes.dropUnfitAudio(c, cat, 'intro')).toEqual(['intro_2'])
    expect(Object.keys(c.cutscenes.audio)).toEqual(['intro_1', 'victory_1'])
    expect(c.files.has('cutscenes/intro_2.asf')).toBe(false)
    c.files.set('cutscenes/intro_1.asf', clip(1.5))
    expect(cutscenes.dropUnfitAudio(c, cat, 'intro')).toEqual(['intro_1'])
  })
})

const choices = (cutscenes: imperfect.Cutscenes) => ({ moves: {}, moveEffects: {}, moveLines: { color: null, alt_color: null }, cutscenes })

describe.skipIf(!ISO)('cutscene files on the disc', () => {
  it('rebuilds every playable cutscene byte for byte', () => {
    const src = gameSource()
    let n = 0
    for (const name of src.names('Cutscenes/', '.cut')) {
      const d = src.entry(name)
      if (u32le(d, 0) !== cuttool.MAGIC) continue
      const cut = cuttool.read(d)
      const out = cuttool.build(cut)
      expect(equal(name.toLowerCase().endsWith('mov_8.cut') ? cuttool.build(cut, cut.sizes) : out, d), name).toBe(true)
      n++
    }
    expect(n).toBeGreaterThan(380)
  })

  it('rebuilds every cutscene stream byte for byte, and re-encodes them closely', () => {
    const src = gameSource()
    const names = src.names('Sounds/ASF/', '.asf').filter((n) => /\/(mp|fm)_[^/]*$/i.test(n))
    expect(names.length).toBe(198)
    for (const [i, name] of names.entries()) {
      const d = src.entry(name)
      const a = asftool.check(d, 120)
      expect(equal(asftool.build(a), d), name).toBe(true)
      if (i % 20) continue
      const pcm = asftool.decode(a)
      const again = asftool.decode(asftool.read(asftool.build(asftool.encode(pcm))))
      pcm.forEach((c, k) => expect(snr(c, again[k]), name).toBeGreaterThan(20))
    }
  })
})

function character(base: string, internal = 'Synth'): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = internal
  c.displayName = internal.toUpperCase()
  c.base = base
  c.glb = makeGlb()
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
  c.files = new Map([['textures/skin.png', pngBytes()]])
  const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(gameSource(), c.base)))
  c.mapping = auto.mapping
  c.overrides = auto.overrides
  return c
}

function clip(seconds: number): Uint8Array {
  const n = Math.round(seconds * asftool.RATE)
  return asftool.build(asftool.encode([tone(n), tone(n)]))
}

const fieldValues = (nvb: Uint8Array, fid: number) => {
  const t = Object.create(tuning.Tuning.prototype) as tuning.Tuning
  t.fields = nvbtool.parseNdb(gameSource().entry('Misc/defaults.ndb')).fields('PLAYER')
  t.nvb = nvbtool.parseNvb(nvb)
  return Array.from({ length: tuning.SLOTS }, (_, s) => t.value(fid, s) as string)
}

describe.skipIf(!ISO)('cutscenes', () => {
  const src = () => gameSource()

  it('lists every base\'s cutscenes and their audio', () => {
    const cat = cutscenes.catalog(src())
    expect(Object.keys(cat).sort()).toEqual(R.keys().sort())
    const wl = cat.wolverine.kinds
    expect(wl.intro.cuts).toEqual(['mp_wl_int_1', 'mp_wl_int_2'])
    expect(wl.intro.slots.map((s) => [s.key, s.label, s.stream.toLowerCase()])).toEqual([
      ['intro_1', 'Intro 1, player 1 side', 'mp_wl_int_1.asf'], ['intro_2', 'Intro 1, player 2 side', 'mp_wl_int_2.asf'], ['intro_3', 'Intro 2', 'mp_wl_int_3.asf']])
    expect(wl.victory.slots.map((s) => s.label)).toEqual(['Victory 1', 'Victory 2'])
    expect(wl.finisher.cuts).toEqual(['fm_wl_male_1', 'fm_wl_female_1', 'fm_wl_brute_1'])
    expect(wl.finisher.slots.map((s) => [s.label, s.stream])).toEqual([['Finisher', 'fm_wl.asf']])
    expect(wl.finisher.slots[0].seconds).toBeCloseTo(498620 / 32000, 3)
    expect(cat.paradox.kinds.finisher.cuts[0]).toBe('fm_wk_male_1')
    expect(cat.paradox.kinds.finisher.slots[0].stream.toLowerCase()).toBe('fm_pr.asf')
    expect(cat.defcon.kinds.victory.cuts[0]).toBe('mp_dc_ext_1.cut')
    expect(cat.thing.body).toBe('brute')
    for (const b of Object.values(cat)) for (const k of Object.values(b.kinds)) for (const sl of k.slots) expect(sl.seconds).toBeGreaterThan(0)
  })

  it('gives Daredevil Wolverine\'s cutscenes with only tuning strings', () => {
    const c = character('daredevil')
    c.cutscenes = { intro: 'wolverine', victory: 'wolverine', finisher: 'wolverine', audio: {}, effects: {} }
    const p = cutscenes.plan(src(), new R.BaseCharacter(src(), 'daredevil'), c)
    expect(p.files.size).toBe(0)
    const wl = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'wolverine'))
    for (const fid of [170, 171, 172, 173, 174, 175, 206, 207, 208]) {
      expect(p.fields.get(fid)).toEqual(Array.from({ length: tuning.SLOTS }, (_, s) => wl.value(fid, s)))
    }
    const r = new Builder(src(), c).build()
    const nvb = r.adds.get('Misc/PLAYER_Synth.nvb')!
    expect(fieldValues(nvb, 170)).toEqual(['mp_wl_int_1', 'mp_wl_int_1', 'mp_wl_int_1', 'mp_wl_int_1', 'mp_wl_int_1', 'mp_a_wl_int_1'])
    expect(fieldValues(nvb, 207)[0]).toBe('fm_wl_female_1')
    expect(latin(r.sets.get('Misc/nvblist.txt')!)).toContain('PLAYER Synth\r\n')
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_DESCRIPTIONID))).toBe('Synth')
  })

  it('remaps the Thing\'s finisher onto a male skeleton', () => {
    const c = character('daredevil')
    c.cutscenes = { finisher: 'thing', audio: {}, effects: {} }
    const p = cutscenes.plan(src(), new R.BaseCharacter(src(), 'daredevil'), c)
    expect([...p.files.keys()]).toEqual(['Cutscenes/synth_finisher1.cut', 'Cutscenes/synth_finisher2.cut', 'Cutscenes/synth_finisher3.cut'])
    expect(p.fields.get(206)![0]).toBe('synth_finisher1')
    const nodes = ngmtool.read(new R.BaseCharacter(src(), 'daredevil').bundleFiles()[0])[1][0].nodes.length
    const own = cuttool.read(p.files.get('Cutscenes/synth_finisher1.cut')!)
    const theirs = cuttool.read(src().entry('Cutscenes/fm_th_male_1.cut'))
    own.chunks.forEach((ch, i) => ch.actors.forEach((a, k) => {
      const name = cuttool.recordName(a.record).toLowerCase()
      if (name === 'thing') expect(a.tracks.every((t) => (cuttool.bone(t) & 0xffff) < nodes)).toBe(true)
      else expect(a.tracks).toEqual(theirs.chunks[i].actors[k].tracks)
    }))
    expect(p.notes.some((n) => n.includes('approximate'))).toBe(true)
  })

  it('keeps flagged tracks when it remaps, and pads short audio to the stream it replaces', () => {
    const c = character('daredevil')
    c.cutscenes = { victory: 'megalith', audio: { victory_1: 'cutscenes/v.asf' }, effects: {} }
    c.files.set('cutscenes/v.asf', clip(1))
    const p = cutscenes.plan(src(), new R.BaseCharacter(src(), 'daredevil'), c)
    const theirs = cuttool.read(src().entry('Cutscenes/mp_ml_ext_1.cut'))
    const mine = cuttool.read(p.files.get(`Cutscenes/${p.fields.get(173)![0]}.cut`)!)
    const megalith = (cut: cuttool.Cut) => cut.chunks[0].actors.find((a) => cuttool.recordName(a.record).toLowerCase() === 'megalith')!
    const flagged = (cut: cuttool.Cut) => megalith(cut).tracks.filter((t) => cuttool.bone(t) > 0xffff).length
    expect(flagged(theirs)).toBeGreaterThan(30)
    expect(flagged(mine)).toBe(flagged(theirs))
    // only the thumb tips, which a male skeleton lacks, are left behind
    expect(megalith(theirs).tracks.length - megalith(mine).tracks.length).toBeLessThanOrEqual(4)
    const audio = asftool.read(p.files.get('Sounds/ASF/english/synth_victory_1.asf')!)
    expect(asftool.info(audio).samples).toBe(asftool.info(asftool.read(src().entry('Sounds/ASF/english/MP_ML_EXT_1.asf'))).samples)
  })

  it('points copies of the cutscenes at new audio, for both costumes and both sides', () => {
    const c = character('daredevil')
    c.cutscenes = { intro: 'wolverine', audio: { intro_2: 'cutscenes/intro_2.asf', finisher_1: 'cutscenes/finisher_1.asf' }, effects: {} }
    c.files.set('cutscenes/intro_2.asf', clip(1))
    c.files.set('cutscenes/finisher_1.asf', clip(2))
    const p = cutscenes.plan(src(), new R.BaseCharacter(src(), 'daredevil'), c)
    expect(asftool.seconds(asftool.read(p.files.get('Sounds/ASF/english/synth_intro_2.asf')!))).toBeCloseTo(cutscenes.catalog(src()).wolverine.kinds.intro.slots[1].seconds, 3)
    const intro = p.fields.get(170)!
    expect(intro[0]).toBe('synth_intro1')
    expect(intro[5]).toBe('synth_intro2')
    expect(cuttool.streams(cuttool.read(p.files.get('Cutscenes/synth_intro1.cut')!))).toEqual(['MP_WL_INT_1.asf', 'synth_intro_2.asf', ''])
    expect(cuttool.streams(cuttool.read(p.files.get('Cutscenes/synth_intro2.cut')!))[1]).toBe('synth_intro_2.asf')
    // the second intro has no player 2 stream of its own
    expect(p.fields.get(171)![0]).toBe('mp_wl_int_2')
    for (const [i, fid] of [206, 207, 208].entries()) {
      const name = p.fields.get(fid)![0]
      expect(name).toBe(`synth_finisher${i + 1}`)
      expect(cuttool.streams(cuttool.read(p.files.get(`Cutscenes/${name}.cut`)!))[0]).toBe('synth_finisher_1.asf')
    }
    c.files.set('cutscenes/finisher_1.asf', clip(40))
    expect(() => cutscenes.plan(src(), new R.BaseCharacter(src(), 'daredevil'), c)).toThrow(/longer than/)
  })

  it('knows every effect slot a victim can play', () => {
    const fx = new Set([0x48, 0x49, 0x5d, 0x5e])
    const seen = new Set<number>()
    for (const n of src().names('Bundles/', '.ngb')) {
      for (const r of ngbtool.parse(src().entry(n))) if (/victim/i.test(r.name)) for (const [, t, k] of r.events) if (fx.has(t)) seen.add(k)
    }
    for (const n of src().names('Cutscenes/', '.cut')) {
      const d = src().entry(n)
      if (u32le(d, 0) !== cuttool.MAGIC) continue
      for (const ch of cuttool.read(d).chunks) for (const a of ch.actors) {
        if (cuttool.recordName(a.record).toLowerCase() !== 'victim') continue
        for (let i = 0; i < a.events.length; i += 12) if (fx.has(a.events[i + 4] | (a.events[i + 5] << 8))) seen.add(a.events[i + 6] | (a.events[i + 7] << 8))
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(VICTIM_SLOTS)
  })

  it('plays Iron Man\'s effects in his finisher on Daredevil', () => {
    const c = character('daredevil')
    c.cutscenes = { finisher: 'ironman', audio: {}, effects: { finisher: 'theirs' } }
    const dd = new R.BaseCharacter(src(), 'daredevil')
    const p = cutscenes.plan(src(), dd, c)
    expect(p.files.size).toBe(3)
    const im = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'ironman'))
    const own = new tuning.Tuning(src(), dd)
    const ddKs = new Set(['', '-t0', '-t1', '-t2'].flatMap((t) => ngbtool.parse(src().entry(`Bundles/daredevil${t}.ngb`)).flatMap((r) => r.events.filter((e) => [0x48, 0x49, 0x5d, 0x5e].includes(e[1])).map((e) => e[2]))))
    const performer = (cut: cuttool.Cut) => cut.chunks.flatMap((ch) => ch.actors.filter((a) => cuttool.recordName(a.record).toLowerCase() === 'ironman'))
    const events = (a: cuttool.Actor) => Array.from({ length: a.events.length / 12 }, (_, i) => [a.events[12 * i + 4] | (a.events[12 * i + 5] << 8), a.events[12 * i + 6] | (a.events[12 * i + 7] << 8)])
    const effects = (t: tuning.Tuning, k: number) => Array.from({ length: tuning.SLOTS }, (_, s) => t.value(EFFECT_FIELDS[k - 1], s))
    let moved = 0
    for (const [i, body] of ['male', 'female', 'brute'].entries()) {
      const name = p.fields.get(206 + i)![0]
      const mine = performer(cuttool.read(p.files.get(`Cutscenes/${name}.cut`)!))
      const theirs = performer(cuttool.read(src().entry(`Cutscenes/fm_im_${body}_1.cut`)))
      mine.forEach((a, n) => events(a).forEach(([type, k], e) => {
        const was = events(theirs[n])[e][1]
        if (![0x48, 0x49, 0x5d, 0x5e].includes(type) || k === was) return
        moved++
        expect(ddKs.has(k)).toBe(false)
        expect(effects(own, k).every((v) => !v)).toBe(true)
        expect(p.fields.get(EFFECT_FIELDS[k - 1])).toEqual(effects(im, was))
      }))
    }
    expect(moved).toBeGreaterThan(0)
    expect(p.notes.some((n) => /of Iron Man's effects/.test(n))).toBe(true)
  })

  it('plays no effects in Megalith\'s intro on Daredevil when told to', () => {
    const c = character('daredevil')
    c.cutscenes = { intro: 'megalith', audio: {}, effects: { intro: 'none' } }
    const p = cutscenes.plan(src(), new R.BaseCharacter(src(), 'daredevil'), c)
    const fx = (cut: cuttool.Cut) => cut.chunks.flatMap((ch) => ch.actors.filter((a) => cuttool.recordName(a.record).toLowerCase() === 'megalith'))
      .flatMap((a) => Array.from({ length: a.events.length / 12 }, (_, i) => a.events[12 * i + 4] | (a.events[12 * i + 5] << 8)))
    expect(fx(cuttool.read(src().entry('Cutscenes/mp_ml_int_1.cut')))).toContain(0x48)
    for (const fid of [170, 171, 172]) {
      for (const name of new Set(p.fields.get(fid)!)) {
        const events = fx(cuttool.read(p.files.get(`Cutscenes/${name}.cut`)!))
        expect(events.some((t) => [0x48, 0x49, 0x5d, 0x5e].includes(t))).toBe(false)
      }
    }
    expect(p.notes.some((n) => n.includes('no effects'))).toBe(true)
  })

  it('says how many effects have room before and after they are chosen', () => {
    const none: imperfect.Cutscenes = { audio: {}, effects: {} }
    expect(cutscenes.effectFit(src(), 'daredevil', choices(none))).toEqual({})
    const dd = cutscenes.effectFit(src(), 'daredevil', choices({ ...none, finisher: 'ironman', intro: 'wolverine' }))
    expect(dd.finisher!.chosen).toBe(false)
    expect(dd.finisher!.total).toBeGreaterThan(0)
    expect(dd.finisher!.fit).toBe(dd.finisher!.total)
    expect(dd.intro!.fit).toBe(dd.intro!.total)
    expect(cutscenes.effectFit(src(), 'daredevil', choices({ ...none, finisher: 'wolverine' })).finisher).toEqual({ fit: 0, total: 0, chosen: false })
    // Johnny Ohm has room for Iron Man's finisher alone, but not along with his intro and victory
    const alone = cutscenes.effectFit(src(), 'johnnyohm', choices({ ...none, finisher: 'ironman', effects: { finisher: 'theirs' } }))
    expect(alone.finisher!.fit).toBe(alone.finisher!.total)
    const all: imperfect.Cutscenes = { intro: 'ironman', victory: 'ironman', finisher: 'ironman', audio: {}, effects: { intro: 'theirs', victory: 'theirs', finisher: 'theirs' } }
    const jo = cutscenes.effectFit(src(), 'johnnyohm', choices(all))
    expect(jo.finisher!.chosen).toBe(true)
    expect(jo.finisher!.fit).toBeLessThan(jo.finisher!.total)
    const c = character('johnnyohm')
    c.cutscenes = all
    const note = cutscenes.plan(src(), new R.BaseCharacter(src(), 'johnnyohm'), c).notes.find((n) => n.includes('finisher'))!
    expect(note).toContain(`${jo.finisher!.fit} of Iron Man's effects, ${jo.finisher!.total - jo.finisher!.fit} more left as Johnny Ohm's`)
  })

  it('patches two characters with cutscenes together', () => {
    const a = character('daredevil')
    a.cutscenes = { finisher: 'thing', audio: { finisher_1: 'cutscenes/f.asf' }, effects: {} }
    a.files.set('cutscenes/f.asf', clip(1))
    const b = character('storm', 'Other')
    b.cutscenes = { victory: 'elektra', audio: {}, effects: {} }
    const [check] = checkBatch(src(), [a, b])
    expect(check.problems.filter(([l]) => l === 'error')).toEqual([])
    const r = buildBatch(src(), [a, b])
    for (const n of ['Cutscenes/synth_finisher1.cut', 'Sounds/ASF/english/synth_finisher_1.asf', 'Misc/PLAYER_Synth.nvb', 'Misc/PLAYER_Other.nvb']) expect(r.adds.has(n)).toBe(true)
    expect(fieldValues(r.adds.get('Misc/PLAYER_Other.nvb')!, 173)[0]).toBe('mp_el_ext_1')
  })
})

const latin = (d: Uint8Array) => String.fromCharCode(...d)
