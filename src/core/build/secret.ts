// Hidden options for a disc with no new characters, from the unlisted #secret page.
import { LabError } from '../errors'
import * as D from '../game/dol'
import type { GameSource } from '../game/source'
import { fixedDebug } from './fixeddebug'
import { type PatchOutput, type Progress, Result, write } from './patch'

export interface SecretOptions {
  debugMenu: boolean
  fixedDebug: boolean
}

export interface SecretOption {
  id: keyof SecretOptions
  label: string
  description: string
  effects: string[]
  report: string
}

export const SECRET_OPTIONS: SecretOption[] = [
  {
    id: 'debugMenu',
    label: 'Debug mode',
    description: "Turns on the game's own debug flag. Button press options are ready directly from the code and may not all be functional.",
    effects: [
      'Main menu: Y opens LEVEL SELECT. A loads a level.  Start opens a debug colour screen (allegedly, but crashes).',
      'Mission select: Y completes the highlighted mission immediately, which is saved.',
      "Menus: the L1 button switches the menu language (allegedly, but I didn't see a change).",
      'Reward comics: a panel counter is shown.',
    ],
    report: 'main.dol: gDebugEnable (fn_801041B0) returns "1"',
  },
  {
    id: 'fixedDebug',
    label: 'Debug mode (fixed)',
    description: "Debug mode, with the level select repaired so every venue in it loads, plus five levels it left out (museum, 0_propsallroom, nycstreets2, roekelfacility and roekelslab).",
    effects: [
      'Everything Debug mode does (does whatever a spider can).',
      'You may have to ignore warnings in Dolphin for some maps to load.',
      'Catacombs and Museum only have collision left, so that is drawn as plain shaded geometry. No textures.',
      'Roekel Training Facility and 0_propsallroom were converted from an older level format the game can no longer read. Roekel Training Facility is untextured.',
      'Roekel Training Facility loads its unused versus layout (fuel cells, cooling tanks, Storm platforms).',
      'You play as Spider-Man rather than Wolverine.',
      '0_test_clash and charactertest are drawn on the 0_test_arena grid, and lighttest_props on lighttest. Their original levels are gone.',
      'lightpooltest is removed (nothing of it survives), and so is 0_test_look (its scene needs two script classes the game no longer has).',
      "roekelslab technically loads, but there's no spawn point set, so you fall into the void. Oopsie.",
    ],
    report: 'main.dol: gDebugEnable (fn_801041B0) returns "1"\nmain.dol: the default player (lbl_8048A314, set by fn_80091174) is plr_spiderman\nmain.dol: fn_800A4DF8 skips a scene model it cannot find',
  },
]

export const noSecrets = (): SecretOptions => ({ debugMenu: false, fixedDebug: false })

const chosen = (opts: SecretOptions) => SECRET_OPTIONS.filter((o) => opts[o.id])

export function buildSecret(source: GameSource, opts: SecretOptions): Result {
  if (!chosen(opts).length) throw new LabError('no secret option is chosen')
  const r = new Result()
  let dol = source.dol
  if (opts.debugMenu || opts.fixedDebug) dol = D.debugEnable(dol)
  if (opts.fixedDebug) {
    dol = D.debugFixes(dol)
    const f = fixedDebug(source)
    r.sets = f.sets
    r.adds = f.adds
    r.notes.push(...f.notes)
  }
  r.dol = dol
  return r
}

export function patchSecret(source: GameSource, opts: SecretOptions, out: PatchOutput, progress: Progress = () => {}, isVerified = false): Promise<Result> {
  return write(source, out, progress, isVerified, () => buildSecret(source, opts))
}

export function secretReport(opts: SecretOptions, r: Result): string {
  const sorted = (m: Map<string, Uint8Array>) => [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const lines = ['ImperfectLab patch report', '', ...new Set(chosen(opts).flatMap((o) => o.report.split('\n')))]
  for (const [k, v] of sorted(r.sets)) lines.push(`changed: ${k} (${v.length} bytes)`)
  for (const [k, v] of sorted(r.adds)) lines.push(`added:   ${k} (${v.length} bytes)`)
  if (r.notes.length) lines.push('', ...r.notes)
  return lines.join('\n') + '\n'
}