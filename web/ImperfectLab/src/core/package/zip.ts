// A ZIP reader that sees every central-directory entry (to check for duplicates) and a deterministic writer.
import { inflateSync, zipSync, type Zippable } from 'fflate'
import { latin1, u16le, u32le } from '../bytes'
import { LabError } from '../errors'

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
  isDir: boolean
}

export function listZip(data: Uint8Array): ZipEntry[] {
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (u32le(data, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new LabError('not a .imperfect file')
  const count = u16le(data, eocd + 10)
  let p = u32le(data, eocd + 16)
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || u32le(data, p) !== 0x02014b50) throw new LabError('not a .imperfect file (archive may be damaged)')
    const nameLen = u16le(data, p + 28), extraLen = u16le(data, p + 30), commentLen = u16le(data, p + 32)
    const flags = u16le(data, p + 8)
    const raw = data.subarray(p + 46, p + 46 + nameLen)
    const name = flags & 0x800 ? new TextDecoder().decode(raw) : latin1(raw)
    out.push({
      name,
      method: u16le(data, p + 10),
      compressedSize: u32le(data, p + 20),
      size: u32le(data, p + 24),
      localOffset: u32le(data, p + 42),
      isDir: name.endsWith('/'),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export function readEntry(data: Uint8Array, e: ZipEntry): Uint8Array {
  const p = e.localOffset
  if (p + 30 > data.length || u32le(data, p) !== 0x04034b50) throw new LabError('not a .imperfect file (archive is damaged)')
  const start = p + 30 + u16le(data, p + 26) + u16le(data, p + 28)
  const body = data.subarray(start, start + e.compressedSize)
  let out: Uint8Array
  if (e.method === 0) out = body.slice()
  else if (e.method === 8) {
    try {
      out = inflateSync(body, { out: new Uint8Array(e.size + 1) })
    } catch {
      throw new LabError(`${e.name} could not be unpacked`)
    }
  } else throw new LabError(`${e.name} uses an unsupported compression method`)
  if (out.length !== e.size) throw new LabError("a member's size does not match the archive's directory")
  return out
}

export function writeZip(members: [string, Uint8Array][]): Uint8Array {
  const files: Zippable = {}
  for (const [name, body] of members) files[name] = [body, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 3, attrs: 0o644 << 16 }]
  return zipSync(files)
}
