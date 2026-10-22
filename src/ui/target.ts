import { chooseIsoOutput, freeSpace, removeOpfs } from '../io/files'
import type { PatchTarget } from '../worker/protocol'
import { store } from './store'

export const OPFS_NAME = 'imperfectlab-patched.iso'
const GC_DISC_SIZE = 1459978240

export async function choosePatchTarget(name: string): Promise<[PatchTarget, string] | null> {
  const handle = await chooseIsoOutput(name)
  if (handle === 'cancel') return null
  if (handle) return [{ kind: 'handle', handle }, handle.name]
  await removeOpfs(OPFS_NAME)
  const free = await freeSpace()
  if (free !== null && free < GC_DISC_SIZE + (64 << 20)) {
    store.fail('Not enough free space in the browser\'s storage for the patched disc (it takes 1.4 GB).')
    return null
  }
  return [{ kind: 'opfs', name: OPFS_NAME }, name]
}
