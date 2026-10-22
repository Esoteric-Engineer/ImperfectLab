// Entity templates (Misc/Global.not), ported from mnroi tools/nottool.py (commit a23c796).
// Little-endian: "NOT\x10", version 1, an index of {name[0x20], body offset}, then the bodies {property count, {id, value[0x20]}..., note length, note}.
import { ByteWriter, cstring, encodeLatin1, putF32le, putU32le, startsWith, u32le } from '../bytes'
import { LabError } from '../errors'

export class Template {
  rawName: Uint8Array
  props: [number, Uint8Array][]
  note: Uint8Array

  constructor(rawName: Uint8Array, props: [number, Uint8Array][], note: Uint8Array) {
    this.rawName = rawName
    this.props = props
    this.note = note
  }

  get name(): string {
    return cstring(this.rawName)
  }

  get(pid: number): Uint8Array | null {
    for (const [i, v] of this.props) if (i === pid) return v
    return null
  }

  set(pid: number, value: Uint8Array) {
    for (let k = 0; k < this.props.length; k++) {
      if (this.props[k][0] === pid) {
        this.props[k] = [pid, value]
        return
      }
    }
    this.props.push([pid, value])
  }
}

export function name32(s: string): Uint8Array {
  const b = encodeLatin1(s)
  if (b.length > 0x1f) throw new LabError(`name longer than 31 characters: ${s}`)
  const out = new Uint8Array(0x20)
  out.set(b)
  return out
}

export const vStr = name32

export function vInt(n: number): Uint8Array {
  const out = new Uint8Array(0x20)
  putU32le(out, 0, n >>> 0)
  return out
}

export function vFloat(f: number): Uint8Array {
  const out = new Uint8Array(0x20)
  putF32le(out, 0, f)
  return out
}

export function parse(data: Uint8Array): Template[] {
  if (!startsWith(data, 'NOT\x10')) throw new LabError('bad Global.not magic')
  const version = u32le(data, 4), count = u32le(data, 8)
  if (version !== 1) throw new LabError(`Global.not version ${version}`)
  const index: [Uint8Array, number][] = []
  let p = 12
  for (let i = 0; i < count; i++) {
    index.push([data.slice(p, p + 0x20), u32le(data, p + 0x20)])
    p += 0x24
  }
  const out: Template[] = []
  for (const [raw, off] of index) {
    if (off !== p) throw new LabError(`body of ${cstring(raw)} at 0x${off.toString(16)}, expected 0x${p.toString(16)}`)
    const n = u32le(data, p)
    p += 4
    const props: [number, Uint8Array][] = []
    for (let i = 0; i < n; i++) {
      props.push([u32le(data, p), data.slice(p + 4, p + 0x24)])
      p += 0x24
    }
    const tn = u32le(data, p)
    const note = data.slice(p + 4, p + 4 + tn)
    p += 4 + tn
    out.push(new Template(raw, props, note))
  }
  if (p !== data.length) throw new LabError(`trailing data: 0x${p.toString(16)} of 0x${data.length.toString(16)}`)
  return out
}

export function build(templates: Template[]): Uint8Array {
  const head = new ByteWriter()
  const bodies = new ByteWriter(1 << 16)
  head.latin1('NOT\x10').u32le(1).u32le(templates.length)
  const base = 12 + 0x24 * templates.length
  for (const t of templates) {
    head.bytes(t.rawName).u32le(base + bodies.length)
    bodies.u32le(t.props.length)
    for (const [pid, v] of t.props) {
      if (v.length !== 0x20) throw new LabError(`${t.name}: property 0x${pid.toString(16)} value is not 0x20 bytes`)
      bodies.u32le(pid).bytes(v)
    }
    bodies.u32le(t.note.length).bytes(t.note)
  }
  return head.bytes(bodies.view()).finish()
}
