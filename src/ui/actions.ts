import * as imperfect from '../core/package/imperfect'
import { type OpenedCharacter, openCharacter, saveCharacter } from '../io/files'
import { errorText } from './engine'
import { store } from './store'

export function confirmDiscard(): boolean {
  return !store.dirty || window.confirm(`Discard the unsaved changes to ${store.character.displayName}?`)
}

export async function newCharacter(): Promise<boolean> {
  if (!confirmDiscard()) return false
  await store.setCharacter(imperfect.newCharacter())
  return true
}

export function open(): Promise<boolean> {
  return openFrom(openCharacter)
}

export function openDropped(pending: Promise<OpenedCharacter | null>): Promise<boolean> {
  return openFrom(() => pending)
}

async function openFrom(get: () => Promise<OpenedCharacter | null>): Promise<boolean> {
  if (!confirmDiscard()) return false
  let opened
  try {
    opened = await get()
  } catch (e) {
    store.fail(e)
    return false
  }
  if (!opened) return false
  let c: imperfect.Character
  try {
    c = imperfect.load(opened.bytes)
  } catch (e) {
    store.fail(`${opened.name} could not be opened:\n${errorText(e)}`)
    return false
  }
  await store.setCharacter(c, opened.name, opened.handle)
  showCredits()
  return true
}

function creditLine(a: { what: string; by: string; license: string; url: string }) {
  const rest = [[a.by, a.license].filter(Boolean).join(', '), a.url].filter(Boolean).join(' ')
  return [a.what, rest].filter(Boolean).join(': ')
}

export function showCredits() {
  const c = store.character
  const cr = c.credits
  const tile = c.files.get('ui/tile.png') ?? c.files.get('ui/tile_selected.png')
  closeCredits()
  store.credits = {
    name: c.displayName,
    color: c.nameColor,
    tile: tile ? URL.createObjectURL(new Blob([tile as BlobPart], { type: 'image/png' })) : null,
    author: cr.author,
    description: cr.description,
    assets: cr.assets.filter((a) => a.what || a.by || a.license || a.url).map(creditLine),
  }
  store.emit()
}

export function closeCredits() {
  if (store.credits?.tile) URL.revokeObjectURL(store.credits.tile)
  store.credits = null
  store.emit()
}

async function write(ask: boolean): Promise<boolean> {
  const c = store.character
  const point = store.savePoint()
  let data: Uint8Array
  try {
    data = imperfect.save(c)
  } catch (e) {
    store.fail(`Saving failed:\n${errorText(e)}`)
    return false
  }
  try {
    const name = store.fileName ?? `${c.internalName.toLowerCase()}.imperfect`
    const r = await saveCharacter(data, name, store.fileHandle, ask)
    if (!r) return false
    if (store.character !== c) return true
    store.fileName = r.name
    store.fileHandle = r.handle
    store.markSaved(point)
    store.message(`Saved ${r.name} (${Math.floor(data.length / 1024)} KB)`)
    return true
  } catch (e) {
    store.fail(`Saving failed:\n${errorText(e)}`)
    return false
  }
}

export function save(): Promise<boolean> {
  return write(!store.fileHandle)
}

export function saveAs(): Promise<boolean> {
  return write(true)
}
