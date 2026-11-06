// The last disc chosen, as a File System Access handle in IndexedDB, so a reload can reopen it (Chromium only).

export type DiscKind = 'file' | 'folder'

export interface DiscDetails {
  size: number
  modified: number | null
  files: number | null
}

export interface RememberedDisc {
  kind: DiscKind
  name: string
  handle: FileSystemHandle
  details?: DiscDetails
}

type PermissionState = 'granted' | 'denied' | 'prompt'

interface PermissionHandle {
  queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>
}

const DB = 'imperfectlab'
const STORE = 'disc'
const KEY = 'last'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = work(d.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    d.close()
  }
}

export async function rememberDisc(disc: RememberedDisc) {
  try {
    await run('readwrite', (s) => s.put(disc, KEY))
  } catch {
    // storage may be unavailable; the disc is then chosen again next time
  }
}

export async function recallDisc(): Promise<RememberedDisc | null> {
  try {
    const v = await run<RememberedDisc | undefined>('readonly', (s) => s.get(KEY))
    return v && v.handle && (v.kind === 'file' || v.kind === 'folder') ? v : null
  } catch {
    return null
  }
}

export async function forgetDisc() {
  try {
    await run('readwrite', (s) => s.delete(KEY))
  } catch {
    // nothing to forget
  }
}

// Asking needs user approval.
export async function readPermission(handle: FileSystemHandle, ask: boolean): Promise<PermissionState> {
  const h = handle as FileSystemHandle & PermissionHandle
  try {
    const state = (await h.queryPermission?.({ mode: 'read' })) ?? 'granted'
    if (state !== 'prompt' || !ask) return state
    return (await h.requestPermission?.({ mode: 'read' })) ?? 'denied'
  } catch {
    return 'denied'
  }
}