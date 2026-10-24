/// <reference lib="webworker" />
import { LabError } from '../core/errors'
import type { ReadAt, Sink } from '../core/game/disc'
import { RgbaImage } from '../core/image/rgba'
import type { Batch } from '../core/build/batch'
import type { EffectChoices } from '../core/build/cutscenes'
import type { CutsceneKind } from '../core/package/imperfect'
import type { PatchTarget, Request, Response } from './protocol'
import { Service } from './service'

declare const self: DedicatedWorkerGlobalScope

const service = new Service()
const FRESH = new Set(['preview', 'materialThumbs', 'compose', 'layout', 'bases', 'stripOutlines', 'cutscenePcm', 'encodeCutsceneAudio', 'decodeCutsceneAudio'])

function fileReader(file: Blob): ReadAt {
  const reader = new FileReaderSync()
  return {
    size: file.size,
    read: (offset, size) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + size))),
  }
}

service.decoder = async (body) => {
  const bitmap = await createImageBitmap(new Blob([body as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
  return new RgbaImage(bitmap.width, bitmap.height, data)
}

async function openSink(target: PatchTarget): Promise<[Sink, () => Promise<void>, () => Promise<void>]> {
  if (target.kind === 'handle') {
    const w = await target.handle.createWritable()
    return [{ write: (chunk) => w.write(chunk as BufferSource) }, () => w.close(), () => w.abort()]
  }
  const root = await navigator.storage.getDirectory()
  const fh = await root.getFileHandle(target.name, { create: true })
  const access = await fh.createSyncAccessHandle()
  access.truncate(0)
  let at = 0
  return [
    { write: (chunk) => { at += access.write(chunk as BufferSource, { at }) } },
    async () => { access.flush(); access.close() },
    async () => { access.close(); await root.removeEntry(target.name) },
  ]
}

// Writes the patched disc into the target, and removes what was written when it fails.
async function intoSink(target: PatchTarget, run: (sink: Sink) => Promise<string>): Promise<string> {
  const [sink, close, abort] = await openSink(target)
  try {
    const text = await run(sink)
    await close()
    return text
  } catch (e) {
    await abort().catch(() => {})
    throw e
  }
}

function transfers(value: unknown, out: Set<ArrayBuffer>, seen = new Set<unknown>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (ArrayBuffer.isView(value)) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) out.add(value.buffer as ArrayBuffer)
    return
  }
  if (Array.isArray(value)) for (const v of value) transfers(v, out, seen)
  else for (const v of Object.values(value)) transfers(v, out, seen)
}

const handlers: Record<string, (progress: (stage: string, done?: number, total?: number) => void, ...args: never[]) => unknown> = {
  openFile: (_p, file: File) => service.openImage(fileReader(file), file.name),
  openFolder: (_p, name: string, files: [string, File][]) => service.openFolder(new Map(files.map(([k, f]) => [k, fileReader(f)])), name),
  verify: (p) => service.verify(p),
  bases: () => service.baseList(),
  baseDetails: (_p, key: string) => service.baseDetails(key),
  moveCatalog: () => service.moveCatalog(),
  cutsceneCatalog: () => service.cutsceneCatalog(),
  cutsceneEffects: (_p, base: string, c: EffectChoices) => service.cutsceneEffects(base, c),
  moveEffects: (_p, base: string, c: EffectChoices) => service.moveEffects(base, c),
  cutscenePcm: (_p, base: string, kind: CutsceneKind, key: string) => service.cutscenePcm(base, kind, key),
  encodeCutsceneAudio: (_p, channels: Int16Array[], samples: number) => service.encodeCutsceneAudio(channels, samples),
  decodeCutsceneAudio: (_p, data: Uint8Array) => service.decodeCutsceneAudio(data),
  importModel: (_p, raw: Uint8Array) => service.importModel(raw),
  setModel: (_p, glb: Uint8Array | null) => service.setModel(glb),
  autoMap: (_p, key: string) => service.autoMap(key),
  preview: (_p, c, needBase: boolean) => service.preview(c, needBase),
  fitCheck: (_p, c) => service.fitCheck(c),
  materialThumbs: (_p, c) => service.materialThumbs(c),
  layout: () => service.layoutInfo(),
  setPictures: (_p, pictures: Record<string, Uint8Array>) => service.setPictures(pictures),
  compose: (_p, args, index: number) => service.compose(args, index),
  stripOutlines: () => service.stripOutlines(),
  check: (p, c) => service.check(c, p),
  patch: (p, c, target: PatchTarget, verified: boolean) => intoSink(target, (sink) => service.patch(c, sink, verified, p)),
  checkBatch: (p, chars: Batch) => service.checkBatch(chars, p),
  patchBatch: (p, chars: Batch, target: PatchTarget, verified: boolean, token: number | null) =>
    intoSink(target, (sink) => service.patchBatch(chars, sink, verified, token, p)),
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, method, args } = e.data
  let last = 0
  const progress = (stage: string, done = 0, total = 0) => {
    const now = performance.now()
    if (now - last < 80 && total && done < total) return
    last = now
    self.postMessage({ id, progress: [stage, done, total] } satisfies Response)
  }
  try {
    const handler = handlers[method]
    if (!handler) throw new Error(`unknown method ${method}`)
    const result = await handler(progress, ...(args as never[]))
    const buffers = new Set<ArrayBuffer>()
    if (FRESH.has(method)) transfers(result, buffers)
    self.postMessage({ id, result } satisfies Response, [...buffers])
  } catch (err) {
    const lab = err instanceof LabError
    const message = lab ? (err as Error).message : err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    self.postMessage({ id, error: message, lab } satisfies Response)
  }
}
