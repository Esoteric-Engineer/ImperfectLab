// Undo and redo over whole-document snapshots.
const MERGE_MS = 400
const LIMIT = 100

export class History<T> {
  private past: T[] = []
  private future: T[] = []
  private current: T
  private saved: T
  private lastKey: string | null = null
  private lastAt = 0

  constructor(initial: T) {
    this.current = initial
    this.saved = initial
  }

  reset(state: T) {
    this.past = []
    this.future = []
    this.current = state
    this.saved = state
    this.lastKey = null
  }

  // The document as of the last edit.
  get latest(): T {
    return this.current
  }

  markSaved(state: T) {
    this.saved = state
    this.lastKey = null
  }

  get isSaved(): boolean {
    return this.current === this.saved
  }

  // `state` is the document after an edit; a null key never merges.
  record(state: T, key: string | null, now: number) {
    const merge = key !== null && key === this.lastKey && now - this.lastAt < MERGE_MS
    if (!merge) {
      this.past.push(this.current)
      if (this.past.length > LIMIT) this.past.shift()
    }
    this.current = state
    this.future = []
    this.lastKey = key
    this.lastAt = now
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  undo(): T | null {
    const prev = this.past.pop()
    if (prev === undefined) return null
    this.future.push(this.current)
    this.current = prev
    this.lastKey = null
    return prev
  }

  redo(): T | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(this.current)
    this.current = next
    this.lastKey = null
    return next
  }
}
