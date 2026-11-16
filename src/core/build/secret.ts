// Hidden options for a disc with no new characters, from the unlisted #secret page.
import { LabError } from '../errors'
import * as D from '../game/dol'
import type { GameSource } from '../game/source'
import { type PatchOutput, type Progress, Result, write } from './patch'

export interface SecretOptions {
  debugMenu: boolean
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
]

export const noSecrets = (): SecretOptions => ({ debugMenu: false })

const chosen = (opts: SecretOptions) => SECRET_OPTIONS.filter((o) => opts[o.id])

export function buildSecret(source: GameSource, opts: SecretOptions): Result {
  if (!chosen(opts).length) throw new LabError('no secret option is chosen')
  const r = new Result()
  let dol = source.dol
  if (opts.debugMenu) dol = D.debugEnable(dol)
  r.dol = dol
  return r
}

export function patchSecret(source: GameSource, opts: SecretOptions, out: PatchOutput, progress: Progress = () => {}, isVerified = false): Promise<Result> {
  return write(source, out, progress, isVerified, () => buildSecret(source, opts))
}

export function secretReport(opts: SecretOptions): string {
  return ['ImperfectLab patch report', '', ...chosen(opts).map((o) => o.report)].join('\n') + '\n'
}