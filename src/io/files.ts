import { LabError } from '../core/errors'
import { decodePng } from '../core/image/png'
import { RgbaImage } from '../core/image/rgba'
import { MAX_IMAGE_SIDE } from '../core/package/imperfect'

type Picker = { description: string; accept: Record<string, string[]> }

interface PickerWindow {
  showOpenFilePicker?: (o: { types?: Picker[]; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (o: { suggestedName?: string; types?: Picker[] }) => Promise<FileSystemFileHandle>
  showDirectoryPicker?: (o?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>
}

interface IterableDirectory {
  values(): AsyncIterable<FileSystemHandle>
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

const DISC: Picker = { description: 'GameCube disc images', accept: { 'application/octet-stream': ['.iso', '.gcm', '.ciso'] } }

export interface PickedDiscFile {
  kind: 'file'
  file: File
  handle: FileSystemFileHandle | null
}

export async function pickDiscFile(): Promise<PickedDiscFile | null> {
  if (win.showOpenFilePicker) {
    try {
      const [handle] = await win.showOpenFilePicker({ types: [DISC] })
      return { kind: 'file', file: await handle.getFile(), handle }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  const file = await pickFile('.iso,.gcm,.ciso')
  return file ? { kind: 'file', file, handle: null } : null
}

export interface PickedDiscFolder {
  kind: 'folder'
  name: string
  // Paths start with the folder's own name, as webkitRelativePath does.
  entries: [string, File][]
  handle: FileSystemDirectoryHandle | null
}

export async function pickDiscFolder(): Promise<PickedDiscFolder | null> {
  if (win.showDirectoryPicker) {
    let handle: FileSystemDirectoryHandle
    try {
      handle = await win.showDirectoryPicker({ mode: 'read' })
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
    return { kind: 'folder', name: handle.name, entries: await readFolderHandle(handle), handle }
  }
  const files = await pickFiles('', { directory: true })
  if (!files.length) return null
  const entries = files.map((f) => [(f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, f] as [string, File])
  return { kind: 'folder', name: entries[0][0].split('/')[0], entries, handle: null }
}

export type PickedDisc = PickedDiscFile | PickedDiscFolder

export async function readFolderHandle(dir: FileSystemDirectoryHandle): Promise<[string, File][]> {
  const pending: Promise<[string, File]>[] = []
  const walk = async (d: FileSystemDirectoryHandle, path: string) => {
    for await (const h of (d as unknown as IterableDirectory).values()) {
      const p = `${path}/${h.name}`
      if (h.kind === 'file') pending.push((h as FileSystemFileHandle).getFile().then((f): [string, File] => [p, f]))
      else await walk(h as FileSystemDirectoryHandle, p)
    }
  }
  await walk(dir, dir.name)
  return Promise.all(pending)
}

// One file at a relative path such as 'files/clash.big', matching names without regard to case.
export async function findInFolder(dir: FileSystemDirectoryHandle, path: string): Promise<File | undefined> {
  const parts = path.toLowerCase().split('/')
  let cur = dir
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1
    let next: FileSystemHandle | undefined
    for await (const h of (cur as unknown as IterableDirectory).values()) {
      if (h.name.toLowerCase() === part && h.kind === (last ? 'file' : 'directory')) {
        next = h
        break
      }
    }
    if (!next) return undefined
    if (last) return (next as FileSystemFileHandle).getFile()
    cur = next as FileSystemDirectoryHandle
  }
  return undefined
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

interface HandleItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}

export function droppedCharacter(dt: DataTransfer): Promise<OpenedCharacter | null> | null {
  for (const item of dt.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file?.name.toLowerCase().endsWith('.imperfect')) continue
    const pendingHandle = (item as unknown as HandleItem).getAsFileSystemHandle?.() ?? Promise.resolve(null)
    return (async () => {
      const h = await pendingHandle.catch(() => null)
      const handle = h?.kind === 'file' ? (h as FileSystemFileHandle) : null
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle }
    })()
  }
  return null
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
