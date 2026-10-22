import type { Request, Response } from '../worker/protocol'

export class EngineError extends Error {
  lab: boolean

  constructor(message: string, lab: boolean) {
    super(message)
    this.lab = lab
  }
}

export type OnProgress = (stage: string, done: number, total: number) => void

class Engine {
  private worker: Worker
  private next = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: OnProgress }>()

  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data
      const p = this.pending.get(msg.id)
      if (!p) return
      if ('progress' in msg) {
        p.progress?.(...msg.progress)
        return
      }
      this.pending.delete(msg.id)
      if ('error' in msg) p.reject(new EngineError(msg.error, msg.lab))
      else p.resolve(msg.result)
    }
  }

  call<T>(method: string, args: unknown[] = [], progress?: OnProgress): Promise<T> {
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress })
      this.worker.postMessage({ id, method, args } satisfies Request)
    })
  }
}

export const engine = new Engine()

export function errorText(e: unknown): string {
  if (e instanceof EngineError) return e.lab ? e.message : `Something went wrong:\n${e.message}`
  if (e instanceof Error) return e.name === 'LabError' ? e.message : `Something went wrong:\n${e.message}`
  return String(e)
}
