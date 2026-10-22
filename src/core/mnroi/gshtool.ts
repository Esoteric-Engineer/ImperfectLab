// UI image banks (.gsh, "ShpG") and shape geometry (.geo), ported from mnroi tools/gshtool.py (commit a23c796).
import { ByteWriter, cstring, encodeLatin1, f32le, putU32le, u16be, u32be, u32le } from '../bytes'
import { LabError } from '../errors'
import * as gxtex from './gxtex'

const PAD = encodeLatin1('Buy ERTS')
const PALETTE_FORMATS: Record<number, number> = { 0: gxtex.IA8, 1: gxtex.RGB565, 2: gxtex.RGB5A3 }

export class Bank {
  names: string[]
  records: Map<string, Uint8Array>
  tag: Uint8Array
  padEnd: boolean

  constructor(names: string[], records: Map<string, Uint8Array>, tag: Uint8Array, padEnd: boolean) {
    this.names = names
    this.records = records
    this.tag = tag
    this.padEnd = padEnd
  }

  record(name: string): Uint8Array {
    const r = this.records.get(name)
    if (!r) throw new LabError(`no image ${name}`)
    return r
  }
}

export function readGsh(data: Uint8Array): Bank {
  if (cstring(data, 0, 4) !== 'ShpG') throw new LabError('not a ShpG bank')
  const count = u32be(data, 8), head = u32be(data, 12)
  const names: string[] = []
  const records = new Map<string, Uint8Array>()
  let p = 16
  for (let i = 0; i < count; i++) {
    const off = u32be(data, p), size = u32be(data, p + 4)
    const end = data.indexOf(0, p + 8)
    const name = cstring(data, p + 8, end)
    names.push(name)
    records.set(name, data.subarray(off, off + size))
    p = end + 1
  }
  return new Bank(names, records, data.slice(p, head), data.length % 0x20 === 0)
}

export function buildGsh(bank: Bank): Uint8Array {
  const names = bank.names
  let head = 16 + bank.tag.length
  for (const n of names) head += 8 + n.length + 1
  const offsets: number[] = []
  let pos = head
  for (const n of names) {
    pos += (0x20 - (pos % 0x20)) % 0x20
    offsets.push(pos)
    pos += bank.record(n).length
  }
  const out = new ByteWriter(pos + 0x20)
  out.latin1('ShpG').zeros(4).u32be(names.length).u32be(head)
  names.forEach((n, i) => out.u32be(offsets[i]).u32be(bank.record(n).length).latin1(n).byte(0))
  out.bytes(bank.tag)
  names.forEach((n, i) => {
    const gap = offsets[i] - out.length
    out.bytes(PAD.subarray(0, Math.min(gap, PAD.length))).zeros(gap - Math.min(gap, PAD.length))
    out.bytes(bank.record(n))
  })
  if (bank.padEnd) out.align(0x20)
  const bytes = out.finish()
  putU32le(bytes, 4, bytes.length)
  return bytes
}

export function blocks(record: Uint8Array): [number, number][] {
  const out: [number, number][] = []
  let p = 0
  for (;;) {
    const word = u32be(record, p), next = u32be(record, p + 4)
    out.push([word >>> 24, p])
    if (!next) return out
    p += next
  }
}

export class Picture {
  format: number
  pixelOff: number
  pixelSize: number
  width: number
  height: number
  paletteFormat: number | null = null
  paletteOff: number | null = null
  colors = 0

  constructor(record: Uint8Array) {
    const bl = blocks(record)
    const img = bl.find(([t]) => t >= 0x10 && t < 0x20)
    if (!img) throw new LabError('the record has no image block')
    const at = img[1]
    this.format = record[at] - 0x10
    this.pixelOff = u32be(record, at + 8) + at
    this.pixelSize = u32be(record, at + 12)
    this.width = u32be(record, at + 0x18)
    this.height = u32be(record, at + 0x1c)
    const byType = new Map(bl)
    let pal: number | undefined
    for (const [t, p] of byType) if (t >= 0x30 && t < 0x40 && pal === undefined) pal = p
    if (pal !== undefined) {
      this.paletteFormat = PALETTE_FORMATS[record[pal] - 0x30]
      this.colors = u32be(record, pal + 0x18)
      this.paletteOff = pal + u32be(record, pal + 8)
    }
  }

  palette(record: Uint8Array): gxtex.Rgba[] {
    const out: gxtex.Rgba[] = []
    for (let i = 0; i < this.colors; i++) out.push(gxtex.texel(this.paletteFormat!, u16be(record, this.paletteOff! + 2 * i)))
    return out
  }

  decode(record: Uint8Array): Uint8Array {
    const data = record.subarray(this.pixelOff, this.pixelOff + this.pixelSize)
    return gxtex.decode(this.format, data, this.width, this.height, this.colors ? this.palette(record) : undefined)
  }
}

export type GeoItem =
  | { kind: 'solid'; color: number }
  | { kind: 'texture'; color: number; flag: number; tex: number; matrix: number[] }
  | { kind: 'line style'; color: number; width: number }
  | { kind: 'triangle'; points: number[][] }
  | { kind: 'line'; points: number[][] }

export type GeoRecord = [number, GeoItem[][]]

export function readGeo(data: Uint8Array): GeoRecord[] {
  const count = u32le(data, 0)
  const records: GeoRecord[] = []
  let p = 4 + 4 * count
  for (let r = 0; r < count; r++) {
    const off = u32le(data, 4 + 4 * r)
    if (off !== p) throw new LabError(`record at 0x${off.toString(16)}, expected 0x${p.toString(16)}`)
    const rid = u32le(data, p), nshapes = u32le(data, p + 4)
    p += 8
    const shapes: GeoItem[][] = []
    for (let s = 0; s < nshapes; s++) {
      const n = u32le(data, p)
      p += 4
      const items: GeoItem[] = []
      for (let i = 0; i < n; i++) {
        const kind = u32le(data, p)
        if (kind === 0) {
          const fill = u32le(data, p + 4)
          if (fill === 1) {
            items.push({ kind: 'solid', color: u32le(data, p + 8) })
            p += 12
          } else if (fill === 0) {
            const matrix = Array.from({ length: 16 }, (_, k) => f32le(data, p + 20 + 4 * k))
            items.push({ kind: 'texture', color: u32le(data, p + 8), flag: u32le(data, p + 12), tex: u32le(data, p + 16), matrix })
            p += 84
          } else if (fill === 2) {
            items.push({ kind: 'line style', color: u32le(data, p + 8), width: f32le(data, p + 12) })
            p += 16
          } else {
            throw new LabError(`record ${rid}: fill style ${fill}`)
          }
        } else if (kind === 1 || kind === 2) {
          const npts = kind === 1 ? 3 : 2
          const points = Array.from({ length: npts }, (_, k) => [0, 1, 2].map((c) => f32le(data, p + 4 + 12 * k + 4 * c)))
          items.push({ kind: kind === 1 ? 'triangle' : 'line', points })
          p += kind === 1 ? 40 : 28
        } else {
          throw new LabError(`record ${rid}: item kind ${kind}`)
        }
      }
      shapes.push(items)
    }
    records.push([rid, shapes])
  }
  if (p !== data.length) throw new LabError(`parse ends at 0x${p.toString(16)} of 0x${data.length.toString(16)}`)
  return records
}

export function buildGeo(records: GeoRecord[]): Uint8Array {
  const body = new ByteWriter()
  const offsets: number[] = []
  const base = 4 + 4 * records.length
  for (const [rid, shapes] of records) {
    offsets.push(base + body.length)
    body.u32le(rid).u32le(shapes.length)
    for (const items of shapes) {
      body.u32le(items.length)
      for (const it of items) {
        if (it.kind === 'solid') body.u32le(0).u32le(1).u32le(it.color)
        else if (it.kind === 'texture') {
          body.u32le(0).u32le(0).u32le(it.color).u32le(it.flag).u32le(it.tex)
          for (const v of it.matrix) body.f32le(v)
        } else if (it.kind === 'line style') body.u32le(0).u32le(2).u32le(it.color).f32le(it.width)
        else {
          body.u32le(it.kind === 'triangle' ? 1 : 2)
          for (const pt of it.points) for (const v of pt) body.f32le(v)
        }
      }
    }
  }
  const out = new ByteWriter(base + body.length)
  out.u32le(records.length)
  for (const o of offsets) out.u32le(o)
  out.bytes(body.view())
  return out.finish()
}

export function addShapes(records: GeoRecord[], added: Map<number, [number, Map<number, number>]>): GeoRecord[] {
  const byId = new Map(records)
  for (const [rid, [template, textures]] of added) {
    if (byId.has(rid)) throw new LabError(`record ${rid} exists`)
    const src = byId.get(template)
    if (!src) throw new LabError(`no .geo record ${template}`)
    byId.set(rid, src.map((items) => items.map((it) =>
      it.kind === 'texture' ? { ...it, tex: textures.get(it.tex) ?? it.tex } : it)))
  }
  return [...byId.entries()].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))
}
