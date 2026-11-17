// A venue loads Levels/<venue>.ngl, Bundles/<venue>.* and the scene of the same name (fn_8002CE78).
import { LabError } from '../errors'
import * as ngl from '../game/ngl'
import type { GameSource } from '../game/source'
import { openMovie, P, rebuild } from './ui'

export const VENUE_SCREEN = `${P}screens/clashDebugVenue.big`

// The developers' list minus lightpooltest (no files) and 0_test_look (needs the removed script classes cRain, cFilterSet), then the levels it left out.
export const VENUES = [
  'powerplant', '0_test_clash', '0_test_arena', 'brooklynbridge', 'avengersmansion', 'nycstreets', 'catacombs', 'dailybugle',
  'grandcentral', 'lighttest', 'lighttest_props', 'roekeltrainingfacility', 'charactertest',
  'museum', '0_propsallroom', 'nycstreets2', 'roekelfacility', 'roekelslab',
]

const OLD_LEVELS = ['Catacombs', 'Museum', 'RoekelTrainingFacility', '0_PropsAllRoom']

// Scene-only venues: [level drawn on, its bundles].
const STAND_INS: Record<string, [string, string | null]> = {
  '0_test_clash': ['0_Test_Arena', '0_test_arena'],
  charactertest: ['0_Test_Arena', '0_test_arena'],
  lighttest_props: ['LightTest', null],
}

// RoekelTrainingFacility's own scene is a skydome; its versus scene was never used.
const SCENE_SWAPS: [string, string][] = [['Levels/RoekelTrainingFacility.nsd', 'Levels/RoekelTrainingFacility_MP.nsd']]

export interface FixedDebug {
  sets: Map<string, Uint8Array>
  adds: Map<string, Uint8Array>
  notes: string[]
}

function levelListPush(apt: ReturnType<typeof openMovie>[2]): [number, number] {
  const movie = apt.aptOff
  for (let f = 0; f < apt.u32(movie + 8); f++) {
    for (const block of apt.frameActions(movie, f)) {
      if (apt.d[block] !== 0x88) continue
      const pool = apt.pool(block)
      for (const [at, op] of apt.walk(block)) {
        if (op !== 0x96) continue
        const vals = apt.getPush(at).map((i) => apt.constValue(i, pool))
        if (vals[0] === 'levelLoadArray' && vals.includes('catacombs')) return [block, at]
      }
    }
  }
  throw new LabError('clashDebugVenue: levelLoadArray not found')
}

export function venueList(data: Uint8Array): string[] {
  const [, , apt] = openMovie(data)
  const [block, at] = levelListPush(apt)
  const pool = apt.pool(block)
  const vals = apt.getPush(at).map((i) => apt.constValue(i, pool))
  return (vals.slice(1, -1) as string[]).reverse()
}

// The array literal pushes its items last to first, then their count.
export function setVenueList(data: Uint8Array, venues: string[]): Uint8Array {
  const [files, , apt] = openMovie(data)
  const [block, at] = levelListPush(apt)
  const items = apt.getPush(at)
  apt.setPush(at, [items[0], ...[...venues].reverse().map((v) => apt.pushStr(block, v)), apt.constInt(venues.length)])
  const [a, c] = apt.build()
  return rebuild(files, a, c)
}

function find(source: GameSource, name: string): string {
  const hit = source.names(name.toLowerCase().split('/')[0] + '/').find((n) => n.toLowerCase() === name.toLowerCase())
  if (!hit) throw new LabError(`CLASH.BIG has no ${name}`)
  return hit
}

export function fixedDebug(source: GameSource): FixedDebug {
  const sets = new Map<string, Uint8Array>(), adds = new Map<string, Uint8Array>(), notes: string[] = []
  const normals = ngl.readNormals(source.entry('Misc/NormalTable.ngn'))
  for (const level of OLD_LEVELS) {
    const name = find(source, `Levels/${level}.ngl`)
    const u = ngl.upgrade(source.entry(name), normals)
    sets.set(name, u.data)
    notes.push(`${level}: level file upgraded to the current layout` +
      (u.rebuilt ? ', its collision drawn as untextured geometry (it has no render geometry)' : '') +
      (u.oldGraphVersion !== 2 ? `, collision graph version ${u.oldGraphVersion} -> 2` : '') +
      (u.lightsDropped ? `, ${u.lightsDropped} old-format light${u.lightsDropped > 1 ? 's' : ''} left out` : ''))
  }
  for (const [venue, [level, bundle]] of Object.entries(STAND_INS)) {
    adds.set(`Levels/${venue}.ngl`, source.entry(find(source, `Levels/${level}.ngl`)))
    if (bundle) {
      for (const ext of ['ngt', 'tpl']) {
        const b = `Bundles/${bundle}.${ext}`
        if (source.has(b)) adds.set(`Bundles/${venue}.${ext}`, source.entry(b))
      }
    }
    notes.push(`${venue}: its scene is drawn on ${level}`)
  }
  for (const [scene, from] of SCENE_SWAPS) {
    sets.set(find(source, scene), source.entry(find(source, from)))
    notes.push(`${scene.split('/')[1]}: replaced by ${from.split('/')[1]}`)
  }
  sets.set(VENUE_SCREEN, setVenueList(source.entry(VENUE_SCREEN), VENUES))
  notes.push(`level select: ${VENUES.join(', ')}`)
  return { sets, adds, notes }
}