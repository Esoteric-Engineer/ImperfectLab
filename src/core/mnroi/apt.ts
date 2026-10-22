// Append-only edits of APT UI movies, ported from mnroi tools/aptpatch.py and the parts of tools/aptdump.py it uses (commit a23c796).
// Every .apt pointer is an absolute offset, so new data is appended and existing count/pointer pairs are pointed at it. the .const item table is rebuilt.
// Nothing may be reachable twice, and an action block must keep its address modulo 4.
import { ByteWriter, cstring, encodeLatin1, i32be, putU32be, startsWith, u32be } from '../bytes'
import { LabError } from '../errors'

const CONST_MAGIC = 'Apt constant file\x1a\0\0'
export const STR_OPS = [0x8b, 0x8c, 0xa1, 0xa4, 0xa5, 0xa6, 0xa7]
export const I32_OPS = [0x81, 0x87, 0x94, 0x9f]
export const BR_OPS = [0x99, 0x9d, 0xb8]
export const CONST_BYTE_OPS = [0xa2, 0xae, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3]

export const al4 = (p: number) => (p + 3) & ~3

export type ConstValue = string | number | [number, number]

export class Apt {
  private buf: Uint8Array
  private len: number
  aptOff: number
  itemsOff: number
  items: [number, number][]
  nOrig: number
  constHead: Uint8Array
  strings: ByteWriter
  stringsBase: number
  newStrings = new Map<number, number>()

  constructor(apt: Uint8Array, constData: Uint8Array) {
    this.buf = new Uint8Array(Math.max(1024, apt.length * 2))
    this.buf.set(apt)
    this.len = apt.length
    if (!startsWith(constData, CONST_MAGIC)) throw new LabError('bad .const header')
    this.aptOff = u32be(constData, 0x14)
    const count = u32be(constData, 0x18)
    this.itemsOff = u32be(constData, 0x1c)
    this.items = []
    for (let i = 0; i < count; i++) this.items.push([u32be(constData, this.itemsOff + 8 * i), u32be(constData, this.itemsOff + 8 * i + 4)])
    this.nOrig = count
    this.constHead = constData.slice(0, this.itemsOff)
    this.stringsBase = this.itemsOff + 8 * count
    this.strings = new ByteWriter(constData.length)
    this.strings.bytes(constData.subarray(this.stringsBase))
  }

  get d(): Uint8Array {
    return this.buf.subarray(0, this.len)
  }

  get length(): number {
    return this.len
  }

  private addItem(typ: number, value: number): number {
    this.items.push([typ, value >>> 0])
    return this.items.length - 1
  }

  constStr(s: string): number {
    this.strings.align(4)
    const off = this.strings.length
    this.strings.latin1(s).byte(0)
    const i = this.addItem(1, 0)
    this.newStrings.set(i, off)
    return i
  }

  constInt(v: number): number {
    return this.addItem(7, v)
  }

  constPool(poolIndex: number): number {
    return this.addItem(8, poolIndex)
  }

  constValue(idx: number, pool?: number[]): ConstValue {
    const [typ, v] = this.items[idx]
    if (typ === 8 && pool !== undefined) return this.constValue(pool[v])
    if (typ === 1) {
      const off = this.newStrings.has(idx) ? this.newStrings.get(idx)! : v - this.stringsBase
      const s = this.strings.view()
      return cstring(s, off)
    }
    if (typ === 7) return v | 0
    return [typ, v]
  }

  u32(o: number): number {
    return u32be(this.buf, o)
  }

  i32(o: number): number {
    return i32be(this.buf, o)
  }

  put32(o: number, v: number) {
    putU32be(this.buf, o, v >>> 0)
  }

  s(o: number): string | null {
    return o === 0 ? null : cstring(this.buf, o, this.len)
  }

  private reserve(n: number) {
    if (this.len + n <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n))
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }

  pad(n: number) {
    this.reserve(n)
    this.buf.fill(0, this.len, this.len + n)
    this.len += n
  }

  append(data: Uint8Array, align = 4): number {
    this.pad((align - (this.len % align)) % align)
    const off = this.len
    this.reserve(data.length)
    this.buf.set(data, off)
    this.len += data.length
    return off
  }

  appendU32s(values: number[]): number {
    const b = new Uint8Array(4 * values.length)
    values.forEach((v, i) => putU32be(b, 4 * i, v >>> 0))
    return this.append(b)
  }

  appendStr(s: string): number {
    const b = encodeLatin1(s + '\0')
    return this.append(b)
  }

  slice(start: number, end: number): Uint8Array {
    return this.buf.slice(start, end)
  }

  pool(block: number): number[] {
    if (this.buf[block] !== 0x88) throw new LabError(`no ConstantPool at 0x${block.toString(16)}`)
    const p = al4(block + 1)
    const n = this.u32(p), ptr = this.u32(p + 4)
    return Array.from({ length: n }, (_, i) => this.u32(ptr + 4 * i))
  }

  extendPool(block: number, itemIndices: number[]): number {
    const old = this.pool(block)
    const p = al4(block + 1)
    this.put32(p, old.length + itemIndices.length)
    this.put32(p + 4, this.appendU32s([...old, ...itemIndices]))
    return old.length
  }

  pushStr(block: number, s: string): number {
    return this.constPool(this.extendPool(block, [this.constStr(s)]))
  }

  getPush(at: number): number[] {
    if (this.buf[at] !== 0x96) throw new LabError(`no PushData at 0x${at.toString(16)}`)
    const p = al4(at + 1)
    const n = this.u32(p), ptr = this.u32(p + 4)
    return Array.from({ length: n }, (_, i) => this.u32(ptr + 4 * i))
  }

  setPush(at: number, items: number[]) {
    if (this.buf[at] !== 0x96) throw new LabError(`no PushData at 0x${at.toString(16)}`)
    const p = al4(at + 1)
    this.put32(p, items.length)
    this.put32(p + 4, this.appendU32s(items))
  }

  walk(p: number, end?: number): [number, number][] {
    const out: [number, number][] = []
    while (end === undefined || p < end) {
      const at = p
      const op = this.buf[p]
      p++
      out.push([at, op])
      if (op === 0x00 && end === undefined) return out
      if (STR_OPS.includes(op) || I32_OPS.includes(op) || BR_OPS.includes(op) || op === 0xb4 || op === 0xb7) {
        p = al4(p) + 4
      } else if (CONST_BYTE_OPS.includes(op) || op === 0xb5 || op === 0xb9) {
        p += 1
      } else if (op === 0xa3 || op === 0xb6) {
        p += 2
      } else if (op === 0x83 || op === 0x88 || op === 0x96) {
        p = al4(p) + 8
      } else if (op === 0x9b || op === 0x8e) {
        p = al4(p)
        const size = this.i32(p + (op === 0x9b ? 12 : 16))
        p += op === 0x9b ? 24 : 28
        out.push(...this.walk(p, p + size))
        p += size
      }
      if (p > this.len) throw new LabError('an action block runs past the end of the movie')
    }
    return out
  }

  findPush(block: number, pred: (vals: ConstValue[]) => boolean): number {
    const pool = this.pool(block)
    const hits: number[] = []
    for (const [at, op] of this.walk(block)) {
      if (op === 0x96 && pred(this.getPush(at).map((i) => this.constValue(i, pool)))) hits.push(at)
    }
    if (hits.length !== 1) throw new LabError(`expected one matching PushData in block 0x${block.toString(16)}, found ${hits.length}`)
    return hits[0]
  }

  character(n: number): number {
    return this.u32(this.u32(this.aptOff + 24) + 4 * n)
  }

  frame(charPtr: number, f: number): [number, number, number] {
    const rec = this.u32(charPtr + 12) + 8 * f
    return [this.u32(rec), this.u32(rec + 4), rec]
  }

  frameActions(charPtr: number, f: number): number[] {
    const [n, items] = this.frame(charPtr, f)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const it = this.u32(items + 4 * i)
      if (this.u32(it) === 1) out.push(this.u32(it + 4))
    }
    return out
  }

  framePlaces(charPtr: number, f: number): [number, string | null][] {
    const [n, items] = this.frame(charPtr, f)
    const out: [number, string | null][] = []
    for (let i = 0; i < n; i++) {
      const it = this.u32(items + 4 * i)
      if (this.u32(it) === 3) out.push([it, this.s(this.u32(it + 52))])
    }
    return out
  }

  addFrameItem(charPtr: number, f: number, itemPtr: number) {
    const [n, items, rec] = this.frame(charPtr, f)
    const next = this.appendU32s([...Array.from({ length: n }, (_, i) => this.u32(items + 4 * i)), itemPtr])
    this.put32(rec, n + 1)
    this.put32(rec + 4, next)
  }

  exports(): [string, number][] {
    const n = this.u32(this.aptOff + 48), ptr = this.u32(this.aptOff + 52)
    return Array.from({ length: n }, (_, i) => [this.s(this.u32(ptr + 8 * i)) ?? '', this.u32(ptr + 8 * i + 4)])
  }

  addExport(name: string, charId: number) {
    const n = this.u32(this.aptOff + 48), ptr = this.u32(this.aptOff + 52)
    const old = this.slice(ptr, ptr + 8 * n)
    const namePtr = this.appendStr(name)
    const rec = new Uint8Array(old.length + 8)
    rec.set(old)
    putU32be(rec, old.length, namePtr)
    putU32be(rec, old.length + 4, charId)
    const next = this.append(rec)
    this.put32(this.aptOff + 48, n + 1)
    this.put32(this.aptOff + 52, next)
  }

  build(): [Uint8Array, Uint8Array] {
    const shift = 8 * (this.items.length - this.nOrig)
    const newBase = this.stringsBase + shift
    const out = new ByteWriter(this.constHead.length + 8 * this.items.length + this.strings.length)
    const head = this.constHead.slice()
    putU32be(head, 0x18, this.items.length)
    out.bytes(head)
    this.items.forEach(([typ, v], i) => {
      if (typ === 1) v = this.newStrings.has(i) ? newBase + this.newStrings.get(i)! : v + shift
      out.u32be(typ).u32be(v)
    })
    out.bytes(this.strings.view())
    return [this.d.slice(), out.finish()]
  }
}
