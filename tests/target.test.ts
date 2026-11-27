import { describe, expect, it } from 'vitest'
import { buildBatch } from '../src/core/build/batch'
import { copyPrefix, Effects } from '../src/core/build/effects'
import * as gun from '../src/core/build/gun'
import { healthCharacters } from '../src/core/build/patch'
import * as shield from '../src/core/build/shield'
import { type BuildTarget, effectPrefix, GAMECUBE } from '../src/core/build/target'
import * as tuning from '../src/core/build/tuning'
import { encodeLatin1, latin1 } from '../src/core/bytes'
import * as D from '../src/core/game/dol'
import * as nfxtool from '../src/core/mnroi/nfxtool'
import * as imperfect from '../src/core/package/imperfect'
import { character, gameSource, ISO } from './helpers'

const JOINED: BuildTarget = { maxCharacters: 27, effectCacheMax: 450000, tintLimit: 141808, listBuffer: 0x1000, ghostTwins: true, wholeNamePrefixes: true, patchDol: false }

const nfxNames = (d: Uint8Array) => nfxtool.blocks(nfxtool.readNfx(d)).map((b) => b.name)

describe('build targets', () => {
  it('names effects as the GameCube build always has by default', () => {
    for (const name of ['Synth', 'ab', 'Doctor_Doom']) {
      expect(effectPrefix(name)).toBe(name.slice(0, 2).toLowerCase())
      expect(copyPrefix(name, true)).toBe(name.slice(0, 2).toLowerCase() + 'a')
    }
    expect(effectPrefix('Synth', JOINED)).toBe('synth_')
    expect(copyPrefix('Synth', false, JOINED)).toBe('synth_f')
  })

  it('gives the tuning list the room the target has', () => {
    const list = encodeLatin1('PLAYER Wolverine\r\n')
    const room = tuning.listRoom(list)
    expect(tuning.listRoom(list, JOINED.listBuffer) - room).toBe(JOINED.listBuffer - GAMECUBE.listBuffer)
  })
})

describe.skipIf(!ISO)('build targets on the disc', () => {
  const stock = () => gameSource().entry('Misc/game.nfx')

  it('keeps an effect file\'s rules in its copies and in every effect it names', () => {
    const fx = new Effects(stock(), JOINED)
    expect(fx.clone().rules).toBe(JOINED)
    expect(gun.tracer(fx, 'Synth').startsWith('synth_gn')).toBe(true)
    expect(Object.values(shield.effects(fx, 'Synth')).every((n) => n.startsWith('synth_sh'))).toBe(true)
    const gc = new Effects(stock())
    expect(gun.tracer(gc, 'Synth').startsWith('sygn')).toBe(true)
  })

  it('builds without main.dol, with whole-name effects and ghost twins', () => {
    const c = character('magneto', 'Ghosty')
    c.aura = { mode: 'tint', tint: 'all', color: '#45FF42', alt_color: '#B109D3' }
    c.flames = { ...imperfect.defaultFlames(), parts: ['head'] }
    c.zButton = { stealth: { undetected: false, untouchable: false, visible: 0.5 }, costume: null, stats: null, size: null, bullet: null, gun: null, laser: imperfect.defaultLaser(), impersonate: null, requires: { energy: { seconds: 8, regen: false } } }
    c.damageStages = [{ enabled: true, health: 75 }, { enabled: false, health: 50 }, { enabled: true, health: 25 }]
    c.materials = [{ ...c.materials[0], damage: { normal: ['hue:30', 'prev', 'hue:90'], alt: ['prev', 'prev', 'prev'] } }]
    const r = buildBatch(gameSource(), [c], () => {}, [], JOINED)
    expect(r.dol).toBeNull()
    expect(r.lasers).toHaveLength(1)
    const before = new Set(nfxNames(stock()).map((n) => n.toLowerCase()))
    const added = nfxNames(r.sets.get('Misc/game.nfx')!).filter((n) => !before.has(n.toLowerCase()))
    expect(added.length).toBeGreaterThan(0)
    expect(added.filter((n) => !n.toLowerCase().startsWith('ghosty_'))).toEqual([])
    const nsa = latin1(r.sets.get('Materials/Shaders/shaders.nsa')!)
    expect(nsa).toMatch(/^Ghosty_z\s/m)
    expect(latin1(buildBatch(gameSource(), [c]).sets.get('Materials/Shaders/shaders.nsa')!)).not.toMatch(/^Ghosty_z\s/m)
    expect(healthCharacters([c], JOINED)[0]).toMatchObject({ kept: 2, z: 1 })
    expect(healthCharacters([c])[0]).toMatchObject({ kept: 1, z: null })
    expect(D.healthTableLE(healthCharacters([c], JOINED)).length).toBe(D.healthTableLE([]).length + (D.healthTableLE(healthCharacters([c])).length - 4))
  })
})