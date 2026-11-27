import * as dsp from '../audio/dspadpcm'
import { ownSounds } from '../build/patch'
import { bankName, bankPath, gameRef } from '../build/sounds'
import { LabError } from '../errors'
import type { GameSource } from '../game/source'
import * as gshtool from '../mnroi/gshtool'
import type { Character } from '../package/imperfect'
import * as XA from './abk'
import { gcToXbox } from './asf'
import type { XboxDisc } from './disc'
import { ngbToNnb } from './nnb'
import { ngmToNmb, readNormalTable } from './nmb'
import * as SX from './shpx'
import { tplToXpr, XboxTextures } from './textures'
import { gcPictures } from './tiles'

// the same bytes on both versions
const SAME = [/^misc\/global\.not$/, /^misc\/game\.nfx$/, /^misc\/nvblist\.txt$/, /^materials\/shaders\/shaders\.nsa$/, /^cutscenes\/.+\.cut$/, /^misc\/.+\.nvb$/, /^motions\/.+\.nms$/]
// SFX_Roekel.abk, the largest Xbox character bank (a mirror match loads two)
export const XBOX_MAX_BANK = 1373708

export interface Converted { files: Map<string, Uint8Array>; done: Set<string>; notes: string[] }

export function gcFiles(r: { sets: Map<string, Uint8Array>; adds: Map<string, Uint8Array> }): Map<string, [string, Uint8Array]> {
  const gc = new Map<string, [string, Uint8Array]>()
  for (const m of [r.sets, r.adds]) for (const [k, v] of m) gc.set(k.toLowerCase(), [k, v])
  return gc
}

const putter = (xbox: XboxDisc, out: Converted) => (path: string, data: Uint8Array) => out.files.set(xbox.spelled(path), data)

export function convertFiles(source: GameSource, xbox: XboxDisc, gc: Map<string, [string, Uint8Array]>, out: Converted) {
  const put = putter(xbox, out), done = out.done
  const normals = readNormalTable(source.entry('Misc/NormalTable.ngn'))
  const textures = new XboxTextures(xbox)
  for (const [k, [path, data]] of gc) {
    if (SAME.some((re) => re.test(k))) { put(path, data); done.add(k); continue }
    if (/^sounds\/asf\/english\/[^/]+\.asf$/.test(k)) {
      // the Xbox also plays French, German and Italian voices: they get the same one
      const x = gcToXbox(data), name = path.split('/').pop()!
      for (const lang of ['english', 'french', 'german', 'italian']) put(`Sounds/ASF/${lang}/${name}`, x)
      done.add(k); continue
    }
    const m = /^bundles\/(.+)\.(ngm|ngb|tpl|ngt)$/.exec(k)
    if (!m) continue
    const stem = path.slice('Bundles/'.length).replace(/\.[^.]+$/, '')
    if (m[2] === 'ngm') put(`Bundles/${stem}.nmb`, ngmToNmb(data, normals))
    else if (m[2] === 'ngb') put(`Bundles/${stem}.nnb`, ngbToNnb(data))
    else if (m[2] === 'tpl') {
      const ngt = gc.get(`bundles/${m[1]}.ngt`)?.[1]
      if (!ngt) throw new LabError(`${stem}: textures without a name list`)
      put(`Bundles/${stem}.xpr`, tplToXpr(ngt, data, textures, stem))
    }
    done.add(k)
  }
}

export function convertHud(source: GameSource, xbox: XboxDisc, gc: Map<string, [string, Uint8Array]>, out: Converted) {
  const put = putter(xbox, out), done = out.done, notes = out.notes
  for (const [k, [path, data]] of gc) {
    const m = /^hud\/(.+)\.gsh$/.exec(k)
    if (!m) continue
    done.add(k)
    const xpath = `HUD/${path.slice(4, -4)}.xsh`
    if (!xbox.has(xpath)) { notes.push(`${path}: the Xbox has no ${xpath}, skipped`); continue }
    const x = xbox.entry(xpath); const xb = SX.readBank(x)
    const srcNames = new Set(gshtool.readGsh(source.entry(path)).names)
    const added = gcPictures(data, (n) => !srcNames.has(n))
    if (!added.size) continue
    const copies: [string, string][] = []
    for (const [n, im] of added) {
      const prefix = n.split('_')[0] + '_'
      const tmpl = xb.names.find((t) => t.startsWith(prefix) && SX.recordSize(xb.recs.get(t)!).join() === [im.width, im.height].join())
      if (!tmpl) throw new LabError(`${xpath}: no ${im.width}x${im.height} ${prefix} image to copy for ${n}`)
      copies.push([n, tmpl])
    }
    put(xpath, SX.replaceImages(SX.addCopies(x, copies), added))
  }
}

export function convertSounds(xbox: XboxDisc, batch: Character[], out: Converted) {
  const put = putter(xbox, out), done = out.done, notes = out.notes
  const xbanks = new Map<string, XA.Bank>()
  const xbank = (base: string) => { if (!xbanks.has(base)) xbanks.set(base, XA.read(xbox.entry(bankPath(bankName(base))))); return xbanks.get(base)! }
  for (const c of batch) {
    if (!ownSounds(c)) continue
    done.add(`sounds/sfx_${c.internalName}.abk`.toLowerCase())
    const bank = xbank(c.base), reps = new Map<number, XA.Replacement>()
    for (const [slot, from] of Object.entries(c.sounds)) {
      const i = Number(slot), target = bank.samples[i]
      if (!target) throw new LabError(`${c.displayName}: the Xbox ${bankName(c.base)} has no sound ${i + 1}`)
      const loop = XA.loops(target)
      if ('file' in from) {
        const body = c.files.get(from.file)
        if (!body) throw new LabError(`the sound file ${from.file} is missing`)
        const d = dsp.readDsp(body)
        reps.set(i, { pcm: dsp.decode(d), rate: d.rate, loop })
      } else {
        const [b, k] = gameRef(from.game), s = xbank(b).samples[k]
        if (!s) throw new LabError(`${c.displayName}: the Xbox ${bankName(b)} has no sound ${k + 1}`)
        reps.set(i, { sample: s, loop })
      }
    }
    const data = XA.build(bank, reps)
    if (data.length > XBOX_MAX_BANK) throw new LabError(`${c.displayName}: the new sounds make the Xbox sound bank ${data.length} bytes, more than the ${XBOX_MAX_BANK} a match can load: shorten them or lower their rate`)
    put(`Sounds/SFX_${c.internalName}.abk`, data)
    notes.push(`${c.displayName}: sound bank SFX_${c.internalName}.abk (${reps.size} of ${bank.samples.length} sounds replaced)`)
  }
}