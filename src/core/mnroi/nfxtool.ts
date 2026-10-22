// Effect definitions (Misc/game.nfx), ported from mnroi tools/nfxtool.py (commit a23c796).
// CRLF text read by fn_803A38DC: "<type> <name>" headers, "<key> <value>" lines, "end".
// Everything is allocated from one 300,000-byte cache, and a block holds at most 28 records.
import { encodeLatin1, latin1 } from '../bytes'
import { roundHalfEven } from './gxtex'

export const CACHE_SIZE = 300000
const SCRATCH = 28
const LINE_MAX = 0x1ff

export const TYPES = [
  'controller', 'trail', 'partsys', 'partsysdam', 'partsubfx', 'partmodel', 'glow', 'constraint',
  'cloth', 'shockwave', 'psishield', 'billboard', 'billboardomni', 'volumefog', 'rain',
  'partcylinder', 'actorglow', 'energybeam', 'lasertripwire', 'gibomatic2k', 'dyngeom',
  'ctrldamage', 'radiuseffect', 'light', 'projectcube', 'boxproject', 'project', 'spawner', 'glass',
  'meshtypeflash', 'damage', 'worldfx',
]

const INT = 0, FLOAT = 1, STRING = 2, VECTOR = 3, COLOR = 4

const KEY_TABLE = `
invalid 0 end 0 material 2 material2 2 startsize 1 endsize 1 sampledelay 1 startcol 4 endcol 4
startcol2 4 endcol2 4 startcolor 5 endcolor 5 startcolor2 5 endcolor2 5 flags 5 markertype 0
marker_index 0 endmarker 0 endmarker_id 0 spawn_delay 1 max_particles 0 max_particles2 0
max_particles3 0 part_life 1 part_size0 1 part_size1 1 maxsize 1 minspread 1 maxspread 1 mindist 1
maxdist 1 effect0 2 effect1 2 effect2 2 effect3 2 change_speed 1 rotate_speed 1 type_flags 5
type_flags2 5 constflags 5 clothflags 5 modflags 5 modsize 3 effectname 2 scale 1 scale2 1 zoffset 1
radius0 1 radius1 1 duration 1 duration_rnd 1 velocity_x 1 velocity_y 1 velocity_z 1 size 1
minsize 1 model 2 force 1 priority 0 turbulence 1 width 1 height 1 velocity 3 faderate 1
lightstyle 0 damagemin 1 damagemax 1 area_type 0 area 3 area_x 1 area_y 1 area_z 1 renderradius 1
type 0 gravity 1 speed 1 width0 1 width1 1 height0 1 height1 1 spin 1 fadein 1 fadeout 1
partfadein 1 partfadeout 1 flashtime 1 intensity 1 warp 1 fov 1 falloff 1 respawn 1 lerpin 1
lerpout 1 angle 1 lerpspeed 1 lerpspeed2 1 decal 0 decalscale 1 fov2 1 source 0 loddist 1
turnspeed 1 cache 0 fieldpos 3 anim 1 delay 1 tile 1 ratio 1 drag 1 mass 1 anim0 1 anim1 1
intensity0 1 intensity1 1 seed 0 axis 0 soundid 0 length0 1 primitive 0 fieldforce 1 radiusb0 1
radiusb1 1 length1 1 rendermax 1 rendermin 1 fieldshape 0 offset 3 ratio2 1 collision0 0 flags2 5
target 3 tile2 1 uvtype 0 coltype 0 postype 0 pos2type 0 rotatetype 0 template 2 childflag 5
`.split(/\s+/).filter(Boolean)
export const KEYS = KEY_TABLE.filter((_, i) => i % 2 === 0)
const KINDS = KEY_TABLE.filter((_, i) => i % 2 === 1).map(Number)
const KEY_INDEX = new Map(KEYS.map((k, i) => [k, i]))
const CACHE_KEY = 103

const WS = '[ \\t\\n\\v\\f\\r]*'
const INT_RE = new RegExp(`^${WS}([+-]?\\d+)`)
const FLOAT_SRC = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)'
const FLOAT_RE = new RegExp(`^${WS}${FLOAT_SRC}`)
const FLOAT_AT = new RegExp(`${WS}${FLOAT_SRC}`, 'y')
const HEX_RE = new RegExp(`^${WS}([+-]?)(?:0[xX])?([0-9a-fA-F]+)`)

export function atoi(s: string): number {
  const m = INT_RE.exec(s)
  return m ? parseInt(m[1], 10) : 0
}

export function atof(s: string): number {
  const m = FLOAT_RE.exec(s)
  return m ? parseFloat(m[1]) : 0.0
}

export function scanFloats(s: string, count: number): number[] {
  const out: number[] = []
  if (!s.startsWith('(')) return out
  let p = 1
  for (let i = 0; i < count; i++) {
    FLOAT_AT.lastIndex = p
    const m = FLOAT_AT.exec(s)
    if (!m) break
    out.push(Math.fround(parseFloat(m[1])))
    p = FLOAT_AT.lastIndex
    if (s.slice(p, p + 1) !== (i < count - 1 ? ',' : ')')) break
    p += 1
  }
  return out
}

export function scanHex(s: string): number | null {
  const m = HEX_RE.exec(s)
  if (!m) return null
  const v = Number(BigInt('0x' + m[2]) & 0xffffffffn)
  return m[1] === '-' ? Number(BigInt(-v) & 0xffffffffn) : v
}

function packColor(a: number, r: number, g: number, b: number): number {
  const rnd = (x: number) => BigInt(roundHalfEven(x)) & 0xffffffffn
  return Number(((rnd(a) << 24n) | (rnd(r) << 16n) | (rnd(g) << 8n) | rnd(b)) & 0xffffffffn)
}

export function tokens(line: string): string[] {
  return line.split(/[ \r\t\n]/).filter(Boolean)
}

export class Record {
  key: number
  text: string
  kind: number
  value: unknown
  error: string | null

  constructor(key: number, text: string) {
    this.key = key
    this.text = text
    this.kind = KINDS[key]
    ;[this.value, this.error] = this.parse()
  }

  private parse(): [unknown, string | null] {
    const t = this.text, kind = this.kind
    if (kind === INT) return [atoi(t), null]
    if (kind === FLOAT) return [Math.fround(atof(t)), null]
    if (kind === STRING) return [t.slice(0, 31), t.length > 31 ? 'longer than 31 characters' : null]
    if (kind === VECTOR || kind === COLOR) {
      const n = kind === VECTOR ? 3 : 4
      const vals = scanFloats(t, n)
      if (vals.length < n) return [vals, `not (${Array(n).fill('%f').join(',')})`]
      return [kind === VECTOR ? vals : packColor(vals[0], vals[1], vals[2], vals[3]), null]
    }
    const v = scanHex(t)
    return v === null ? [0, 'not hex'] : [v, null]
  }

  cacheSizes(): number[] {
    if (this.kind === VECTOR) return [12]
    if (this.kind === STRING) return [(this.value as string).length + 1]
    return []
  }
}

export class Block {
  type: number
  name: string
  lines: string[]
  ended: boolean

  constructor(type: number, name: string, lines: string[], ended: boolean) {
    this.type = type
    this.name = name
    this.lines = lines
    this.ended = ended
  }

  records(): [Record[], string[], number | null] {
    const recs: Record[] = []
    const unknown: string[] = []
    let cache: number | null = null
    for (const line of this.lines.slice(1, this.lines.length - (this.ended ? 1 : 0))) {
      if (line.startsWith(';')) continue
      const t = tokens(line.slice(0, LINE_MAX - 1))
      if (!t.length) continue
      const key = KEY_INDEX.get(t[0].toLowerCase()) ?? 0
      if (key === 0) unknown.push(t[0])
      else if (key === CACHE_KEY) cache = t.length > 1 ? atoi(t[1]) & 0xff : 0
      else recs.push(new Record(key, t.length > 1 ? t[1] : ''))
    }
    return [recs, unknown, cache]
  }
}

export type Item = string | Block

export function readNfx(data: Uint8Array): Item[] {
  const lines = latin1(data).split('\r\n')
  const items: Item[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.startsWith(';') ? [] : tokens(line.slice(0, LINE_MAX - 1))
    if (t.length < 2 || !TYPES.includes(t[0].toLowerCase())) {
      items.push(line)
      i++
      continue
    }
    let j = i + 1
    let ended = false
    while (j < lines.length) {
      const u = lines[j].startsWith(';') ? [] : tokens(lines[j].slice(0, LINE_MAX - 1))
      j++
      if (u.length && u[0].toLowerCase() === 'end') {
        ended = true
        break
      }
    }
    items.push(new Block(TYPES.indexOf(t[0].toLowerCase()), t[1], lines.slice(i, j), ended))
    i = j
  }
  return items
}

export function buildNfx(items: Item[]): Uint8Array {
  const out: string[] = []
  for (const it of items) {
    if (typeof it === 'string') out.push(it)
    else out.push(...it.lines)
  }
  return encodeLatin1(out.join('\r\n'))
}

export function blocks(items: Item[]): Block[] {
  return items.filter((it): it is Block => typeof it !== 'string')
}

export function cacheUse(items: Item[]): [[Block, number][], number] {
  let used = 0
  let scratch = false
  const out: [Block, number][] = []
  const alloc = (size: number) => {
    const start = used
    used += size
    if (size % 4 === 0) used += (4 - (start % 4)) % 4
    return used - start
  }
  for (const b of blocks(items)) {
    let n = alloc(b.name.length + 1)
    const recs = b.records()[0]
    if (recs.length && !scratch) {
      scratch = true
      for (let i = 0; i < SCRATCH; i++) n += alloc(32)
    }
    if (recs.length) {
      n += alloc(8 * recs.length)
      for (const r of recs) for (const s of r.cacheSizes()) n += alloc(s)
    }
    out.push([b, n])
  }
  return [out, used]
}

export function problems(items: Item[]): [string[], string[]] {
  const out: string[] = []
  const dups: string[] = []
  const seen = new Map<string, number>()
  for (const b of blocks(items)) {
    const where = `${TYPES[b.type]} ${b.name}`
    const [recs, unknown] = b.records()
    if (!b.ended) out.push(`${where}: no end`)
    if (recs.length > SCRATCH) out.push(`${where}: ${recs.length} records, the scratch table holds ${SCRATCH}`)
    for (const k of unknown) out.push(`${where}: unknown key ${k}`)
    for (const r of recs) if (r.error) out.push(`${where}: ${KEYS[r.key]} ${r.text}: ${r.error}`)
    const low = b.name.toLowerCase()
    if (seen.has(low)) dups.push(`${where}: name already used by a ${TYPES[seen.get(low)!]} block, which wins`)
    else seen.set(low, b.type)
  }
  for (const it of items) {
    if (typeof it === 'string' && it.length > LINE_MAX - 1) out.push(`line longer than ${LINE_MAX - 1} bytes: ${it.slice(0, 40)}...`)
  }
  const total = cacheUse(items)[1]
  if (total > CACHE_SIZE) out.push(`cache: ${total} bytes, over ${CACHE_SIZE}`)
  return [out, dups]
}
