// A character's size (manifest `model.size`), baked into its own skeleton, animations, motion set and act_ template.
// Translation keys are offsets from the bind pose, so scaling them with the bones scales every pose, root motion included.
import * as R from '../game/roster'
import * as ngbtool from '../mnroi/ngbtool'
import * as nmstool from '../mnroi/nmstool'
import * as nottool from '../mnroi/nottool'

const DEFAULTS: [number, number][] = [[R.P_RADIUS, 0.4], [R.P_HEIGHT, 1.92]]

const isRoot = (bone: number, ch: number) => (bone & 0xffff) === 0 && ch === 1

// A root that leaves the ground keeps the base's travel.
export const airborne = (rec: ngbtool.Record) => rec.tracks.some(([bone, ch, keys]) => isRoot(bone, ch) && keys.some(([, v]) => Math.abs(ngbtool.translation(v)[2]) > 0.01))

export function scaleRecord(rec: ngbtool.Record, s: number): ngbtool.Record {
  const keepRoot = airborne(rec)
  const tracks = rec.tracks.map(([bone, ch, keys]): ngbtool.Track => [bone, ch, ch !== 1 || (keepRoot && isRoot(bone, ch)) ? keys : keys.map(([f, v]): ngbtool.Key => {
    const t = ngbtool.translation(v)
    return [f, ngbtool.encodeTranslation([t[0] * s, t[1] * s, t[2] * s])]
  })])
  return { ...rec, tracks }
}

// A motion's stride (`move`), so the feet keep pace with the ground.
export function strides(opts: string[], s: number): string[] {
  const i = opts.findIndex((o) => o.toLowerCase() === 'move')
  return i >= 0 && Number(opts[i + 1]) > 0 ? opts.map((o, j) => (j === i + 1 ? (Number(o) * s).toFixed(3) : o)) : opts
}

export function scaleMotionSet(set: nmstool.MotionSet, s: number) {
  set.lines = set.lines.map((l) => {
    if (!l.motion || l.overlay < 0) return l
    const opts = strides(l.motion.opts, s)
    if (opts === l.motion.opts) return l
    const m = { ...l.motion, opts }
    return { ...l, raw: nmstool.format(m), motion: m }
  })
}

// The collision body's radius and height on each template that has its own.
export function scaleTemplates(T: R.Templates, pairs: [nottool.Template, string][], s: number) {
  for (const [t, src] of pairs) {
    for (const [pid, fallback] of DEFAULTS) {
      if (t !== pairs[0][0] && T.get(src).get(pid) === null) continue
      t.set(pid, nottool.vFloat((R.f32(T.prop(src, pid)) ?? fallback) * s))
    }
  }
}
