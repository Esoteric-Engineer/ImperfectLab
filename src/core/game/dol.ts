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
export const Z_ACTIONS = ['stealth', 'costume', 'stats', 'size', 'bullet', 'gun', 'laser'] as const
export type ZAction = (typeof Z_ACTIONS)[number]
export const Z_SECONDS: [number, number] = [1, 60]
export const Z_SIZE: [number, number] = [0.1, 3.0]
export const Z_SLOW: [number, number] = [0.25, 0.9]

// fn_80137494 (the AI debug display, never called in retail) rewritten from zactions.s, then its table.
const Z_CODE: [number, number, string] = [0x80137494, 0x858, '33246b517b202fa554e0792f4a66b6d4c5a84712']
const Z_ACTIONS_CODE =
  '9421ffc07c0802a690010044bea100147fbfeb78807f05b42c030000418202dc83c300e42c1e0000418202d0813f00088389004c3b600000813f000c2c090000418200088369004c4800152d3fa0800b3bbd18b8801d00007c00f000418201943bbd0018801d00007c00f00041820184' +
  '2c1c0000418202842c1b00004082027c7fc3f3784bf4e9d52c0300004082026c3b0000003c60805538632110482fd3d17c181800408002543c608055386321107f04c378482fa2757c771b78482f89dd3b1800017c03f0004082ffcc3f4080133b5a79c83aba000c801a000470090010' +
  '418200083ab5001c70090100418200083ab5000870090020418200083ab5000470090040418200083ab50004881500002c000000418201e4387700047ea4ab784803b0a12c030000418200347ea4ab78480001f57c952378387700044803b0852c030000418200187ea4ab78480001d9' +
  '38840003549a003a4bffff7cc03a00003d208008c0096cc4fc0100004182001c7fc3f3784bf4f1293d208008c0096cc4fc010000408101743fa0800b3bbd18b8380000027c0903a63d20805981293c2c801d00002c00000041820020801d00047c004850280000fa408000103bbd0018' +
  '4200ffe04800013493dd0000801a0000901d0008801a0004901d000c935d0010801e0308901d00143b200001480000842c1c0000418200707fc3f3784bf4e85d2c03000040820060c03d00083d208008c0096cc4fc0100004182003c3d208059c0493c38c07e0328ec6300b2ec230824' +
  '801d000c700000014082000cc09e03ccec2408ba7fc3f3784bf4d3852c030000418200143d20805980093c2c901d0004480000983b200000933d0000835d0010c03a00083d208008c0096cc8fc010000418200142c19000040820008fc2000904800007d801d000c700000084182000c' +
  '7f23cb7848001131801d000c7000001041820030813a00242c09ffff41820024801e0308540007322c1900004082000c813d0014712900307c004b78901e0308801d000c7000002041820008480114ed2c1900004082ff60baa10014800100447c0803a6382100404e800020807e01bc' +
  '2c0300004d8200203d208008c0496cc44806e36888040000388400012c0000004082fff44e800020380000002c0400004d8200203d20800b392918b8394000027d4903a6814900007c0a20004082002c3d408059814a3c2c800900047d40505038000000280a00fa408000108149000c' +
  '7d4a283940820010392900184200ffc84e800020380000014e8000207d8802a67c641b7838a000044bffff917d8803a67c0303784e8000209421fff07c0802a690010014906100084bf793fd2c030000418200148081000838a000044bffff5d68030001800100147c0803a638210010' +
  '4e8000207d8802a67c641b7838a000024bffff397d8803a62c0000004182000838600000816100004e8000207d8802a638a000024bffff157d8803a62c00000040820008480279b0386000014e8000205408103a38a00010280000044081002038a001003900001c2c04006841820010' +
  '390000202c04009d408200407d8802a67c8b23787c641b784bfffec17d8803a67d645b782c00000041820020812900103929000c7c29442e3d208008c0096cc4fc0100004c8000204bf79f587d8802a67c641b7838a000104bfffe817d8803a62c0000004d82002081290010c0490020' +
  '3d408008c00a6cc4fc0200004d8000209421ffe091810024d0210008d041000c388000864bf79efd3d208008c0096cc8ec000828c021000c3d208008c0496cc4fc00100040810010c0410008ec2100b2ec210024800100247c0803a6382100204e800020'
const Z_UPDATE = 0x80137494
const Z_INVULNERABLE = 0x80137830
const Z_AIR_GRAB = 0x8013784c
const Z_AI_EXIT = 0x80137888
const Z_AI_SKIP = 0x801378b0
// fn_80138868 and fn_80148B50 (only called by the AI debug display) rewritten from zactions.s's .costume and .grow.
const Z_COSTUME: [number, number, string] = [0x80138868, 0x1bc, '61e8152bdf47e9ccfa6ade46acca4702b944d154']
const Z_COSTUME_CODE =
  '9421ffd07c0802a690010034bee1000c7c7f1b78809e01bc2c0400004182009080a4000083a400ac8b8500048b650008380000037f7b0396834500882c1c00004182006c833d00003b0000007c18d800408000505700103a7efa002e7c17c80041820020387900283897002848039d81' +
  '2c0300004182000c3b1800014bffffd07c18da142c1f0000408200087c00da145400103a7d3a002e80090014901900143bbd00043b9cffff4bffff94bae1000c800100347c0803a6382100304e8000207d8802a6c02302ec7c641b7838a000404bffee957d8803a62c0000004d820020' +
  '3d208013c0092a98ec2100244e8000207d8802a63be000003d20800b392918b81c1f00187c89002e38a000404bffee592c00000041820048812401802c0900004182003c81290050c00900d0ec000072d00900d0c00900d4ec000072d00900d4c00900d8ec0000728004018c2c000000' +
  '40820008ec00102ad00900d83bff00012c1f00024180ff947d8803a64e800020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
  '3d2080548009337c812933807c004840408100083b800000480101b8'
const Z_GROW: [number, number, string] = [0x80148b50, 0x1e0, 'df1294d9c898ae4c8244d1f6ccc7d315012fa7d6']
const Z_GROW_CODE =
  '3d208014392989d839400000380000027c0903a6816900002c0b000041820028c0090004c0290010ec000072c02b0044fc000800408200107c0b20004d820020480000087d2a4b78392900184200ffc8392000002c0500004d8200207d4953794d820020908900003d608008c00b6cc8' +
  'd0090004c0040044d0090010c004004cd00900144e8000207d8802a67fc4f37838a000004bffff6d7d8803a62c0900004d820020c0290004c0490008c069000c3d408059c08a3c38ec630132ec020828fc800210fc04180040810010fc801850fc6020eeec41182ad0490004c0090010' +
  'ec0000b2d01e0044c0090014ec0000b2d01e004cc00900083d408008c02a6cc8fc0208004c820020fc0008004c82002038000000900900004e8000207d8802a67fc4f3787f25cb784bfffed97d8803a62c0900004d8200203d408008c04a6cc8fc2010902c19000041820040801a0004' +
  '700b0010395a000c41820008394a001c700b010041820008394a0008c02a0000ec011028fc0002103d408008c06a6cccec0000f2d009000cd02900084e8000207d8802a6809f00083884ff8838a000004bfffe617d8803a62c09000041820024c0290004393f000c3800000c7c0903a6' +
  'c4090004ec000072d00900004200fff4801e00b04e800020'
const Z_POSE = 0x80148ce0
const Z_RATE = 0x80138928
// fn_80132838 (the AI debug draw, which returns at once in retail) rewritten from zactions.s's .time, starting with blr.
const Z_TIME: [number, number, string] = [0x80132838, 0x274, 'f42b178c70b6270f34a756ab2f73b0dc90bf8c4f']
const Z_TIME_CODE =
  '4e8000209421ffe07c0802a690010024bfc100187c7f1b783d208008c0096cc8d00100083bc000003d20800b392918b81c1e00187c89002e38a0004048004f592c0000004182004881290010800900043949000c700b001041820008394a001c700b010041820008394a0008700b0020' +
  '41820008394a0004c02a0000c0010008fc01000040800008d02100083bde00012c1e00024180ff943d208013c0292a98c0410008c07f00303d408008c08a6cccec630132ec020828fc800210fc04180040810010fc801850fc6020eeec41182ad0492a98c03f0058ec2100b2bbc10018' +
  '800100247c0803a6382100204e800020809e0744808400283d80800c398c9534480000207c641b783d808007398c4954480000107c641b783d808007398c4d647d6802a638a0004048004e6d7d6803a67d8903a62c0000004d8204209421ffe0916100243d20805980093c3490010008' +
  'c0093c38d001000cc0493c3cd04100103d408013c02a2a98ec000824d0093c38ec420072d0493c3c3d408013c02a2a9cec000072fc00001ed80100188001001c90093c344e8004213d2080598001000890093c348001000c90093c388001001090093c3c800100247c0803a638210020' +
  '4e8000209421ffe07c0802a69001002493e1001c90610008d021000c3d208013c0492a983d208008c0296cc8fc02080041820018ec211024d02100103d208008c0496cc448005f1d80610008c021000c481f547d3d208013c0292a983d208008c0496cc8fc01100041820024c0410010' +
  'ec420828c061000cec4200f23d208013c0692aa0ec4200f248005ed983e1001c800100247c0803a6382100204e8000203f800000447a0000c1a00000'
const Z_SCALE = 0x8013283c
const Z_OWN_SLOT = 0x80132928
const Z_OWN_LOGIC = 0x8013293c
const Z_OWN_POSE = 0x8013294c
const Z_STEP = 0x801329fc
// fn_800B1884 (a tuning float: attack damage, run and sprint speed) and fn_80086C80 (damage taken) rewritten in place from zactions.s;
// they also hold its slots and constants.
const Z_TUNING: [number, string, string] = [0x800b1884,
  '9421ffe87c0802a6bfa1000c9001001c7c3f0b787c7d1b787c9e2378801d016c2c000000408200103d208049c029ba6848000020807d016c7fc4f37880bd01704838245dfc000890fc2000904800000481610000800b00047c0803a6bbabfff47d615b784e800020',
  '3804ffea2800008741810008480860448003016c2c0000004182001080a301707c030378483824783d208008c0296cc44e80002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000']
const Z_TAKEN: [number, string, string] = [0x80086c80,
  '9421ffe87c0802a6bfa1000c9001001c7c3f0b787c7e1b787c9d2378381d00867fc3f3787c0403784802abddfc0008903d208049c1a98758ec0d0028fc2000904800000481610000800b00047c0803a6bbabfff47d615b784e800020',
  '9421fff07c0802a69001001493e1000c7c7f1b78388400864802abed3d208008c0096cc8ec2008287fe3fb78480b0c9583e1000c800100147c0803a6382100104e800020000000003f80000040800000600000006000000060000000']
// fn_80085F4C (is the actor invulnerable) keeps its bit test and asks zactions.s otherwise.
const INVULNERABLE: [number, string] = [0x80085f4c, '9421fff093e1000c7c3f0b787c691b7881690304556007fe7c030378480000048161000083ebfffc7d615b784e800020']
// {site, old instruction, target}: fn_800FB944 (human input update), fn_800E07A4 (air grab), fn_80150200 and fn_80461948 (AI target),
// fn_8014F8BC (AI enemy choice), fn_801A479C (a model's bones posed from its actor's world matrix), fn_801AF790 (the time scale),
// fn_80094E04 (slot update), fn_80074814 and fn_800748A4 (actor passes), fn_80061A10 (Havok step), fn_800BD2D0 and fn_800BD3A8 (state timers).
const Z_HOOKS: [number, string, number][] = [
  [0x800fba50, '48000008', Z_UPDATE], [0x800e09cc, '4bfd028d', Z_AIR_GRAB], [0x80150240, '81610000', Z_AI_EXIT],
  [0x804619b0, '81610000', Z_AI_EXIT], [0x8014fa14, '4800f865', Z_AI_SKIP], [0x801a483c, '801e00b0', Z_POSE],
  [0x801afb8c, '48285ac5', Z_SCALE], [0x80094e88, '480246ad', Z_OWN_SLOT], [0x8007487c, '480000d9', Z_OWN_LOGIC],
  [0x800748f8, '4800046d', Z_OWN_POSE], [0x80061af0, '482c63d5', Z_STEP], [0x800bd30c, '4bfc86f9', Z_RATE], [0x800bd3e4, '4bfc8621', Z_RATE],
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
  staged?: boolean
  damage: (number | null)[]
  taken: number | null
  lift: string | null
  run: number | null
  sprint: number | null
  size: number | null
  slow: number | null
  gun: boolean
  laser?: boolean
}

const LIFT_BITS: Record<string, number> = { light: 0, medium: 0x10, heavy: 0x20 }
const changesStats = (c: ZCharacter) => c.damage.some((v) => v !== null) || c.taken !== null || c.lift !== null || c.run !== null || c.sprint !== null

const branch = (from: number, to: number, link: boolean) => (0x48000000 | ((to - from) & 0x3fffffc) | (link ? 1 : 0)) >>> 0
const word = (v: number) => {
  const b = new Uint8Array(4)
  putU32be(b, 0, v)
  return b
}

function unchanged(dol: Uint8Array, [va, size, digest]: [number, number, string]): number {
  const at = fileOffset(dol, va)
  if (toHex(sha1(dol.subarray(at, at + size))) !== digest) throw new LabError(`main.dol differs from GVLE69 at 0x${at.toString(16).toUpperCase()}`)
  return at
}

function zTable(chars: ZCharacter[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const c of chars) {
    if (c.seconds !== 0 && !(c.seconds >= Z_SECONDS[0] && c.seconds <= Z_SECONDS[1])) throw new LabError(`a full energy bar lasts ${Z_SECONDS[0]} to ${Z_SECONDS[1]} seconds, not ${c.seconds}`)
    if (c.visible !== 1 && !(c.visible >= Z_VISIBLE[0] && c.visible <= Z_VISIBLE[1])) throw new LabError(`a faded character is ${Z_VISIBLE[0] * 100}% to ${Z_VISIBLE[1] * 100}% visible, not ${c.visible * 100}%`)
    if (c.damage.length !== 5) throw new LabError('Z-button stats need five attack damage values')
    if (c.lift !== null && !Object.hasOwn(LIFT_BITS, c.lift)) throw new LabError(`lifting strength is light, medium or heavy, not ${c.lift}`)
    for (const v of [c.run, c.sprint]) if (v !== null && !(v > 0)) throw new LabError(`a Z run or sprint speed is above 0, not ${v}`)
    if (c.size !== null && !(c.size >= Z_SIZE[0] && c.size <= Z_SIZE[1])) throw new LabError(`a Z size is ${Z_SIZE[0]} to ${Z_SIZE[1]} times the character's, not ${c.size}`)
    if (c.slow !== null && !(c.slow >= Z_SLOW[0] && c.slow <= Z_SLOW[1])) throw new LabError(`Bullet Time's world speed is ${Z_SLOW[0] * 100}% to ${Z_SLOW[1] * 100}%, not ${c.slow * 100}%`)
    const stats = changesStats(c)
    const speeds = c.run !== null || c.sprint !== null
    const names = encodeLatin1(entityNames(c.internal).join('\0') + '\0')
    const at = (stats ? 40 : 12) + (speeds ? 8 : 0) + (c.size !== null ? 4 : 0) + (c.slow !== null ? 4 : 0)
    const entry = new Uint8Array(at + ((names.length + 3) & ~3))
    putF32be(entry, 0, c.seconds)
    putU32be(entry, 4, (c.regen ? 1 : 0) | (c.undetected ? 2 : 0) | (c.untouchable ? 4 : 0) | (c.costume ? (c.staged ? 512 : 8) : 0) | (stats ? 16 : 0) | (c.size !== null ? 32 : 0) | (c.slow !== null ? 64 : 0) | (c.gun ? 128 : 0) | (speeds ? 256 : 0) | (c.laser ? LASER_FLAG : 0))
    putF32be(entry, 8, c.visible)
    if (stats) {
      c.damage.forEach((v, i) => putF32be(entry, 12 + 4 * i, v ?? -1))
      putF32be(entry, 32, c.taken ?? -1)
      putU32be(entry, 36, c.lift === null ? 0xffffffff : LIFT_BITS[c.lift])
    }
    if (speeds) {
      putF32be(entry, 40, c.run ?? -1)
      putF32be(entry, 44, c.sprint ?? -1)
    }
    if (c.size !== null) putF32be(entry, at - (c.slow !== null ? 8 : 4), c.size)
    if (c.slow !== null) putF32be(entry, at - 4, c.slow)
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

  const code = fromHex(Z_ACTIONS_CODE)
  const table = zTable(chars)
  if (code.length + table.length > Z_CODE[1]) throw new LabError(`fn_80137494 has no room for ${chars.length} characters' Z-button actions`)
  const body = new Uint8Array(Z_CODE[1])
  body.set(code)
  body.set(table, code.length)
  out.set(body, unchanged(out, Z_CODE))
  for (const [fn, hex] of [[Z_COSTUME, Z_COSTUME_CODE], [Z_GROW, Z_GROW_CODE], [Z_TIME, Z_TIME_CODE]] as const) {
    const more = new Uint8Array(fn[1])
    more.set(fromHex(hex))
    out.set(more, unchanged(out, fn))
  }

  const [fn, old] = INVULNERABLE
  // lwz r0,0x304(r3); clrlwi. r0,r0,31; beq +12; li r3,1; blr; b invulnerable
  const next = concat([fromHex('80030304540007ff4182000c386000014e800020'), word(branch(fn + 0x14, Z_INVULNERABLE, false)), fromHex('60000000'.repeat(6))])
  put(out, fileOffset(out, fn), fromHex(old), next)
  for (const [site, instruction, target] of Z_HOOKS) put(out, fileOffset(out, site), fromHex(instruction), word(branch(site, target, true)))
  for (const [fva, before, after] of [Z_TUNING, Z_TAKEN]) put(out, fileOffset(out, fva), fromHex(before), fromHex(after))
  return out
}

// gun.s, in a text section of its own where the arena started (the arena then starts after it), then its table.
const GUN_CODE =
  '9421ffb07c0802a690010054bec10020dbe1004883bf00087fdcf3783d80801a398cd5e07d8903a64e800421480009d9389dff887c9d2378480009917d3b4b79418201c87d785b78813c000088090009895b00037c005040418001b0835c0064881b0000540030327f3a0214' +
  '7fa4eb7838a000803d808013398c77cc7d8903a64e8004217c170378480014a93bebffc43d20805980693c2c80180010907800107c6018502803006440810008386000643c004330900100189061001cc8210018c81f0028fc210028fc200818c01b006cec210032c058000c' +
  '2c1700004182001cec42082ac01f0010fc02004040810020fc40009048000018ec420828c01f0000fc02004040800008fc400090d058000cecc2102a3ae00000c01f000cfc020040418000103ae00001c01f0018ecc03028ece6302ac01f001cece03828ed0601b2efe801f2' +
  '7f23cb78389b001888bb000254a530327cba2a14480000c9c01f0000fc1f0040408100147f83e3787f64db787f25cb78480009d12c17000041820070893b0001552930327d3a4a143929fffc3959fffc380000107c0903a684090004940a00044200fff88adb0007281600ff' +
  '4182003c56c330327c7a1a14389b00e088bb000254a530327cba2a1448000055807c00a856c020367c630214389b011056c530327cba2a14480000e5807c00a8881b0000540020367c630214389b000c7f25cb78480000c9cbe10048bac10020800100547c0803a638210050' +
  '4e8000207ca92b787c8a23787c6b1b78380000047c0903a6c02a0000c04a0004c06a0008c0090000ec810032c0090010ec82203ac0090020ec83203ac0090004eca10032c0090014eca2283ac0090024eca3283ac0090008ecc10032c0090018ecc2303ac0090028ecc3303a' +
  '4240001cd08b0000d0ab0004d0cb0008394a000c396b00104bffff94c0090030ec84002ac0090034eca5002ac0090038ecc6002ad08b0000d0ab0004d0cb00084e800020c0240000c0440004c0640008394000007c05542eec810032396a00107c055c2eec82203a396a0020' +
  '7c055c2eec83203a396a00307c055c2eec84002a7c83552e394a00042c0a000c4180ffc84e8000202c0500004082002428040005418201602804001341820158280400224180000c2804002540810148280400604180001028040063408100384800010c2804002741800104' +
  '28040040418100fc2804002e418200f428040036418200ec2804003a418200e42804003d418200dc9421ffc07c0802a690010044bfa10034906100089081000c90a1001090c10014d0210018d041001cd061002048000651808100084800060d7d3f4b794182007080810008' +
  '38a000803d808013398c77cc7d8903a64e8004212c000000418200503bc0014e8001000c2800003640810018280000604182001028000061418200083bc0014f80610008480000d92c0300003860ffff4182005880810008480005a58001000c900b000893c1000c80610008' +
  '8081000c80a1001080c10014c0210018c041001cc0610020bba10034800100447c0803a6382100409421ffb83d808009398c7cec7d8903a64e800420bba10034800100447c0803a6382100404e8000209421ffc07c0802a690010044bfa10034906100089081000c90a10010' +
  '90c10014d0210018d041001cd06100207c641b78480005112c0900004182ff7480610008480004ed480004d14082ff643860ffff800100447c0803a6382100404e8000209421ffe07c0802a690010024bfc100187c7f1b787c641b78480004c97d3e4b78c00b000c3c003f80' +
  '90010008c0210008fc00080038600000408200447fe3fb78c03e00083d808008398c4b687d8903a64e8004212c03000038600000418200207fe3fb78c03e00083d808008398c4a607d8903a64e80042138600001bbc10018800100247c0803a6382100204e80002028040001' +
  '418001b028040002418101a89421ffe07c0802a690010024bf8100107c7f1b787c9c2378480004657fe3fb783d80800d398cc5e07d8903a64e8004217c7e1b787c641b78480004097d3d4b794182014c93eb00147fc4f37838a000803d808013398c77cc7d8903a64e800421' +
  '2c000000418201282c1c0001418201087fc3f378480003b94800039d418200f82c03014f418200f0881d000470000001418200247fe3fb78388000013d80800d398cc1487d8903a64e8004212c030000408200187fe3fb787f84e378480000fd2c030000418200b0881f0008' +
  '280000024180009c28000004418100947fe3fb783d80800d398cda207d8903a64e8004212c030000408200787fc3f3784bfffe652c030000418200707fc4f3784800033538000000900b000848000e917d695b787fc3f378881f00083880014e280000024182001438800151' +
  '28000003418200083880015038a0000038c00000c029fff4c049fff8c069fffc3d808009398c7ce87d8903a64e8004214800000c386000014800000838600000bb810010800100247c0803a6382100204e8000207fe3fb787f84e378bb810010800100247c0803a638210020' +
  '9421ffe03d80800d398cc0c07d8903a64e8004209421ffe03d80800d398cc0c07d8903a64e8004202c050004408200fc8803000828000002418000f028000004418100e89421ffd07c0802a690010034bfc10028906100089081000c90a1001090c1001490e100187c7f1b78' +
  '4800026d7fe3fb783d80800d398cc5e07d8903a64e8004217c7e1b787c641b78480002112c090000418200707fc3f378480001ed480001d14082006038000056981f040938000000981f040a901f041438000003981f040b38000015981f040c7fe3fb783880000038a00000' +
  '38c0000138e000003d80800f398c0c707d8903a64e800421bbc10028800100347c0803a6382100304e800020806100088081000c80a1001080c1001480e10018bbc10028800100347c0803a6382100309421ffd03d80800d398cdf887d8903a64e8004209421ffe07c0802a6' +
  '9001002493e1001c906100089081000c7c7f1b787c641b78480001412c09000041820048812b00142c0900004182003c88090008280000024180003028000004418100287fe3fb78480000fd480000e14082001883e1001c800100247c0803a6382100204e80002080610008' +
  '8081000c83e1001c800100247c0803a6382100209421ffe83d80800a398caecc7d8903a64e8004203804ffff2c00005641820024386000002c0000004d800020386000032c0000034d8100207c0303784e8000203800000090030414386000564e8000209421fff07c0802a6' +
  '9001001493e1000c7c7f1b78480000612c03014e4182000c2c03014f408200247fe4fb784800005d2c09000041820014800b00082c000000418200087c03037883e1000c800100147c0803a6382100104e8000202c03014e4d8200202c0301504d8200202c0301514e800020' +
  '9421fff03d80800a398cb0507d8903a64e8004207d4802a648000b657d4803a6396b0004380000047c0903a6812b00007c0920004082000c812b00044e800020396b00184200ffe8392000004e8000209421ffd07c0802a690010034bf21001448000b1d7d7f5b783d208059' +
  '80093c2c813f00007c00480041820104901f00003bc000002c1e0004408000f41f9e00187f9cfa143b2000003b4000003c608055386321103d808043398c49007d8903a64e8004217c1e1800408000983c608055386321107fc4f3783d808043398c17bc7d8903a64e800421' +
  '7c7d1b783d808043398cff2c7d8903a64e8004217c791b78837f00643b5f00682c1b000040810050387d0004389a00a03d808017398c26547d8903a64e8004212c03000041820034387d0004389a00c03d808017398c26547d8903a64e8004212c030000418200143b5a0120' +
  '3b7bffff4bffffb03b400000801c00047c00c8004182001438000000901c000c901c0010901c0014933c0004935c00083bde00014bffff0cbb210014800100347c0803a6382100304e8000209421fe807c0802a690010184bee1015083a30064838300a87c9e23787cbb2b78' +
  '8b5e000338610010389e004888be000554a530327cbd2a14480004c538610020389e005488be000654a530327cbd2a14480004ad38610030389e006088be000154a530327cbd2a144800049538610040389e00607f65db7848000485386100403881004038a10030480004c1' +
  '386100403881003038a10040fc20f890480004d1386100503881002038a100104800049d3881005048000505d0210108386100603881003038a100204800048138810060480004e9d021010c386100603881004038a1001048000465386100703881006048000531c01f0020' +
  'fc0100404081023cc0410108c061010cec821828fc802210ec84002aeca2182aeca50028fc01204040800008fc202090fc01284040810008fc202890d02101103881005038a1007048000451fc200850386100803881005038a10070480004193861008038810080480004c1' +
  'c01f0020fc010040408101ccc0410108c061010cc0810110eca200b2eca4293aeca328fcecc20132ecc6302aeca53024c0ff0010fc05384040810008fca03890fd003850fc05404040800008fca04090d0a10114ecc5397cc03f0000c01f0024fc06004040810044fd203034' +
  'c19f000cc1bf0014ed690272ed6b01b2ed6b6b3ced2902f2ed690272ed6b01b2ed6b6b3ced2902f2ed690272ed6b01b2ed6b6b3ced2902f2ec260272ec2100b2d0210118c0210114ec2100b2386100903881001038a1007048000345c0210118386100903881009038a10080' +
  '48000331c0210110386100a03881001038a100704800031d386100b038810050480003c5386100c03881009038a10010480002dd386100c0388100c0480003a9386100d0388100b038a100c04800066d386100e0388100d04800048d7fa3eb78389e007038a100e038c10010' +
  '7f47d3787f88e3784800018d386100303881003038a100e038c10010480003e1386100b03881003038a1009048000275386100b0388100b048000341386100c0388100a038a1009048000259386100c0388100c048000325386100d0388100b038a100c0480005e9386100e0' +
  '388100d0480004097fa3eb78389e008038a100e038c100907f47d3787f88e37848000109893e0001552930327efd4a1438c0000038e000007c37342e7c5b3c2eec6100b2390600107c37442e392700107c5b4c2eec6118ba390600207c37442e392700207c5b4c2eec6118ba' +
  '1d4600037d4a3a14394a01207c61552e38e700042c07000c4180ffb438c600042c06000c4180ffa4386100d0388101204800040dc0230000c0430004c0630008c083000cc01f0010eca0f828ec212ffaec4207f2ec6307f2ec8407f2d0230000d0430004d0630008d083000c' +
  '48000559386100e0388100d04800032938610030389e00607ee5bb78480000f57fa3eb78389e009038a100e038c100307f47d3787f88e37848000019bae10150800101847c0803a6382101804e8000209421ffc07c0802a690010044bec100107c781b787c9923787cba2b78' +
  '7cdb33787cfc3b787d1d43783bc000007c1ee0004080007c57c9e8fe7d3948ae57ca077e7d295430712900014182005c57c930327ef84a143ac000007c77b2147c641b787f45d37838df0000480002013ad600102c1600304180ffe4387700307c641b787f45d3787f66db78' +
  '480001e157c920367c7d4a147c641b787f45d3787f66db78480001c93bde00014bffff84bac10010800100447c0803a6382100404e800020c0240000c0440004c064000838c0000038e600307c053c2e7c85342eec81013a38e600107c053c2eec82203a38e600207c053c2e' +
  'ec83203a7c83352e38c600042c06000c4180ffcc4e80002038c000007c04342e7c45342eec0010287c03352e38c600042c06000c4180ffe84e80002038c000007c05342e7c44342eec01103a7c03352e38c600042c06000c4180ffe84e800020c0240000c0050000ec210032' +
  'c0440004c0050004ec22083ac0440008c0050008ec22083a4e8000207c8523787d4802a64bffffd17d4803a6c01f0024fc0100404181000cc03f00004e800020fc400834c19f000cc1bf0014ed6200b2ed6b0072ed6b6b3cec4202f2ed6200b2ed6b0072ed6b6b3cec4202f2' +
  'ed6200b2ed6b0072ed6b6b3cec4202f2ec2100b24e8000207c8523787d4802a64bffff697d4803a6c01f0024fc0100404181000cc03f00004e800020fc400834c19f000cc1bf0014ed6200b2ed6b0072ed6b6b3cec4202f2ed6200b2ed6b0072ed6b6b3cec4202f2ed6200b2' +
  'ed6b0072ed6b6b3cec4202f2ec2100b238c000007c04342eec0000b27c03352e38c600042c06000c4180ffec4e800020c1460000c1660004c1860008c0240000ec215028c0440004ec425828c0640008ec636028c0050000ec81503ac005000cec82203ac0050018ec83203a' +
  'c0050004eca1583ac0050010eca2283ac005001ceca3283ac0050008ecc1603ac0050014ecc2303ac0050020ecc3303ad0830000d0a30004d0c300084e800020c0240000c0440004c0640008c084000ceca2102aecc3182aece4202aed020172ed2301b2ed4401f2c01f0010' +
  'ed69502aed605828d1630000ed68502aed605828d1630010ed68482aed605828d1630020ed0201b2ed2101f2ed68482ad1630004ed684828d163000ced0201f2ed2101b2ed684828d1630008ed68482ad1630018ed0301f2ed210172ed68482ad1630014ed684828d163001c' +
  '4e800020c0240000c0440010c0640020c01f0010ec80082aec84102aec84182aeca0082aeca51028eca51828ecc00828ecc6102aecc61828ece00828ece71028ece7182ac0240014c044001ced011028ed21102ac0240018c0440008ed411028ed61102ac0240004c044000c' +
  'ed811028eda1102a38c00000fc202090fc0508404081000c38c00001fc202890fc0608404081000c38c00002fc203090fc0708404081000838c000032c06000040820018d0830000d1030004d1430008d183000c4800004c2c06000140820018d1030000d0a30004d1a30008' +
  'd163000c480000302c06000240820018d1430000d1a30004d0c30008d123000c48000014d1830000d1630004d1230008d0e3000cc0230000c01f0000fc0100404080007438c000007c23342efc2008507c23352e38c600042c0600104180ffec48000054c0240000c0440004' +
  'c0640008c0850000c0a50004c0c50008c01f0010ece1013aece2397aece339bad0e30000ec0201b2ec03017cd0030004ec030132ec0101bcd0030008ec010172ec02013cd003000cc0230000c0430004c0630008c083000ceca10072eca228baeca328faeca4293ac01f0024' +
  'fc05004041810020c03f0010c05f0000d0230000d0430004d0430008d043000c4e800020fcc02834c19f000cc1bf0014ed6601b2ed6b0172ed6b6b3cecc602f2ed6601b2ed6b0172ed6b6b3cecc602f2ed6601b2ed6b0172ed6b6b3cecc602f2ec2101b2ec4201b2ec6301b2' +
  'ec8401b2d0230000d0430004d0630008d083000c4e8000207c0802a6429f00057d6802a67c0803a6396b004c4e8000200000000000000000000000003f0000003f8000003fc00000400000004040000038d1b7172b8cbccc433000000000000041f0000040f00000bf800000'
export const GUN_POSE = 0, GUN_PLAY = 0x31c, GUN_PRESSED = 0x578, GUN_EVENT = 0x754, GUN_STOP = 0x868, GUN_PICK = 0x904, GUN_MOTION = 0x940,
  GUN_DATA = 0x1584
const GUN_PLAYERS = 4
// {actor, entry, the attack its shot plays for, draw progress, clock, controller} per player, then the count and the entries
export const GUN_COUNT = 4 + 24 * GUN_PLAYERS, GUN_ENTRIES = GUN_COUNT + 4
export const GUN_ENTRY_SIZE = 0x120
// fn_801A479C's bl fn_8019D5E0, and the first instructions of fn_80097CE8, fn_800CC0BC, fn_8009B04C, fn_800CDF84 and fn_8009AEC8.
const GUN_POSE_SITE: [number, string] = [0x801a4a08, '4bff8bd9']
const GUN_PLAY_SITE: [number, string] = [0x80097ce8, '9421ffb8']
const GUN_PRESSED_SITE: [number, string] = [0x800cc0bc, '9421ffe0']
const GUN_MOTION_SITE: [number, string] = [0x8009b04c, '9421fff0']
const GUN_EVENT_SITE: [number, string] = [0x800cdf84, '9421ffd0']
const GUN_STOP_SITE: [number, string] = [0x8009aec8, '9421ffe8']
// fn_800E1788's event 0x4E (the projectile pick) asks gun_pick instead.
const GUN_PICK_SITE: [number, string] = [0x800e1efc, '813f00103809ffff2c0000004180001c813f00103809ffff2c00000340810008380000034800000838000000']
// Event 0x4E with this value picks tuning field 176 (90 + 86), which no character sets, for the bullet.
export const GUN_PICK_VALUE = 87
export const GUN_FIELD = 176
// The shots standing, in the air, running and walking.
export const GUN_MOTIONS = { ground: 'action1', air: 'action2', run: 'action3', walk: 'action4' }

export interface GunCharacter {
  internal: string
  bone: number
  hand: number
  anchor: number
  nodes: number
  automatic: boolean
  energy: number
  bind: [number, number, number]
  k: number[] // 4x3 row-vector transform from the anchor's skin matrix to the gun's
  swap: { bone: number; bind: [number, number, number]; k: number[] } | null
  upper: number
  fore: number
  arm: [number, number, number][]
  draw: number
  moves: number[][]
}

export const GUN_DRAW = 0.3

function gunTable(guns: GunCharacter[]): Uint8Array {
  const out = new Uint8Array(GUN_ENTRIES + GUN_ENTRY_SIZE * guns.length)
  putU32be(out, GUN_COUNT, guns.length)
  guns.forEach((g, i) => {
    const o = GUN_ENTRIES + GUN_ENTRY_SIZE * i
    if (g.k.length !== 12 || (g.swap && g.swap.k.length !== 12)) throw new LabError('a gun holster is a 4x3 matrix')
    if (g.arm.length !== 3 || g.moves.length !== 3) throw new LabError("a gun's arm is an upper arm, forearm and hand")
    if (g.moves.some((bones) => bones.some((b) => b >= 128))) throw new LabError("the gun's arm has a bone past the 128 a reach can move")
    out.set([g.bone, g.hand, g.anchor, g.nodes, g.automatic ? 1 : 0, g.upper, g.fore, g.swap?.bone ?? 0xff], o)
    putF32be(out, o + 8, g.energy)
    g.bind.forEach((v, j) => putF32be(out, o + 0xc + 4 * j, v))
    g.k.forEach((v, j) => putF32be(out, o + 0x18 + 4 * j, v))
    g.arm.flat().forEach((v, j) => putF32be(out, o + 0x48 + 4 * j, v))
    putF32be(out, o + 0x6c, 1 / (1000 * g.draw))
    g.moves.forEach((bones, j) => bones.forEach((b) => { out[o + 0x70 + 0x10 * j + (b >> 3)] |= 1 << (b & 7) }))
    entityNames(g.internal).forEach((name, j) => out.set(field(name), o + 0xa0 + 0x20 * j))
    if (g.swap) {
      g.swap.k.forEach((v, j) => putF32be(out, o + 0xe0 + 4 * j, v))
      g.swap.bind.forEach((v, j) => putF32be(out, o + 0x110 + 4 * j, v))
    }
  })
  return out
}

// Needs zActions first: the gun is drawn while the character's Z slot is live (gun.s calls its stealth_test).
// body in a new text section where the arena started, which then starts after it.
function textSection(dol: Uint8Array, body: Uint8Array): [Uint8Array, number] {
  const slot = (() => {
    for (let i = 2; i < 7; i++) if (!u32be(dol, 0x90 + 4 * i)) return i
    throw new LabError('main.dol has no free text section')
  })()
  const size = (body.length + 0x1f) & ~0x1f
  const lo = arenaLo(dol)
  const at = (dol.length + 0x1f) & ~0x1f
  const out = new Uint8Array(at + size)
  out.set(dol)
  out.set(body, at)
  putU32be(out, 4 * slot, at)
  putU32be(out, 0x48 + 4 * slot, lo)
  putU32be(out, 0x90 + 4 * slot, size)
  for (const [lis, addi] of ARENA_REFS) retarget(out, lis, addi, address(out, lis, addi), lo + size)
  return [out, lo]
}

export function gun(dol: Uint8Array, guns: GunCharacter[]): Uint8Array {
  if (guns.length > GUN_PLAYERS) throw new LabError(`main.dol has room for ${GUN_PLAYERS} characters' guns, not ${guns.length}`)
  const [out, lo] = textSection(dol, concat([fromHex(GUN_CODE), gunTable(guns)]))
  const [pose, poseOld] = GUN_POSE_SITE
  put(out, fileOffset(out, pose), fromHex(poseOld), word(branch(pose, lo + GUN_POSE, true)))
  for (const [[site, old], to] of [[GUN_PLAY_SITE, GUN_PLAY], [GUN_PRESSED_SITE, GUN_PRESSED], [GUN_MOTION_SITE, GUN_MOTION], [GUN_EVENT_SITE, GUN_EVENT],
    [GUN_STOP_SITE, GUN_STOP]] as const) {
    put(out, fileOffset(out, site), fromHex(old), word(branch(site, lo + to, false)))
  }
  const [pick, pickOld] = GUN_PICK_SITE
  const next = concat([fromHex('7e639b78809f0010'), word(branch(pick + 8, lo + GUN_PICK, true)), fromHex('7c601b784800001c'), fromHex('60000000'.repeat(6))])
  put(out, fileOffset(out, pick), fromHex(pickOld), next)
  return out
}

// health.s, in a text section of its own like the gun's, then its table: each player's costume shows its damage stage.
const HEALTH_CODE =
  '9421ffc07c0802a690010044bee1001c480003297d7f5b783d20805980093c2c813f00007c00480041820164901f00003bc000002c1e00044080015457dc20367f9cfa143b9c00043b2000003b4000003b6000003c608055386321103d808043398c49007d8903a64e800421' +
  '7c1e1800408000a03c608055386321107fc4f3783d808043398c17bc7d8903a64e8004217c7d1b783d808043398cff2c7d8903a64e8004217c791b7941820068837901bc831f00443b5f00482c18000040810050387d0004389a00103d808017398c26547d8903a64e800421' +
  '2c03000041820034387d0004389a00303d808017398c26547d8903a64e8004212c030000418200143b5a00503b18ffff4bffffb03b400000801c00007c00c8004082001c801c00047c00d80040820010801c00087c00d00041820018933c0000937c0004935c00083800ffff' +
  '901c000c2c1a0000418200382c1b0000418200307f23cb787f44d37848000045801c000c7c00180041820018907c000c7c641b787f63db7888ba000e480000d93bde00014bfffeacbae1001c800100447c0803a6382100407fc3f3784e8000209421ffe07c0802a690010024' +
  '93e1001c93c100187c7f1b787c9e2378881e000d2c0000ff4182002c7fe4fb7838a002003d808013398c77cc7d8903a64e8004212c0000004182000c887e000d48000050887e000cc03f031cc05f0320ec021028fc02000040810038ec211024392000007fcaf378c06a0000' +
  'fc01180041810010887e000c7c634a143863000139290001394a00042c0900034180ffdc83c1001883e1001c800100247c0803a6382100204e8000209421ffd07c0802a690010034bec100087c9623788123000083a300ac8b8900048b690008834900882c050000418200a0' +
  '7c162800408000987c1b2b967d4029d67c0ad800408200887c1b0379418200807ed6d9d62c1c000041820074833d00002c1900004182005c3b0000007c18d800408000505700103a7efa002e7c17c8004182002c38790028389700283d808017398c26547d8903a64e800421' +
  '2c0300004182000c3b1800014bffffc47c18b2145400103a7d3a002e80090014901900143bbd00043b9cffff4bffff8cbac10008800100347c0803a6382100304e8000207c0802a6429f00057d6802a67c0803a6396b00104e800020'
export const HEALTH_POSE = 0, HEALTH_DATA = 0x350
const HEALTH_PLAYERS = 4
// The clock, then {actor, model instance, entry, block shown} per player, then the count and the entries.
export const HEALTH_COUNT = 4 + 16 * HEALTH_PLAYERS, HEALTH_ENTRIES = HEALTH_COUNT + 4
export const HEALTH_ENTRY_SIZE = 0x50
export const HEALTH_STAGES = 3
// fn_801A479C's mr r3, r30, after the model's frame stamp and before the bones are posed.
const HEALTH_SITE: [number, string] = [0x801a4814, '7fc3f378']

export interface HealthCharacter {
  internal: string
  stages: number[] // falling fractions of max health
  kept: number // the untouched copies' block
  z: number | null
}

function healthTable(chars: HealthCharacter[]): Uint8Array {
  const out = new Uint8Array(HEALTH_ENTRIES + HEALTH_ENTRY_SIZE * chars.length)
  putU32be(out, HEALTH_COUNT, chars.length)
  chars.forEach((c, i) => {
    const o = HEALTH_ENTRIES + HEALTH_ENTRY_SIZE * i
    if (!c.stages.length || c.stages.length > HEALTH_STAGES) throw new LabError(`a costume has 1 to ${HEALTH_STAGES} damage stages, not ${c.stages.length}`)
    c.stages.forEach((v, j) => {
      if (!(v > 0 && v < 1) || (j && !(v < c.stages[j - 1]))) throw new LabError('damage stages start below full health and fall')
    })
    if (c.kept < 1 || (c.z !== null && (c.z < 1 || c.z >= c.kept))) throw new LabError("a costume's Z twins come after its own materials and before the untouched copies")
    for (let j = 0; j < HEALTH_STAGES; j++) putF32be(out, o + 4 * j, c.stages[j] ?? -1)
    out.set([c.kept, c.z ?? 0xff, c.kept + 1 + c.stages.length], o + 0xc)
    entityNames(c.internal).forEach((name, j) => out.set(field(name), o + 0x10 + 0x20 * j))
  })
  return out
}

// A character with Z twins needs zActions first: its stage gives way to them while Z holds them.
export function health(dol: Uint8Array, chars: HealthCharacter[]): Uint8Array {
  if (!chars.length || chars.length > MAX_NEW) throw new LabError(`main.dol has room for 1 to ${MAX_NEW} characters' damage stages, not ${chars.length}`)
  const zCode = fromHex(Z_ACTIONS_CODE), zAt = fileOffset(dol, Z_CODE[0])
  if (chars.some((c) => c.z !== null) && !equal(dol.subarray(zAt, zAt + zCode.length), zCode)) {
    throw new LabError('a damaged Z costume needs the Z-button actions in main.dol first')
  }
  const [out, lo] = textSection(dol, concat([fromHex(HEALTH_CODE), healthTable(chars)]))
  const [site, old] = HEALTH_SITE
  put(out, fileOffset(out, site), fromHex(old), word(branch(site, lo + HEALTH_POSE, true)))
  return out
}

const LASER_CODE =
  '9421ffe07c0802a69001002493e1001c93c100187c7f1b784800002d7c7e1b787fe3fb78480002457fc3f37883c1001883e1001c800100247c0803a6382100204e8000209421ffd03d808007398c49587d8903a64e8004209421ffe07c0802a69001002493e1001c93c100187c7f1b78' +
  '7c9e23784800007dd02100082c1e000040820054809f00e4480009352c09000041820044809f00e438a004003d808013398c77cc7d8903a64e8004212c00000041820024881f00082800000241800018280000044181001048000b49c02bffc848000008c021000883c1001883e1001c' +
  '800100247c0803a6382100204e8000209421ffd83d80800d398cc1d87d8903a64e8004209421ffd07c0802a690010034bfa10024dbe100187c7f1b783d808040398c85c87d8903a64e800421ffe0089048000ae13bcbffc83bab0004c03f019cc01e000cfc01004041800104fc40081e' +
  'd84100088001000c3d2043309121001090010014c8610010c89e0030fc632028fc601818ec211828c01e0024ec210028fc200a10c01e0028fc010040408000c0380000047c0903a6801d00087000000141820040c03f0020c01d0020ec210028ec410072c03f0024c01d0024ec210028' +
  'ec41107ac03f0028c01d0028ec210028ec41107ac01e002cfc020040418000103bbd00404200ffb44800006438000000901f01dc901f00e0c03d0014c05d0018c01e0000c07e000cd03f0130d05f0134d01f0138fc800850d05f00e4d09f00e8d01f00ecd03f00f4d05f00f8d01f00fc' +
  'd01f0104d01f0108d07f010cc03d000cfc1f084040810008ffe00890fc20f890cbe10018bba10024800100347c0803a6382100304e8000209421ff007c0802a690010104bf0100c0dbe100e07c7f1b78480007857fe4fb78480007357d3d4b79418205b07d7e5b78480009793b8bffc8' +
  '7fe4fb7838a004003d808013398c77cc7d8903a64e8004217c1b0378801f030470000100418200083b600000835f03dc2c1a00004082000c3b60000048000014881a000828000002418200083b6000002c1b000040820064801e000870090001418205405400003c901e00087fe3fb78' +
  '389d00607000000241820008389d008038a000003d808039398c3a607d8903a64e8004212c03000041820508812300c8a80901b8818901bc7c6302147d8903a64e800421480004ec7f43d3783880000038a100204bfffd8dc01c0014fc0100404081011cc01c0000d001002838610020' +
  '7c641b7848000801c01c0010fc010040408100fcc01f0088d0010090c01f008cd0010094c01c0000d0010098386100907c641b78480007d1c01c0010fc010040408100cc3d208059c0e93c38c01d0010ece70032c01c0020fc07004040810008fce00090c0210090c0410094c0610020' +
  'c0810024eca100f2eca2293aecc10132ecc230fced0701f2c01c0004c13c000ced08483cfc0540404180000c388100204800003cc01c0000fc06004040800008fce03850ed210232ed2249fced4101f2ed42523ad1210090d1410094386100907c641b7848000731388100907c992378' +
  '7fe3fb783d808006398ca9b87d8903a64e800421c0190000d01a0440c0190004d01a0444c0190008d01a04487fe3fb783d80800a398cad807d8903a64e8004217c781b787fe3fb783d80800b398c16687d8903a64e8004217c671b787f03c3783880004338a0000038de00203d80801a' +
  '398c51047d8903a64e8004212c03000040820024c01f00a8d01e0020c01f00acd01e0024c01f00b0c03c001cec00082ad01e0028c01f0088d01e0014c01f008cd01e0018c01c0000d01e001c387e00147c641b7848000661386100403d808043398c4db47d8903a64e8004217fe3fb78' +
  '3d80800b398c24ac7d8903a64e8004217c671b78387e0020389e0014c03d000038a0200038c100403900000039200000394000003d808005398ca7587d8903a64e8004213b600000c01d0000d01e000c2c03000041820050386100403d808043398c4e0c7d8903a64e800421c01c0000' +
  'fc01004040800008fc200090c01d0000fc01004040800008d03e000c386100403d808005398c8a747d8903a64e8004217c7b1b78801e0008700900014082006060000001901e0008c01d0008d01e00107fe3fb78389d00607000000241820008389d008038a000ff38c000ff3d808039' +
  '398c3d0c7d8903a64e8004212c0300004182001c812300c8a80901c8818901cc7c6302147d8903a64e8004213d208059c0093c38c03e0010ec21002ac05d0008fc0110404080000cd03e0010480001d4ec211028fc01104041800008c03c0000d03e001038610030389e002038be0014' +
  'c03e000c480004cd2c1b000041820078881b00002c000000418200582c000007418200502c0000024182000c2c000008408200387f63db787fe4fb7838a0000180dd0014c03d000438e10030391e0014c05c0000392000003d80800a398c2f947d8903a64e8004213b60000048000018' +
  '7c1bf8004182fff47f63db7838810030480001493b0000003c608055386321103d808043398c49007d8903a64e8004217c1818004080010c3c608055386321107f04c3783d808043398c17bc7d8903a64e8004213d808043398cff2c7d8903a64e8004213b1800017c791b794182ffac' +
  '7c19f8004182ffa47c19d8004182ff9cc03900a8c01e0020ec210028c05900acc01e0024ec420028c07e0014c09e0018eca100f2eca2293ac01c0000fc05004040800008fca00090c01e000cfc05004040810008fca00090ec23097cec44117cecc10072ecc230bac0f90044c01d000c' +
  'ece7002aece701f2fc0638404181ff2cc11e0028c13900b0c01d000ced490028fc0850404180ff14c179004ced49582aed4a002afc0850404181ff0038610030389e002038be0014fc202890480003357f23cb7838810030480000214bfffedccbe100e0bb0100c0800101047c0803a6' +
  '382101004e8000209421ffc07c0802a690010044934100389361003c7c7a1b787c9b2378801a03047000010040820128813a03dc2c0900004182003880090018700001004182002cc03a0088c05e0014ec6100b2c03a008cc05e0018ec6118bafc601850c01c0018fc030040408000e8' +
  '38000000900100089001000c380000ff90010010900100147f43d3787fe4fb7838a0000180dd0014c03d00047f67db78391e0014813d001839400001c05c00003d808003398cfd507d8903a64e800421c01c0000fc0100404081008c801a03047000010040820080801a03dc2c000000' +
  '418200747fe3fb783d80800b398c13d87d8903a64e8004217c7b1b78807a03dc812303aca8090130818901347c630214809d001c38bf00a838c00001c03c000c38e000007f68db7839200000394000007d8903a64e8004217f43d3787fe4fb7838a000013d808004398c15887d8903a6' +
  '4e8004218361003c83410038800100447c0803a6382100404e8000207d4802a6480002517d4803a6392000002c0400004d820020396b0004380000047c0903a6812b00007c0920004082000c812b00044e800020396b00404200ffe8392000004e8000209421ffd07c0802a690010034' +
  'bf010010480001fd7d7f5b783d20805980093c2c813f00007c00480041820120901f00003bc000002c1e0004408001101f9e00407f9cfa143b2000003b4000003b0000003c608055386321103d808043398c49007d8903a64e8004217c1e1800408000a43c608055386321107fc4f378' +
  '3d808043398c17bc7d8903a64e8004217c7d1b783d808043398cff2c7d8903a64e8004217c791b78837f01043b5f01082c1b000040810058387d0004389a00203d808017398c26547d8903a64e8004212c03000041820040387d0004389a00403d808017398c26547d8903a64e800421' +
  '3b0000022c0300004182001c3b0000003b5a00a03b7bffff4bffffa83b4000003b000000801c00047c00c8004182001038000000901c000c901c0014933c0004935c0008801c000c540007fa7c00c378901c000c3bde00014bfffef0bb010010800100347c0803a6382100304e800020' +
  '38c000007c05342e7c44342eec01103a7c03352e38c600042c06000c4180ffe84e800020c0240000ec210072c0040004ec20083ac0040008ec20083ac01c0010fc0100404181000cc03c00004e800020fc400834c19c0004c1bc0008ed6200b2ed6b0072ed6b6b3cec4202f2ed6200b2' +
  'ed6b0072ed6b6b3cec4202f2ed6200b2ed6b0072ed6b6b3cec4202f2ec2100b238c000007c04342eec0000b27c03352e38c600042c06000c4180ffec4e8000207c0802a6429f00057d6802a67c0803a6396b00484e800020000000003f0000003fc000003f8000002b8cbccc3e4ccccd' +
  '3e99999a3f99999a3f0000003e0000003b83126f3f8000004330000000000000'
export const LASER_TICK = 0, LASER_MOVE = 0x58, LASER_LENGTH = 0x104, LASER_DATA = 0x0c60
const LASER_PLAYERS = 4
const LASER_SLOT = 0x40
// Per player {actor, entry, state, length, time to the next tick, direction, origin}, then the count and the entries.
export const LASER_COUNT = 4 + LASER_SLOT * LASER_PLAYERS, LASER_ENTRIES = LASER_COUNT + 4
export const LASER_ENTRY_SIZE = 0xa0
export const LASER_FLAG = 1024
// Hook sites: fn_80074954 (entity logic), fn_800CC1D4 (controller stick), and the dyngeom length getter fn_803F85C8 in its vtable.
const LASER_TICK_SITE: [number, string] = [0x80074954, '9421ffd0']
const LASER_MOVE_SITE: [number, string] = [0x800cc1d4, '9421ffd8']
const LASER_LENGTH_SITE: [number, string] = [0x8050f168 + 0xc4, '803f85c8']
// Turn is rad/s. Damage flags are fn_8002FD50's, a plain punch's: 0x50 (fn_800DA884) is needed for a hit reaction, 0x10000000
// is what fn_800E6D54 adds to a melee hit.
export const LASER_TICK_SECONDS = 0.2
export const LASER_RADIUS = 0.25
export const LASER_TURN = 4.5
const LASER_DAMAGE_TYPE = 0
const LASER_DAMAGE_FLAGS = 0x10000050
// HitReactLight, as event 0x1A value 0 sets a punch's (fn_800E1788).
const LASER_REACTION = 0x69

export interface LaserCharacter {
  internal: string
  range: number // the ray's length, m
  damage: number // per second
  size: number // the character's own size, for the beam's width
  effects: [string, string] // costume 1's and 2's effect
}

function laserTable(chars: LaserCharacter[]): Uint8Array {
  const out = new Uint8Array(LASER_ENTRIES + LASER_ENTRY_SIZE * chars.length)
  putU32be(out, LASER_COUNT, chars.length)
  chars.forEach((c, i) => {
    const o = LASER_ENTRIES + LASER_ENTRY_SIZE * i
    if (!(c.range > 0) || !(c.damage > 0)) throw new LabError("a laser's range and damage are above 0")
    for (const name of c.effects) if (!name || name.length > 31) throw new LabError(`a laser effect is named in 1 to 31 characters, not ${name}`)
    putF32be(out, o, c.range)
    putF32be(out, o + 4, c.damage * LASER_TICK_SECONDS)
    putF32be(out, o + 8, LASER_TICK_SECONDS)
    putF32be(out, o + 0xc, LASER_RADIUS * c.size)
    putF32be(out, o + 0x10, LASER_TURN)
    putU32be(out, o + 0x14, LASER_DAMAGE_TYPE)
    putU32be(out, o + 0x18, LASER_DAMAGE_FLAGS)
    putU32be(out, o + 0x1c, LASER_REACTION)
    entityNames(c.internal).forEach((name, j) => out.set(field(name), o + 0x20 + 0x20 * j))
    c.effects.forEach((name, j) => out.set(field(name), o + 0x60 + 0x20 * j))
  })
  return out
}

// Needs zActions first: laser.s calls its stealth_test.
export function laser(dol: Uint8Array, chars: LaserCharacter[]): Uint8Array {
  if (!chars.length || chars.length > MAX_NEW) throw new LabError(`main.dol has room for 1 to ${MAX_NEW} characters' lasers, not ${chars.length}`)
  const zCode = fromHex(Z_ACTIONS_CODE), zAt = fileOffset(dol, Z_CODE[0])
  if (!equal(dol.subarray(zAt, zAt + zCode.length), zCode)) throw new LabError('the laser needs the Z-button actions in main.dol first')
  const [out, lo] = textSection(dol, concat([fromHex(LASER_CODE), laserTable(chars)]))
  for (const [[site, old], to] of [[LASER_TICK_SITE, LASER_TICK], [LASER_MOVE_SITE, LASER_MOVE]] as const) {
    put(out, fileOffset(out, site), fromHex(old), word(branch(site, lo + to, false)))
  }
  const [vt, old] = LASER_LENGTH_SITE
  put(out, fileOffset(out, vt), fromHex(old), word(lo + LASER_LENGTH))
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
