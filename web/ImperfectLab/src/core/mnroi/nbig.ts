// Nested UI archives (Apt/**/<name>.big): a RefPack stream of a BIGF file, ported from mnroi tools/nbig.py (commit a23c796).
import { ByteWriter, cstring, encodeLatin1, putU32le, u32be } from '../bytes'
import { LabError } from '../errors'
import * as refpack from './refpack'

const ALIGN = 0x80
export const TAG = encodeLatin1('L231\0\0\0\0')

export type ArchiveFile = [string, Uint8Array]

export function parse(data: Uint8Array): [ArchiveFile[], Uint8Array] {
  if (data[0] === 0x10 && data[1] === 0xfb) data = refpack.decompress(data)
  if (cstring(data, 0, 4) !== 'BIGF') throw new LabError('not a BIGF archive')
  const count = u32be(data, 8), indexSize = u32be(data, 12)
  const files: ArchiveFile[] = []
  let p = 16
  for (let i = 0; i < count; i++) {
    const off = u32be(data, p), size = u32be(data, p + 4)
    const end = data.indexOf(0, p + 8)
    files.push([cstring(data, p + 8, end), data.subarray(off, off + size)])
    p = end + 1
  }
  return [files, data.slice(p, indexSize)]
}

export function load(data: Uint8Array): ArchiveFile[] {
  return parse(data)[0]
}

export function save(files: ArchiveFile[], compress = true, tag: Uint8Array = TAG): Uint8Array {
  let indexSize = 16 + tag.length
  for (const [n] of files) indexSize += 8 + n.length + 1
  let pos = indexSize
  const index = new ByteWriter()
  const placed: [number, Uint8Array][] = []
  for (const [name, data] of files) {
    pos += (ALIGN - (pos % ALIGN)) % ALIGN
    index.u32be(pos).u32be(data.length).latin1(name).byte(0)
    placed.push([pos, data])
    pos += data.length
  }
  const raw = new ByteWriter(pos)
  raw.latin1('BIGF').zeros(4).u32be(files.length).u32be(indexSize).bytes(index.view()).bytes(tag)
  for (const [at, data] of placed) raw.zeros(at - raw.length).bytes(data)
  const out = raw.finish()
  putU32le(out, 4, pos)
  return compress ? refpack.compress(out) : out
}
