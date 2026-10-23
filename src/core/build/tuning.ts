// The character's own tuning file, Misc/PLAYER_<Name>.nvb: a copy of the base's with some fields changed, and its line in Misc/nvblist.txt.
import { cstring, encodeLatin1, f32le, i32le, latin1, putF32le, putU32le } from '../bytes'
import { LabError } from '../errors'
import type { BaseCharacter } from '../game/roster'
import type { GameSource } from '../game/source'
import { roundHalfEven } from '../mnroi/gxtex'
import * as nvbtool from '../mnroi/nvbtool'

export const SLOTS = nvbtool.SLOTS
const RESISTANCE = [134, 135, 136, 137, 138]
export const FIELDS: Record<string, number> = { run_speed: 104, sprint_speed: 157, rage_per_super: 189, rage_duration: 192 }
export const POWER_EFFECTS = [98, 99]
export const AIM_RANGE = 2
const LIST_BUFFER = 0x200

type Value = number | string

export class Tuning {
  base: BaseCharacter
  fields: nvbtool.Field[]
  nvb: nvbtool.Nvb
  list: Uint8Array

  constructor(source: GameSource, base: BaseCharacter) {
    this.base = base
    this.fields = nvbtool.parseNdb(source.entry('Misc/defaults.ndb')).fields('PLAYER')
    this.nvb = nvbtool.parseNvb(source.entry(base.nvbName()))
    this.list = source.entry('Misc/nvblist.txt')
  }

  slots(fid: number): [number, Uint8Array[]] {
    const [typ, def] = this.fields[fid]
    return [typ, this.nvb.slots(fid, def) ?? new Array(SLOTS).fill(def)]
  }

  value(fid: number, slot = 0): Value {
    const [typ, vals] = this.slots(fid)
    const v = vals[slot]
    if (typ === nvbtool.T_FLOAT) return f32le(v, 0)
    if (typ === nvbtool.T_INT) return i32le(v, 0)
    return cstring(v)
  }

  num(fid: number, slot = 0): number {
    return this.value(fid, slot) as number
  }

  fieldsOf(type: number): number[] {
    return this.fields.flatMap(([typ], fid) => (typ === type ? [fid] : []))
  }

  damageTaken(): number {
    return 1.0 - this.num(RESISTANCE[0])
  }

  gameplay(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, fid] of Object.entries(FIELDS)) out[k] = this.num(fid)
    out.damage_taken = this.damageTaken()
    out.throw_reach = this.num(AIM_RANGE)
    return out
  }

  private set(nvb: nvbtool.Nvb, fid: number, values: Value[]) {
    const typ = this.fields[fid][0]
    const enc = (v: Value): Uint8Array => {
      if (typ === nvbtool.T_FLOAT) {
        const b = new Uint8Array(4)
        putF32le(b, 0, v as number)
        return b
      }
      if (typ === nvbtool.T_INT) {
        const b = new Uint8Array(4)
        putU32le(b, 0, roundHalfEven(v as number) >>> 0)
        return b
      }
      return encodeLatin1((v as string) + '\0')
    }
    const recs: nvbtool.Record[] = [[0, typ, enc(values[0])]]
    values.forEach((v, s) => {
      if (s && v !== values[0]) recs.push([s, typ, enc(v)])
    })
    const g = nvb.group(fid)
    if (g) g[1] = recs
    else nvb.groups.push([fid, recs])
  }

  private scaled(fid: number, next: number): number[] {
    const vals = Array.from({ length: SLOTS }, (_, s) => this.num(fid, s))
    if (!vals[0]) return new Array(SLOTS).fill(next)
    const k = next / vals[0]
    return vals.map((v) => v * k)
  }

  build(internal: string, gameplay: Record<string, unknown>, effects: Map<number, string[]> | null = null): [string, Uint8Array, Uint8Array] {
    const nvb = nvbtool.parseNvb(nvbtool.buildNvb(this.nvb))
    const raw = new Uint8Array(0x40)
    raw.set(encodeLatin1(internal))
    nvb.rawName = raw
    for (const [key, fid] of Object.entries(FIELDS)) {
      const v = gameplay[key]
      if (v !== null && v !== undefined) this.set(nvb, fid, this.scaled(fid, v as number))
    }
    const t = gameplay.damage_taken as number | undefined
    if (t !== null && t !== undefined) {
      const t0 = this.damageTaken()
      for (const fid of RESISTANCE) {
        const taken = Array.from({ length: SLOTS }, (_, s) => 1.0 - this.num(fid, s))
        const k = t0 > 0 ? t / t0 : null
        this.set(nvb, fid, taken.map((x) => 1.0 - (k !== null ? x * k : t)))
      }
    }

    const reach = gameplay.throw_reach as number | undefined
    if (reach !== null && reach !== undefined) this.set(nvb, AIM_RANGE, new Array(SLOTS).fill(reach))
    for (const [fid, names] of effects ?? []) this.set(nvb, fid, names)
    return [`Misc/PLAYER_${internal}.nvb`, nvbtool.buildNvb(nvb), this.listed(internal)]
  }

  listed(internal: string): Uint8Array {
    let text = latin1(this.list)
    for (const [a, b] of listPairs(this.list)) {
      if (a.toUpperCase() === 'PLAYER' && b.toLowerCase() === internal.toLowerCase()) throw new LabError(`nvblist.txt already lists PLAYER ${internal}`)
    }
    if (listCost(internal) > listRoom(this.list)) throw new LabError('Misc/nvblist.txt has no room for another tuning file')
    if (!text.endsWith('\r\n')) text += '\r\n'
    return encodeLatin1(text + `PLAYER ${internal}\r\n`)
  }
}

// fn_801B3C4C reads the first two names of each line not starting with a space or '/'.
function listPairs(list: Uint8Array): [string, string][] {
  const out: [string, string][] = []
  for (const line of latin1(list).split('\n')) {
    if (line.startsWith(' ') || line.startsWith('/')) continue
    const t = line.split(/[ \t\r\n/;]+/).filter(Boolean)
    if (t.length >= 2) out.push([t[0], t[1]])
  }
  return out
}

export function listCost(internal: string): number {
  return 'PLAYER'.length + internal.length + 2
}

export function listRoom(list: Uint8Array): number {
  return LIST_BUFFER - 1 - listPairs(list).reduce((n, [a, b]) => n + a.length + b.length + 2, 0)
}
