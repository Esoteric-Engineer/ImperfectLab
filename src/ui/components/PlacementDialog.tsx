import { useEffect, useRef, useState } from 'react'
import { defaultPlacement } from '../../core/build/patch'
import { FADE } from '../../core/build/portraits'
import { decodePng } from '../../core/image/png'
import { RgbaImage } from '../../core/image/rgba'
import { type Placement, type Pose, POSES } from '../../core/package/imperfect'
import type { LayoutInfo } from '../../worker/protocol'
import { ColorButton, ImageView, Modal, Note, NumberInput } from './common'
import { engine } from '../engine'
import { store } from '../store'

const ZOOM = 2
const LABELS: [Pose, string][] = [['ready', 'READY (costume 1 picked)'], ['readyalt', 'READY (costume 2 picked)'], ['rest', 'REST (cursor on the tile)']]

interface Args {
  spec: Record<Pose, Placement>
  fade: number
  pose: Pose
  ghost: Record<string, boolean>
}

async function composeImage(layout: LayoutInfo, a: Args): Promise<RgbaImage | null> {
  const canvas = layout.canvases[a.pose]
  if (!canvas) return null
  const sp = a.spec[a.pose]
  const out = wrap(await engine.call('compose', [{ pose: a.pose, scale: sp.scale, anchor: sp.anchor, glow: sp.glow, fade: a.fade }, canvas.index]))!
  const [W, H] = canvas.size
  const bg = RgbaImage.filled(W, H, [34, 60, 78, 255])
  const orig = wrap(layout.originals[a.pose] as never)
  if (a.ghost[a.pose] && orig) {
    const faint = orig.copy()
    for (let i = 3; i < faint.data.length; i += 4) faint.data[i] = Math.floor((faint.data[i] * 35) / 100)
    bg.alphaComposite(faint)
  }
  bg.alphaComposite(out)
  return bg
}

const wrap = (im: { width: number; height: number; data: Uint8ClampedArray } | null) => (im ? new RgbaImage(im.width, im.height, im.data) : null)

export function PlacementDialog({ onClose }: { onClose: () => void }) {
  const c = store.character
  const [layout, setLayout] = useState<LayoutInfo | null>(null)
  const [pose, setPose] = useState<Pose>('ready')
  const [ghost, setGhost] = useState<Record<string, boolean>>({ ready: true, readyalt: true, rest: true })
  const [fade, setFade] = useState(c.ui.fade ?? FADE)
  const [lastGlow, setLastGlow] = useState<Record<string, string>>({})
  const [spec, setSpec] = useState<Record<Pose, Placement>>(() => {
    const ready = c.files.get('ui/select_ready.png')!
    const pics: Record<Pose, Uint8Array> = { ready, readyalt: c.files.get('ui/select_readyalt.png') ?? ready, rest: c.files.get('ui/select_rest.png') ?? ready }
    const sel = c.ui.select
    const out = {} as Record<Pose, Placement>
    for (const p of POSES) {
      const v = sel[p] ?? (p !== 'rest' ? sel.ready : undefined) ?? defaultPlacement(decodePng(pics[p]))
      out[p] = { scale: v.scale, anchor: [v.anchor[0], v.anchor[1]], glow: v.glow }
    }
    return out
  })
  const [image, setImage] = useState<RgbaImage | null>(null)
  const wanted = useRef<Args | null>(null)
  const working = useRef(false)

  useEffect(() => {
    const ready = c.files.get('ui/select_ready.png')!
    engine.call('setPictures', [{ ready, readyalt: c.files.get('ui/select_readyalt.png') ?? ready, rest: c.files.get('ui/select_rest.png') ?? ready }])
      .then(() => engine.call<LayoutInfo>('layout'))
      .then(setLayout, (e) => {
        store.fail(e)
        onClose()
      })
  }, [c, onClose])

  useEffect(() => {
    if (!layout) return
    wanted.current = { spec, fade, pose, ghost }
    if (working.current) return
    working.current = true
    void (async () => {
      while (wanted.current) {
        const a = wanted.current
        wanted.current = null
        try {
          const im = await composeImage(layout, a)
          if (im) setImage(im)
        } catch (e) {
          store.fail(e)
        }
      }
      working.current = false
    })()
  }, [layout, spec, fade, pose, ghost])

  const sp = spec[pose]
  const update = (next: Partial<Placement>) => setSpec((s) => ({ ...s, [pose]: { ...s[pose], ...next } }))
  const drag = useRef<[number, number] | null>(null)

  return (
    <Modal title="Place the select-screen portrait" onClose={onClose} wide>
      <Note>Drag a picture to move it, and set its size. The faint picture is Johnny Ohm's, which every new character's portrait is laid out like; put the face about where his is.</Note>
      <div className="tabs">
        {LABELS.map(([p, label]) => <button key={p} className={p === pose ? 'active' : ''} onClick={() => setPose(p)}>{label}</button>)}
      </div>
      <div className="placement">
        <div className="placement-canvas"
          onPointerDown={(e) => {
            drag.current = [e.clientX, e.clientY]
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drag.current || !layout) return
            const dx = e.clientX - drag.current[0], dy = e.clientY - drag.current[1]
            drag.current = [e.clientX, e.clientY]
            const k = (sp.scale * layout.canvases[pose].scale) / layout.sR * ZOOM
            update({ anchor: [sp.anchor[0] - dx / k, sp.anchor[1] - dy / k] })
          }}
          onPointerUp={() => (drag.current = null)}>
          {layout ? <ImageView image={image} zoom={ZOOM} checker={false} /> : <p>Loading the layout...</p>}
        </div>
        <div className="form">
          <label>Size</label>
          <NumberInput min={0.01} max={20} step={0.02} value={Math.round(sp.scale * 1000) / 1000} onChange={(v) => update({ scale: v })} />
          <label>Face x</label>
          <NumberInput min={-8192} max={8192} step={1} value={Math.round(sp.anchor[0])} onChange={(v) => update({ anchor: [Math.round(v), Math.round(sp.anchor[1])] })} />
          <label>Face y</label>
          <NumberInput min={-8192} max={8192} step={1} value={Math.round(sp.anchor[1])} onChange={(v) => update({ anchor: [Math.round(sp.anchor[0]), Math.round(v)] })} />
          <label className="check"><input type="checkbox" checked={Boolean(sp.glow)} onChange={(e) => update({ glow: e.target.checked ? (lastGlow[pose] ?? '#3CFF5A6E') : null })} /> Glow</label>
          <ColorButton color={sp.glow ?? lastGlow[pose] ?? '#3CFF5A6E'} alpha disabled={!sp.glow} onChange={(v) => {
            setLastGlow((g) => ({ ...g, [pose]: v }))
            update({ glow: v })
          }} />
          <span />
          <label className="check"><input type="checkbox" checked={ghost[pose]} onChange={(e) => setGhost((g) => ({ ...g, [pose]: e.target.checked }))} /> Show Johnny Ohm's</label>
        </div>
      </div>
      <div className="row">
        <label>Fade-in rows at the top</label>
        <NumberInput min={0} max={200} step={1} value={fade} onChange={(v) => setFade(Math.round(v))} />
        <span className="spacer" />
        <button onClick={() => {
          c.ui.select = { ...spec }
          c.ui.fade = fade
          store.touch('character')
          onClose()
        }}>OK</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
