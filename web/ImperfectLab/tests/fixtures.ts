import * as R from '../src/core/game/roster'
import type { GameSource } from '../src/core/game/source'
import { encodePng } from '../src/core/image/png'
import { RgbaImage } from '../src/core/image/rgba'
import { Model } from '../src/core/model/glb'
import * as mapping from '../src/core/model/mapping'
import { Skeleton } from '../src/core/model/skeleton'
import * as imperfect from '../src/core/package/imperfect'
import { makeGlb } from './helpers'

export function pattern(w: number, h: number, seed: number, transparentBorder = 0): Uint8Array {
  const im = new RgbaImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      im.data[i] = (x * 255) / Math.max(1, w - 1) + seed * 37
      im.data[i + 1] = (y * 255) / Math.max(1, h - 1) + seed * 11
      im.data[i + 2] = ((x ^ y) * 7 + seed * 53) & 255
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y)
      im.data[i + 3] = edge < transparentBorder ? (edge * 255) / transparentBorder : 255
    }
  }
  return encodePng(im)
}

function base(src: GameSource, name: string, display: string, key: string): imperfect.Character {
  const c = imperfect.newCharacter()
  c.internalName = name
  c.displayName = display
  c.base = key
  c.glb = makeGlb()
  const auto = mapping.autoMap(new Model(c.glb), Skeleton.ofBase(new R.BaseCharacter(src, key)))
  c.mapping = auto.mapping
  c.overrides = auto.overrides
  return c
}

export function fixtureA(src: GameSource): imperfect.Character {
  const c = base(src, 'ParityA', 'PARITY A', 'johnnyohm')
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [64, 64]), texture: 'textures/skin.png', alt: 'hue:120' }]
  c.files = new Map([['textures/skin.png', pattern(64, 64, 1)]])
  c.gameplay = { damage_taken: 0.7, lift: 'heavy', wire_swing: true, health: 150, run_speed: 12.5 }
  c.aura = { mode: 'tint', color: '#FF4020', alt_color: '#20FF40' }
  c.ui.ready_voice = 'FE_SFX_OHM'
  c.credits = { author: 'parity', description: 'fixture A', assets: [{ what: 'model', by: 'test', license: 'CC0', url: '' }] }
  return c
}

export function fixtureB(src: GameSource): imperfect.Character {
  const c = base(src, 'ParityB', 'PARITY B', 'storm')
  c.materials = [{ ...imperfect.newMaterial(0, 'skin', true, '', [128, 64]), texture: 'textures/skin.png', alt: 'textures/skin_alt.png', twoSided: true }]
  c.files = new Map([
    ['textures/skin.png', pattern(100, 60, 2)],
    ['textures/skin_alt.png', pattern(77, 131, 3)],
    ['ui/select_ready.png', pattern(240, 320, 4, 30)],
    ['ui/select_readyalt.png', pattern(200, 300, 5, 12)],
    ['ui/tile.png', pattern(64, 32, 6)],
    ['ui/hud.png', pattern(64, 64, 7, 8)],
    ['ui/hud_rage.png', pattern(64, 64, 8)],
    ['ui/banner.png', pattern(150, 40, 9, 4)],
  ])
  c.aura = { mode: 'swap', color: '#40A0FF', alt_color: '#50FF50' }
  c.stats = { normal: [7, 6, 5, 4, 3, 2], alt: [1, 2, 3, 4, 5, 6] }
  c.ui.select = { ready: { scale: 1.1, anchor: [120, 60], glow: '#3CFF5A6E' }, readyalt: { scale: 0.9, anchor: [100, 50], glow: null } }
  c.ui.fade = 40
  c.nameColor = '#FFAA00'
  return c
}
