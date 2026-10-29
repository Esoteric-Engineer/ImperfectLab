// Same-size edits to main.dol that turn the filler roster record 19 into a playable character, and grow the effect cache for a tint.
// More characters (up to 9, the select grid's third row) need records past the 20th, which the tables have no room for: patchMany moves them into a new data section.
// The roster tables (Game/unlockables.c in the decomp) hold 0x4C-byte records.
import { sha1 } from '@noble/hashes/legacy.js'
import { concat, cstring, encodeLatin1, equal, fromHex, i32be, i8, putF32be, putU32be, toHex, u32be } from '../bytes'
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

// fn_8009D71C (caches the energy regeneration rates) rewritten in place: the rate while holding R (+0x3D0) also adds tuning field 245, which only ImperfectLab sets.
const CHARGE_RATE: [number, string, string] = [0x8009d71c,
  '9421fff07c0802a6bfc10008900100147c3f0b787c7e1b787fc3f3783880002d48014149fc000890d01e03cc7fc3f3783880002b48014135fc000890d01e03c47fc3f378' +
  '3880002c48014121fc000890d01e03c8806d91e83880003938a00000483965a5fc000890c1be03ccec000372d01e03d081610000800b00047c0803a6bbcbfff87d615b784e800020',
  '9421fff07c0802a6bfc10008900100147c7e1b783880002d48014151d03e03cc7fc3f3783880002b48014141d03e03c47fc3f3783880002c48014131d03e03c8806d91e8' +
  '3880003938a00000483965b9c1be03ccec010372d01e03d07fc3f378388000f548014105c01e03d0ec00082ad01e03d0800100147c0803a6bbc10008382100104e80002060000000']

// fn_800E1788's event 0x1B (sets the hit's damage, +0x3F8, from tuning field 22 + param) rewritten in place: param 5 reads tuning field 217, which only ImperfectLab sets.
const THROW_DAMAGE: [number, string, string] = [0x800e2338,
  '801f00102c0000024182007c28000002418100182c000000418200242c000001418200404800003c2c0000034182007c2c00000441820098480000287e639b78' +
  '4bfea2697c701b787e038378388000164bfcf4fdfc000890d01303f8480000947e639b784bfea2457c6f1b787de37b78388000174bfcf4d9fc000890d01303f8' +
  '480000707e639b784bfea2217c6e1b787dc37378388000184bfcf4b5fc000890d01303f84800004c7e639b784bfea1fd907f0038807f0038388000194bfcf491' +
  'fc000890d01303f8480000287e639b784bfea1d9907f003c807f003c3880001a4bfcf46dfc000890d01303f848000004',
  '7e639b784bfea2a5809f00102804000440810018280400053880001740820010388000d948000008388400164bfcf521d03303f8480000bc' +
  '60000000'.repeat(46)]

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

export function chargeRate(dol: Uint8Array): Uint8Array {
  const out = dol.slice()
  const [va, old, next] = CHARGE_RATE
  put(out, fileOffset(out, va), fromHex(old), fromHex(next))
  return out
}

export function throwDamage(dol: Uint8Array): Uint8Array {
  const out = dol.slice()
  const [va, old, next] = THROW_DAMAGE
  put(out, fileOffset(out, va), fromHex(old), fromHex(next))
  return out
}

// fn_800FB488's button bindings: a count, then 0x50-byte records (room for 32) of up to four {min, max, type, button} steps, a timeout and the action they set.
// Z (button 5) gets a copy of Block's record (step type 3, set while held) for the unused action 19.
const BINDINGS_COUNT = 0x804cc80c
const BINDINGS = 0x804cc810
const BINDING = 0x50
const GAME_BINDINGS = 18
const Z_BUTTON = 5
const Z_LOGICAL = 19
export const Z_ACTIONS = ['stealth', 'costume', 'stats'] as const
export type ZAction = (typeof Z_ACTIONS)[number]
export const Z_SECONDS: [number, number] = [1, 60]

// fn_80137494 (the AI debug display, never called in retail) rewritten from zactions.s, then its table.
const Z_CODE: [number, number, string] = [0x80137494, 0x858, '33246b517b202fa554e0792f4a66b6d4c5a84712']
const Z_ACTIONS_CODE =
  '9421ffc07c0802a690010044bea100147fbfeb78807f05b42c030000418202a483c300e42c1e000041820298813f00088389004c3b600000813f000c2c090000418200088369004c3fa0800b3bbd18b8801d00007c00f000418201703bbd0018801d00007c00f000418201602c1c0000' +
  '418202502c1b0000408202487fc3f3784bf4e9d92c030000408202383b0000003c60805538632110482fd3d57c181800408002203c608055386321107f04c378482fa2797c771b78482f89e13b1800017c03f0004082ffcc3f4080133b5a7a2c3aba000c801a00047000001041820008' +
  '3ab5001c881500002c000000418201d4387700047ea4ab784803b0c92c030000418200347ea4ab78480002a57c952378387700044803b0ad2c030000418200187ea4ab784800028938840003549a003a4bffffa0c03a00003d208008c0096cc4fc0100004182001c7fc3f3784bf4f151' +
  '3d208008c0096cc4fc010000408101643fa0800b3bbd18b8380000027c0903a63d20805981293c2c801d00002c00000041820020801d00047c004850280000fa408000103bbd00184200ffe04800012493dd0000801a0000901d0008801a0004901d000c935d0010801e0308901d0014' +
  '3b200001480000842c1c0000418200707fc3f3784bf4e8852c03000040820060c03d00083d208008c0096cc4fc0100004182003c3d208059c0493c38c07e0328ec6300b2ec230824801d000c700000014082000cc09e03ccec2408ba7fc3f3784bf4d3ad2c030000418200143d208059' +
  '80093c2c901d0004480000883b200000933d0000835d0010c03a00083d208008c0096cc8fc010000418200142c19000040820008fc2000904800006d801d000c700000084182000c7f23cb7848000071801d000c7000001041820030813a00242c09ffff41820024801e030854000732' +
  '2c1900004082000c813d0014712900307c004b78901e03082c1900004082ff70baa10014800100447c0803a6382100404e800020807e01bc2c0300004d8200203d208008c0496cc44806e3a09421ffd07c0802a690010034bee1000c7c7f1b78809e01bc2c0400004182009080a40000' +
  '83a400ac8b8500048b650008380000037f7b0396834500882c1c00004182006c833d00003b0000007c18d800408000505700103a7efa002e7c17c8004182002038790028389700284803ae692c0300004182000c3b1800014bffffd07c18da142c1f0000408200087c00da145400103a' +
  '7d3a002e80090014901900143bbd00043b9cffff4bffff94bae1000c800100347c0803a6382100304e80002088040000388400012c0000004082fff44e800020380000002c0400004d8200203d20800b392918b8394000027d4903a6814900007c0a20004082002c3d408059814a3c2c' +
  '800900047d40505038000000280a00fa408000108149000c7d4a283940820010392900184200ffc84e800020380000014e8000207d8802a67c641b7838a000044bffff917d8803a67c0303784e8000209421fff07c0802a690010014906100084bf793752c0300004182001480810008' +
  '38a000044bffff5d68030001800100147c0803a6382100104e8000207d8802a67c641b7838a000024bffff397d8803a62c0000004182000838600000816100004e8000207d8802a638a000024bffff157d8803a62c0000004082000848027928386000014e8000207d8802a67c8b2378' +
  '7c641b7838a000104bfffee97d8803a67d645b782c0000004182002481290010548a103a3929ffb47c29542e3d208008c0096cc4fc0100004c8000204bf79ef47d8802a67c641b7838a000104bfffea57d8803a62c0000004d82002081290010c04900203d408008c00a6cc4fc020000' +
  '4d8000209421ffe091810024d0210008d041000c388000864bf79e993d208008c0096cc8ec000828c021000c3d208008c0496cc4fc00100040810010c0410008ec2100b2ec210024800100247c0803a6382100204e800020'
const Z_UPDATE = 0x80137494
const Z_INVULNERABLE = 0x801378b8
const Z_AIR_GRAB = 0x801378d4
const Z_AI_EXIT = 0x80137910
const Z_AI_SKIP = 0x80137938
// fn_800B1884 (a tuning float) and fn_80086C80 (damage taken) rewritten in place from zactions.s; they also hold its slots and constants.
const Z_TUNING: [number, string, string] = [0x800b1884,
  '9421ffe87c0802a6bfa1000c9001001c7c3f0b787c7d1b787c9e2378801d016c2c000000408200103d208049c029ba6848000020807d016c7fc4f37880bd01704838245dfc000890fc2000904800000481610000800b00047c0803a6bbabfff47d615b784e800020',
  '3804ffea2800000441810008480860cc8003016c2c0000004182001080a301707c030378483824783d208008c0296cc44e80002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000']
const Z_TAKEN: [number, string, string] = [0x80086c80,
  '9421ffe87c0802a6bfa1000c9001001c7c3f0b787c7e1b787c9d2378381d00867fc3f3787c0403784802abddfc0008903d208049c1a98758ec0d0028fc2000904800000481610000800b00047c0803a6bbabfff47d615b784e800020',
  '9421fff07c0802a69001001493e1000c7c7f1b78388400864802abed3d208008c0096cc8ec2008287fe3fb78480b0cf983e1000c800100147c0803a6382100104e800020000000003f80000060000000600000006000000060000000']
// fn_80085F4C (is the actor invulnerable) keeps its bit test and asks zactions.s otherwise.
const INVULNERABLE: [number, string] = [0x80085f4c, '9421fff093e1000c7c3f0b787c691b7881690304556007fe7c030378480000048161000083ebfffc7d615b784e800020']
// {site, old instruction, target}: fn_800FB944 (human input update), fn_800E07A4 (air grab), fn_80150200 and fn_80461948 (AI target), fn_8014F8BC (AI enemy choice).
const Z_HOOKS: [number, string, number][] = [
  [0x800fba50, '48000008', Z_UPDATE], [0x800e09cc, '4bfd028d', Z_AIR_GRAB], [0x80150240, '81610000', Z_AI_EXIT],
  [0x804619b0, '81610000', Z_AI_EXIT], [0x8014fa14, '4800f865', Z_AI_SKIP],
]

export const Z_VISIBLE: [number, number] = [0, 0.95]

export interface ZCharacter {
  internal: string
  seconds: number
  regen: boolean
  undetected: boolean
  untouchable: boolean
  visible: number
  costume: boolean
  damage: (number | null)[]
  taken: number | null
  lift: string | null
}

const LIFT_BITS: Record<string, number> = { light: 0, medium: 0x10, heavy: 0x20 }
const changesStats = (c: ZCharacter) => c.damage.some((v) => v !== null) || c.taken !== null || c.lift !== null

const branch = (from: number, to: number, link: boolean) => (0x48000000 | ((to - from) & 0x3fffffc) | (link ? 1 : 0)) >>> 0
const word = (v: number) => {
  const b = new Uint8Array(4)
  putU32be(b, 0, v)
  return b
}

function zTable(chars: ZCharacter[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const c of chars) {
    if (c.seconds !== 0 && !(c.seconds >= Z_SECONDS[0] && c.seconds <= Z_SECONDS[1])) throw new LabError(`a full energy bar lasts ${Z_SECONDS[0]} to ${Z_SECONDS[1]} seconds, not ${c.seconds}`)
    if (c.visible !== 1 && !(c.visible >= Z_VISIBLE[0] && c.visible <= Z_VISIBLE[1])) throw new LabError(`a faded character is ${Z_VISIBLE[0] * 100}% to ${Z_VISIBLE[1] * 100}% visible, not ${c.visible * 100}%`)
    if (c.damage.length !== 5) throw new LabError('Z-button stats need five attack damage values')
    if (c.lift !== null && !Object.hasOwn(LIFT_BITS, c.lift)) throw new LabError(`lifting strength is light, medium or heavy, not ${c.lift}`)
    const stats = changesStats(c)
    const names = encodeLatin1(entityNames(c.internal).join('\0') + '\0')
    const at = stats ? 40 : 12
    const entry = new Uint8Array(at + ((names.length + 3) & ~3))
    putF32be(entry, 0, c.seconds)
    putU32be(entry, 4, (c.regen ? 1 : 0) | (c.undetected ? 2 : 0) | (c.untouchable ? 4 : 0) | (c.costume ? 8 : 0) | (stats ? 16 : 0))
    putF32be(entry, 8, c.visible)
    if (stats) {
      c.damage.forEach((v, i) => putF32be(entry, 12 + 4 * i, v ?? -1))
      putF32be(entry, 32, c.taken ?? -1)
      putU32be(entry, 36, c.lift === null ? 0xffffffff : LIFT_BITS[c.lift])
    }
    entry.set(names, at)
    parts.push(entry)
  }
  parts.push(new Uint8Array(16))
  return concat(parts)
}

export function zActions(dol: Uint8Array, chars: ZCharacter[]): Uint8Array {
  const out = dol.slice()
  const block = fileOffset(out, BINDINGS)
  if (u32be(out, block) !== 1 || u32be(out, block + 0x48) !== 0) throw new LabError(`main.dol differs from GVLE69 at 0x${block.toString(16).toUpperCase()}`)
  const z = out.slice(block, block + BINDING)
  putU32be(z, 0x10, Z_BUTTON)
  putU32be(z, 0x48, Z_LOGICAL)
  put(out, fileOffset(out, BINDINGS + BINDING * GAME_BINDINGS), new Uint8Array(BINDING), z)
  put(out, fileOffset(out, BINDINGS_COUNT), word(GAME_BINDINGS), word(GAME_BINDINGS + 1))

  const [va, size, digest] = Z_CODE
  const at = fileOffset(out, va)
  if (toHex(sha1(out.subarray(at, at + size))) !== digest) throw new LabError(`main.dol differs from GVLE69 at 0x${at.toString(16).toUpperCase()}`)
  const code = fromHex(Z_ACTIONS_CODE)
  const table = zTable(chars)
  if (code.length + table.length > size) throw new LabError(`fn_80137494 has no room for ${chars.length} characters' Z-button actions`)
  const body = new Uint8Array(size)
  body.set(code)
  body.set(table, code.length)
  out.set(body, at)

  const [fn, old] = INVULNERABLE
  // lwz r0,0x304(r3); clrlwi. r0,r0,31; beq +12; li r3,1; blr; b invulnerable
  const next = concat([fromHex('80030304540007ff4182000c386000014e800020'), word(branch(fn + 0x14, Z_INVULNERABLE, false)), fromHex('60000000'.repeat(6))])
  put(out, fileOffset(out, fn), fromHex(old), next)
  for (const [site, instruction, target] of Z_HOOKS) put(out, fileOffset(out, site), fromHex(instruction), word(branch(site, target, true)))
  for (const [fva, before, after] of [Z_TUNING, Z_TAKEN]) put(out, fileOffset(out, fva), fromHex(before), fromHex(after))
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
