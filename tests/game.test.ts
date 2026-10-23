import { describe, expect, it } from 'vitest'
import * as effects from '../src/core/build/effects'
import * as flames from '../src/core/build/flames'
import * as basemoves from '../src/core/build/basemoves'
import * as moves from '../src/core/build/moves'
import { buildBatch, checkBatch, ordinal } from '../src/core/build/batch'
import { Builder, report } from '../src/core/build/patch'
import * as templates from '../src/core/build/templates'
import * as tuning from '../src/core/build/tuning'
import * as ui from '../src/core/build/ui'
import { latin1 } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as D from '../src/core/game/dol'
import * as R from '../src/core/game/roster'
import { Apt } from '../src/core/mnroi/apt'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import * as ngbtool from '../src/core/mnroi/ngbtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import * as nmstool from '../src/core/mnroi/nmstool'
import * as nvbtool from '../src/core/mnroi/nvbtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb, pngBytes } from './helpers'

const DOOM_EDITS: [number, string | number[]][] = [[0x4c7ac0, 'plr_doctordoom'], [0x4c7ae0, 'DOCTOR DOOM'], [0x4c7b00, [7, 4, 3, 6, 5, 4, 0, 0]],
  [0x4c80b0, 'plr_altDoctordoom'], [0x4c8148, [0, 0, 0, 0x13]]]

function tinted(base: string): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = 'Synth'
  c.displayName = 'SYNTH'
  c.base = base
  c.glb = makeGlb()
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
  c.files = new Map([['textures/skin.png', pngBytes()]])
  const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(gameSource(), c.base)))
  c.mapping = auto.mapping
  c.overrides = auto.overrides
  c.aura = { mode: 'tint', tint: 'all', color: '#45FF42', alt_color: '#B109D3' }
  return c
}

describe.skipIf(!ISO)('main.dol', () => {
  it('writes the Doctor Doom record as Doompatcher did', () => {
    const dol = gameSource().dol
    const out = D.patch(dol, 'DoctorDoom', 'DOCTOR DOOM', [7, 4, 3, 6, 5, 4], [7, 4, 3, 6, 5, 4])
    expect(out.length).toBe(dol.length)
    for (const [off, want] of DOOM_EDITS) {
      const bytes = typeof want === 'string' ? [...want].map((c) => c.charCodeAt(0)) : want
      expect([...out.subarray(off, off + bytes.length)]).toEqual(bytes)
    }
  })

  it('grows the effect cache', () => {
    const dol = gameSource().dol
    expect(D.readEffectCache(dol)).toBe(nfxtool.CACHE_SIZE)
    const out = D.growEffectCache(dol, 0x4a400)
    expect(D.readEffectCache(out)).toBe(0x4a400)
    expect(() => D.growEffectCache(out, 0x4a400)).toThrow(LabError)
  })

  it('rewrites only the animation time setter for a long throw', () => {
    const dol = gameSource().dol
    const out = D.mirrorSkip(dol)
    const at = D.fileOffset(dol, 0x8019db24)
    const changed = [...out].flatMap((b, i) => (b !== dol[i] ? [i] : []))
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every((i) => i >= at && i < at + 0x70)).toBe(true)
    expect(() => D.mirrorSkip(out)).toThrow(LabError)
  })

  it('refuses a patched main.dol', () => {
    const out = D.patch(gameSource().dol, 'A', 'B', [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])
    expect(() => D.patch(out, 'A', 'B', [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])).toThrow(LabError)
  })

  it('reads every base record', () => {
    for (const key of R.keys()) expect(D.readRecord(gameSource().dol, D.NORMAL_TABLE, R.BASES[key][2]).name.toLowerCase().startsWith('plr_')).toBe(true)
  })

  it('moves the roster into a new data section for two characters', () => {
    const dol = gameSource().dol
    expect(D.tables(dol)).toEqual([D.NORMAL_TABLE, D.ALT_TABLE, 0x4c80fc])
    expect(D.arenaLo(dol)).toBe(D.ARENA_LO)
    const out = D.patchMany(dol, [
      { internal: 'DoctorDoom', display: 'DOCTOR DOOM', stats: [7, 4, 3, 6, 5, 4], altStats: [7, 4, 3, 6, 5, 4] },
      { internal: 'CaptainAmerica', display: 'CAPTAIN AMERICA', stats: [3, 4, 2, 3, 1, 6], altStats: [3, 4, 2, 3, 1, 6] },
    ])
    const [normal, alt, order] = D.tables(out)
    expect(normal).toBe(dol.length)
    expect(D.fileOffset(out, D.ARENA_LO)).toBe(normal)
    expect(D.arenaLo(out)).toBeGreaterThanOrEqual(D.ARENA_LO + 21 * (2 * 0x4c + 4))
    expect(D.arenaLo(out) % 32).toBe(0)
    for (let i = 0; i < 19; i++) expect(D.readRecord(out, normal, i)).toEqual(D.readRecord(dol, D.NORMAL_TABLE, i))
    for (let i = 0; i < 19; i++) expect(D.readRecord(out, alt, i)).toEqual(D.readRecord(dol, D.ALT_TABLE, i))
    expect(D.readRecord(out, normal, 19)).toEqual({ name: 'plr_doctordoom', key: 'DOCTOR DOOM', stats: [7, 4, 3, 6, 5, 4], unlocked: 1 })
    expect(D.readRecord(out, alt, 20)).toEqual({ name: 'plr_altCaptainamerica', key: 'CAPTAIN AMERICA', stats: [3, 4, 2, 3, 1, 6], unlocked: 1 })
    expect(Array.from({ length: 21 }, (_, i) => out[order + 4 * i + 3])).toEqual([0, 10, 2, 15, 6, 14, 3, 9, 7, 13, 4, 16, 8, 1, 17, 5, 12, 11, 18, 19, 20])
    expect(D.readEffectCache(D.growEffectCache(out, 0x4a400))).toBe(0x4a400)
    const c = { internal: 'A', display: 'B', stats: [1, 1, 1, 1, 1, 1], altStats: [1, 1, 1, 1, 1, 1] }
    expect(() => D.patchMany(out, [c, c])).toThrow(LabError)
    expect(() => D.patch(out, 'A', 'B', c.stats, c.altStats)).toThrow(LabError)
  })

  it('fills the select grid with nine characters', () => {
    const dol = gameSource().dol
    const chars = Array.from({ length: 9 }, (_, i) => ({ internal: `Hero${i}`, display: `HERO ${i}`, stats: [i, 1, 2, 3, 4, 5], altStats: [5, 4, 3, 2, 1, i] }))
    const out = D.patchMany(dol, chars)
    const [normal, alt, order] = D.tables(out)
    expect(normal).toBe(dol.length)
    expect(D.arenaLo(out)).toBeGreaterThanOrEqual(D.ARENA_LO + 28 * (2 * 0x4c + 4))
    expect(D.arenaLo(out) % 32).toBe(0)
    for (let i = 0; i < 19; i++) expect(D.readRecord(out, normal, i)).toEqual(D.readRecord(dol, D.NORMAL_TABLE, i))
    chars.forEach((c, i) => {
      expect(D.readRecord(out, normal, 19 + i)).toEqual({ name: `plr_hero${i}`, key: c.display, stats: c.stats, unlocked: 1 })
      expect(D.readRecord(out, alt, 19 + i)).toEqual({ name: `plr_altHero${i}`, key: c.display, stats: c.altStats, unlocked: 1 })
    })
    expect(Array.from({ length: 28 }, (_, i) => out[order + 4 * i + 3]).slice(18)).toEqual([18, 19, 20, 21, 22, 23, 24, 25, 26, 27])
    // the select screen's limits and fn_8044F070's search of the order table
    for (const off of [0x1007dc, 0x101758, 0x101760, 0x101788, 0x101790]) expect(out[off + 3]).toBe(27)
    expect(out[0x44c09c + 3]).toBe(0x1b)
    expect(() => D.patchMany(dol, [...chars, chars[0]])).toThrow(LabError)
    expect(() => D.patchMany(dol, [chars[0]])).toThrow(LabError)
  })
})

describe.skipIf(!ISO)('game', () => {
  const src = () => gameSource()

  it('loads every base', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    const counts: Record<string, number> = { thing: 66, wolverine: 72, storm: 81, defcon: 97 }
    for (const key of R.keys()) {
      const b = new R.BaseCharacter(src(), key, t)
      expect(src().has(`Bundles/${b.bundle}.ngm`), key).toBe(true)
      expect(src().has(b.nvbName()), key).toBe(true)
      const sk = Skeleton.ofBase(b)
      expect(sk.requiredRoles().every((r) => sk.node(r) !== undefined), key).toBe(true)
      if (key in counts) expect(sk.nodes.length, key).toBe(counts[key])
    }
  })

  it('translates a mapping between body classes', () => {
    const male = Skeleton.ofBase(new R.BaseCharacter(src(), 'johnnyohm'))
    for (const key of ['storm', 'thing']) {
      const other = Skeleton.ofBase(new R.BaseCharacter(src(), key))
      const [m, o] = mapping.translate(new Map([[male.node('L.hand')!, 'hand'], [39, 'club']]), new Map([['mid', male.node('L.finger_a.0')!]]), male, other)
      expect(m).toEqual(new Map([[other.node('L.hand')!, 'hand']]))
      expect(o).toEqual(new Map([['mid', other.node('L.finger_a.0')!]]))
    }
  })

  it('adds a select-screen voice', () => {
    const values = ui.sfxValues(src().entry(ui.P + 'main.big'))
    expect(Object.values(R.VOICES).filter((k) => values.has(k)).length).toBe(18)
    const patched = ui.patchCharselect(src().entry(ui.P + 'screens/clashCharSelect.big'), values.get('FE_SFX_OHM')!)
    const files = ui.loadArchive(patched)
    const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
    const apt = new Apt(get('.apt'), get('.const'))
    const block = apt.frameActions(apt.aptOff, 0)[0]
    const pool = apt.pool(block)
    const pushes = apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool)))
    expect(pushes).toContainEqual(['g_aCharacterAudio', values.get('FE_SFX_OHM'), '_global'])
  })

  it('finds what a tint copies', () => {
    const jo = effects.tintPlans(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    const thing = effects.tintPlans(src(), new R.BaseCharacter(src(), 'thing'))
    expect(jo.power.roots).toEqual(['jOhmStand', 'jOhmPwrStand', 'jOhmPowerOn'])
    expect(jo.all.roots).toContain('jOhmArcToSkyL')
    expect([thing.all.roots, thing.all.alt]).toEqual([[], []])
  })

  it('swaps auras in the templates', () => {
    const base = new R.BaseCharacter(src(), 'johnnyohm')
    const t = new R.Templates(templates.build(src().entry('Misc/Global.not'), base, 'Tester', 'swap'))
    expect(R.text(t.prop('plr_Tester', R.P_CASTID))).toBe('ALT_JOHNNYOHM')
    expect(R.text(t.prop('plr_altTester', R.P_CASTID))).toBe('JOHNNYOHM')
    expect(R.text(t.prop('plr_altTester', R.P_MODEL))).toBe('Tester_alt.nod')
  })

  it("keeps the CPU levels' spread in tuning", () => {
    const tun = new tuning.Tuning(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    const [name, data, listed] = tun.build('Tester', { damage_taken: 0.4, run_speed: 13.9 })
    const nvb = nvbtool.parseNvb(data)
    expect(name).toBe('Misc/PLAYER_Tester.nvb')
    expect(latin1(nvb.rawName).split('\0')[0]).toBe('Tester')
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    const slots = (fid: number) => nvb.slots(fid, fields[fid][1])!.map((v) => new DataView(v.buffer, v.byteOffset).getFloat32(0, true))
    expect(slots(104)[0]).toBeCloseTo(13.9, 4)
    const taken = slots(134).map((x) => 1 - x)
    expect(taken[0]).toBeCloseTo(0.4, 4)
    expect(taken[3]).toBeLessThan(taken[0])
    expect(latin1(listed).endsWith('PLAYER Tester\r\n')).toBe(true)
  })

  it('tints effects', () => {
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const names = fx.tinted(['jOhmStand'], '#FF2020', 'testfx')
    expect(names.size).toBe(7)
    const items = nfxtool.readNfx(fx.build())
    const [problems] = nfxtool.problems(items)
    expect(problems.filter((p) => p.includes('cache:') || p.includes('records'))).toEqual([])
    const copy = nfxtool.blocks(items).find((b) => b.name === names.get('johmarc'))!
    const cols = copy.records()[0].filter((r) => ['startcol', 'endcol'].includes(nfxtool.KEYS[r.key])).map((r) => r.value as number)
    expect(cols.length).toBeGreaterThan(0)
    expect(cols.every((c) => ((c >>> 16) & 255) > (c & 255))).toBe(true)
  })

  it('scales the alpha of a tint by its color\'s opacity', () => {
    const alphas = (color: string) => {
      const fx = new effects.Effects(src().entry('Misc/game.nfx'))
      const names = fx.tinted(['jOhmStand'], color, 'testfx')
      const copies = new Set([...names.values()].map((n) => n.toLowerCase()))
      return nfxtool.blocks(nfxtool.readNfx(fx.build())).filter((b) => copies.has(b.name.toLowerCase()))
        .flatMap((b) => b.lines.slice(1).map(nfxtool.tokens).filter((t) => t.length >= 2 && ['startcol', 'endcol'].includes(t[0].toLowerCase())))
        .map((t) => nfxtool.scanFloats(t[1], 4)[0])
    }
    const full = alphas('#FF2020'), half = alphas('#FF202080'), none = alphas('#FF202000')
    expect(full.length).toBeGreaterThan(0)
    expect(alphas('#FF2020FF')).toEqual(full)
    expect(none.every((a) => a === 0)).toBe(true)
    expect(half.every((a, i) => Math.abs(a - full[i] * 128 / 255) < 0.01)).toBe(true)
  })

  it('builds a synthetic character', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Synth'
    c.displayName = 'SYNTH'
    c.base = 'wolverine'
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()], ['ui/hud.png', pngBytes(64, 64)]])
    const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src(), c.base)))
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    c.gameplay = { lift: 'heavy' }
    const r = new Builder(src(), c).build()
    expect(r.adds.has('Bundles/synth.ngm')).toBe(true)
    expect(r.adds.has('Bundles/synth_alt.tpl')).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.u32(t.prop('plr_Synth', R.P_ABILITIES))! & 0x30).toBe(0x20)
  })

  it('points every field naming a tinted effect at its copy', () => {
    const r = new Builder(src(), tinted('johnnyohm')).build()
    const nvb = nvbtool.parseNvb(r.adds.get('Misc/PLAYER_Synth.nvb')!)
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    const names = (fid: number) => nvb.slots(fid, fields[fid][1])!.map((v) => latin1(v).split('\0')[0])
    const fx = new Set(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => b.name))
    for (const [event, power] of [[87, 98], [88, 99]]) expect(names(event)).toEqual(names(power))
    for (const fid of [81, 98, 99, 101, 242, 243]) expect(names(fid).every((n) => /^sy[fa][0-9a-z]+$/.test(n) && fx.has(n))).toBe(true)
    expect(names(67)).toEqual(new Array(6).fill('stdHitTrailLH'))
    const used = nfxtool.cacheUse(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!))[1]
    expect(D.readEffectCache(r.dol!)).toBe(effects.cacheSize(used))
    expect(D.readEffectCache(r.dol!)! - used).toBeLessThan(0x800 + 0x400)
    // A projectile, its explosion and the zap the explosion leaves on the victim are copies too.
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const fid of [90, 91, 92]) {
      for (const proj of names(fid)) {
        const chain = templates.chain(T, proj)
        expect(chain.map((t) => t.name.split('_')[0])).toEqual(['proj', 'exp'])
        const fxNames = chain.flatMap((t) => t.props.map(([, v]) => R.text(v)).filter((s) => s && fx.has(s)))
        expect(fxNames.length).toBeGreaterThan(0)
        expect(fxNames.every((n) => /^sy[fa][0-9a-z]+$/.test(n!))).toBe(true)
      }
    }
  })

  it('fits every base\'s tint in the effect cache', () => {
    const over: string[] = []
    for (const key of R.keys()) {
      const plans = effects.tintPlans(src(), new R.BaseCharacter(src(), key))
      expect(plans.power.extra, key).toBe(0)
      expect(nfxtool.CACHE_SIZE + plans.all.extra, key).toBeLessThanOrEqual(effects.CACHE_MAX)
      if (effects.tintLevel(plans, 'all') !== 'all') over.push(key)
    }
    expect(over).toEqual(['ironman'])
  })

  it('tints only the idle and power-up effects when a full tint needs too much memory', () => {
    const r = new Builder(src(), tinted('ironman')).build()
    expect(D.readEffectCache(r.dol!)).toBe(nfxtool.CACHE_SIZE)
    expect(r.notes.some((n) => n.includes('idle and power-up effects are tinted'))).toBe(true)
  })

  it('puts flames on chosen parts', () => {
    for (const base of ['wolverine', 'storm', 'megalith']) {
      const c = tinted(base)
      c.aura = { ...c.aura, mode: 'base' }
      c.flames = { ...imperfect.defaultFlames(), parts: ['head', 'r_hand', 'l_foot'] }
      const r = new Builder(src(), c).build()
      const sk = Skeleton.ofBase(new R.BaseCharacter(src(), base))
      for (const costume of ['', '_alt']) {
        const [, models] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
        const marks = models[0].attachments.filter(([, kind]) => kind === flames.FLAME_KIND).map(([node, , index]) => [node, index])
        expect(marks, base).toEqual([[sk.node('head'), 0], [sk.node('R.hand'), 2], [sk.node('L.foot'), 5]])
      }
      const T = new R.Templates(r.sets.get('Misc/Global.not')!)
      const names = ['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2))!)
      expect(names[0]).toBe(names[1])
      const items = nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)
      expect(nfxtool.problems(items)[0]).toEqual([])
      const by = new Map(nfxtool.blocks(items).map((b) => [b.name, b]))
      const children = by.get(names[0])!.records()[0].map((rec) => rec.value as string)
      const marker = (n: string) => by.get(n)!.records()[0].filter((rec) => ['markertype', 'marker_index'].includes(nfxtool.KEYS[rec.key])).map((rec) => rec.value)
      expect(children.map(marker)).toEqual([[69, 0], [69, 2], [69, 5]])
      expect(r.adds.has('Misc/PLAYER_Synth.nvb')).toBe(false)
      expect(D.readEffectCache(r.dol!)).toBe(nfxtool.CACHE_SIZE)
    }
  })

  it('colors flames per costume and drops the base\'s own effect', () => {
    const c = tinted('humantorch')
    c.aura = { ...c.aura, mode: 'base' }
    c.flames = { ...imperfect.defaultFlames(), parts: ['head'], color: '#2040FF', base_effect: false }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    for (const t of ['act_Synth', 'plr_Synth', 'plr_altSynth']) expect(T.get(t).get(R.P_EFFECT1), t).toBeNull()
    const [normal, alt] = ['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2))!)
    expect(normal).not.toBe(alt)
    const by = new Map(nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).map((b) => [b.name, b]))
    const records = (controller: string) => by.get(by.get(controller)!.records()[0][0].value as string)!.records()[0]
    const values = (controller: string, key: string) => records(controller).filter((rec) => nfxtool.KEYS[rec.key] === key).map((rec) => rec.value)
    // blue, from a lighter start, on the grey sprite; the game's own orange sprite would turn any color orange
    const [start, end] = ['startcol', 'endcol'].map((k) => values(normal, k)[0] as number)
    expect((end & 255) > ((end >>> 16) & 255)).toBe(true)
    expect((start >>> 16) & 255).toBeGreaterThan((end >>> 16) & 255)
    expect(values(normal, 'material')).toEqual([flames.GREY_SPRITE])
    expect([values(alt, 'startcol'), values(alt, 'endcol'), values(alt, 'material')]).toEqual([[], [], ['GE_PAR_FireSprite_04']])
    // the grey sprite goes into the recolored costume's bundle (Human Torch's costume 2 bundle has its own), once
    const greys = (costume: string) => latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).split(/\s+/).filter((n) => n.toLowerCase() === flames.GREY_SPRITE.toLowerCase()).length
    expect([greys(''), greys('_alt')]).toEqual([1, 1])
  })

  it('sets the whole body on fire with the game\'s own effect', () => {
    const c = tinted('wolverine')
    c.aura = { ...c.aura, mode: 'base' }
    c.flames = { ...imperfect.defaultFlames(), body: true }
    const r = new Builder(src(), c).build()
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(['plr_Synth', 'plr_altSynth'].map((t) => R.text(T.prop(t, R.P_EFFECT2)))).toEqual(['htBodyFire', 'htBodyFire'])
    expect(r.sets.has('Misc/game.nfx')).toBe(false)
    const [, models] = ngmtool.read(r.adds.get('Bundles/synth.ngm')!)
    expect(models[0].attachments.some(([, kind]) => kind === flames.FLAME_KIND)).toBe(false)
  })

  it('counts flames in the memory a tint may take', () => {
    const f = { ...imperfect.defaultFlames(), parts: [...imperfect.FLAME_PARTS], color: '#FF0000', alt_color: '#0000FF' }
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const before = fx.used()
    flames.effectNames(fx, f, 'Synth')
    expect(Math.abs(fx.used() - before - flames.cost(f))).toBeLessThan(16)
    expect(flames.cost({ ...imperfect.defaultFlames(), body: true })).toBe(0)
    const plans = effects.tintPlans(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    expect(effects.tintLevel(plans, 'all', 0)).toBe('all')
    expect(effects.tintLevel(plans, 'all', flames.cost(f))).toBe('power')
    const c = tinted('johnnyohm')
    c.flames = f
    const r = new Builder(src(), c).build()
    expect(r.notes.some((n) => n.includes('idle and power-up effects are tinted'))).toBe(true)
  })

  it('shares the flames of characters that have the same', () => {
    const f = { ...imperfect.defaultFlames(), parts: ['head', 'chest'] }
    const a = { ...tinted('wolverine'), flames: f }
    const b = { ...tinted('storm'), internalName: 'Other', displayName: 'OTHER', flames: f }
    for (const c of [a, b]) c.aura = { ...c.aura, mode: 'base' }
    const r = buildBatch(src(), [a, b])
    const T = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(T.prop('plr_Other', R.P_EFFECT2))).toBe(R.text(T.prop('plr_Synth', R.P_EFFECT2)))
    const added = nfxtool.blocks(nfxtool.readNfx(r.sets.get('Misc/game.nfx')!)).length - nfxtool.blocks(nfxtool.readNfx(src().entry('Misc/game.nfx'))).length
    expect(added).toBe(3)
  })

  it('names the new fighters', () => {
    expect(Array.from({ length: 9 }, (_, i) => ordinal(i))).toEqual(['19th', '20th', '21st', '22nd', '23rd', '24th', '25th', '26th', '27th'])
  })

  it('builds two characters, the second on the first', () => {
    const a = tinted('johnnyohm')
    const b = { ...tinted('humantorch'), internalName: 'Other', displayName: 'OTHER' }
    b.ui = { ...b.ui, ready_voice: 'FE_SFX_TORCH' }
    b.files = new Map([...b.files, ['ui/select_ready.png', pngBytes(200, 400)], ['ui/tile.png', pngBytes(64, 32)]])
    const r = buildBatch(src(), [a, b])
    const [normal, alt] = D.tables(r.dol!)
    expect(D.readRecord(r.dol!, normal, 19).name).toBe('plr_synth')
    expect(D.readRecord(r.dol!, alt, 20)).toMatchObject({ name: 'plr_altOther', key: 'OTHER' })
    for (const name of ['Bundles/synth.ngm', 'Bundles/other_alt.tpl', 'Misc/PLAYER_Synth.nvb', 'Misc/PLAYER_Other.nvb']) expect(r.adds.has(name), name).toBe(true)
    // the base's portraits under both ids: 18 had placeholders to replace, 19 is new
    expect(r.sets.has(ui.P + 'portraits/c18_p0.big')).toBe(true)
    for (const n of ['c19_p0', 'cvs19', 'cvs19_alt', 'cvs18_alt']) expect(r.adds.has(`${ui.P}portraits/${n}.big`), n).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(t.has('plr_Synth') && t.has('plr_altOther')).toBe(true)
    expect(latin1(r.sets.get('Misc/nvblist.txt')!).endsWith('PLAYER Synth\r\nPLAYER Other\r\n')).toBe(true)
    // both tints in full would grow the effect cache by 16 KB: they are cut back to fit what one may
    expect(r.cache === null || r.cache - nfxtool.CACHE_SIZE <= effects.TINT_ALL_LIMIT).toBe(true)
    expect(r.notes.some((n) => n.startsWith('OTHER: aura tint') && n.includes('idle and power-up'))).toBe(true)
    expect(r.notes.some((n) => n.includes("uses Johnny Ohm's (FE_SFX_OHM)"))).toBe(true)

    const movie = (name: string) => {
      const files = ui.loadArchive(r.sets.get(ui.P + name)!)
      const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
      return new Apt(get('.apt'), get('.const'))
    }
    const pushes = (apt: Apt) => apt.frameActions(apt.aptOff, 0).flatMap((block) => {
      const pool = apt.pool(block)
      return apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool)))
    })
    const select = pushes(movie('screens/clashCharSelect.big'))
    const values = ui.sfxValues(src().entry(ui.P + 'main.big'))
    expect(select).toContainEqual(['g_aCharacterAudio', values.get('FE_SFX_TORCH'), values.get('FE_SFX_OHM'), '_global'])
    expect(select.find((v) => v[0] === 'aObject')!.slice(0, 3)).toEqual(['aObject', 'thumb19', 'thumb18'])
    expect(select.find((v) => v[0] === 'g_aCharacterOrder')!.slice(0, 3)).toEqual(['g_aCharacterOrder', 19, 18])
    const main = pushes(movie('main.big'))
    const names = main.find((v) => v.includes('~kT_VANROEKEL'))!
    expect(names.slice(-21)).toEqual(['OTHER', 'SYNTH', ...names.slice(-19, -1), 20])
    expect(names[names.length - 19]).toBe('~kT_VANROEKEL')
    expect(main.find((v) => v.includes('kGlobal_Max_NumChar'))!.slice(-1)).toEqual([20])
    const thumbs = new Map(movie('screens/clashCharSelect_thumbs.big').exports())
    expect(thumbs.has('char18') && thumbs.has('char19')).toBe(true)
    expect(report([a, b], r)).toContain('roster records 19 to 20')
  })

  it('checks a pair before building it', () => {
    const a = tinted('johnnyohm')
    const b = { ...tinted('humantorch'), internalName: 'Other', displayName: 'OTHER' }
    b.ui = { ...b.ui, ready_voice: 'FE_SFX_TORCH' }
    const [check, r] = checkBatch(src(), [a, b])
    expect(check.problems.filter(([l]) => l === 'error')).toEqual([])
    expect(check.problems.some(([l, m]) => l === 'warning' && m.startsWith('20th (OTHER)') && m.includes('idle and power-up'))).toBe(true)
    expect(check.problems.some(([, m]) => m.includes('FE_SFX_OHM'))).toBe(true)
    expect(r).not.toBeNull()
    expect(check.cacheExtra).toBeLessThanOrEqual(effects.TINT_ALL_LIMIT)
    expect(check.largest).toBe(420153)
    expect(check.models.map(([n]) => n)).toEqual(['19th (SYNTH)', '20th (OTHER)'])
    expect(check.models.every(([, size]) => size > 0 && size < check.largest)).toBe(true)
  })

  it('finds names two characters would both add', () => {
    const a = { ...tinted('johnnyohm'), internalName: 'Foo' }
    const [same] = checkBatch(src(), [a, { ...tinted('storm'), internalName: 'foo' }])
    expect(same.problems.some(([l, m]) => l === 'error' && m.includes('internal name'))).toBe(true)
    const [overlap, r] = checkBatch(src(), [a, { ...tinted('storm'), internalName: 'altFoo' }])
    expect(overlap.problems).toContainEqual(['error', '19th (SYNTH) and 20th (SYNTH) both would add plr_altfoo, plr_altfoo_rage to the game: change one internal name'])
    expect(r).toBeNull()
  })

  it('refuses two characters with the same internal name', () => {
    expect(() => buildBatch(src(), [tinted('johnnyohm'), tinted('storm')])).toThrow(LabError)
  })

  it('gives a voice to one before a voiced one', () => {
    const named = (base: string, name: string, voice: string | null) => {
      const c = { ...tinted(base), internalName: name, displayName: name.toUpperCase(), aura: { ...tinted(base).aura, mode: 'base' as const } }
      c.ui = { ...c.ui, ready_voice: voice }
      return c
    }
    const chars = [named('johnnyohm', 'One', 'FE_SFX_OHM'), named('storm', 'Two', null), named('venom', 'Three', 'FE_SFX_VENOM')]
    const r = buildBatch(src(), chars)
    expect(r.notes.some((n) => n.includes("TWO: no ready voice") && n.includes("uses Storm's (FE_SFX_STORM)"))).toBe(true)
    const files = ui.loadArchive(r.sets.get(ui.P + 'screens/clashCharSelect.big')!)
    const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
    const apt = new Apt(get('.apt'), get('.const'))
    const block = apt.frameActions(apt.aptOff, 0)[0]
    const pool = apt.pool(block)
    const audio = apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool))).find((v) => v[0] === 'g_aCharacterAudio')!
    const values = ui.sfxValues(src().entry(ui.P + 'main.big'))
    expect(audio).toEqual(['g_aCharacterAudio', ...['FE_SFX_VENOM', 'FE_SFX_STORM', 'FE_SFX_OHM'].map((v) => values.get(v)), '_global'])
  })

  it('builds nine characters into the third row', () => {
    const bases = ['thing', 'wolverine', 'paradox', 'elektra', 'johnnyohm', 'spiderman', 'daredevil', 'storm', 'venom']
    const chars = bases.map((base, i) => ({ ...tinted(base), internalName: `Nine${i}`, displayName: `NINE ${i}`, aura: { ...tinted(base).aura, mode: 'base' as const } }))
    const [check, r] = checkBatch(src(), chars)
    expect(check.problems.filter(([l]) => l === 'error')).toEqual([])
    expect(check.models.map(([n]) => n)).toEqual(chars.map((c, i) => `${ordinal(i)} (${c.displayName})`))
    const [normal] = D.tables(r!.dol!)
    expect(D.readRecord(r!.dol!, normal, 27)).toMatchObject({ name: 'plr_nine8', key: 'NINE 8' })
    expect(r!.adds.has('Misc/PLAYER_Nine0.nvb')).toBe(false)
    const movie = (name: string) => {
      const files = ui.loadArchive(r!.sets.get(ui.P + name)!)
      const get = (ext: string) => files.find(([n]) => n.toLowerCase().endsWith(ext))![1]
      return new Apt(get('.apt'), get('.const'))
    }
    const pushes = (apt: Apt) => apt.frameActions(apt.aptOff, 0).flatMap((block) => {
      const pool = apt.pool(block)
      return apt.walk(block).filter(([, op]) => op === 0x96).map(([at]) => apt.getPush(at).map((i) => apt.constValue(i, pool)))
    })
    const select = pushes(movie('screens/clashCharSelect.big'))
    expect(select.find((v) => v[0] === 'aObject')!.slice(0, 2)).toEqual(['aObject', 'thumb26'])
    expect(select.find((v) => v[0] === 'g_aCharacterOrder')!.slice(-1)).toEqual([27])
    const main = pushes(movie('main.big'))
    const names = main.find((v) => v.includes('~kT_VANROEKEL'))!
    expect(names.slice(-28, -19)).toEqual(chars.map((c) => c.displayName).reverse())
    expect(names[names.length - 1]).toBe(27)
    expect(main.find((v) => v.includes('kGlobal_Max_NumChar'))!.slice(-1)).toEqual([27])
    const thumbs = new Map(movie('screens/clashCharSelect_thumbs.big').exports())
    for (let id = 18; id < 27; id++) expect(thumbs.has(`char${id}`), `char${id}`).toBe(true)
    for (let id = 18; id < 27; id++) expect(r!.sets.has(`${ui.P}portraits/c${id}_p0.big`) || r!.adds.has(`${ui.P}portraits/c${id}_p0.big`), `c${id}_p0`).toBe(true)
    expect(report(chars, r!)).toContain('roster records 19 to 27')
  })

  it("keeps the tuned characters to what the game's tuning list holds", () => {
    const chars = ['johnnyohm', 'storm', 'venom', 'heatwave', 'magneto'].map((base, i) => ({ ...tinted(base), internalName: `Tuned${i}`, displayName: `TUNED ${i}` }))
    const [check, r] = checkBatch(src(), chars)
    expect(r).toBeNull()
    expect(check.problems.some(([l, m]) => l === 'error' && m.includes("tuning list take 70 bytes where it has 53 free"))).toBe(true)
    const short = [{ ...tinted('johnnyohm'), internalName: 'A', displayName: 'A' }, { ...tinted('magneto'), internalName: 'B', displayName: 'B' }]
    expect(checkBatch(src(), short)[0].problems.filter(([l]) => l === 'error')).toEqual([])
  })

  it('refuses a name the game uses', () => {
    const c = imperfect.newCharacter()
    c.internalName = 'Wolverine'
    c.displayName = 'W'
    c.glb = makeGlb()
    c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
    c.files = new Map([['textures/skin.png', pngBytes()]])
    expect(() => new Builder(src(), c).build()).toThrow(LabError)
  })
})

describe.skipIf(!ISO)('base moves', () => {
  const src = () => gameSource()
  const daredevil = () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    return c
  }

  it('reads and writes animation bundles byte for byte', () => {
    for (const name of ['daredevil', 'daredevil-t0', 'daredevil-t1', 'daredevil-t2', 'thing']) {
      const data = src().entry(`Bundles/${name}.ngb`)
      expect(ngbtool.build(ngbtool.parse(data))).toEqual(data)
    }
  })

  it('flies the club straight out to the reach and back', () => {
    const [, models] = ngmtool.read(src().entry('Bundles/daredevil.ngm'))
    const rec = ngbtool.parse(src().entry('Bundles/daredevil.ngb')).find((r) => r.name === 'Daredevil_RangedAttack.nad')!
    const out = basemoves.longThrow(rec, models[0], 35)
    const at = (t: number) => ngbtool.pose(models[0], out, t)[basemoves.CLUB][1]
    const start = at(13), turn = at(13 + 18)
    expect(out.length).toBe(rec.length + 25)
    expect(turn[1] - start[1]).toBeCloseTo(35, 1)
    expect(Math.abs(turn[0] - start[0])).toBeLessThan(0.2)
    expect(Math.abs(turn[2] - start[2])).toBeLessThan(0.2)
    expect(out.events.filter(([, t]) => t === 0x53 || t === basemoves.MIRROR_EVENT).map(([f, t]) => [f, t])).toEqual([[31, 0x53], [31, basemoves.MIRROR_EVENT]])
    // mirrored about the turn, the return passes where the way out did
    for (const i of [3, 9, 15]) expect(at(31 + i)[1]).toBeCloseTo(at(31 - i)[1], 1)
    // the rest of the body only moves in time
    const other = (r: ngbtool.Record) => r.tracks.filter(([b]) => b !== basemoves.CLUB).map(([, , k]) => k.map(([, v]) => v))
    expect(other(out)).toEqual(other(rec))
  })

  it('builds a long baton throw', () => {
    const c = daredevil()
    c.baseMoves = { throw_reach: 30, throw_cable: false }
    const r = new Builder(src(), c).build()
    expect(r.adds.has('Motions/Synth.nms')).toBe(true)
    for (const n of ['synth', 'synth-t0', 'synth-t1', 'synth-t2']) expect(r.adds.has(`Bundles/${n}.ngb`)).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_MOTIONSET))).toBe('Synth.nms')
    expect(R.text(t.prop('plr_altSynth', R.P_MOTIONSET))).toBe('Synth.nms')
    expect(t.prop('plr_Synth', R.P_EFFECT1)).toBeNull()
    expect(t.prop('plr_altSynth', R.P_EFFECT1)).toBeNull()
    expect(R.text(t.prop('plr_Daredevil', R.P_MOTIONSET))).toBe('Daredevil.nms')
    const nvb = nvbtool.parseNvb(r.adds.get('Misc/PLAYER_Synth.nvb')!)
    const fields = nvbtool.parseNdb(src().entry('Misc/defaults.ndb')).fields('PLAYER')
    expect(nvb.slots(tuning.AIM_RANGE, fields[tuning.AIM_RANGE][1])!.map((v) => new DataView(v.buffer, v.byteOffset).getFloat32(0, true))).toEqual(new Array(tuning.SLOTS).fill(30))
    for (const costume of ['', '_alt']) {
      const [, base] = ngmtool.read(src().entry(`Bundles/daredevil${costume}.ngm`))
      const [, built] = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)
      const end = (m: ngmtool.Model, kind: number) => m.attachments.find(([n, k]) => n === basemoves.CLUB && k === kind)![3][12]
      expect(end(built[0], 43) - end(base[0], 43)).toBeCloseTo(basemoves.HIT_REACH, 5)
      expect(end(built[0], 44) - end(base[0], 44)).toBeCloseTo(-basemoves.HIT_REACH, 5)
    }
  })

  it('keeps the cable unless asked', () => {
    const c = daredevil()
    c.baseMoves = { throw_reach: 20 }
    const t = new R.Templates(new Builder(src(), c).build().sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_EFFECT1))).toBe(R.text(t.prop('plr_Daredevil', R.P_EFFECT1)))
  })

  it('gives the long throw a name of its own', () => {
    const c = daredevil()
    c.baseMoves = { throw_reach: 30 }
    const r = new Builder(src(), c).build()
    const names = ngbtool.names(r.adds.get('Bundles/synth.ngb')!).map((n) => n.toLowerCase())
    expect(names).not.toContain(basemoves.THROW)
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const own = set.get('superattackfar')!.anim
    expect(own).toMatch(/^Daredevil_RangedAtta_[0-9a-f]{6}\.nad$/)
    for (const s of ['rangedattack', 'dodgeexitsuperattack']) expect(set.get(s)!.anim).toBe(own)
    expect(names).toContain(own.toLowerCase())
  })
})

describe.skipIf(!ISO)('moves', () => {
  const src = () => gameSource()
  const daredevil = () => {
    const c = tinted('daredevil')
    c.aura = { ...c.aura, mode: 'base' }
    return c
  }
  const records = (data: Uint8Array) => new Map(ngbtool.parse(data).map((r) => [r.name.toLowerCase(), r]))

  it('reads and writes every motion set byte for byte', () => {
    const names = src().names('Motions/', '.nms')
    expect(names.length).toBeGreaterThanOrEqual(47)
    for (const n of names) expect(nmstool.parse(src().entry(n)).build()).toEqual(src().entry(n))
  })

  it('lists every base\'s moves', () => {
    const cat = moves.catalog(src())
    expect(Object.keys(cat).sort()).toEqual(R.keys().sort())
    expect(cat.thing.body).toBe('brute')
    expect(cat.daredevil.motions.superthrow).toBe('daredevil_superThrow.nad')
    expect(cat.thing.motions.superthrowfemale).toBe('Thing_SuperThrowFemale.nad')
    // a line whose animation no bundle has is dropped, as the game drops it
    expect(cat.daredevil.motions.superwallattackloop).not.toBe('Daredevil_WallAttackSLoop.nad')
    const grab = moves.options(cat, 'daredevil', moves.MOVE_IDS.get('SuperThrow')!)
    expect(grab.some((o) => o.from.includes('thing'))).toBe(true)
  })

  it('sets the motion set on the player templates\' parent only', () => {
    const t = new R.Templates(src().entry('Misc/Global.not'))
    for (const key of R.keys()) {
      const b = new R.BaseCharacter(src(), key, t)
      expect(t.get(b.plr).get(R.P_MOTIONSET)).toBeNull()
      expect(t.get(b.alt).get(R.P_MOTIONSET)).toBeNull()
      expect(R.text(t.prop(b.plr, R.P_MOTIONSET))).toBe(moves.motionSetOf(b))
    }
  })

  it('gives Daredevil the Thing\'s super throw, as the Doom and Cap mod gave Captain America', () => {
    const c = daredevil()
    c.moves = { SuperThrow: 'thing' }
    const r = new Builder(src(), c).build()
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Synth', R.P_MOTIONSET))).toBe('Synth.nms')
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const thing = nmstool.parse(src().entry('Motions/thing.nms')).motions()
    for (const s of ['superthrowvictim', 'superthrowvictimfemale', 'superthrowvictimbrute']) expect(set.get(s)).toEqual(thing.get(s))
    const map = moves.boneMap('brute', 'male', 88)
    for (const [i, suffix] of ['', 'Female', 'Brute'].entries()) {
      const m = set.get(`superthrow${suffix.toLowerCase()}`)!
      expect(m.opts).toEqual(['noloop', 'endpause'])
      expect(m.anim).toMatch(new RegExp(`^${`Thing_SuperThrow${suffix || 'Male'}`.slice(0, 20)}_[0-9a-f]{6}\\.nad$`))
      const built = records(r.adds.get(`Bundles/synth-t${i}.ngb`)!)
      const theirs = records(src().entry(`Bundles/thing-t${i}.ngb`))
      const own = built.get(m.anim.toLowerCase())!
      expect(ngbtool.sameMotion(own, moves.remapRecord(theirs.get(`thing_superthrow${(suffix || 'male').toLowerCase()}.nad`)!, map))).toBe(true)
      const victim = thing.get(`superthrowvictim${suffix.toLowerCase()}`)!.anim.toLowerCase()
      expect(ngbtool.sameMotion(built.get(victim)!, theirs.get(victim)!)).toBe(true)
      for (const gone of ['daredevil_superthrow.nad', 'male_ddsuperthrwvictim.nad', 'female_ddsuperthrwvictim.nad', 'brute_ddsuperthrwvictim.nad']) expect(built.has(gone)).toBe(false)
      // the rest of Daredevil's bundle is as it was
      const dd = records(src().entry(`Bundles/daredevil-t${i}.ngb`))
      for (const [k, rec] of dd) if (!k.includes('superthrw') && !k.includes('superthrow')) expect(built.has(k) && ngbtool.sameMotion(built.get(k)!, rec)).toBe(true)
    }
    expect(r.adds.get('Bundles/synth.ngb')).toEqual(src().entry('Bundles/daredevil.ngb'))
    expect(r.notes.some((n) => n.includes('Super throw') && n.includes('approximate'))).toBe(true)
  })

  it('takes moves along with a long throw', () => {
    const c = daredevil()
    c.moves = { SuperThrow: 'thing', Attack1: 'spiderman' }
    c.baseMoves = { throw_reach: 30 }
    const r = new Builder(src(), c).build()
    const set = nmstool.parse(r.adds.get('Motions/Synth.nms')!).motions()
    const main = records(r.adds.get('Bundles/synth.ngb')!)
    expect(set.get('superattackfar')!.anim).toMatch(/^Daredevil_RangedAtta_/)
    const attack = set.get('attack1')!
    expect(attack.anim.toLowerCase()).toBe(moves.catalog(src()).spiderman.motions.attack1.toLowerCase())
    expect(main.has(attack.anim.toLowerCase())).toBe(true)
    expect(main.has('daredevil_ncombo_h1.nad')).toBe(false)
    expect(set.get('superthrow')!.anim).toMatch(/^Thing_SuperThrowMale_/)
  })

  it('builds two characters with moves in one patch', () => {
    const a = daredevil()
    a.moves = { SuperThrow: 'thing' }
    const b = tinted('wolverine')
    b.aura = { ...b.aura, mode: 'base' }
    b.internalName = 'Other'
    b.displayName = 'OTHER'
    b.moves = { Attack1: 'spiderman', Throw: 'storm' }
    const r = buildBatch(src(), [a, b])
    for (const n of ['Motions/Synth.nms', 'Motions/Other.nms', 'Bundles/synth-t1.ngb', 'Bundles/other-t2.ngb']) expect(r.adds.has(n)).toBe(true)
    const t = new R.Templates(r.sets.get('Misc/Global.not')!)
    expect(R.text(t.prop('plr_Other', R.P_MOTIONSET))).toBe('Other.nms')
    expect(r.notes.some((n) => n.startsWith('OTHER: moves: Throw from Storm') && n.includes('female animations on a male skeleton'))).toBe(true)
  })

  it('refuses a move from the base itself', () => {
    const c = daredevil()
    c.moves = { SuperThrow: 'daredevil' }
    expect(() => new Builder(src(), c).build()).toThrow(LabError)
  })
})
