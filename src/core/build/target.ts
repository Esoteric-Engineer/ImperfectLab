import { MAX_NEW } from '../game/dol'

export interface BuildTarget {
  maxCharacters: number
  effectCacheMax: number
  // how far tints may grow the effect cache before falling back to a lower level
  tintLimit: number
  listBuffer: number
  // faded characters also get Z texture twins, for targets that draw the fade with them
  ghostTwins: boolean
  // effect names start with the whole internal name, for targets that join characters built apart
  wholeNamePrefixes: boolean
  patchDol: boolean
}

export const GAMECUBE: Readonly<BuildTarget> = Object.freeze({
  maxCharacters: MAX_NEW,
  effectCacheMax: 0x50000,
  tintLimit: 8224,
  listBuffer: 0x200,
  ghostTwins: false,
  wholeNamePrefixes: false,
  patchDol: true,
})

export function effectPrefix(internal: string, target: Pick<BuildTarget, 'wholeNamePrefixes'> = GAMECUBE): string {
  return target.wholeNamePrefixes ? `${internal.toLowerCase()}_` : internal.slice(0, 2).toLowerCase()
}