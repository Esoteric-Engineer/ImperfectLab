// XDVDFS: an xiso, or a full redump with the game partition further in.
import { LabError } from '../errors'
import type { ReadAt } from '../game/disc'

const SECTOR = 2048
const MAGIC = 'MICROSOFT*XBOX*MEDIA'

export class XboxDisc {
  private base = -1
  readonly files = new Map<string, [number, number]>()   // lowercased path -> [sector, size]
  readonly names = new Map<string, string>()              // lowercased path -> path as on the disc
  private r: ReadAt
  constructor(r: ReadAt) {
    this.r = r
    for (const b of [0, 0x18300000, 0x30600000, 0x2080000, 0xfd90000]) {
      if (b + 0x10000 + 28 > r.size) continue
      const h = r.read(b + 0x10000, 28)
      if (String.fromCharCode(...h.subarray(0, 20)) === MAGIC) { this.base = b; break }
    }
    if (this.base < 0) throw new LabError('this is not an Xbox disc image (no XDVDFS volume)')
    const h = r.read(this.base + 0x10000, 28); const dv = new DataView(h.buffer, h.byteOffset)
    this.walk(dv.getUint32(20, true), dv.getUint32(24, true), '')
  }
  private walk(sec: number, size: number, prefix: string) {
    if (!size) return
    const d = this.r.read(this.base + sec * SECTOR, size); const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    const node = (off: number) => {
      const p = off * 4
      if (p + 14 > d.length) return
      const l = dv.getUint16(p, true), rr = dv.getUint16(p + 2, true), start = dv.getUint32(p + 4, true), fsize = dv.getUint32(p + 8, true), attr = d[p + 12], nl = d[p + 13]
      if (l === 0xffff && rr === 0xffff && start === 0xffffffff) return
      const name = String.fromCharCode(...d.subarray(p + 14, p + 14 + nl)), path = prefix + name
      if (l) node(l)
      if (attr & 0x10) this.walk(start, fsize, path + '/')
      else { this.files.set(path.toLowerCase(), [start, fsize]); this.names.set(path.toLowerCase(), path) }
      if (rr) node(rr)
    }
    node(0)
  }
  has(path: string) { return this.files.has(path.toLowerCase()) }
  entry(path: string): Uint8Array {
    const f = this.files.get(path.toLowerCase())
    if (!f) throw new LabError(`the Xbox disc has no ${path}`)
    return this.r.read(this.base + f[0] * SECTOR, f[1])
  }
  head(path: string, n: number): Uint8Array {
    const f = this.files.get(path.toLowerCase())
    if (!f) throw new LabError(`the Xbox disc has no ${path}`)
    return this.r.read(this.base + f[0] * SECTOR, Math.min(n, f[1]))
  }
  list(prefix: string): string[] { const p = prefix.toLowerCase(); return [...this.names.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => v) }
  spelled(path: string) { return this.names.get(path.toLowerCase()) ?? path }
}