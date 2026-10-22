import { sha1 } from '@noble/hashes/legacy.js'
import { cstring, latin1, toHex, u32be, u32le } from '../bytes'
import { LabError } from '../errors'
import { CHUNK, type Disc, type FileEntry } from './disc'

export const GAME_ID = 'GVLE69'
const SHA1: Record<string, string> = {
  'main.dol': '8e3cc563c300b7730802f69ade112bba1f4c6be5',
  'CLASH.BH': '32836d400df4b4e9f95b9eb790ebb142ab5c28bb',
  'CLASH.BIG': '9519b437d8677dbfb3dea7757aae3511bbfabc71',
}

export class Entry {
  offset: number
  size: number
  name: string
  hash: number
  data: Uint8Array | null = null
  usize = 0

  constructor(offset: number, size: number, name: string, hash = 0) {
    this.offset = offset
    this.size = size
    this.name = name
    this.hash = hash
  }
}

export class BigIndex {
  total: number
  indexSize: number
  entries: Entry[] = []
  tail: Uint8Array
  slack: Uint8Array
  byName = new Map<string, Entry>()
  dups = new Set<string>()

  constructor(head: Uint8Array, rest: Uint8Array, slack: Uint8Array) {
    if (latin1(head, 0, 4) !== 'BIG4') throw new LabError('CLASH.BIG is not a BIG4 archive')
    this.total = u32le(head, 4)
    const count = u32be(head, 8)
    this.indexSize = u32be(head, 12)
    let p = 0
    for (let i = 0; i < count; i++) {
      const off = u32be(rest, p), size = u32be(rest, p + 4)
      const end = rest.indexOf(0, p + 8)
      this.entries.push(new Entry(off, size, cstring(rest, p + 8, end)))
      p = end + 1
    }
    this.tail = rest.slice(p, this.indexSize - 16)
    if (this.entries.length) {
      let s = slack.subarray(0, Math.max(0, this.entries[0].offset - this.indexSize))
      let n = s.length
      while (n > 0 && s[n - 1] === 0) n--
      s = s.subarray(0, n)
      slack = s
    }
    this.slack = slack.slice()
    for (const e of this.entries) {
      const key = e.name.toLowerCase()
      if (this.byName.has(key)) this.dups.add(key)
      this.byName.set(key, e)
    }
  }
}

export class GameSource {
  disc: Disc
  bigFile: FileEntry
  bhFile: FileEntry
  index: BigIndex
  private cache = new Map<string, Uint8Array>()

  constructor(disc: Disc) {
    this.disc = disc
    if (disc.gameId !== GAME_ID || disc.revision !== 0) {
      throw new LabError(`this is ${disc.gameId} revision ${disc.revision}; ImperfectLab needs Marvel Nemesis for GameCube, USA (${GAME_ID} revision 0)`)
    }
    this.bigFile = disc.file('CLASH.BIG')
    this.bhFile = disc.file('CLASH.BH')
    const head = disc.read(this.bigFile, 0, 16)
    const indexSize = u32be(head, 12)
    const rest = disc.read(this.bigFile, 16, indexSize - 16 + 0x40)
    const slack = disc.read(this.bigFile, indexSize, 0x40)
    this.index = new BigIndex(head, rest, slack)
  }

  get name(): string {
    return this.disc.name
  }

  get dol(): Uint8Array {
    return this.disc.dol
  }

  bh(): Uint8Array {
    return this.disc.read(this.bhFile, 0, this.bhFile.size)
  }

  has(name: string): boolean {
    return this.index.byName.has(name.toLowerCase())
  }

  names(prefix = '', suffix = ''): string[] {
    const p = prefix.toLowerCase(), s = suffix.toLowerCase()
    return this.index.entries.filter((e) => e.name.toLowerCase().startsWith(p) && e.name.toLowerCase().endsWith(s)).map((e) => e.name)
  }

  entry(name: string): Uint8Array {
    const key = name.toLowerCase()
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const e = this.index.byName.get(key)
    if (!e) throw new LabError(`CLASH.BIG has no entry ${name}`)
    const data = this.disc.read(this.bigFile, e.offset, e.size)
    this.cache.set(key, data)
    if (this.cache.size > 96) this.cache.delete(this.cache.keys().next().value!)
    return data
  }

  readBig(offset: number, size: number): Uint8Array {
    return this.disc.read(this.bigFile, offset, size)
  }

  verify(progress?: (done: number, total: number) => void) {
    if (toHex(sha1(this.dol)) !== SHA1['main.dol']) throw new LabError('main.dol is not the original GVLE69 one: the disc is already patched or modified')
    if (toHex(sha1(this.bh())) !== SHA1['CLASH.BH']) throw new LabError('CLASH.BH is not the original GVLE69 one: the disc is already patched or modified')
    const h = sha1.create()
    const total = this.bigFile.size
    for (let pos = 0; pos < total;) {
      const n = Math.min(CHUNK, total - pos)
      h.update(this.disc.read(this.bigFile, pos, n))
      pos += n
      progress?.(pos, total)
    }
    if (toHex(h.digest()) !== SHA1['CLASH.BIG']) throw new LabError('CLASH.BIG is not the original GVLE69 one: the disc is already patched or modified')
  }
}
