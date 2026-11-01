// Event 0x4e picks what the next 0x04 launches: param k is index min(max(k - 1, 0), 3) (fn_800E1788, +0x409), the template in tuning field 90 + index (fn_800F0C70); a move that picks none launches field 90.
import type * as ngbtool from '../mnroi/ngbtool'
import * as tuning from './tuning'

export const PICK = 0x4e
export const FIRE = 0x04
export const FIELDS = [90, 91, 92, 93]

const index = (k: number) => Math.min(Math.max(k - 1, 0), FIELDS.length - 1)

export function pickAt(rec: ngbtool.Record): number | null {
  const fire = rec.events.find(([, t]) => t === FIRE)
  if (!fire) return null
  const picks = rec.events.filter(([f, t]) => t === PICK && f <= fire[0])
  return picks.length ? index(picks[picks.length - 1][2]) : 0
}

export function filled(tun: tuning.Tuning): boolean[] {
  return FIELDS.map((fid) => Array.from({ length: tuning.SLOTS }, (_, s) => tun.value(fid, s)).some(Boolean))
}

export function repick(rec: ngbtool.Record, to: number): ngbtool.Record {
  const events = rec.events.map((e): ngbtool.Event => (e[1] === PICK ? [e[0], PICK, to + 1, e[3]] : e))
  const fire = rec.events.find(([, t]) => t === FIRE)
  if (to !== 0 && fire && !rec.events.some(([f, t]) => t === PICK && f <= fire[0])) events.unshift([0, PICK, to + 1, 0])
  const same = events.length === rec.events.length && events.every((e, i) => e[2] === rec.events[i][2])
  return same ? rec : { ...rec, events }
}

export function target(theirs: ngbtool.Record, own: ngbtool.Record | undefined, has: boolean[]): number | null {
  const at = pickAt(theirs)
  if (at === null || !has.some(Boolean)) return null
  const mine = own ? pickAt(own) : null
  if (mine !== null && has[mine]) return mine
  return has[at] ? at : has.indexOf(true)
}
