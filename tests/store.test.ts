import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newCharacter } from '../src/core/package/imperfect'
import type { ModelInfo } from '../src/worker/protocol'

const calls = vi.hoisted(() => ({ setModel: [] as { glb: Uint8Array | null; done: (v: unknown) => void }[] }))

vi.mock('../src/ui/engine', () => ({
  errorText: (e: unknown) => String(e),
  engine: {
    call: (name: string, args: unknown[]) => {
      if (name !== 'setModel') return Promise.resolve(null)
      return new Promise((done) => calls.setModel.push({ glb: args[0] as Uint8Array | null, done }))
    },
  },
}))

const { store } = await import('../src/ui/store')

const info = (tag: string) => ({ joints: [{ name: tag, parent: null, pos: [0, 0, 0] }], weighted: [] }) as unknown as ModelInfo
const names = () => store.model?.jointNames().join()

async function fresh(glb: Uint8Array | null = null) {
  calls.setModel.length = 0
  const c = newCharacter()
  c.glb = glb
  const loaded = store.setCharacter(c)
  calls.setModel[0].done(null)
  await loaded
  calls.setModel.length = 0
  return c
}

function edit(c: { displayName: string }, name: string) {
  c.displayName = name
  store.touch('character')
}

describe('store undo and redo', () => {
  beforeEach(async () => {
    await fresh()
  })

  it('restores the character in place', async () => {
    const c = store.character
    edit(c, 'ONE')
    edit(c, 'TWO')
    await store.undo()
    expect(store.character).toBe(c)
    expect(c.displayName).toBe('ONE')
    await store.undo()
    expect(c.displayName).toBe('NEW HERO')
    expect(store.canUndo).toBe(false)
    await store.redo()
    expect(c.displayName).toBe('ONE')
    expect(store.canRedo).toBe(true)
  })

  it('lets an edit already under way land on the restored document', async () => {
    const c = store.character
    edit(c, 'ONE')
    await store.undo()
    edit(c, 'LATE')
    expect(store.character.displayName).toBe('LATE')
    await store.undo()
    expect(store.character.displayName).toBe('NEW HERO')
  })

  it('is clean again when undone back to the saved state', async () => {
    const c = store.character
    expect(store.dirty).toBe(false)
    edit(c, 'ONE')
    expect(store.dirty).toBe(true)
    await store.undo()
    expect(store.dirty).toBe(false)
    await store.redo()
    expect(store.dirty).toBe(true)
    store.markSaved(store.savePoint())
    edit(c, 'TWO')
    await store.undo()
    expect(store.dirty).toBe(false)
  })

  it('stays dirty for an edit made while the file was being written', () => {
    const c = store.character
    edit(c, 'ONE')
    const point = store.savePoint()
    edit(c, 'TWO')
    store.markSaved(point)
    expect(store.dirty).toBe(true)
  })

  it('waits out an edit that is still being put together', async () => {
    const c = store.character
    edit(c, 'ONE')
    let finish = () => {}
    const working = store.edit(() => new Promise<void>((done) => { finish = done }))
    expect(store.canUndo).toBe(false)
    await store.undo()
    expect(c.displayName).toBe('ONE')
    finish()
    await working
    expect(store.canUndo).toBe(true)
  })

  it('counts restores', async () => {
    edit(store.character, 'ONE')
    const before = store.restores
    await store.undo()
    expect(store.restores).toBe(before + 1)
  })
})

describe('store undo with a model', () => {
  const glbA = new Uint8Array([1])
  const glbB = new Uint8Array([2])

  it('reloads the model only when the model changed', async () => {
    const c = await fresh(glbA)
    edit(c, 'ONE')
    await store.undo()
    expect(calls.setModel).toHaveLength(0)
    c.glb = glbB
    store.touch('model')
    const undone = store.undo()
    expect(calls.setModel.map((r) => r.glb)).toEqual([glbA])
    calls.setModel[0].done(info('a'))
    await undone
    expect(names()).toBe('a')
  })

  it('drops the old model before the restored character is drawn', async () => {
    const c = await fresh(glbA)
    store.adoptModel(info('a'))
    c.glb = glbB
    store.touch('model')
    store.adoptModel(info('b'))
    const seen: (string | undefined)[] = []
    const stop = store.subscribe(() => seen.push(names()))
    const undone = store.undo()
    calls.setModel[0].done(info('a'))
    await undone
    stop()
    expect(seen[0]).toBeUndefined()
  })

  it('ignores a slower load once a newer undo has been asked for', async () => {
    const c = await fresh(glbA)
    c.glb = glbB
    store.touch('model')
    const c2 = new Uint8Array([3])
    c.glb = c2
    store.touch('model')
    const first = store.undo()
    const second = store.undo()
    calls.setModel[1].done(info('newer'))
    await second
    calls.setModel[0].done(info('older'))
    await first
    expect(names()).toBe('newer')
  })

  it('ignores an undo load that finishes after a model was imported', async () => {
    const c = await fresh(glbA)
    c.glb = glbB
    store.touch('model')
    const undone = store.undo()
    store.adoptModel(info('imported'))
    calls.setModel[0].done(info('stale'))
    await undone
    expect(names()).toBe('imported')
  })
})
