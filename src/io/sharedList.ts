// The Multi-Character Patch list in the shared workspace, where Lab Builder can add it to its own.
import { getList, newId, setList } from '@nemesismods/workspace'
import { type Character, load, save } from '../core/package/imperfect'

export interface BatchSlot {
  source: string
  character: Character
}

export async function recallBatch(): Promise<BatchSlot[]> {
  try {
    return (await getList('lab-characters')).flatMap((e) => {
      try {
        return [{ source: e.source, character: load(e.bytes) }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

let pending: ReturnType<typeof setTimeout> | null = null

export function publishBatch(slots: BatchSlot[]) {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    try {
      const entries = slots.map((s) => ({ id: newId(), name: s.character.displayName, source: s.source, bytes: save(s.character) }))
      setList('lab-characters', entries).catch(() => {})
    } catch {
      // storage may be unavailable, no biggie
    }
  }, 400)
}