import { LabError } from '../core/errors'
import { decodePng } from '../core/image/png'
import { RgbaImage } from '../core/image/rgba'
import { MAX_IMAGE_SIDE } from '../core/package/imperfect'

type Picker = { description: string; accept: Record<string, string[]> }

interface PickerWindow {
  showOpenFilePicker?: (o: { types?: Picker[]; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (o: { suggestedName?: string; types?: Picker[] }) => Promise<FileSystemFileHandle>
}

const win = window as unknown as PickerWindow

export const canSaveInPlace = typeof win.showSaveFilePicker === 'function'

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

export function pickFiles(accept: string, options: { directory?: boolean; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = Boolean(options.multiple)
    if (options.directory) input.setAttribute('webkitdirectory', '')
    input.style.display = 'none'
    document.body.appendChild(input)
    const done = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done([...(input.files ?? [])]))
    input.addEventListener('cancel', () => done([]))
    input.click()
  })
}

export async function pickFile(accept: string): Promise<File | null> {
  return (await pickFiles(accept))[0] ?? null
}

export interface OpenedCharacter {
  name: string
  bytes: Uint8Array
  handle: FileSystemFileHandle | null
}

const IMPERFECT: Picker = { description: 'ImperfectLab characters', accept: { 'application/octet-stream': ['.imperfect'] } }

export async function openCharacter(): Promise<OpenedCharacter | null> {
  if (win.showOpenFilePicker) {
    try {
      const [handle] = await win.showOpenFilePicker({ types: [IMPERFECT] })
      const file = await handle.getFile()
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  const file = await pickFile('.imperfect')
  return file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null } : null
}

export function download(bytes: Uint8Array | string, name: string, type = 'application/octet-stream') {
  const blob = new Blob([bytes as BlobPart], { type })
  downloadBlob(blob, name)
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function saveCharacter(bytes: Uint8Array, name: string, handle: FileSystemFileHandle | null, ask: boolean): Promise<{ name: string; handle: FileSystemFileHandle | null } | null> {
  if (handle && !ask) {
    await writeHandle(handle, bytes)
    return { name: handle.name, handle }
  }
  if (win.showSaveFilePicker) {
    try {
      const h = await win.showSaveFilePicker({ suggestedName: name, types: [IMPERFECT] })
      await writeHandle(h, bytes)
      return { name: h.name, handle: h }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  download(bytes, name)
  return { name, handle: null }
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const w = await handle.createWritable()
  await w.write(bytes as BufferSource)
  await w.close()
}

export async function chooseIsoOutput(name: string): Promise<FileSystemFileHandle | null | 'cancel'> {
  if (!win.showSaveFilePicker) return null
  try {
    return await win.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Disc images', accept: { 'application/octet-stream': ['.iso'] } }] })
  } catch (e) {
    if (isAbort(e)) return 'cancel'
    throw e
  }
}

export async function decodePicture(file: File): Promise<RgbaImage> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let im: RgbaImage
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    im = decodePng(bytes)
  } else {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    } catch {
      throw new LabError(`${file.name} could not be read as a picture`)
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    im = new RgbaImage(bitmap.width, bitmap.height, ctx.getImageData(0, 0, bitmap.width, bitmap.height).data)
  }
  if (Math.max(im.width, im.height) > MAX_IMAGE_SIDE) throw new LabError(`the picture is larger than ${MAX_IMAGE_SIDE} pixels a side`)
  return im
}

export async function opfsFile(name: string): Promise<File> {
  const root = await navigator.storage.getDirectory()
  return (await root.getFileHandle(name)).getFile()
}

export async function removeOpfs(name: string) {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(name).catch(() => {})
}

export async function freeSpace(): Promise<number | null> {
  try {
    const e = await navigator.storage.estimate()
    return e.quota !== undefined && e.usage !== undefined ? e.quota - e.usage : null
  } catch {
    return null
  }
}
