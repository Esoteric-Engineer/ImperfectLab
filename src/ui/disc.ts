// Opening the disc: chosen by the user, or reopened from the last visit (discHandle.ts).
import { type DiscDetails, type RememberedDisc, forgetDisc, readPermission, recallDisc, rememberDisc } from '../io/discHandle'
import { type PickedDisc, findInFolder, readFolderHandle } from '../io/files'
import { discKey, isVerified, rememberVerified } from '../io/verified'
import type { BaseInfo, DiscInfo } from '../worker/protocol'
import { engine, errorText } from './engine'
import { store } from './store'

export type CheckProgress = (progress: [number, number] | null) => void

const BIG = 'files/clash.big'

// A folder is told apart by its name and its main archive, so it can be keyed without reading the rest.
function folderKey(name: string, big: File | undefined): string {
  return `${name}|${big ? discKey(big) : ''}`
}

function keyOf(src: PickedDisc): string {
  if (src.kind === 'file') return discKey(src.file)
  const big = src.entries.find(([p]) => p.toLowerCase().endsWith(BIG))
  return folderKey(src.name, big?.[1])
}

async function peekKey(disc: RememberedDisc): Promise<string | null> {
  try {
    if (disc.kind === 'file') return discKey(await (disc.handle as FileSystemFileHandle).getFile())
    const handle = disc.handle as FileSystemDirectoryHandle
    return folderKey(handle.name, await findInFolder(handle, BIG))
  } catch {
    return null
  }
}

function detailsOf(src: PickedDisc): DiscDetails {
  if (src.kind === 'file') return { size: src.file.size, modified: src.file.lastModified, files: null }
  return { size: src.entries.reduce((n, [, f]) => n + f.size, 0), modified: null, files: src.entries.length }
}

export function describeDisc(d: DiscDetails): string {
  const parts: string[] = []
  if (d.files !== null) parts.push(`${d.files.toLocaleString()} files`)
  const gb = d.size / 1024 ** 3
  parts.push(gb >= 1 ? `${gb.toFixed(2)} GB` : `${(d.size / 1024 ** 2).toFixed(0)} MB`)
  if (d.modified !== null) parts.push(`modified ${new Date(d.modified).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`)
  return parts.join(' · ')
}

export async function loadDisc(src: PickedDisc, onCheck: CheckProgress = () => {}): Promise<boolean> {
  const key = keyOf(src)
  let info: DiscInfo
  try {
    info = src.kind === 'file'
      ? await engine.call<DiscInfo>('openFile', [src.file])
      : await engine.call<DiscInfo>('openFolder', [src.name, src.entries])
  } catch (e) {
    store.fail(e)
    return false
  }
  store.setGame(null)
  if (!isVerified(key)) {
    onCheck([0, 0])
    try {
      await engine.call('verify', [], (_stage, done, total) => onCheck([done, total]))
    } catch (e) {
      onCheck(null)
      store.fail(`${info.name} cannot be used:\n${errorText(e)}`)
      return false
    }
    onCheck(null)
    rememberVerified(key)
  }
  const details = detailsOf(src)
  try {
    const bases = await engine.call<BaseInfo[]>('bases')
    store.setGame({ name: info.name, key, verified: true, bases, details })
  } catch (e) {
    store.fail(e)
    return false
  }
  if (src.handle) {
    const disc: RememberedDisc = { kind: src.kind, name: src.handle.name, handle: src.handle, details }
    store.setRememberedDisc(disc)
    await rememberDisc(disc)
  } else {
    store.setRememberedDisc(null)
    await forgetDisc()
  }
  return true
}

// Null, and forgotten, when the disc is gone from where it was.
async function sourceOf(disc: RememberedDisc): Promise<PickedDisc | null> {
  try {
    if (disc.kind === 'file') {
      const handle = disc.handle as FileSystemFileHandle
      return { kind: 'file', file: await handle.getFile(), handle }
    }
    const handle = disc.handle as FileSystemDirectoryHandle
    return { kind: 'folder', name: handle.name, entries: await readFolderHandle(handle), handle }
  } catch {
    store.setRememberedDisc(null)
    await forgetDisc()
    return null
  }
}

// Reopens the last disc automatically when the browser still allows reading it and it was previously verified.
// Otherwise, the Game page offers to reopen it.
let restoring: Promise<void> | null = null
export function restoreDisc(): Promise<void> {
  restoring ??= restore()
  return restoring
}

async function restore() {
  store.setRestoringDisc(true)
  try {
    const disc = await recallDisc()
    if (!disc || store.game) return
    store.setRememberedDisc(disc)
    if ((await readPermission(disc.handle, false)) !== 'granted') return
    const key = await peekKey(disc)
    if (!key || !isVerified(key)) return
    const src = await sourceOf(disc)
    if (src && !store.game) await loadDisc(src)
  } finally {
    store.setRestoringDisc(false)
  }
}

// Must run from a click, as it may ask the browser for permission.
export async function reopenDisc(onCheck: CheckProgress): Promise<boolean> {
  const disc = store.rememberedDisc
  if (!disc) return false
  if ((await readPermission(disc.handle, true)) !== 'granted') {
    store.fail(`ImperfectLab was not allowed to read ${disc.name}. Allow access, or choose the disc again.`)
    return false
  }
  const src = await sourceOf(disc)
  if (!src) {
    store.fail(`${disc.name} could not be found any more. Please choose the disc again.`)
    return false
  }
  return loadDisc(src, onCheck)
}