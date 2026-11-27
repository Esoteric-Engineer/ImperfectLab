/// <reference lib="webworker" />
import { folderDisc, ImageDisc, type ReadAt } from '../core/game/disc'
import { GameSource } from '../core/game/source'
import { RgbaImage } from '../core/image/rgba'
import { type ImageDecoder, Model } from '../core/model/glb'

// workers only: FileReaderSync
export function blobReader(blob: Blob): ReadAt {
  const reader = new FileReaderSync()
  return {
    size: blob.size,
    read: (offset, size) => new Uint8Array(reader.readAsArrayBuffer(blob.slice(offset, offset + size))),
  }
}

export function openGameImage(blob: Blob, name: string): GameSource {
  return new GameSource(new ImageDisc(blobReader(blob), name))
}

export function openGameFolder(files: [string, Blob][], name: string): GameSource {
  return new GameSource(folderDisc(new Map(files.map(([k, f]) => [k, blobReader(f)])), name))
}

export const decodeImage: ImageDecoder = async (body) => {
  const bitmap = await createImageBitmap(new Blob([body as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  return new RgbaImage(bitmap.width, bitmap.height, ctx.getImageData(0, 0, bitmap.width, bitmap.height).data)
}

export async function loadModel(glb: Uint8Array, decode: ImageDecoder = decodeImage): Promise<Model> {
  const m = new Model(glb)
  await m.decodeWith(decode)
  return m
}