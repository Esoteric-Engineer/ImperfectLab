// The last disc chosen, as a File System Access handle in the shared workspace, so a reload (or Lab Builder) can reopen it.
import { forgetHandle, getHandle, setHandle } from '@nemesismods/workspace'

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

export async function rememberDisc(disc: RememberedDisc) {
  try {
    await setHandle('gamecube-disc', disc)
  } catch {
    // storage may be unavailable; the disc is then chosen again next time
  }
}

export async function recallDisc(): Promise<RememberedDisc | null> {
  try {
    const v = await getHandle<RememberedDisc>('gamecube-disc')
    return v && v.handle && (v.kind === 'file' || v.kind === 'folder') ? v : null
  } catch {
    return null
  }
}

export async function forgetDisc() {
  try {
    await forgetHandle('gamecube-disc')
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