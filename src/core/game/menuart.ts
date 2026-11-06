// Menu art read from the player's own disc for the Nemesis theme; no game art ships with ImperfectLab.
import { LabError } from '../errors'
import { RgbaImage } from '../image/rgba'
import * as gshtool from '../mnroi/gshtool'
import * as nbig from '../mnroi/nbig'
import type { GameSource } from './source'

const BG_MAIN = 'Apt/clash/gamelib/bg_main.big'
const CITY = '2'

export function menuCity(src: GameSource): RgbaImage {
  const gsh = nbig.load(src.entry(BG_MAIN)).find(([n]) => n.toLowerCase().endsWith('.gsh'))
  if (!gsh) throw new LabError(`${BG_MAIN} has no .gsh image bank`)
  const record = gshtool.readGsh(gsh[1]).record(CITY)
  const pic = new gshtool.Picture(record)
  return new RgbaImage(pic.width, pic.height, pic.decode(record))
}