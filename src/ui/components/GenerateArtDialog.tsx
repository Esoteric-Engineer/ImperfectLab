import { useEffect, useMemo, useRef, useState } from 'react'
import * as A from '../../core/build/artgen'
import { FADE } from '../../core/build/portraits'
import { decodePng, encodePng } from '../../core/image/png'
import { RgbaImage } from '../../core/image/rgba'
import type { Character, Placement, Pose } from '../../core/package/imperfect'
import { decodePicture, pickFile } from '../../io/files'
import { engine } from '../engine'
import { PLACEMENT_HELP, POSE_LABELS, startingPlacements } from '../placement'
import { store, useStore } from '../store'
import { bundledTemplates } from '../templates'
import { ColorButton, ImageView, Modal, Note, NumberInput, Warning } from './common'
import { PlacementEditor } from './PlacementDialog'

type Kind = 'loading' | 'hud' | 'tile'
type Tab = Kind | 'select'
type Costume = 0 | 1
type TileSource = 'rest' | Costume
type Pair<T> = [T, T]

interface Picture { image: RgbaImage; png: Uint8Array }

const PICTURES = '.png,.jpg,.jpeg,.webp,.bmp,.gif'
const TABS: [Tab, string][] = [['loading', 'Loading screen'], ['hud', 'HUD portrait'], ['tile', 'Select tiles'], ['select', 'Select portrait']]
const ZOOM: Record<Kind, number> = { loading: 2, hud: 4, tile: 4 }
const MARGIN = 56
const COSTUMES: [Costume, string][] = [[0, 'Costume 1'], [1, 'Costume 2']]
const SLOTS: [TileSource, string][] = [[0, 'select_ready'], [1, 'select_readyalt'], ['rest', 'select_rest']]

interface State {
  pictures: Pair<Picture | null>
  rest: Picture | null
  base: Record<string, Uint8Array | undefined>
  baseUi: Pick<Character['ui'], 'select' | 'fade'> | null
  loading: Pair<A.Framing | null>
  hud: Pair<A.Framing | null>
  tile: Partial<Record<TileSource, A.Framing>>
  tileSource: TileSource | null
  rage: Pair<string>
  linked: Record<'loading' | 'hud', boolean>
  select: Partial<Record<Pose, Placement>>
  fade: number
}

const fresh = (): State => ({
  pictures: [null, null], rest: null, base: {}, baseUi: null, loading: [null, null], hud: [null, null], tile: {}, tileSource: null, rage: [...A.RAGE_DEFAULTS],
  linked: { loading: true, hud: true }, select: {}, fade: FADE,
})

let kept: { owner: Character; state: State } | null = null

const pictureIn = (st: State, which: TileSource) => (which === 'rest' ? st.rest : st.pictures[which])

function posePictures(st: Pick<State, 'pictures' | 'rest'>): Record<Pose, Picture | null> {
  const ready = st.pictures[0]
  return { ready, readyalt: st.pictures[1] ?? ready, rest: st.rest ?? ready }
}

function withPicture(st: State, which: TileSource, pic: Picture | null): State {
  const next: State = which === 'rest' ? { ...st, rest: pic } : { ...st, pictures: (which === 0 ? [pic, st.pictures[1]] : [st.pictures[0], pic]) }
  const before = posePictures(st), after = posePictures(next)
  const select = Object.fromEntries(Object.entries(st.select).filter(([p]) => before[p as Pose] === after[p as Pose]))
  next.select = select
  next.tile = { ...st.tile, [which]: undefined }
  if (which !== 'rest') {
    const reset = <T,>(pair: Pair<T | null>): Pair<T | null> => (which === 0 ? [null, pair[1]] : [pair[0], null])
    next.loading = reset(st.loading)
    next.hud = reset(st.hud)
  }
  return next
}

function opening(c: Character): State {
  let st = kept && kept.owner === c ? kept.state : fresh()
  if (st.baseUi?.select !== c.ui.select || st.baseUi.fade !== c.ui.fade) {
    st = { ...st, select: { ...c.ui.select }, fade: c.ui.fade ?? FADE, baseUi: { select: c.ui.select, fade: c.ui.fade } }
  }
  for (const [which, slot] of SLOTS) {
    const png = c.files.get(`ui/${slot}.png`)
    if (png === st.base[slot]) continue
    let pic: Picture | null = null
    try {
      if (png) pic = { image: decodePng(png), png }
    } catch {
      // Left out, as if unset
    }
    st = withPicture(st, which, pic)
    st.base = { ...st.base, [slot]: png }
  }
  return st
}

const wrap = (im: { width: number; height: number; data: Uint8ClampedArray }) => new RgbaImage(im.width, im.height, im.data)
const sameSize = (a: [number, number] | undefined, b: [number, number]) => !a || (a[0] === b[0] && a[1] === b[1])

function toCanvas(im: RgbaImage): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = im.width
  c.height = im.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0)
  return c
}

export function GenerateArtDialog({ onClose }: { onClose: () => void }) {
  useStore()
  const [s, setS] = useState<State>(() => opening(store.character))
  const [tab, setTab] = useState<Tab>('loading')
  const [pose, setPose] = useState<Pose>('ready')
  const [costume, setCostume] = useState<Costume>(0)
  const [outlines, setOutlines] = useState<Pair<RgbaImage[]> | null>(null)
  const [failed, setFailed] = useState(false)
  const t = bundledTemplates()

  useEffect(() => {
    kept = { owner: store.character, state: s }
  }, [s])

  useEffect(() => {
    engine.call<Pair<RgbaImage[]>>('stripOutlines').then((o) => setOutlines([o[0].map(wrap), o[1].map(wrap)]), (e) => {
      setFailed(true)
      store.fail(e)
    })
  }, [])

  const sizes = store.game ? (store.baseDetails()?.sizes ?? null) : null
  const mismatch = sizes && outlines
    ? ([['hud', t.hud.size], ['tile0', t.tiles.normal[0].size], ['tile1', t.tiles.selected[0].size], ['strip0', outlines[0][0].size],
        ['strip1', outlines[0][1].size], ['strip0_alt', outlines[1][0].size], ['strip1_alt', outlines[1][1].size]] as [string, [number, number]][])
      .filter(([k, size]) => !sameSize(sizes[k], size)).map(([k]) => k)
    : []

  const kind: Kind = tab === 'select' ? 'loading' : tab
  const wanted = s.tileSource ?? (s.rest ? 'rest' : 0)
  const tileSource: TileSource = pictureIn(s, wanted) ? wanted : 0
  const tilePicture = pictureIn(s, tileSource)?.image ?? null

  const poses = useMemo(() => posePictures({ pictures: s.pictures, rest: s.rest }), [s.pictures, s.rest])
  const posePngs = useMemo(() => (poses.ready ? { ready: poses.ready.png, readyalt: poses.readyalt!.png, rest: poses.rest!.png } : null), [poses])
  const placements = useMemo(() => (poses.ready ? startingPlacements(s.select, (p) => poses[p]!.image) : null), [s.select, poses])

  const sizeOf = (k: Kind): [number, number] => (k === 'loading' ? A.stripsSize(outlines![0]) : k === 'hud' ? t.hud.size : t.tiles.normal[0].size)
  const pictureOf = (k: Kind, i: Costume): RgbaImage | null => (k === 'tile' ? tilePicture : (s.pictures[i] ?? s.pictures[0])?.image ?? null)
  const shared = (k: Kind, i: Costume): Costume => (k !== 'tile' && i === 1 && s.linked[k] ? 0 : i)
  const framingOf = (k: Kind, i: Costume): A.Framing => {
    const own = k === 'tile' ? s.tile[tileSource] : s[k][shared(k, i)]
    return own ?? A.defaultFraming(pictureOf(k, shared(k, i))!, sizeOf(k), A.FIT[k])
  }
  const setFraming = (k: Kind, i: Costume, f: A.Framing) => setS((st) => {
    if (k === 'tile') return { ...st, tile: { ...st.tile, [tileSource]: f } }
    const pair: Pair<A.Framing | null> = [...st[k]]
    pair[shared(k, i)] = f
    return { ...st, [k]: pair }
  })

  const load = async (which: TileSource) => {
    const file = await pickFile(PICTURES)
    if (!file) return
    try {
      const im = await decodePicture(file)
      const pic = { image: im, png: encodePng(im) }
      setS((st) => withPicture(st, which, pic))
    } catch (e) {
      store.fail(`The picture could not be read:\n${(e as Error).message}`)
    }
  }

  const ready = Boolean(s.pictures[0] && outlines && sizes && !mismatch.length)
  const shownCostume: Costume = kind !== 'tile' && s.pictures[1] ? costume : 0
  const picture = ready ? pictureOf(kind, shownCostume) : null
  const masks = useMemo(() => {
    if (!outlines) return null
    const [bg, fr] = t.tiles.normal
    const tileMask = bg.copy()
    tileMask.putAlpha(bg.alpha().map((v, i) => Math.max(v, fr.alpha()[i])))
    return { loading: A.joinStrips(outlines[0]), hud: t.hud, tile: tileMask }
  }, [outlines, t])

  const finish = () => {
    const inputs: A.ArtInputs = {
      pictures: [s.pictures[0]!.image, s.pictures[1]?.image ?? null],
      loading: [framingOf('loading', 0), framingOf('loading', 1)],
      hud: [framingOf('hud', 0), framingOf('hud', 1)],
      tile: framingOf('tile', 0),
      tilePicture: tilePicture!,
      rage: s.rage,
    }
    const c = store.character
    for (const [slot, im] of A.generate(inputs, { ...t, outlines: outlines! })) c.files.set(`ui/${slot}.png`, encodePng(im))
    const base: State['base'] = {}
    for (const [which, slot] of SLOTS) {
      const png = pictureIn(s, which)?.png
      if (png) c.files.set(`ui/${slot}.png`, png)
      else c.files.delete(`ui/${slot}.png`)
      base[slot] = png
    }
    c.ui.select = { ...placements! }
    c.ui.fade = s.fade
    kept = { owner: c, state: { ...s, base, baseUi: { select: c.ui.select, fade: c.ui.fade } } }
    store.touch('character')
    onClose()
  }

  return (
    <Modal title="Generate art from pictures" onClose={onClose} wide>
      <Note>Load a picture for each costume, then frame each piece of art on its tab. Drag to move, and use the mouse wheel to zoom. The dimmed area is cut away. The pictures also become the select-screen portraits on the Art tab.</Note>
      <div className="artgen-pictures">
        {([...COSTUMES, ['rest', 'REST']] as [TileSource, string][]).map(([which, label]) => {
          const pic = pictureIn(s, which)
          return (
            <div key={which} className="artgen-picture">
              <ImageView image={pic?.image ?? null} side={72} />
              <div>
                <div>{label} picture{which !== 0 ? ' (optional)' : ''}</div>
                <Note>{pic ? `${pic.image.width} x ${pic.image.height} pixels` : which === 1 ? "costume 1's art is used" : which === 'rest' ? "costume 1's picture is used" : 'required'}</Note>
                <div className="row">
                  <button className="small" onClick={() => void load(which)}>Load...</button>
                  {which !== 0 && <button className="small" disabled={!pic} onClick={() => setS((st) => withPicture(st, which, null))}>Clear</button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {mismatch.length > 0 && <Warning title="The art can't be generated for this base">The game's art sizes don't match the templates ({mismatch.join(', ')}).</Warning>}
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} className={k === tab ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="row">
        {tab === 'select' ? (
          <>
            {POSE_LABELS.map(([p, label]) => (
              <button key={p} className={`small toggle ${pose === p ? 'active' : ''}`} onClick={() => setPose(p)}>{label}</button>
            ))}
            <label>Fade-in rows at the top</label>
            <NumberInput min={0} max={200} step={1} value={s.fade} onChange={(v) => setS((st) => ({ ...st, fade: Math.round(v) }))} />
          </>
        ) : kind === 'tile' ? (
          <>
            <label>Picture:</label>
            <select value={tileSource} onChange={(e) => setS((st) => ({ ...st, tileSource: e.target.value === 'rest' ? 'rest' : Number(e.target.value) as Costume }))}>
              <option value="rest" disabled={!s.rest}>{s.rest ? 'REST' : 'REST (load its picture first)'}</option>
              {COSTUMES.map(([i, label]) => <option key={i} value={i} disabled={!s.pictures[i]}>{label}</option>)}
            </select>
            <Note>One picture makes both tiles; they're the same for both costumes. The inner box is the selected tile.</Note>
          </>
        ) : (
          <>
            {COSTUMES.map(([i, label]) => (
              <button key={i} className={`small toggle ${shownCostume === i ? 'active' : ''}`} disabled={!s.pictures[i]} onClick={() => setCostume(i)}>{label}</button>
            ))}
            <label className="check">
              <input type="checkbox" checked={s.linked[kind]} onChange={(e) => {
                const on = e.target.checked
                setS((st) => {
                  const pair: Pair<A.Framing | null> = [...st[kind]]
                  if (!on && picture) pair[1] = framingOf(kind, 0)
                  return { ...st, [kind]: pair, linked: { ...st.linked, [kind]: on } }
                })
              }} /> Costume 2 uses costume 1's framing
            </label>
          </>
        )}
      </div>
      {tab === 'select' ? (
        posePngs && placements ? (
          <>
            <Note>{PLACEMENT_HELP}</Note>
            <PlacementEditor pictures={posePngs} pose={pose} spec={placements} fade={s.fade}
              onChange={(p) => setS((st) => ({ ...st, select: { ...st.select, [pose]: p } }))} />
          </>
        ) : <p className="note">Load the costume 1 picture to start.</p>
      ) : picture && masks ? (
        <div className="artgen">
          <div>
            <FramingEditor picture={picture} framing={framingOf(kind, shownCostume)} size={sizeOf(kind)} zoom={ZOOM[kind]} mask={masks[kind]}
              seams={kind === 'loading' ? [outlines![0][0].width] : []} matte={kind !== 'tile'} inner={kind === 'tile' ? A.SELECTED_ZOOM : null}
              onChange={(f) => setFraming(kind, shownCostume, f)} />
            <FramingFields framing={framingOf(kind, shownCostume)} onChange={(f) => setFraming(kind, shownCostume, f)}
              onFit={() => setFraming(kind, shownCostume, A.defaultFraming(picture, sizeOf(kind), A.FIT[kind]))} />
          </div>
          <div className="artgen-side">
            <Previews kind={kind} s={s} outlines={outlines!} framingOf={framingOf} pictureOf={pictureOf}
              onRage={(i, v) => setS((st) => ({ ...st, rage: (i === 0 ? [v, st.rage[1]] : [st.rage[0], v]) as Pair<string> }))} />
          </div>
        </div>
      ) : (
        <p className="note">{failed ? "The game's loading screens could not be read." : !sizes || !outlines ? "Reading the game's art..." : mismatch.length ? '' : 'Load the costume 1 picture to start.'}</p>
      )}
      <div className="row">
        <span className="spacer" />
        <button disabled={!ready} onClick={finish}>OK</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

function Previews({ kind, s, outlines, framingOf, pictureOf, onRage }: {
  kind: Kind; s: State; outlines: Pair<RgbaImage[]>; framingOf: (k: Kind, i: Costume) => A.Framing; pictureOf: (k: Kind, i: Costume) => RgbaImage | null
  onRage: (i: Costume, v: string) => void
}) {
  const t = bundledTemplates()
  const costumes = COSTUMES.filter(([i]) => s.pictures[i])
  const f0 = framingOf(kind, 0), f1 = framingOf(kind, 1)
  const images = kind === 'tile'
    ? [A.tilePair(pictureOf('tile', 0)!, f0, t.tiles)]
    : costumes.map(([i]) => {
      const pic = pictureOf(kind, i)!, f = i === 0 ? f0 : f1
      return kind === 'loading' ? [A.joinStrips(A.loadingStrips(pic, f, outlines[i]))] : A.hudPair(pic, f, t.hud, s.rage[i])
    })

  if (kind === 'tile') {
    return (
      <div className="artgen-previews">
        <figure><ImageView image={images[0][0]} zoom={3} /><figcaption>Tile</figcaption></figure>
        <figure><ImageView image={images[0][1]} zoom={3} /><figcaption>Tile, selected</figcaption></figure>
      </div>
    )
  }
  return (
    <div className="artgen-previews">
      {costumes.map(([i, label], n) => (
        <figure key={i}>
          <div className="row">{images[n].map((im, k) => <ImageView key={k} image={im} zoom={kind === 'loading' ? 1 : 2} />)}</div>
          <figcaption>{label}{kind === 'hud' && ': normal, rage'}</figcaption>
          {kind === 'hud' && <div className="row"><label>Rage tint</label><ColorButton color={s.rage[i]} alpha onChange={(v) => onRage(i, v)} /></div>}
        </figure>
      ))}
    </div>
  )
}

function FramingFields({ framing, onChange, onFit }: { framing: A.Framing; onChange: (f: A.Framing) => void; onFit: () => void }) {
  const [cx, cy] = framing.center
  return (
    <div className="row artgen-fields">
      <label>Size</label>
      <NumberInput min={0.01} max={50} step={0.01} value={Math.round(framing.scale * 1000) / 1000} onChange={(v) => onChange({ ...framing, scale: v })} />
      <label>X</label>
      <NumberInput min={-16384} max={16384} step={1} value={Math.round(cx)} onChange={(v) => onChange({ ...framing, center: [v, cy] })} />
      <label>Y</label>
      <NumberInput min={-16384} max={16384} step={1} value={Math.round(cy)} onChange={(v) => onChange({ ...framing, center: [cx, v] })} />
      <button className="small" onClick={onFit}>Fit</button>
    </div>
  )
}

function FramingEditor({ picture, framing, size, zoom, mask, seams, matte, inner, onChange }: {
  picture: RgbaImage; framing: A.Framing; size: [number, number]; zoom: number; mask: RgbaImage; seams: number[]; matte: boolean; inner: number | null
  onChange: (f: A.Framing) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ framing, onChange })
  const drag = useRef<[number, number] | null>(null)
  const W = size[0] * zoom + 2 * MARGIN, H = size[1] * zoom + 2 * MARGIN
  const source = useMemo(() => toCanvas(picture), [picture])
  const shade = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(toCanvas(mask), MARGIN, MARGIN, size[0] * zoom, size[1] * zoom)
    return c
  }, [mask, size, zoom, W, H])

  useEffect(() => {
    latest.current = { framing, onChange }
  })

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const k = framing.scale * zoom
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    if (matte) {
      ctx.fillStyle = '#000'
      ctx.fillRect(MARGIN, MARGIN, size[0] * zoom, size[1] * zoom)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.setTransform(k, 0, 0, k, W / 2 - framing.center[0] * k, H / 2 - framing.center[1] * k)
    ctx.drawImage(source, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(shade, 0, 0)
    ctx.strokeStyle = 'rgba(255, 220, 0, 0.85)'
    ctx.setLineDash([4, 4])
    ctx.strokeRect(MARGIN - 0.5, MARGIN - 0.5, size[0] * zoom + 1, size[1] * zoom + 1)
    for (const x of seams) {
      ctx.beginPath()
      ctx.moveTo(MARGIN + x * zoom + 0.5, MARGIN)
      ctx.lineTo(MARGIN + x * zoom + 0.5, MARGIN + size[1] * zoom)
      ctx.stroke()
    }
    if (inner) {
      const w = (size[0] * zoom) / inner, h = (size[1] * zoom) / inner
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)'
      ctx.strokeRect(Math.round((W - w) / 2) - 0.5, Math.round((H - h) / 2) - 0.5, Math.round(w) + 1, Math.round(h) + 1)
    }
    ctx.setLineDash([])
  }, [framing, zoom, source, shade, seams, matte, inner, size, W, H])

  // React's wheel listener is passive, so it can't keep the page from scrolling
  useEffect(() => {
    const c = ref.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { framing: f, onChange: change } = latest.current
      const r = c.getBoundingClientRect()
      const px = e.clientX - r.left - W / 2, py = e.clientY - r.top - H / 2
      const k = f.scale * zoom
      const sx = f.center[0] + px / k, sy = f.center[1] + py / k
      const scale = f.scale * (e.deltaY < 0 ? 1 / 0.92 : 0.92)
      change({ scale, center: [sx - px / (scale * zoom), sy - py / (scale * zoom)] })
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [zoom, W, H])

  return (
    <div className="thumb checker artgen-editor">
      <canvas ref={ref} width={W} height={H}
        onPointerDown={(e) => {
          drag.current = [e.clientX, e.clientY]
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const k = framing.scale * zoom
          const dx = e.clientX - drag.current[0], dy = e.clientY - drag.current[1]
          drag.current = [e.clientX, e.clientY]
          onChange({ ...framing, center: [framing.center[0] - dx / k, framing.center[1] - dy / k] })
        }}
        onPointerUp={() => (drag.current = null)} />
    </div>
  )
}
