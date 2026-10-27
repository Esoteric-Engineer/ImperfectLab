// Same-size edits to main.dol that turn the filler roster record 19 into a playable character, and grow the effect cache for a tint.
// More characters (up to 9, the select grid's third row) need records past the 20th, which the tables have no room for: patchMany moves them into a new data section.
// The roster tables (Game/unlockables.c in the decomp) hold 0x4C-byte records.
import { sha1 } from '@noble/hashes/legacy.js'
import { cstring, encodeLatin1, equal, fromHex, i32be, i8, putU32be, toHex, u32be } from '../bytes'
import { LabError } from '../errors'

export const NORMAL_TABLE = 0x4c751c
export const ALT_TABLE = 0x4c7b0c
const ORDER_TABLE = 0x4c80fc
const RECORD = 0x4c
const RECORDS = 20
export const SLOT = 19

const LIMITS: [number, string, string][] = [
  [0x1007dc, '2c000012', '2c000013'],
  [0x101758, '2c000012', '2c000013'],
  [0x101760, '38000012', '38000013'],
  [0x101788, '2c000012', '2c000013'],
  [0x101790, '38000012', '38000013'],
]
// The same limits for n characters (18 + n), and fn_8044F070's search of the order table, which only needs raising once it has a 21st entry.
const byte = (v: number) => v.toString(16).padStart(2, '0')
const manyLimits = (n: number): [number, string, string][] => [
  ...LIMITS.map(([off, old, next]): [number, string, string] => [off, old, next.slice(0, 6) + byte(0x12 + n)]),
  [0x44c09c, '2c0a0013', '2c0a00' + byte(Math.max(0x13, 0x12 + n))],
]
// The select grid is 9 wide and 3 rows deep: 27 characters, 9 of them new.
export const MAX_NEW = 9
const FILLER: Record<number, string> = { [NORMAL_TABLE]: 'plr_thing', [ALT_TABLE]: 'plr_altThing' }
// fn_803A38DC allocates 300,000 bytes and its allocator fn_803A3460 checks the same limit.
const EFFECT_CACHE_SIZE: [number, string][] = [[0x3a048c, '3d200004612993e0'], [0x3a092c, '3c600004606393e0']]

// fn_8019DB24 (an animation's time setter) rewritten in place, setting the time forward to an event 0x7E's frame mirrors it about that frame (build/basemoves.ts).
const MIRROR_SKIP: [number, string, string] = [0x8019db24,
  '9421ffe87c0802a6bfc100109001001c7c3f0b787c7e1b78d03f0008c01f0008d01e0004801e001c2c0000004082000848000028801e0024' +
  '7c0903785520103a807e0020388000007c0503784bfd48a9480000084800000481610000800b00047c0803a6bbcbfff87d615b784e800020',
  '8083001c2884000041860048c0030004fc0100004081003c80a4003c80c4004034a5ffff4180002ca0e600042807007e40820010c0460000' +
  'fc0208004182000c38c6000c4bffffdcec410028ec21102ad02300044d86002080a3002454a5103a80630020388000004bfd488c60000000']

// fn_80114420 (loads each player's SFX bank) rewritten in place from sfxbanks.s: own banks for new characters, one bank per type ID.
const SFX_BANKS: [number, number, string] = [0x80114420, 0x3b4, '7298b504a7cb5aa56a512407733250e5f641ca5b']
const SFX_BANKS_CODE =
  '9421ffc07c0802a6bf21002490010044800d815c2c0000004182013c800d88302c000000408201303c608055386326ac3c8080493884771c4805e1fd7c7f1b783c608055386321104831e3dd2c030000408200203c608055386321104831e3f52c0300004082000c2c1f0000408200e8' +
  '3bc000003ba000003c60805538632110483204617c1e1800408000cc3c608055386321107fc4f3784831d3057c7c1b784831ba6d4bf867297c7b1b78281b001f41810018380000017c00d8307fa900394082008c7fbd03783f4080113b5a45e8881a00002c00000041820048387c0004' +
  '7f44d3784805e1517c791b784800007d387c00047f44d3784805e13d4800006d2c030000418200142c1900004182000c480000594bffffbc7f44d37848000024281b0012418100283d2080113929459c5760103a7c89002e2c04000041820010806d88a838a00001483432153bde0001' +
  '4bffff28800100447c0803a6bb210024382100404e800020881a00003b5a00012c0000004082fff44e800020'
// The game's bank names in .rodata, by type ID.
const SFX_BANK_NAMES: [number, number, string][] = [
  [1, 0x8049790c, 'SFX_Wolv1'], [2, 0x80497900, 'SFX_Iron2'], [3, 0x80497924, 'SFX_Spidey'], [4, 0x80497930, 'SFX_Venom'],
  [5, 0x804979a0, 'SFX_Magneto'], [6, 0x80497978, 'SFX_Elektra'], [7, 0x804979b8, 'SFX_Storm'], [8, 0x804979c4, 'SFX_Torch'],
  [9, 0x8049796c, 'SFX_Devil'], [10, 0x80497918, 'SFX_Thing'], [11, 0x804979ac, 'SFX_Roekel'], [12, 0x80497954, 'SFX_Brigade'],
  [13, 0x80497960, 'SFX_DefCon'], [14, 0x804979d0, 'SFX_Wink'], [15, 0x80497944, 'SFX_AfterShk'], [16, 0x8049793c, 'SFX_Ohm'],
  [17, 0x80497984, 'SFX_Hazmat'], [18, 0x80497990, 'SFX_Heatwave'],
]

export const soundBankName = (internal: string) => `SFX_${internal}`

export function gameSoundBank(typeId: number): string {
  const row = SFX_BANK_NAMES.find(([id]) => id === typeId)
  if (!row) throw new LabError(`no sound bank belongs to type ID ${typeId}`)
  return row[2]
}

export function soundBanks(dol: Uint8Array, internals: string[]): Uint8Array {
  const out = dol.slice()
  const [va, size, digest] = SFX_BANKS
  const at = fileOffset(out, va)
  if (toHex(sha1(out.subarray(at, at + size))) !== digest) throw new LabError(`main.dol differs from GVLE69 at 0x${at.toString(16).toUpperCase()}`)
  const code = fromHex(SFX_BANKS_CODE)
  const table = new Uint8Array(19 * 4)
  for (const [id, name, text] of SFX_BANK_NAMES) {
    if (cstring(out, fileOffset(out, name), fileOffset(out, name) + 0x10) !== text) throw new LabError(`main.dol has no ${text} at 0x${name.toString(16).toUpperCase()}`)
    putU32be(table, 4 * id, name)
  }
  const strings = encodeLatin1(internals.map((n) => [...entityNames(n), soundBankName(n)].join('\0') + '\0').join('') + '\0')
  if (code.length + table.length + strings.length > size) throw new LabError(`fn_80114420 has no room for ${internals.length} characters' sound banks`)
  const body = new Uint8Array(size)
  body.set(code)
  body.set(table, code.length)
  body.set(strings, code.length + table.length)
  out.set(body, at)
  return out
}

const TABLE_REFS: [number, number, number][] = [
  [0x42ece4, 0x42ece8, 0x804ca51c], [0x42ecf8, 0x42ecfc, 0x804cab0c], [0x42ed0c, 0x42ed18, 0x804cb0fc], [0x44c0a8, 0x44c0b8, 0x804cb0fc],
]
// The moved tables go where the arena started, and the arena starts after them.
// OSInit sets its start to __ArenaLo, or to _stack_addr rounded up when booted with a BI2 debug flag below 2.
// Only these two pairs change, the stack itself stays.
export const ARENA_LO = 0x806809c0
const ARENA_REFS: [number, number, number][] = [[0x177bc4, 0x177bc8, ARENA_LO], [0x177bfc, 0x177c00, 0x806809a0]]
const sectionSize = (records: number) => (2 * RECORD * records + 4 * records + 0x1f) & ~0x1f

export interface NewCharacter {
  internal: string
  display: string
  stats: number[]
  altStats: number[]
}

export interface RosterRecord {
  name: string
  key: string
  stats: number[]
  unlocked: number
}

export function recordOffset(table: number, index: number): number {
  return table + RECORD * index
}

export function readRecord(dol: Uint8Array, table: number, index: number): RosterRecord {
  const o = recordOffset(table, index)
  return {
    name: cstring(dol, o, o + 0x20),
    key: cstring(dol, o + 0x20, o + 0x40),
    stats: Array.from({ length: 6 }, (_, i) => i8(dol, o + 0x40 + i)),
    unlocked: i32be(dol, o + 0x48),
  }
}

export function entityNames(internal: string): [string, string] {
  const low = internal.toLowerCase()
  return ['plr_' + low, 'plr_alt' + low.charAt(0).toUpperCase() + low.slice(1)]
}

function field(text: string, size = 0x20): Uint8Array {
  const b = encodeLatin1(text)
  if (b.length >= size) throw new LabError(`${JSON.stringify(text)} does not fit a ${size}-byte field`)
  const out = new Uint8Array(size)
  out.set(b)
  return out
}

function put(out: Uint8Array, off: number, old: Uint8Array, next: Uint8Array) {
  if (!equal(out.subarray(off, off + old.length), old) || old.length !== next.length) {
    throw new LabError(`main.dol differs from GVLE69 at 0x${off.toString(16).toUpperCase()}`)
  }
  out.set(next, off)
}

// The size both lis/ori pairs load, or null when they differ.
export function readEffectCache(dol: Uint8Array): number | null {
  const sizes = EFFECT_CACHE_SIZE.map(([off]) => (((u32be(dol, off) & 0xffff) << 16) | (u32be(dol, off + 4) & 0xffff)) >>> 0)
  return sizes.every((s) => s === sizes[0]) ? sizes[0] : null
}

export function growEffectCache(dol: Uint8Array, size: number): Uint8Array {
  const out = dol.slice()
  for (const [off, old] of EFFECT_CACHE_SIZE) {
    const next = fromHex(old)
    next.set([size >>> 24, (size >>> 16) & 255], 2)
    next.set([(size >>> 8) & 255, size & 255], 6)
    put(out, off, fromHex(old), next)
  }
  return out
}

export function mirrorSkip(dol: Uint8Array): Uint8Array {
  const out = dol.slice()
  const [va, old, next] = MIRROR_SKIP
  put(out, fileOffset(out, va), fromHex(old), fromHex(next))
  return out
}

// fn_800FB488's button bindings: a count, then 0x50-byte records (room for 32) of up to four {min, max, type, button} steps, a timeout and the action they set.
const BINDINGS_COUNT = 0x804cc80c
const BINDINGS = 0x804cc810
const BINDING = 0x50
const GAME_BINDINGS = 18
const Z_BUTTON = 5
export const Z_ACTIONS = { jump: [4, 5] } as const
export type ZAction = keyof typeof Z_ACTIONS

export function zButton(dol: Uint8Array, action: ZAction): Uint8Array {
  const out = dol.slice()
  const [record, logical] = Z_ACTIONS[action]
  const from = fileOffset(out, BINDINGS + BINDING * record)
  if (u32be(out, from) !== 1 || u32be(out, from + 0x48) !== logical) throw new LabError(`main.dol differs from GVLE69 at 0x${from.toString(16).toUpperCase()}`)
  const next = out.slice(from, from + BINDING)
  putU32be(next, 0x10, Z_BUTTON)
  put(out, fileOffset(out, BINDINGS + BINDING * GAME_BINDINGS), new Uint8Array(BINDING), next)
  const count = new Uint8Array(4)
  putU32be(count, 0, GAME_BINDINGS + 1)
  put(out, fileOffset(out, BINDINGS_COUNT), fromHex('00000012'), count)
  return out
}

function checkStats(values: number[]) {
  if (values.length !== 6 || !values.every((v) => v >= 0 && v <= 10)) throw new LabError('stats must be six values from 0 to 10')
}

export function patch(dol: Uint8Array, internal: string, display: string, stats: number[], altStats: number[]): Uint8Array {
  const out = dol.slice()
  for (const [off, old, next] of LIMITS) put(out, off, fromHex(old), fromHex(next))
  const names: Record<number, string> = { [NORMAL_TABLE]: entityNames(internal)[0], [ALT_TABLE]: entityNames(internal)[1] }
  for (const [table, values] of [[NORMAL_TABLE, stats], [ALT_TABLE, altStats]] as [number, number[]][]) {
    checkStats(values)
    const o = recordOffset(table, SLOT)
    put(out, o, field(FILLER[table]), field(names[table]))
    put(out, o + 0x20, field('~kT_THING'), field(display))
    put(out, o + 0x40, out.slice(o + 0x40, o + 0x48), new Uint8Array([...values.map((v) => v & 255), 0, 0]))
  }
  put(out, ORDER_TABLE + 4 * SLOT, new Uint8Array(4), new Uint8Array([0, 0, 0, SLOT]))
  return out
}

const ha = (v: number) => ((v + 0x8000) >>> 16) & 0xffff

function retarget(out: Uint8Array, lis: number, addi: number, old: number, next: number) {
  const [a, b] = [u32be(out, lis), u32be(out, addi)]
  if (a >>> 26 !== 15 || b >>> 26 !== 14 || (a & 0xffff) !== ha(old) || (b & 0xffff) !== (old & 0xffff)) {
    throw new LabError(`main.dol differs from GVLE69 at 0x${lis.toString(16).toUpperCase()}`)
  }
  putU32be(out, lis, ((a & 0xffff0000) | ha(next)) >>> 0)
  putU32be(out, addi, ((b & 0xffff0000) | (next & 0xffff)) >>> 0)
}

function address(dol: Uint8Array, lis: number, addi: number): number {
  return ((u32be(dol, lis) << 16) + ((u32be(dol, addi) << 16) >> 16)) >>> 0
}

// The file offset that loads at a virtual address.
export function fileOffset(dol: Uint8Array, va: number): number {
  for (let i = 0; i < 18; i++) {
    const off = u32be(dol, 4 * i), at = u32be(dol, 0x48 + 4 * i), size = u32be(dol, 0x90 + 4 * i)
    if (size && at <= va && va < at + size) return off + va - at
  }
  throw new LabError(`main.dol loads nothing at 0x${va.toString(16).toUpperCase()}`)
}

// Where the roster tables are, by what fn_80431CCC reads: [normal, alternate, order] as file offsets.
export function tables(dol: Uint8Array): [number, number, number] {
  return TABLE_REFS.slice(0, 3).map(([lis, addi]) => fileOffset(dol, address(dol, lis, addi))) as [number, number, number]
}

export function arenaLo(dol: Uint8Array): number {
  return address(dol, ARENA_REFS[0][0], ARENA_REFS[0][1])
}

export function patchMany(dol: Uint8Array, chars: NewCharacter[]): Uint8Array {
  if (chars.length < 2 || chars.length > MAX_NEW) throw new LabError(`the roster section holds 2 to ${MAX_NEW} new characters, not ${chars.length}`)
  const records = RECORDS + chars.length - 1
  const size = sectionSize(records)
  const slot = (() => {
    for (let i = 7; i < 18; i++) if (!u32be(dol, 0x90 + 4 * i)) return i
    throw new LabError('main.dol has no free data section')
  })()
  const at = (dol.length + 0x1f) & ~0x1f
  const out = new Uint8Array(at + size)
  out.set(dol)
  for (const [off, old, next] of manyLimits(chars.length)) put(out, off, fromHex(old), fromHex(next))

  const section = out.subarray(at)
  for (const [k, table] of [NORMAL_TABLE, ALT_TABLE].entries()) {
    const base = RECORD * records * k
    const filler = recordOffset(table, SLOT)
    put(out, filler, field(FILLER[table]), field(FILLER[table]))
    section.set(dol.subarray(table, table + RECORD * RECORDS), base)
    chars.forEach((c, i) => {
      const values = k ? c.altStats : c.stats
      checkStats(values)
      const o = base + RECORD * (SLOT + i)
      section.set(field(entityNames(c.internal)[k]), o)
      section.set(field(c.display), o + 0x20)
      section.set([...values.map((v) => v & 255), 0, 0], o + 0x40)
      putU32be(section, o + 0x48, 1)
    })
  }
  const order = 2 * RECORD * records
  put(out, ORDER_TABLE + 4 * SLOT, new Uint8Array(4), new Uint8Array(4))
  section.set(dol.subarray(ORDER_TABLE, ORDER_TABLE + 4 * RECORDS), order)
  chars.forEach((_, i) => putU32be(section, order + 4 * (SLOT + i), SLOT + i))

  putU32be(out, 4 * slot, at)
  putU32be(out, 0x48 + 4 * slot, ARENA_LO)
  putU32be(out, 0x90 + 4 * slot, size)
  const moved = [ARENA_LO, ARENA_LO + RECORD * records, ARENA_LO + order]
  TABLE_REFS.forEach(([lis, addi, old], i) => retarget(out, lis, addi, old, moved[Math.min(i, 2)]))
  for (const [lis, addi, old] of ARENA_REFS) retarget(out, lis, addi, old, ARENA_LO + size)
  return out
}
