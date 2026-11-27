// Uncompressed BIGF archives as the Xbox data has them; the header's total size is little-endian.
import { ByteWriter, cstring, putU32le, u32be } from '../bytes'
import { LabError } from '../errors'
import type { RgbaImage } from '../image'
import * as SX from './shpx'

export type ArchiveFile = [string, Uint8Array]
const ALIGN = 0x80

export function parseBig(data: Uint8Array): [ArchiveFile[], Uint8Array] {
  if (cstring(data, 0, 4) !== 'BIGF') throw new LabError('not a BIGF archive')
  const count = u32be(data, 8), indexSize = u32be(data, 12)
  const files: ArchiveFile[] = []; let p = 16
  for (let i = 0; i < count; i++) {
    const off = u32be(data, p), size = u32be(data, p + 4), end = data.indexOf(0, p + 8)
    files.push([cstring(data, p + 8, end), data.slice(off, off + size)]); p = end + 1
  }
  return [files, data.slice(p, indexSize)]
}

export function saveBig(files: ArchiveFile[], tag: Uint8Array): Uint8Array {
  let indexSize = 16 + tag.length
  for (const [n] of files) indexSize += 8 + n.length + 1
  let pos = indexSize
  const index = new ByteWriter(); const placed: [number, Uint8Array][] = []
  for (const [name, data] of files) {
    pos += (ALIGN - (pos % ALIGN)) % ALIGN
    index.u32be(pos).u32be(data.length).latin1(name).byte(0); placed.push([pos, data]); pos += data.length
  }
  const raw = new ByteWriter(pos)
  raw.latin1('BIGF').zeros(4).u32be(files.length).u32be(indexSize).bytes(index.view()).bytes(tag)
  for (const [at, data] of placed) raw.zeros(at - raw.length).bytes(data)
  const out = raw.finish(); putU32le(out, 4, out.length)
  return out
}

export function renameBig(d: Uint8Array, from: string, to: string, pictures?: Map<string, RgbaImage>): Uint8Array {
  const [files, tag] = parseBig(d)
  return saveBig(files.map(([n, b]) => [to + n.slice(from.length), pictures && n.toLowerCase().endsWith('.xsh') ? SX.replaceImages(b, pictures) : b]), tag)
}