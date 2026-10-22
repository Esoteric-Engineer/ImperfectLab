import { useMemo, useState } from 'react'
import * as R from '../../core/game/roster'
import { decodePng, encodePng } from '../../core/image/png'
import type { RgbaImage } from '../../core/image/rgba'
import { decodePicture, pickFile } from '../../io/files'
import { CropDialog } from '../components/CropDialog'
import { ImageView, Note } from '../components/common'
import { PlacementDialog } from '../components/PlacementDialog'
import { store, useStore } from '../store'

const SLOTS: [string, string, string][] = [
  ['select_ready', 'Select screen, READY', 'free'],
  ['select_rest', 'Select screen, REST', 'free'],
  ['select_readyalt', 'Select screen, costume 2', 'free'],
  ['tile', 'Tile', 'tile0'],
  ['tile_selected', 'Tile, selected', 'tile1'],
  ['hud', 'HUD portrait', 'hud'],
  ['hud_rage', 'HUD portrait, rage', 'hud'],
  ['hud_alt', 'HUD portrait, costume 2', 'hud'],
  ['hud_alt_rage', 'HUD, costume 2 rage', 'hud'],
  ['load_wide', 'Loading screen, wide strip', 'strip0'],
  ['load_narrow', 'Loading screen, narrow strip', 'strip1'],
  ['load_wide_alt', 'Loading, wide, costume 2', 'strip0_alt'],
  ['load_narrow_alt', 'Loading, narrow, costume 2', 'strip1_alt'],
  ['banner', 'In-match name banner', 'banner'],
]
const PICTURES = '.png,.jpg,.jpeg,.webp,.bmp,.gif'

const sources = new Map<string, RgbaImage>()

function fallback(slot: string): string {
  const files = store.character.files
  const base = store.base()
  const name = base ? base.label : 'the base character'
  const ready = files.has('ui/select_ready.png')
  if (slot === 'select_ready') return `${name}'s portraits are used`
  if (slot.startsWith('select_')) return ready ? "READY's picture is used" : `${name}'s portraits are used`
  if (slot.startsWith('tile')) return slot === 'tile_selected' && files.has('ui/tile.png') ? 'the unselected tile is used' : `${name}'s tile is used`
  if (slot.startsWith('load_')) {
    if (!ready) return `${name}'s are used`
    return slot.endsWith('_alt') && files.has('ui/load_wide.png') ? "costume 1's strip is used" : 'cut from the READY portrait'
  }
  if (slot === 'hud') return `${name}'s HUD portraits are used`
  if (slot.startsWith('hud_')) return files.has('ui/hud.png') ? 'the HUD portrait is used' : `${name}'s is used`
  if (slot === 'banner') return 'no banner (the game leaves it out)'
  return ''
}

export function ArtPage() {
  useStore()
  const s = store
  const c = s.character
  const details = s.baseDetails()
  const sizes = s.game ? (details?.sizes ?? null) : null
  const [placing, setPlacing] = useState(false)
  const [crop, setCrop] = useState<{ slot: string; image: RgbaImage; size: [number, number]; title: string } | null>(null)

  const applyPicture = (slot: string, kind: string, title: string, im: RgbaImage, force = false) => {
    const size = kind !== 'free' ? (sizes?.[kind] ?? null) : null
    if (size && (im.width !== size[0] || im.height !== size[1] || force)) {
      setCrop({ slot, image: im, size, title })
      return
    }
    if (kind !== 'free' && size === null) {
      store.fail("Choose the game disc first: this picture's size comes from the game.")
      return
    }
    c.files.set(`ui/${slot}.png`, encodePng(im))
    store.touch('character')
  }

  return (
    <div className="page">
      <h3>Portraits, tile and HUD</h3>
      <Note>Art is optional, defaulting to the base character's art when unset. Exact-size pictures open a crop box when they don't fit.</Note>
      <div className="row">
        <button disabled={!s.game || !c.files.has('ui/select_ready.png')} onClick={() => setPlacing(true)}>Place the portrait...</button>
        <label className="check"><input type="checkbox" checked={c.ui.banner ?? true} onChange={(e) => { c.ui.banner = e.target.checked; store.touch('character') }} /> Use the name banner picture in matches (experimental)</label>
      </div>
      <div className="row">
        <label>Voice when picked (experimental):</label>
        <select value={c.ui.ready_voice ?? ''} onChange={(e) => { c.ui.ready_voice = e.target.value || null; store.touch('character') }}>
          <option value="">none (no voice)</option>
          {R.keys().map((k) => <option key={k} value={R.VOICES[k]}>{R.label(k)}'s</option>)}
        </select>
      </div>
      <div className="slots">
        {SLOTS.map(([slot, title, kind]) => (
          <SlotCard key={slot} slot={slot} title={title} kind={kind} size={kind !== 'free' ? (sizes?.[kind] ?? null) : null}
            onLoad={async () => {
              const file = await pickFile(PICTURES)
              if (!file) return
              try {
                const im = await decodePicture(file)
                sources.set(slot, im)
                applyPicture(slot, kind, title, im)
              } catch (e) {
                store.fail(`The picture could not be read:\n${(e as Error).message}`)
              }
            }}
            onRecrop={() => {
              const im = sources.get(slot)
              if (im) applyPicture(slot, kind, title, im, true)
            }}
            onClear={() => {
              c.files.delete(`ui/${slot}.png`)
              sources.delete(slot)
              store.touch('character')
            }} />
        ))}
      </div>
      {placing && <PlacementDialog onClose={() => setPlacing(false)} />}
      {crop && <CropDialog image={crop.image} size={crop.size} title={crop.title} onDone={(im) => {
        const slot = crop.slot
        setCrop(null)
        if (im) {
          c.files.set(`ui/${slot}.png`, encodePng(im))
          store.touch('character')
        }
      }} />}
    </div>
  )
}

function SlotCard({ slot, title, kind, size, onLoad, onRecrop, onClear }: {
  slot: string; title: string; kind: string; size: [number, number] | null; onLoad: () => void; onRecrop: () => void; onClear: () => void
}) {
  useStore()
  const s = store
  const body = s.character.files.get(`ui/${slot}.png`)
  const image = useMemo(() => {
    try {
      return body ? decodePng(body) : null
    } catch {
      return null
    }
  }, [body])
  const sizeText = kind === 'free' ? 'any size; placed with "Place the portrait..."' : size ? `${size[0]} x ${size[1]} pixels` : 'size unknown until the game disc is chosen'
  return (
    <div className="card slot">
      <h4>{title}</h4>
      <div className="slot-body">
        <ImageView image={image} side={110} />
        <div>
          <div>{sizeText}</div>
          <Note>{body ? 'Your picture' : fallback(slot)}</Note>
          <div className="row">
            <button className="small" onClick={onLoad}>Load...</button>
            <button className="small" onClick={onRecrop} disabled={!sources.has(slot) || kind === 'free'}>Crop again</button>
            <button className="small" onClick={onClear}>Clear</button>
          </div>
        </div>
      </div>
    </div>
  )
}
