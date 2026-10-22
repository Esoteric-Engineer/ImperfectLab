import { cstring, latin1, u32be, u32le } from '../bytes'
import { LabError } from '../errors'

export const SECTOR = 0x8000
const CISO_HEADER = 0x8000
export const GC_DISC_SIZE = 1459978240
export const CHUNK = 1 << 22
const UNSUPPORTED: Record<string, string> = { 'RVZ\x01': 'RVZ', 'WIA\x01': 'WIA', '\x01\xc0\x0b\xb1': 'GCZ' }

export interface ReadAt {
  readonly size: number
  read(offset: number, size: number): Uint8Array
}

export interface Sink {
  write(chunk: Uint8Array): void | Promise<void>
}

function readFull(r: ReadAt, offset: number, size: number): Uint8Array {
  const data = r.read(offset, Math.max(0, Math.min(size, r.size - offset)))
  if (data.length === size) return data
  const out = new Uint8Array(size)
  out.set(data)
  return out
}

class Image {
  private r: ReadAt
  private blocks: (number | null)[] | null = null
  private blockSize = 0

  constructor(r: ReadAt, name: string) {
    this.r = r
    const head = readFull(r, 0, 8)
    const magic = latin1(head, 0, 4)
    if (magic in UNSUPPORTED) {
      throw new LabError(`${name} is a ${UNSUPPORTED[magic]} image: convert it to ISO first (Dolphin: right-click the game, Convert File, format ISO)`)
    }
    if (magic === 'CISO') {
      this.blockSize = u32le(head, 4)
      const present = readFull(r, 8, CISO_HEADER - 8)
      this.blocks = []
      let n = 0
      for (const b of present) {
        this.blocks.push(b ? n : null)
        if (b) n++
      }
    }
  }

  read(offset: number, size: number): Uint8Array {
    if (this.blocks === null) return readFull(this.r, offset, size)
    const out = new Uint8Array(size)
    const bs = this.blockSize
    let o = 0
    while (size) {
      const i = Math.floor(offset / bs), within = offset % bs
      const n = Math.min(size, bs - within)
      const slot = i < this.blocks.length ? this.blocks[i] : null
      if (slot !== null) out.set(readFull(this.r, CISO_HEADER + slot * bs + within, n), o)
      o += n
      offset += n
      size -= n
    }
    return out
  }
}

export class FileEntry {
  path: string
  offset: number
  size: number

  constructor(path: string, offset: number, size: number) {
    this.path = path
    this.offset = offset
    this.size = size
  }
}

export abstract class Disc {
  name = ''
  boot!: Uint8Array
  bi2!: Uint8Array
  apploader!: Uint8Array
  fst!: Uint8Array
  dol!: Uint8Array
  gameId = ''
  revision = 0
  dolOffset = 0
  fstOffset = 0
  fstSize = 0
  files: FileEntry[] = []

  protected header() {
    this.gameId = latin1(this.boot, 0, 6)
    this.revision = this.boot[7]
    this.dolOffset = u32be(this.boot, 0x420)
    this.fstOffset = u32be(this.boot, 0x424)
    this.fstSize = u32be(this.boot, 0x428)
  }

  file(path: string): FileEntry {
    const want = path.toLowerCase()
    for (const e of this.files) if (e.path.toLowerCase() === want) return e
    throw new LabError(`the disc has no file ${path}`)
  }

  abstract read(entry: FileEntry, offset: number, size: number): Uint8Array

  readFile(path: string): Uint8Array {
    const e = this.file(path)
    return this.read(e, 0, e.size)
  }
}

export class ImageDisc extends Disc {
  private img: Image

  constructor(r: ReadAt, name: string) {
    super()
    this.name = name
    this.img = new Image(r, name)
    this.boot = this.img.read(0, 0x440)
    this.bi2 = this.img.read(0x440, 0x2000)
    const ap = this.img.read(0x2440 + 0x14, 8)
    this.apploader = this.img.read(0x2440, 0x20 + u32be(ap, 0) + u32be(ap, 4))
    this.header()
    this.fst = this.img.read(this.fstOffset, this.fstSize)
    this.dol = this.img.read(this.dolOffset, dolSize(this.img.read(this.dolOffset, 0x100)))
    this.files = parseFst(this.fst)
  }

  read(entry: FileEntry, offset: number, size: number): Uint8Array {
    return this.img.read(entry.offset + offset, size)
  }
}

export class FolderDisc extends Disc {
  private entries: Map<string, ReadAt>

  constructor(entries: Map<string, ReadAt>, name: string) {
    super()
    this.name = name
    this.entries = new Map([...entries].map(([k, v]) => [k.toLowerCase(), v]))
    const get = (n: string) => {
      const r = this.entries.get(`sys/${n}`)
      if (!r) throw new LabError(`${name} is not an extracted disc (sys/boot.bin, bi2.bin, apploader.img, fst.bin and main.dol are needed): sys/${n} is missing`)
      return readFull(r, 0, r.size)
    }
    this.boot = get('boot.bin')
    this.bi2 = get('bi2.bin')
    this.apploader = get('apploader.img')
    this.fst = get('fst.bin')
    this.dol = get('main.dol')
    this.header()
    this.files = parseFst(this.fst)
  }

  read(entry: FileEntry, offset: number, size: number): Uint8Array {
    const r = this.entries.get(`files/${entry.path}`.toLowerCase())
    if (!r) throw new LabError(`the extracted disc has no file files/${entry.path}`)
    return readFull(r, offset, size)
  }
}

export function dolSize(head: Uint8Array): number {
  let m = 0
  for (let i = 0; i < 18; i++) {
    const o = u32be(head, 4 * i), s = u32be(head, 0x90 + 4 * i)
    if (s) m = Math.max(m, o + s)
  }
  return m
}

export function parseFst(fst: Uint8Array): FileEntry[] {
  const count = u32be(fst, 8)
  const names = count * 12
  const files: FileEntry[] = []
  const stack: [number, string][] = [[count, '']]
  const name = (i: number) => cstring(fst, names + (u32be(fst, i * 12) & 0xffffff))
  for (let i = 1; i < count; i++) {
    while (i >= stack[stack.length - 1][0]) stack.pop()
    const flags = fst[i * 12]
    const a = u32be(fst, i * 12 + 4), b = u32be(fst, i * 12 + 8)
    if (flags) stack.push([b, stack[stack.length - 1][1] + name(i) + '/'])
    else files.push(new FileEntry(stack[stack.length - 1][1] + name(i), a, b))
  }
  return files
}

export interface Replacement {
  size: number
  write(sink: Sink): Promise<void>
}

class Zeros {
  private static block = new Uint8Array(CHUNK)
  static async write(sink: Sink, n: number) {
    while (n > 0) {
      const k = Math.min(n, CHUNK)
      await sink.write(k === CHUNK ? Zeros.block : new Uint8Array(k))
      n -= k
    }
  }
}

export async function copyEntry(disc: Disc, entry: FileEntry, sink: Sink, progress?: (n: number) => void) {
  for (let pos = 0; pos < entry.size; pos += CHUNK) {
    const n = Math.min(CHUNK, entry.size - pos)
    await sink.write(disc.read(entry, pos, n))
    progress?.(n)
  }
}

// The new image is written front to back: every file's place is worked out first, so the FST
// with the new offsets and sizes can be written before the files.
export async function writeIso(sink: Sink, disc: Disc, dol: Uint8Array, replace: Map<string, Uint8Array | Replacement>, progress?: (n: number) => void): Promise<number> {
  const rep = new Map([...replace].map(([k, v]) => [k.toLowerCase(), v]))
  const order = [...disc.files].sort((a, b) => a.offset - b.offset)
  const fst = disc.fst.slice()
  const count = u32be(fst, 8)
  const fileRows: number[] = []
  for (let j = 1; j < count; j++) if (!fst[j * 12]) fileRows.push(j)
  const row = new Map<string, number>()
  disc.files.forEach((e, k) => row.set(e.path, fileRows[k]))
  if (dol.length > disc.fstOffset - disc.dolOffset) throw new LabError('the patched main.dol does not fit before the FST')
  const head = disc.boot.length + disc.bi2.length + disc.apploader.length
  if (head > disc.dolOffset) throw new LabError('the disc header overlaps main.dol')

  let pos = disc.fstOffset + disc.fstSize
  const plan: [number, number, Uint8Array | Replacement | undefined][] = []
  for (const e of order) {
    const start = Math.max(e.offset, (pos + SECTOR - 1) & ~(SECTOR - 1))
    const src = rep.get(e.path.toLowerCase())
    const size = src === undefined ? e.size : src instanceof Uint8Array ? src.length : src.size
    const r = row.get(e.path)!
    fst[r * 12 + 4] = start >>> 24
    fst[r * 12 + 5] = (start >>> 16) & 255
    fst[r * 12 + 6] = (start >>> 8) & 255
    fst[r * 12 + 7] = start & 255
    fst[r * 12 + 8] = size >>> 24
    fst[r * 12 + 9] = (size >>> 16) & 255
    fst[r * 12 + 10] = (size >>> 8) & 255
    fst[r * 12 + 11] = size & 255
    plan.push([start, size, src])
    pos = start + size
  }
  if (pos > GC_DISC_SIZE) throw new LabError(`the patched game is 0x${pos.toString(16).toUpperCase()} bytes, more than a GameCube disc holds`)

  let at = 0
  const put = async (data: Uint8Array) => {
    await sink.write(data)
    at += data.length
  }
  const padTo = async (target: number) => {
    if (target < at) throw new LabError('the new disc layout overlaps itself')
    await Zeros.write(sink, target - at)
    at = target
  }
  await put(disc.boot)
  await put(disc.bi2)
  await put(disc.apploader)
  await padTo(disc.dolOffset)
  await put(dol)
  await padTo(disc.fstOffset)
  await put(fst)
  for (const [i, e] of order.entries()) {
    const [start, size, src] = plan[i]
    await padTo(start)
    if (src === undefined) {
      await copyEntry(disc, e, sink, progress)
      at += e.size
    } else if (src instanceof Uint8Array) {
      await put(src)
    } else {
      await src.write(sink)
      at += size
    }
  }
  await padTo(GC_DISC_SIZE)
  return GC_DISC_SIZE
}
