import { describe, expect, it } from 'vitest'
import * as effects from '../src/core/build/effects'
import * as laser from '../src/core/build/laser'
import { Builder } from '../src/core/build/patch'
import * as shaders from '../src/core/build/shaders'
import { f32be, latin1, u32be } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as D from '../src/core/game/dol'
import * as R from '../src/core/game/roster'
import * as gxtex from '../src/core/mnroi/gxtex'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import * as ngmtool from '../src/core/mnroi/ngmtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb, pngBytes } from './helpers'

const src = () => gameSource()

function lasered(base: string, l: Partial<imperfect.Laser> = {}): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = 'Synth'
  c.displayName = 'SYNTH'
  c.base = base
  c.glb = makeGlb()
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png' }]
  c.files = new Map([['textures/skin.png', pngBytes()]])
  const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src(), c.base)))
  c.mapping = auto.mapping
  c.overrides = auto.overrides
  c.zButton = { stealth: null, costume: null, stats: null, size: null, bullet: null, gun: null, laser: { ...imperfect.defaultLaser(), ...l }, impersonate: null, requires: { energy: { seconds: 8, regen: false } } }
  return c
}

const zOnly = (internal: string, more: Partial<D.ZCharacter> = {}): D.ZCharacter => ({ internal, seconds: 0, regen: false, undetected: false, untouchable: false, visible: 1, costume: false,
  damage: [null, null, null, null, null], taken: null, lift: null, run: null, sprint: null, size: null, slow: null, gun: false, ...more })

describe.skipIf(!ISO)('laser beam', () => {
  it('marks a laser in the Z table', () => {
    const dol = src().dol
    const out = D.zActions(dol, [zOnly('Synth', { laser: true })])
    const t = D.fileOffset(out, 0x80137494) + 0x534
    expect(u32be(out, t + 4)).toBe(D.LASER_FLAG)
    expect(latin1(out, t + 12, t + 36)).toBe('plr_synth\0plr_altSynth\0\0')
  })

  it("adds the laser's code in a text section of its own and hooks the logic pass, the stick and the beam's length", () => {
    const chars: D.LaserCharacter[] = [
      { internal: 'Synth', range: 30, damage: 20, size: 1, effects: ['sylz6', 'sylzd'] },
      { internal: 'Other', range: 12, damage: 45, size: 1.5, effects: ['otlz6', 'otlz6'] },
    ]
    expect(() => D.laser(src().dol, chars)).toThrow(/Z-button/)
    const zd = D.zActions(src().dol, chars.map((c) => zOnly(c.internal, { laser: true })))
    for (const before of [zd, D.patchMany(zd, [1, 2].map((i) => ({ internal: `C${i}`, display: `C${i}`, stats: [1, 1, 1, 1, 1, 1], altStats: [1, 1, 1, 1, 1, 1] })))]) {
      const lo = D.arenaLo(before)
      const out = D.laser(before, chars)
      const slot = [2, 3, 4, 5, 6].find((i) => u32be(out, 0x90 + 4 * i) && !u32be(before, 0x90 + 4 * i))!
      expect(u32be(out, 0x48 + 4 * slot)).toBe(lo)
      const size = u32be(out, 0x90 + 4 * slot), at = u32be(out, 4 * slot)
      expect(D.arenaLo(out)).toBe(lo + size)
      const target = (from: number) => (from + ((((u32be(out, D.fileOffset(out, from)) << 6) >> 6) & ~3))) >>> 0
      for (const [site, to] of [[0x80074954, D.LASER_TICK], [0x800cc1d4, D.LASER_MOVE]]) {
        expect(target(site)).toBe(lo + to)
        expect(u32be(out, D.fileOffset(out, site)) >>> 26).toBe(18)
        expect(u32be(out, D.fileOffset(out, site)) & 1).toBe(0)
      }
      expect(u32be(out, D.fileOffset(out, 0x8050f168 + 0xc4))).toBe(lo + D.LASER_LENGTH)
      // its own calls to the hooked functions skip their first instruction
      const code = out.subarray(at, at + D.LASER_DATA)
      const words = Array.from({ length: code.length / 4 }, (_, i) => u32be(code, 4 * i))
      expect(words).toContain(0x9421ffd0)
      expect(words).toContain(0x9421ffd8)
      const table = at + D.LASER_DATA
      expect(u32be(out, table)).toBe(0)
      expect(u32be(out, table + D.LASER_COUNT)).toBe(2)
      const first = table + D.LASER_ENTRIES, second = first + D.LASER_ENTRY_SIZE
      expect([0, 4, 8, 0xc, 0x10].map((o) => f32be(out, first + o))).toEqual([30, 4, D.LASER_TICK_SECONDS, D.LASER_RADIUS, D.LASER_TURN].map(Math.fround))
      expect([0x14, 0x18, 0x1c].map((o) => u32be(out, first + o))).toEqual([0, 0x10000050, 0x69])
      expect(latin1(out, first + 0x20, first + 0xa0)).toBe(['plr_synth', 'plr_altSynth', 'sylz6', 'sylzd'].map((n) => n + '\0'.repeat(32 - n.length)).join(''))
      expect([0, 4, 0xc].map((o) => f32be(out, second + o))).toEqual([12, 9, Math.fround(D.LASER_RADIUS * 1.5)])
      expect(latin1(out, second + 0x60, second + 0x65)).toBe('otlz6')
      const changed = [...out.subarray(0, before.length)].flatMap((b, i) => (b !== before[i] ? [i] : []))
      const sites = [[0x80074954, 4], [0x800cc1d4, 4], [0x8050f168 + 0xc4, 4]].map(([va, n]) => [D.fileOffset(out, va), D.fileOffset(out, va) + n])
      expect(changed.every((i) => i < 0x100 || sites.some(([a, b]) => i >= a && i < b) || [0x177bc4, 0x177bc8, 0x177bfc, 0x177c00].some((r) => i >= r && i < r + 4))).toBe(true)
      expect(() => D.laser(out, chars)).toThrow(LabError)
    }
    expect(() => D.laser(zd, [])).toThrow(/room/)
    expect(() => D.laser(zd, [{ ...chars[0], effects: ['x'.repeat(32), 'a'] }])).toThrow(LabError)
    expect(() => D.laser(zd, [{ ...chars[0], damage: 0 }])).toThrow(LabError)
  })

  it("builds a tinted copy of Iron Man's finisher beam on attachment 67", () => {
    const fx = new effects.Effects(src().entry('Misc/game.nfx'))
    const before = fx.used()
    const l = { ...imperfect.defaultLaser(), color: '#FF2010', alt_color: '#2040FF', range: 25 }
    const [normal, alt] = laser.build(fx, l, 'Synth')
    expect(normal).not.toBe(alt)
    const used = fx.used() - before
    expect(laser.bytes(() => new effects.Effects(src().entry('Misc/game.nfx')), l)).toBe(used)
    expect(laser.bytes(() => new effects.Effects(src().entry('Misc/game.nfx')), { ...l, alt_color: l.color })).toBeLessThan(used)
    const items = nfxtool.readNfx(fx.build())
    expect(nfxtool.problems(items)[0]).toEqual([])
    const by = new Map(nfxtool.blocks(items).map((b) => [b.name.toLowerCase(), b]))
    const kv = (n: string) => by.get(n.toLowerCase())!.records()[0].map((rec): [string, unknown] => [nfxtool.KEYS[rec.key], rec.value])
    const children = (n: string) => kv(n).filter(([k]) => k === 'effectname').map(([, v]) => v as string)
    const DYN = nfxtool.TYPES.indexOf('dyngeom')
    for (const [root, red] of [[normal, true], [alt, false]] as const) {
      expect(by.get(root.toLowerCase())!.type).toBe(nfxtool.TYPES.indexOf('controller'))
      const groups = children(root)
      expect(groups.length).toBe(2)
      const shafts: string[] = []
      for (const g of groups) {
        const recs = kv(g)
        expect(recs.filter(([k]) => k === 'markertype').map(([, v]) => v)).toEqual(recs.filter(([k]) => k === 'effectname').map(() => laser.KIND))
        expect(recs.filter(([k]) => k === 'marker_index').every(([, v]) => v === laser.INDEX)).toBe(true)
        shafts.push(...children(g))
      }
      // the sparks follow a full-length shaft, which places them at its end
      const fxb = kv(groups[1])
      const hitAt = fxb.findIndex(([k]) => k === 'childflag')
      expect(fxb[hitAt][1]).toBe(0x200)
      const hit = fxb.slice(0, hitAt).filter(([k]) => k === 'effectname').map(([, v]) => v as string)
      const anchor = Object.fromEntries(kv(hit[hit.length - 2]))
      expect(anchor.length1).toBe(25 + laser.SIGN)
      // every shaft and flare is signed, the sparks are not
      const dyns = shafts.filter((n) => by.get(n.toLowerCase())!.type === DYN)
      expect(dyns.length).toBe(10)
      for (const n of dyns) {
        const len = Object.fromEntries(kv(n)).length1 as number
        expect(len - Math.trunc(len), n).toBe(laser.SIGN)
        // none ends at the actor's target, as the finisher's shafts reach the victim
        expect((Object.fromEntries(kv(n)).type_flags as number) & 0x4000000, n).toBe(0)
      }
      const sparks = children(hit[hit.length - 1])
      const sparkLengths = sparks.filter((n) => by.get(n.toLowerCase())!.type === DYN).map((n) => Object.fromEntries(kv(n)).length1 as number)
      expect(sparkLengths).toEqual([Math.fround(0.3)])
      // grey textures under their own names, tinted
      const all = [...shafts, ...sparks]
      const materials = new Set(all.flatMap((n) => by.get(n.toLowerCase())!.lines.map(nfxtool.tokens).filter((t) => t[0]?.toLowerCase() === 'material').map((t) => t[1])))
      expect([...materials].sort()).toEqual(['GE_Tracer', 'IL_LaserBolt', 'IL_LaserSpark'].sort())
      const core = by.get(dyns[0].toLowerCase())!
      const [, r, g, b] = nfxtool.scanFloats(nfxtool.tokens(core.lines.find((x) => /^startcol /.test(x))!)[1], 4)
      expect(red ? r > g && r > b : b > r && b > g, `${r},${g},${b}`).toBe(true)
    }
  })

  it('gives the beam its attachment, grey textures and code', () => {
    const c = lasered('wolverine', { bone: 'R.hand', position: [0.1, 0.2, 0.3], color: '#00FF20', alt_color: '#00FF20' })
    const r = new Builder(src(), c).build()
    const sk = Skeleton.ofBase(new R.BaseCharacter(src(), 'wolverine'))
    for (const costume of ['', '_alt']) {
      const marks = ngmtool.read(r.adds.get(`Bundles/synth${costume}.ngm`)!)[1][0].attachments.filter(([, k]) => k === laser.KIND)
      expect(marks.map(([node, , index, m]) => [node, index, ...m.slice(12, 15)])).toEqual([[sk.node('R.hand')!, 0, 0.1, 0.2, 0.3].map(Math.fround)])
      const names = latin1(r.adds.get(`Bundles/synth${costume}.ngt`)!).split(/\s+/).filter(Boolean)
      const [ims] = gxtex.readTpl(r.adds.get(`Bundles/synth${costume}.tpl`)!)
      for (const [, to] of laser.TEXTURES) {
        const at = names.findIndex((n) => n.toLowerCase() === to.toLowerCase())
        expect(at, to).toBeGreaterThanOrEqual(0)
        const im = ims[at]
        const rgba = gxtex.decode(im.format, im.base(), im.width, im.height)
        let spread = 0
        for (let i = 0; i < rgba.length; i += 4) spread = Math.max(spread, Math.abs(rgba[i] - rgba[i + 1]), Math.abs(rgba[i + 1] - rgba[i + 2]))
        expect(spread, to).toBeLessThanOrEqual(8)
        expect(im.data.length).toBe(im.size())
      }
    }
    // drawn added to what is behind them, as Iron Man's own GE_BlueLightning.nas has it
    const nsa = shaders.blocks(r.sets.get('Materials/Shaders/shaders.nsa')!)
    for (const [, to] of laser.TEXTURES) expect([nsa.get(to.toLowerCase())?.get('shader'), nsa.get(to.toLowerCase())?.get('texture')]).toEqual(['add', to])
    expect(r.laser).toMatchObject({ internal: 'Synth', range: 30, damage: 20, size: 1 })
    expect(r.laser!.effects[0]).toBe(r.laser!.effects[1])
    expect(latin1(r.sets.get('Misc/game.nfx')!)).toContain(`controller ${r.laser!.effects[0]}`)
    const slot = [2, 3, 4, 5, 6].find((i) => u32be(r.dol!, 0x90 + 4 * i))!
    const table = u32be(r.dol!, 4 * slot) + D.LASER_DATA
    expect(u32be(r.dol!, table + D.LASER_COUNT)).toBe(1)
    expect(latin1(r.dol!, table + D.LASER_ENTRIES + 0x60, table + D.LASER_ENTRIES + 0x60 + r.laser!.effects[0].length)).toBe(r.laser!.effects[0])
    expect(r.notes.some((n) => n.startsWith("laser beam: Iron Man's finisher beam tinted #00FF20"))).toBe(true)
    // no tuning file of its own for the laser
    expect(r.adds.has('Misc/PLAYER_Synth.nvb')).toBe(false)
  })

  it('uses an attachment kind no shipped model or effect has', () => {
    const s = src()
    const ngms = [...s.index.byName.keys()].filter((n) => n.startsWith('bundles/') && n.endsWith('.ngm'))
    expect(ngms.length).toBeGreaterThan(18)
    for (const n of ngms) {
      for (const m of ngmtool.read(s.entry(n))[1]) expect(m.attachments.some(([, k]) => k === laser.KIND), n).toBe(false)
    }
    const items = nfxtool.readNfx(s.entry('Misc/game.nfx'))
    for (const b of nfxtool.blocks(items)) {
      for (const rec of b.records()[0]) {
        if (['markertype', 'endmarker'].includes(nfxtool.KEYS[rec.key])) expect(rec.value, b.name).not.toBe(laser.KIND)
      }
    }
  })

  it("leaves the game's own dyngeoms alone", () => {
    // laser.s takes a dyngeom whose length1 has a fraction of 1/8 (within 0.004) near a beam's origin as the beam's
    for (const b of nfxtool.blocks(nfxtool.readNfx(src().entry('Misc/game.nfx')))) {
      if (b.type !== nfxtool.TYPES.indexOf('dyngeom')) continue
      const len = b.records()[0].find((rec) => nfxtool.KEYS[rec.key] === 'length1')?.value as number | undefined
      if (len === undefined || len < 1) continue
      expect(Math.abs(len - Math.trunc(len) - laser.SIGN), b.name).toBeGreaterThan(0.004)
    }
  })
})
