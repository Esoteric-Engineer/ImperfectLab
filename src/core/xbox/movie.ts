import { LabError } from '../errors'
import { Apt } from './aptle'
import { type ArchiveFile, parseBig, saveBig } from './big'

export function openMovie(data: Uint8Array): [ArchiveFile[], Uint8Array, Map<string, ArchiveFile>, Apt] {
  const [files, tag] = parseBig(data)
  const d = new Map<string, ArchiveFile>()
  for (const [n, b] of files) d.set(n.split('.').pop()!.toLowerCase(), [n, b])
  const apt = d.get('apt'), cst = d.get('const')
  if (!apt || !cst) throw new LabError('the movie archive has no .apt or .const')
  return [files, tag, d, new Apt(apt[1], cst[1])]
}

export function rebuildMovie(files: ArchiveFile[], tag: Uint8Array, a: Uint8Array, c: Uint8Array): Uint8Array {
  return saveBig(files.map(([n, b]) => { const e = n.split('.').pop()!.toLowerCase(); return [n, e === 'apt' ? a : e === 'const' ? c : b] }), tag)
}

// main.big's FE_SFX_* sound ids
export function sfxValues(mainData: Uint8Array): Map<string, number> {
  const [, , , apt] = openMovie(mainData); const out = new Map<string, number>(); const movie = apt.aptOff
  for (let f = 0; f < apt.u32(movie + 8); f++) for (const block of apt.frameActions(movie, f)) {
    if (apt.d[block] !== 0x88) continue
    const pool = apt.pool(block)
    for (const [at, op] of apt.walk(block)) {
      if (op !== 0x96) continue
      const vals = apt.getPush(at).map((i) => apt.constValue(i, pool))
      if (vals.length === 2 && typeof vals[0] === 'string' && vals[0].startsWith('FE_SFX_') && typeof vals[1] === 'number' && !out.has(vals[0])) out.set(vals[0], vals[1])
    }
  }
  return out
}