import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as A from '../src/core/build/artgen'
import { cutStrips } from '../src/core/build/portraits'
import { decodePng } from '../src/core/image/png'
import { RgbaImage } from '../src/core/image/rgba'

const template = (name: string) => decodePng(new Uint8Array(readFileSync(new URL(`../src/assets/templates/${name}.png`, import.meta.url))))
const pixel = (im: RgbaImage, x: number, y: number) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)]

function find(im: RgbaImage, test: (p: number[]) => boolean): [number, number] {
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (test(pixel(im, x, y))) return [x, y]
  throw new Error('no such pixel')
}

describe('art generator', () => {
  it('colorizes like GIMP in linear light', () => {
    const im = new RgbaImage(2, 1, Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 128]))
    expect(pixel(A.colorize(im, A.TILE_TINTS.normal), 0, 0)).toEqual([177, 233, 245, 255])
    expect(pixel(A.colorize(im, A.TILE_TINTS.selected), 0, 0)).toEqual([250, 252, 252, 255])
    expect(pixel(A.colorize(im, A.TILE_TINTS.normal), 1, 0)).toEqual([0, 0, 0, 128])
  })

  it('tints the rage portrait like the samples', () => {
    const im = new RgbaImage(3, 1, Uint8Array.from([8, 9, 1, 255, 186, 186, 178, 255, 96, 78, 66, 255]))
    const out = A.tintOver(im, A.RAGE_DEFAULTS[0])
    const want = [[61, 10, 3], [183, 176, 168], [107, 74, 62]]
    want.forEach((w, x) => pixel(out, x, 0).slice(0, 3).forEach((v, k) => expect(Math.abs(v - w[k])).toBeLessThanOrEqual(2)))
  })

  it('cuts the HUD portrait to the template', () => {
    const t = template('icon-bg')
    const face = RgbaImage.filled(t.width, t.height, [200, 100, 50, 255])
    const out = A.hudPortrait(face, t)
    expect(out.alpha()).toEqual(t.alpha())
    const [x, y] = find(t, (p) => p[3] === 255)
    expect(pixel(out, x, y)).toEqual([200, 100, 50, 255])
  })

  it('builds a tile from its background, the tinted picture and its frame', () => {
    const bg = template('charselect-normal-bg'), fr = template('charselect-normal-frame')
    const want = bg.alpha().map((v, i) => Math.max(v, fr.alpha()[i]))
    const white = A.tile(RgbaImage.filled(bg.width, bg.height, [255, 255, 255, 255]), [bg, fr], A.TILE_TINTS.normal)
    expect(white.alpha()).toEqual(want)
    const inside = bg.alpha().findIndex((v, i) => v === 255 && fr.alpha()[i] === 0)
    expect(pixel(white, inside % bg.width, Math.floor(inside / bg.width))).toEqual([177, 233, 245, 255])
    const edge = fr.alpha().findIndex((v) => v === 255)
    expect(pixel(white, edge % bg.width, Math.floor(edge / bg.width))).toEqual(pixel(fr, edge % bg.width, Math.floor(edge / bg.width)))
    const empty = A.tile(new RgbaImage(bg.width, bg.height), [bg, fr], A.TILE_TINTS.normal)
    expect(pixel(empty, inside % bg.width, Math.floor(inside / bg.width))).toEqual(pixel(bg, inside % bg.width, Math.floor(inside / bg.width)))
  })

  it('cuts the loading screen into strips with their outlines', () => {
    const face = RgbaImage.filled(6, 2, [10, 20, 30, 255])
    const wide = new RgbaImage(4, 2), narrow = new RgbaImage(2, 2)
    wide.putAlpha(Uint8Array.from([0, 255, 255, 255, 255, 255, 255, 0]))
    narrow.putAlpha(Uint8Array.from([255, 0, 128, 0]))
    const [a, b] = cutStrips(face, [wide, narrow])
    expect([a.size, b.size]).toEqual([[4, 2], [2, 2]])
    expect(a.alpha()).toEqual(wide.alpha())
    expect(b.alpha()).toEqual(narrow.alpha())
    expect(A.joinStrips([a, b]).size).toEqual([6, 2])
  })

  it('puts the loading screen on black', () => {
    const outlines = [RgbaImage.filled(4, 2, [0, 0, 0, 255]), RgbaImage.filled(2, 2, [0, 0, 0, 255])]
    const pic = new RgbaImage(6, 2)
    pic.paste(RgbaImage.filled(3, 2, [200, 0, 0, 255]), 0, 0)
    const joined = A.joinStrips(A.loadingStrips(pic, { scale: 1, center: [3, 1] }, outlines))
    expect(pixel(joined, 0, 0)).toEqual([200, 0, 0, 255])
    expect(pixel(joined, 5, 1)).toEqual([0, 0, 0, 255])
  })

  it('zooms the selected tile in on the same center', () => {
    const t = { normal: [template('charselect-normal-bg'), template('charselect-normal-frame')], selected: [template('charselect-selected-bg'), template('charselect-selected-frame')] } as A.ArtTemplates['tiles']
    const pic = new RgbaImage(64, 32)
    pic.paste(RgbaImage.filled(20, 32, [255, 255, 255, 255]), 22, 0)
    const [normal, selected] = A.tilePair(pic, { scale: 1, center: [32, 16] }, t)
    const lit = (im: RgbaImage) => { let n = 0; for (let x = 0; x < 64; x++) if (pixel(im, x, 16)[0] > 150) n++; return n }
    expect(lit(selected) / lit(normal)).toBeCloseTo(A.SELECTED_ZOOM, 0)
    expect(lit(selected)).toBeGreaterThan(lit(normal))
  })

  it('frames a picture by scale and center', () => {
    const pic = new RgbaImage(40, 80)
    pic.paste(RgbaImage.filled(20, 60, [9, 9, 9, 255]), 10, 10)
    const f = A.defaultFraming(pic, [8, 4], 2)
    expect(f.scale).toBeCloseTo(16 / 20)
    expect(f.center).toEqual([20, 10 + 2 / f.scale])
    const out = A.frame(pic, { scale: 1, center: [20, 40] }, [10, 10])
    expect(pixel(out, 5, 5)).toEqual([9, 9, 9, 255])
    expect(pixel(A.frame(pic, { scale: 1, center: [-20, 40] }, [10, 10]), 5, 5)[3]).toBe(0)
  })

  it('generates every slot, leaving out costume 2 without its picture', () => {
    const pic = RgbaImage.filled(100, 200, [120, 130, 140, 255])
    const outlines = [RgbaImage.filled(128, 256, [0, 0, 0, 255]), RgbaImage.filled(32, 256, [0, 0, 0, 255])]
    const t: A.ArtTemplates = {
      outlines: [outlines, outlines],
      hud: template('icon-bg'),
      tiles: { normal: [template('charselect-normal-bg'), template('charselect-normal-frame')], selected: [template('charselect-selected-bg'), template('charselect-selected-frame')] },
    }
    const f: A.Framing = { scale: 1, center: [50, 100] }
    const inputs: A.ArtInputs = { pictures: [pic, null], loading: [f, f], hud: [f, f], tile: f, tilePicture: pic, rage: A.RAGE_DEFAULTS }
    expect([...A.generate(inputs, t).keys()].sort()).toEqual(['hud', 'hud_rage', 'load_narrow', 'load_wide', 'tile', 'tile_selected'])
    const all = A.generate({ ...inputs, pictures: [pic, pic] }, t)
    expect(all.size).toBe(10)
    expect(all.get('load_wide')!.size).toEqual([128, 256])
    expect(all.get('load_narrow_alt')!.size).toEqual([32, 256])
    expect(all.get('hud_alt_rage')!.size).toEqual([64, 64])
  })
})
