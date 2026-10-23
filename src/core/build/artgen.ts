// Character art generated from one picture per costume.
// Tints are worked out in linear light, intended to be functionally equivalent to GIMP 3's "Colorize" and layer blending.
import { RgbaImage } from '../image/rgba'
import { hlsToRgb } from './colorsys'
import * as images from './images'
import { cutStrips } from './portraits'

export interface Framing {
  scale: number
  center: [number, number]
}

// GIMP Colorize hue, saturation and lightness
export type Tint = [number, number, number]


// Hard-coded to get the official Nemesis look.
export const TILE_TINTS: Record<'normal' | 'selected', Tint> = { normal: [0.5336, 0.7209, -0.325], selected: [0.5333, 0.3069, -0.033] } // For charselect icons
export const SELECTED_ZOOM = 1.3 // For charselect "Selected" icon
export const RAGE_DEFAULTS: [string, string] = ['#A30F0F1F', '#FF000014'] // For HUD icon
export const FIT = { loading: 4.5, hud: 4, tile: 3.5 } // For loading-screen slices

export interface ArtTemplates {
  outlines: [RgbaImage[], RgbaImage[]]
  hud: RgbaImage
  tiles: Record<'normal' | 'selected', [RgbaImage, RgbaImage]>
}

export interface ArtInputs {
  pictures: [RgbaImage, RgbaImage | null]
  loading: [Framing, Framing]
  hud: [Framing, Framing]
  tile: Framing
  tilePicture: RgbaImage
  rage: [string, string]
}

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

function srgb8(v: number): number {
  const c = Math.min(1, Math.max(0, v))
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
}

export function frame(picture: RgbaImage, f: Framing, size: [number, number]): RgbaImage {
  const hw = size[0] / 2 / f.scale, hh = size[1] / 2 / f.scale
  return images.cropResize(picture, [f.center[0] - hw, f.center[1] - hh, f.center[0] + hw, f.center[1] + hh], size)
}

// Fits the picture's width to `k` output widths with its top at the top, centred on the top of the figure.
export function defaultFraming(picture: RgbaImage, size: [number, number], k: number): Framing {
  const [x0, y0, x1, y1] = picture.bbox() ?? [0, 0, picture.width, picture.height]
  const scale = (k * size[0]) / Math.max(1, x1 - x0)
  const head = picture.crop(0, y0, picture.width, y0 + Math.max(1, Math.round((y1 - y0) * 0.12))).bbox()
  const cx = head ? (head[0] + head[2]) / 2 : (x0 + x1) / 2
  return { scale, center: [cx, y0 + size[1] / 2 / scale] }
}

export function colorize(im: RgbaImage, [hue, sat, light]: Tint): RgbaImage {
  const out = im.copy()
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    let lum = 0.2126 * LINEAR[d[i]] + 0.7152 * LINEAR[d[i + 1]] + 0.0722 * LINEAR[d[i + 2]]
    lum = light > 0 ? lum * (1 - light) + light : lum * (1 + light)
    const [r, g, b] = hlsToRgb(hue, lum, sat)
    d[i] = srgb8(r)
    d[i + 1] = srgb8(g)
    d[i + 2] = srgb8(b)
  }
  return out
}

export function tintOver(im: RgbaImage, color: string): RgbaImage {
  const c = [1, 3, 5].map((k) => LINEAR[parseInt(color.slice(k, k + 2), 16)])
  const a = color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1
  const out = im.copy()
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) d[i + k] = srgb8((1 - a) * LINEAR[d[i + k]] + a * c[k])
  }
  return out
}

export function hudPortrait(face: RgbaImage, template: RgbaImage): RgbaImage {
  const out = template.copy()
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  out.alphaComposite(face)
  out.putAlpha(template.alpha())
  return out
}

export function tile(face: RgbaImage, [bg, frameIm]: [RgbaImage, RgbaImage], tint: Tint): RgbaImage {
  const a = bg.alpha(), b = frameIm.alpha()
  const out = bg.copy()
  out.alphaComposite(colorize(face, tint))
  out.alphaComposite(frameIm)
  out.putAlpha(a.map((v, i) => Math.max(v, b[i])))
  return out
}

export function stripsSize(outlines: RgbaImage[]): [number, number] {
  return [outlines.reduce((w, o) => w + o.width, 0), outlines[0].height]
}

export function loadingStrips(picture: RgbaImage, f: Framing, outlines: RgbaImage[]): RgbaImage[] {
  const [W, H] = stripsSize(outlines)
  const face = RgbaImage.filled(W, H, [0, 0, 0, 255])
  face.alphaComposite(frame(picture, f, [W, H]))
  return cutStrips(face, outlines)
}

export function joinStrips(strips: RgbaImage[]): RgbaImage {
  const out = new RgbaImage(strips.reduce((w, s) => w + s.width, 0), strips[0].height)
  let x = 0
  for (const s of strips) {
    out.paste(s, x, 0)
    x += s.width
  }
  return out
}

export function hudPair(picture: RgbaImage, f: Framing, template: RgbaImage, rage: string): [RgbaImage, RgbaImage] {
  const face = frame(picture, f, template.size)
  return [hudPortrait(face, template), hudPortrait(tintOver(face, rage), template)]
}

export function tilePair(picture: RgbaImage, f: Framing, t: ArtTemplates['tiles']): [RgbaImage, RgbaImage] {
  const closer = frame(picture, { ...f, scale: f.scale * SELECTED_ZOOM }, t.selected[0].size)
  return [tile(frame(picture, f, t.normal[0].size), t.normal, TILE_TINTS.normal), tile(closer, t.selected, TILE_TINTS.selected)]
}

export function generate(a: ArtInputs, t: ArtTemplates): Map<string, RgbaImage> {
  const out = new Map<string, RgbaImage>()
  a.pictures.forEach((pic, i) => {
    if (!pic) return
    const alt = i === 1 ? '_alt' : ''
    const [wide, narrow] = loadingStrips(pic, a.loading[i], t.outlines[i])
    out.set(`load_wide${alt}`, wide)
    out.set(`load_narrow${alt}`, narrow)
    const [hud, rage] = hudPair(pic, a.hud[i], t.hud, a.rage[i])
    out.set(`hud${alt}`, hud)
    out.set(`hud${alt}_rage`, rage)
  })
  const [normal, selected] = tilePair(a.tilePicture, a.tile, t.tiles)
  out.set('tile', normal)
  out.set('tile_selected', selected)
  return out
}