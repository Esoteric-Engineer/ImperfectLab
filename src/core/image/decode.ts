import { LabError } from '../errors'
import { decodePng } from './png'
import type { RgbaImage } from './rgba'

export const MAX_IMAGE_SIDE = 4096

export function isPng(body: Uint8Array): boolean {
  return body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47
}

export function decodeImage(body: Uint8Array): RgbaImage {
  if (!isPng(body)) throw new LabError('only PNG images can be read here')
  let im: RgbaImage
  try {
    im = decodePng(body)
  } catch (e) {
    throw new LabError(`an image could not be read: ${(e as Error).message}`)
  }
  if (Math.max(im.width, im.height) > MAX_IMAGE_SIDE) throw new LabError(`an image is larger than ${MAX_IMAGE_SIDE} pixels a side`)
  return im
}
