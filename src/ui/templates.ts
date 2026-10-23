// The art templates that ship with the app, for the art generator.
// NOT official game assets!!! These were all hand-made (just look at how poorly they're drawn lol)
import iconBg from '../assets/templates/icon-bg.png?inline'
import normalBg from '../assets/templates/charselect-normal-bg.png?inline'
import normalFrame from '../assets/templates/charselect-normal-frame.png?inline'
import selectedBg from '../assets/templates/charselect-selected-bg.png?inline'
import selectedFrame from '../assets/templates/charselect-selected-frame.png?inline'
import type { ArtTemplates } from '../core/build/artgen'
import { decodePng } from '../core/image/png'
import type { RgbaImage } from '../core/image/rgba'

function fromDataUrl(url: string): RgbaImage {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  return decodePng(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
}

let cached: Omit<ArtTemplates, 'outlines'> | null = null

export function bundledTemplates(): Omit<ArtTemplates, 'outlines'> {
  cached ??= {
    hud: fromDataUrl(iconBg),
    tiles: { normal: [fromDataUrl(normalBg), fromDataUrl(normalFrame)], selected: [fromDataUrl(selectedBg), fromDataUrl(selectedFrame)] },
  }
  return cached
}
