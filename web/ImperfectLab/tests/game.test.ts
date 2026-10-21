import { describe, expect, it } from 'vitest'
import * as effects from '../src/core/build/effects'
import { Builder } from '../src/core/build/patch'
import * as templates from '../src/core/build/templates'
import * as tuning from '../src/core/build/tuning'
import * as ui from '../src/core/build/ui'
import { latin1 } from '../src/core/bytes'
import { LabError } from '../src/core/errors'
import * as D from '../src/core/game/dol'
import * as R from '../src/core/game/roster'
import { Apt } from '../src/core/mnroi/apt'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import * as nvbtool from '../src/core/mnroi/nvbtool'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { gameSource, ISO, makeGlb, pngBytes } from './helpers'

const DOOM_EDITS: [number, string | number[]][] = [[0x4c7ac0, 'plr_doctordoom'], [0x4c7ae0, 'DOCTOR DOOM'], [0x4c7b00, [7, 4, 3, 6, 5, 4, 0, 0]],
  [0x4c80b0, 'plr_altDoctordoom'], [0x4c8148, [0, 0, 0, 0x13]]]

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

  it('refuses a patched main.dol', () => {
    const out = D.patch(gameSource().dol, 'A', 'B', [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])
    expect(() => D.patch(out, 'A', 'B', [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])).toThrow(LabError)
  })

  it('reads every base record', () => {
    for (const key of R.keys()) expect(D.readRecord(gameSource().dol, D.NORMAL_TABLE, R.BASES[key][2]).name.toLowerCase().startsWith('plr_')).toBe(true)
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
    const jo = effects.tintRoots(src(), new R.BaseCharacter(src(), 'johnnyohm'))
    const thing = effects.tintRoots(src(), new R.BaseCharacter(src(), 'thing'))
    expect(jo[0]).toContain('jOhmStand')
    expect([thing[0], thing[1]]).toEqual([[], []])
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
