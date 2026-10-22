import { useSyncExternalStore } from 'react'
import type { Joint, JointModel } from '../core/model/glb'
import { Skeleton } from '../core/model/skeleton'
import { type Character, newCharacter } from '../core/package/imperfect'
import type { BaseDetails, BaseInfo, ModelInfo } from '../worker/protocol'
import { engine, errorText } from './engine'

export class ModelView implements JointModel {
  info: ModelInfo
  joints: Joint[]
  private byName: Map<string, Joint>
  private weightedMap: Map<string, number>

  constructor(info: ModelInfo) {
    this.info = info
    this.joints = info.joints.map((j) => ({ name: j.name, parent: j.parent, pos: j.pos }))
    this.byName = new Map(this.joints.map((j) => [j.name, j]))
    this.weightedMap = new Map(info.weighted)
  }

  jointNames() {
    return this.joints.map((j) => j.name)
  }

  weighted() {
    return this.weightedMap
  }

  joint(name: string): Joint {
    const j = this.byName.get(name)
    if (!j) throw new Error(`the model has no joint ${name}`)
    return j
  }
}

export interface Game {
  name: string
  key: string
  verified: boolean
  bases: BaseInfo[]
}

export type Change = 'character' | 'model' | 'mapping' | 'game'

class Store {
  character: Character = newCharacter()
  fileName: string | null = null
  fileHandle: FileSystemFileHandle | null = null
  dirty = false
  game: Game | null = null
  model: ModelView | null = null
  modelError: string | null = null
  status = ''
  error: string | null = null
  credits: string | null = null
  busy = 0
  versions: Record<Change, number> = { character: 0, model: 0, mapping: 0, game: 0 }
  private version = 0
  private listeners = new Set<() => void>()
  private skeletons = new Map<string, Skeleton | null>()
  private details = new Map<string, BaseDetails | 'loading'>()
  private statusTimer = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  snapshot = () => this.version

  emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  touch(what: Change = 'character', dirty = true) {
    if (dirty) this.dirty = true
    this.versions[what]++
    this.emit()
  }

  message(text: string, timeout = 6000) {
    this.status = text
    clearTimeout(this.statusTimer)
    this.statusTimer = window.setTimeout(() => {
      this.status = ''
      this.emit()
    }, timeout)
    this.emit()
  }

  fail(e: unknown) {
    this.error = errorText(e)
    this.emit()
  }

  dismissError() {
    this.error = null
    this.emit()
  }

  async setCharacter(c: Character, fileName: string | null = null, handle: FileSystemFileHandle | null = null) {
    this.character = c
    this.fileName = fileName
    this.fileHandle = handle
    this.dirty = false
    await this.loadModel()
    for (const k of Object.keys(this.versions) as Change[]) this.versions[k]++
    this.emit()
  }

  async loadModel() {
    this.model = null
    this.modelError = null
    try {
      const info = await engine.call<ModelInfo | null>('setModel', [this.character.glb])
      this.model = info ? new ModelView(info) : null
    } catch (e) {
      this.modelError = errorText(e)
    }
  }

  setGame(game: Game | null) {
    this.game = game
    this.skeletons.clear()
    this.details.clear()
    this.touch('game', false)
  }

  base(key = this.character.base): BaseInfo | null {
    return this.game?.bases.find((b) => b.key === key) ?? null
  }

  skeleton(key = this.character.base): Skeleton | null {
    if (!this.game) return null
    if (!this.skeletons.has(key)) {
      const b = this.base(key)
      this.skeletons.set(key, b?.skeleton ? new Skeleton({ nodes: b.skeleton.nodes }, b.skeleton.body) : null)
    }
    return this.skeletons.get(key)!
  }

  baseDetails(key = this.character.base): BaseDetails | null {
    if (!this.game) return null
    const d = this.details.get(key)
    if (d === undefined) {
      this.details.set(key, 'loading')
      engine.call<BaseDetails>('baseDetails', [key]).then((v) => {
        this.details.set(key, v)
        this.emit()
      }, (e) => this.fail(e))
      return null
    }
    return d === 'loading' ? null : d
  }

  title(): string {
    const name = this.fileName ?? `${this.character.displayName} (unsaved)`
    return `${name}${this.dirty ? ' *' : ''} - ImperfectLab`
  }
}

export const store = new Store()

export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.snapshot)
  return store
}
