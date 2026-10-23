import { describe, expect, it } from 'vitest'
import * as imperfect from '../src/core/package/imperfect'
import { History } from '../src/ui/history'

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History(0)
    h.record(1, 'a', 0)
    h.record(2, 'b', 10_000)
    h.record(3, 'a', 20_000)
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([2, 1, 0, null])
    expect([h.redo(), h.redo(), h.redo(), h.redo()]).toEqual([1, 2, 3, null])
  })

  it('drops the redo steps on a new edit', () => {
    const h = new History(0)
    h.record(1, 'a', 0)
    h.undo()
    expect(h.canRedo).toBe(true)
    h.record(5, 'a', 10_000)
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe(0)
  })

  it('merges quick edits of one kind and keeps others apart', () => {
    const h = new History(0)
    h.record(1, 'a', 0)
    h.record(2, 'a', 100)
    h.record(3, 'a', 200)
    h.record(4, 'b', 250)
    h.record(5, 'a', 5000)
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([4, 3, 0, null])
  })

  it('never merges into a restored state', () => {
    const h = new History(0)
    h.record(1, 'a', 0)
    h.undo()
    h.record(2, 'a', 50)
    expect(h.undo()).toBe(0)
  })

  it('never merges a null key', () => {
    const h = new History(0)
    h.record(1, null, 0)
    h.record(2, null, 10)
    expect([h.undo(), h.undo()]).toEqual([1, 0])
  })

  it('tracks the saved state', () => {
    const h = new History(0)
    expect(h.isSaved).toBe(true)
    h.record(1, 'a', 0)
    expect(h.isSaved).toBe(false)
    h.markSaved(h.latest)
    expect(h.isSaved).toBe(true)
    h.record(2, 'a', 10)
    expect(h.isSaved).toBe(false)
    h.undo()
    expect(h.isSaved).toBe(true)
    h.undo()
    expect(h.isSaved).toBe(false)
    h.redo()
    expect(h.isSaved).toBe(true)
  })

  it('keeps only the most recent steps and can reset', () => {
    const h = new History(0)
    for (let i = 1; i <= 150; i++) h.record(i, 'a', i * 10_000)
    let n = 0
    while (h.undo() !== null) n++
    expect(n).toBe(100)
    h.reset(7)
    expect(h.canUndo || h.canRedo).toBe(false)
  })
})

describe('snapshotCharacter', () => {
  it('copies the fields but shares the model and picture bytes', () => {
    const c = imperfect.newCharacter()
    c.glb = new Uint8Array([1, 2, 3])
    c.files = new Map([['ui/hud.png', new Uint8Array([4, 5])]])
    c.mapping = new Map([[1, 'Hips']])
    c.stats.normal[0] = 7
    const s = imperfect.snapshotCharacter(c)
    expect(s).toEqual(c)
    expect(s.glb).toBe(c.glb)
    expect(s.files.get('ui/hud.png')).toBe(c.files.get('ui/hud.png'))
    c.mapping.set(2, 'Spine')
    c.stats.normal[0] = 1
    c.files.delete('ui/hud.png')
    c.credits.assets.push({ what: 'x', by: '', license: '', url: '' })
    expect(s.mapping.size).toBe(1)
    expect(s.stats.normal[0]).toBe(7)
    expect(s.files.has('ui/hud.png')).toBe(true)
    expect(s.credits.assets).toHaveLength(0)
  })
})
