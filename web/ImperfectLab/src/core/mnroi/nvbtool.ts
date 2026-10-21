// Tuning files (Misc/<CLASS>_<name>.nvb) and their schema (Misc/defaults.ndb), ported from mnroi tools/nvbtool.py (commit a23c796).
// Little-endian. A VECTOR value is 0x10 bytes, a D888 4; any other type has a u32 size before its bytes.
// After a group's first record the loader copies slot 0 to slots 1-5, so a file lists slot 0 first and then only the slots that differ.
import { ByteWriter, cstring, u32le } from '../bytes'
import { LabError } from '../errors'

const NVB_MAGIC = 0xbeefad00
const NDB_MAGIC = 0xd000d000
export const SLOTS = 6

export const T_TEMPLATE = 0xffffd884, T_EFFECT = 0xffffd885, T_D886 = 0xffffd886, T_VECTOR = 0xffffd887
export const T_D888 = 0xffffd888, T_STRING = 0xffffd889, T_FLOAT = 0xffffd88a, T_INT = 0xffffd88b

export type Field = [number, Uint8Array]
export type Record = [number, number, Uint8Array]
export type Group = [number, Record[]]

function readValue(d: Uint8Array, p: number, typ: number): [Uint8Array, number] {
  if (typ === T_VECTOR) return [d.slice(p, p + 0x10), p + 0x10]
  if (typ === T_D888) return [d.slice(p, p + 4), p + 4]
  const n = u32le(d, p)
  return [d.slice(p + 4, p + 4 + n), p + 4 + n]
}

function writeValue(out: ByteWriter, typ: number, v: Uint8Array) {
  if (typ !== T_VECTOR && typ !== T_D888) out.u32le(v.length)
  out.bytes(v)
}

export class Schema {
  classes: [Uint8Array, number, Field[]][]

  constructor(classes: [Uint8Array, number, Field[]][]) {
    this.classes = classes
  }

  fields(cls: string): Field[] {
    for (const [raw, , fields] of this.classes) if (cstring(raw).toUpperCase() === cls.toUpperCase()) return fields
    throw new LabError(`no class ${cls} in Misc/defaults.ndb`)
  }
}

export function parseNdb(d: Uint8Array): Schema {
  const magic = u32le(d, 0), version = u32le(d, 4), size = u32le(d, 8), count = u32le(d, 12)
  if (magic !== NDB_MAGIC || version !== 0x10001) throw new LabError('bad .ndb header')
  let p = 16
  const classes: [Uint8Array, number, Field[]][] = []
  for (let c = 0; c < count; c++) {
    const raw = d.slice(p, p + 0x40)
    const nfields = u32le(d, p + 0x40), nslots = u32le(d, p + 0x44)
    p += 0x48
    const fields: Field[] = []
    for (let i = 0; i < nfields; i++) {
      const typ = u32le(d, p)
      const [v, next] = readValue(d, p + 4, typ)
      fields.push([typ, v])
      p = next
    }
    classes.push([raw, nslots, fields])
  }
  if (p !== d.length || size !== d.length) throw new LabError('trailing data in Misc/defaults.ndb')
  return new Schema(classes)
}

export class Nvb {
  word1: number
  rawClass: Uint8Array
  rawName: Uint8Array
  groups: Group[]

  constructor(word1: number, rawClass: Uint8Array, rawName: Uint8Array, groups: Group[]) {
    this.word1 = word1
    this.rawClass = rawClass
    this.rawName = rawName
    this.groups = groups
  }

  group(fid: number): Group | null {
    for (const g of this.groups) if (g[0] === fid) return g
    return null
  }

  slots(fid: number, def: Uint8Array): Uint8Array[] | null {
    const g = this.group(fid)
    if (g === null) return null
    const out = new Array<Uint8Array>(SLOTS).fill(def)
    g[1].forEach(([slot, , v], j) => {
      out[slot] = v
      if (j === 0) out.fill(out[0], 1)
    })
    return out
  }
}

export function parseNvb(d: Uint8Array): Nvb {
  const magic = u32le(d, 0), word1 = u32le(d, 4), size = u32le(d, 8)
  if (magic !== NVB_MAGIC) throw new LabError('bad .nvb magic')
  const count = u32le(d, 0x8c)
  let p = 0x90
  const groups: Group[] = []
  for (let g = 0; g < count; g++) {
    const fid = u32le(d, p), nrec = u32le(d, p + 4)
    p += 8
    const recs: Record[] = []
    for (let i = 0; i < nrec; i++) {
      const slot = u32le(d, p), typ = u32le(d, p + 4)
      const [v, next] = readValue(d, p + 8, typ)
      recs.push([slot, typ, v])
      p = next
    }
    groups.push([fid, recs])
  }
  if (p !== d.length || size !== d.length) throw new LabError('trailing data in a .nvb file')
  return new Nvb(word1, d.slice(0xc, 0x4c), d.slice(0x4c, 0x8c), groups)
}

export function buildNvb(nvb: Nvb): Uint8Array {
  const body = new ByteWriter()
  body.bytes(nvb.rawClass).bytes(nvb.rawName).u32le(nvb.groups.length)
  for (const [fid, recs] of nvb.groups) {
    body.u32le(fid).u32le(recs.length)
    for (const [slot, typ, v] of recs) {
      body.u32le(slot).u32le(typ)
      writeValue(body, typ, v)
    }
  }
  const out = new ByteWriter(12 + body.length)
  out.u32le(NVB_MAGIC).u32le(nvb.word1).u32le(12 + body.length).bytes(body.view())
  return out.finish()
}
