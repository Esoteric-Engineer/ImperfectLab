import { useEffect, useRef, useState } from 'react'
import { addOptions, animations, type Move, options } from '../../core/build/moves'
import { label } from '../../core/game/roster'
import * as ngbtool from '../../core/mnroi/ngbtool'
import { copyCharacter } from '../../core/package/imperfect'
import { posedBones, skin } from '../../core/preview'
import type { MovePreview } from '../../worker/protocol'
import { Modal, Note } from './common'
import { Viewport } from './viewport'
import { engine, errorText } from '../engine'
import { store, useStore } from '../store'

const SLOT_LABELS: Record<string, string> = { '-t0': 'vs male', '-t1': 'vs female', '-t2': 'vs brute' }
const SPEEDS = [0.25, 0.5, 1]
const IDLE = '@idle'
const stem = (anim: string | null) => (anim ?? '').replace(/\.nad$/i, '')
type Shown = 'custom' | 'base'

interface Choice {
  value: string
  from: string[]
  text: string
}

function choices(move: Move): { list: Choice[]; current: string | null } {
  const c = store.character, cat = store.moveCatalog()
  if (!cat?.[c.base]) return { list: [], current: null }
  const own = animations(cat, c.base, move)
  const list: Choice[] = own ? [{ value: c.base, from: [c.base], text: `${label(c.base)}: ${stem(own.find((a) => a !== null) ?? null)}` }] : []
  for (const o of own ? options(cat, c.base, move) : addOptions(cat, c.base, move)) {
    const approx = o.body !== cat[c.base].body ? ` (${o.body}, approximate)` : ''
    list.push({ value: o.from[0], from: o.from, text: `${o.from.map(label).join(', ')}: ${stem(o.anims.find((a) => a !== null) ?? null)}${approx}` })
  }
  if (c.moveIdle.includes(move.id)) {
    list.unshift({ value: IDLE, from: [], text: 'Idle' })
    return { list, current: IDLE }
  }
  const picked = c.moves[move.id] ?? (own ? c.base : null)
  return { list, current: list.find((ch) => picked !== null && ch.from.includes(picked))?.value ?? null }
}

export function MovePreviewDialog({ move, onSave, onClose }: { move: Move; onSave?: (from: string) => void; onClose: () => void }) {
  const s = useStore()
  const c = store.character
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<Viewport | null>(null)
  const time = useRef(0)
  const framed = useRef(false)
  const redraw = useRef<(t: number) => void>(() => {})
  const { list, current } = choices(move)
  const [pick, setPick] = useState(() => current ?? list[0]?.value ?? '')
  const [data, setData] = useState<MovePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState('')
  const [shown, setShown] = useState<Shown>('custom')
  const [part, setPart] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(true)
  const [bones, setBones] = useState(true)
  const [inPlace, setInPlace] = useState(true)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    view.current = new Viewport(canvas.current!)
    return () => view.current?.dispose()
  }, [])

  const from = !pick || pick === current ? null : pick
  useEffect(() => {
    let live = true
    const timer = window.setTimeout(() => {
      engine.call<MovePreview | string>('movePreview', [copyCharacter({ ...store.character, glb: null }), move.id, from]).then((r) => {
        if (!live) return
        setLoading(false)
        if (typeof r === 'string') {
          setReport('✖ ' + r)
          setData(null)
          return
        }
        setReport('')
        setData(r)
        setPart((v) => (v < r.variants.length ? v : 0))
      }, (e) => {
        if (!live) return
        setLoading(false)
        setReport('✖ ' + errorText(e))
      })
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [s.versions.character, s.versions.model, s.versions.mapping, s.model, move.id, from])

  const meshes = data ? (shown === 'custom' && data.custom ? data.custom : data.base) : null
  const played = data?.variants[part] ?? null

  useEffect(() => {
    const vp = view.current
    if (!vp || !meshes) return
    vp.setScene(meshes, [], !framed.current)
    if (!framed.current) {
      vp.yaw = 0.6
      vp.pitch = 0.1
    }
    framed.current = true
  }, [meshes])

  useEffect(() => view.current?.setShowBones(bones), [bones])

  useEffect(() => {
    const vp = view.current
    if (!vp || !data || !meshes || !played) return
    const model = { nodes: data.nodes }
    const rest = ngbtool.pose(model, null, 0).map(([, T]) => T)
    const pos = meshes.map((m) => new Float32Array(m.positions.length))
    const nrm = meshes.map((m) => new Float32Array(m.normals.length))
    const length = played.rec.length
    const draw = (t: number) => {
      const posed = ngbtool.pose(model, played.rec, t)
      if (inPlace && posed.length) {
        const dx = posed[0][1][0] - rest[0][0], dy = posed[0][1][1] - rest[0][1]
        for (const p of posed) p[1] = [p[1][0] - dx, p[1][1] - dy, p[1][2]]
      }
      meshes.forEach((m, i) => skin(m, posed, rest, pos[i], nrm[i]))
      vp.setPose(pos, nrm, posedBones(data.nodes, posed))
    }
    redraw.current = draw
    draw(time.current)
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      let t = time.current + ((now - last) / 1000) * played.fps * speed
      last = now
      if (t >= length) {
        if (loop && length > 0) t %= length
        else {
          t = length
          setPlaying(false)
        }
      }
      time.current = t
      setFrame(t)
      draw(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [data, meshes, played, playing, speed, loop, inPlace])

  const length = played?.rec.length ?? 0
  const restart = () => {
    time.current = 0
    setFrame(0)
  }
  const play = () => {
    if (!playing && time.current >= length) time.current = 0
    setPlaying(!playing)
  }

  return (
    <Modal title={`Animation preview: ${move.label}`} onClose={onClose} wide>
      <div className="move-preview">
        <div className="move-preview-options">
          <label>Preview model</label>
          <select value={data?.custom ? shown : 'base'} onChange={(e) => setShown(e.target.value as Shown)}>
            <option value="custom" disabled={!data?.custom}>Custom model</option>
            <option value="base">{label(c.base)}'s model</option>
          </select>
          <label>Animation</label>
          <select value={pick} disabled={!list.length} onChange={(e) => {
            restart()
            setPart(0)
            setLoading(true)
            setPick(e.target.value)
          }}>
            {list.map((ch) => <option key={ch.value} value={ch.value}>{ch.text}{ch.value === current ? ' (current)' : ''}</option>)}
          </select>
          {data && data.variants.length > 1 && (
            <>
              <label>Part</label>
              <select value={part} onChange={(e) => {
                restart()
                setPart(Number(e.target.value))
              }}>
                {data.variants.map((v, i) => <option key={i} value={i}>{v.state}{SLOT_LABELS[v.slot] ? ` · ${SLOT_LABELS[v.slot]}` : ''}</option>)}
              </select>
            </>
          )}
          <div className="row tight">
            <button disabled={!played} onClick={play}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Playback speed">
              {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
            <span className="muted">{played ? `${played.fps} fps` : ''}</span>
          </div>
          <input type="range" min={0} max={length} step={0.1} value={Math.min(frame, length)} disabled={!played} onChange={(e) => {
            time.current = Number(e.target.value)
            setFrame(time.current)
            setPlaying(false)
            redraw.current(time.current)
          }} />
          <span className="muted">Frame {frame.toFixed(1)} of {length}</span>
          <label className="check"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
          <label className="check"><input type="checkbox" checked={bones} onChange={(e) => setBones(e.target.checked)} /> Show bones</label>
          <label className="check" title="Hold the character over one spot instead of following where the move carries it"><input type="checkbox" checked={inPlace} onChange={(e) => setInPlace(e.target.checked)} /> Keep in place</label>
          <div className="row tight">
            {(['front', 'right', 'back', 'left'] as const).map((n) => (
              <button key={n} className="small" onClick={() => view.current?.view(n)}>{n[0].toUpperCase() + n.slice(1)}</button>
            ))}
          </div>
          {report && <Note>{report}</Note>}
          {loading && !report && <p className="muted">Building the move's animations...</p>}
          {data && !data.variants.length && <Note>There is no animation to show for this move.</Note>}
          {data?.notes.map((n) => <Note key={n}>{n}</Note>)}
          <span className="spacer" />
          <div className="row tight">
            {onSave && <button disabled={from === null || pick === IDLE} title="Use this animation for the move" onClick={() => onSave(pick)}>Save</button>}
            <button onClick={onClose}>Close preview</button>
          </div>
        </div>
        <canvas ref={canvas} className="viewport" />
      </div>
    </Modal>
  )
}