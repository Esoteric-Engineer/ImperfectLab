import { useEffect, useState } from 'react'
import { zipSync } from 'fflate'
import { encodePng } from '../../core/image/png'
import type { RgbaImage } from '../../core/image/rgba'
import { copyCharacter, type Material } from '../../core/package/imperfect'
import { decodePicture, download, pickFile } from '../../io/files'
import { ImageView, Note, NumberInput } from '../components/common'
import { engine } from '../engine'
import { artName, fileName } from '../format'
import { store, useStore } from '../store'

const SIZES = [8, 16, 32, 64, 128, 256, 512, 1024]
const PICTURES = '.png,.jpg,.jpeg,.webp,.bmp,.gif'
const COSTUMES = ['costume1', 'costume2']

function matName(m: Material): string {
  return fileName(m.name || `mat${m.gltfMaterial}`)
}

function texturePngs(index: number | null) {
  return engine.call<[Uint8Array | null, Uint8Array | null][]>('materialPngs', [copyCharacter({ ...store.character, glb: null }), index])
}

async function downloadTexture(index: number, costume: 0 | 1) {
  try {
    const body = (await texturePngs(index))[index][costume]
    if (!body) return store.fail('This texture could not be read.')
    const c = store.character
    download(body, `${artName(c)} - ${matName(c.materials[index])} - ${COSTUMES[costume]}.png`, 'image/png')
  } catch (e) {
    store.fail(e)
  }
}

async function downloadAll() {
  try {
    const c = store.character
    const entries: Record<string, Uint8Array> = {}
    ;(await texturePngs(null)).forEach((pair, i) => pair.forEach((body, k) => {
      const m = c.materials[i]
      const name = `${matName(m)} - ${COSTUMES[k]}.png`
      if (body) entries[name in entries ? `${matName(m)} (mat${m.gltfMaterial}) - ${COSTUMES[k]}.png` : name] = body
    }))
    if (!Object.keys(entries).length) return store.fail('None of the textures could be read.')
    download(zipSync(entries, { level: 0 }), `${artName(c)} - textures.zip`, 'application/zip')
  } catch (e) {
    store.fail(e)
  }
}

export function MaterialsPage() {
  useStore()
  const s = store
  const c = s.character
  const [thumbs, setThumbs] = useState<[RgbaImage | null, RgbaImage | null][]>([])

  useEffect(() => {
    let live = true
    if (!c.materials.length) return
    engine.call<[RgbaImage | null, RgbaImage | null][]>('materialThumbs', [copyCharacter({ ...store.character, glb: null })])
      .then((t) => live && setThumbs(t), () => live && setThumbs([]))
    return () => {
      live = false
    }
  }, [c, s.versions.character, s.versions.model])

  return (
    <div className="page">
      <h3>Materials and costumes</h3>
      <Note>Each material of your model becomes a game material with one texture. Costume 2 uses the Costume 1 textures unless otherwise specified.</Note>
      {c.materials.length > 0 && <div className="row">
        <button onClick={downloadAll}>Download all textures</button>
        <Note>Saves every material as a zip of PNG files.</Note>
      </div>}
      {!c.materials.length && <div className="card"><h4>No model yet</h4><Note>Import a model in the Model step first.</Note></div>}
      {c.materials.map((_, i) => <MaterialCard key={i} index={i} thumbs={thumbs[i] ?? [null, null]} />)}
    </div>
  )
}

function MaterialCard({ index, thumbs }: { index: number; thumbs: [RgbaImage | null, RgbaImage | null] }) {
  useStore()
  const s = store
  const c = s.character
  const m = c.materials[index]
  const sk = s.game ? s.skeleton() : null
  const edited = () => s.touch('character')
  const altMode = m.alt === 'same' ? 0 : m.alt.startsWith('hue:') ? 1 : 2

  const choose = async (which: 'texture' | 'alt') => {
    const file = await pickFile(PICTURES)
    if (!file) return false
    return store.edit(async () => {
      let im: RgbaImage
      try {
        im = await decodePicture(file)
      } catch (e) {
        store.fail(`The picture could not be read:\n${(e as Error).message}`)
        return false
      }
      const member = `textures/mat${m.gltfMaterial}${which === 'alt' ? '_alt' : ''}.png`
      c.files.set(member, encodePng(im))
      if (which === 'alt') m.alt = member
      else {
        m.texture = member
        if (Math.max(im.width, im.height) <= 1024) m.size = [im.width, im.height].map((d) => Math.min(512, 1 << Math.max(3, 32 - Math.clz32(d - 1)))) as [number, number]
      }
      edited()
      return true
    })
  }

  return (
    <div className="card material">
      <h4>Material: {m.name || m.gltfMaterial}</h4>
      <div className="material-body">
        <div className="thumbs">
          <div className="thumb-head">
            <span>Costume 1</span>
            <button className="small" title="Download this texture" aria-label={`Download ${m.name || m.gltfMaterial} costume 1`} disabled={!thumbs[0]}
              onClick={() => downloadTexture(index, 0)}>&#x2B07;</button>
          </div>
          <ImageView image={thumbs[0]} side={128} />
          <div className="thumb-head">
            <span>Costume 2</span>
            <button className="small" title={m.alt === 'same' ? 'Costume 2 uses the costume 1 texture' : 'Download this texture'}
              aria-label={`Download ${m.name || m.gltfMaterial} costume 2`} disabled={!thumbs[1] || m.alt === 'same'}
              onClick={() => downloadTexture(index, 1)}>&#x2B07;</button>
          </div>
          <ImageView image={thumbs[1]} side={128} />
        </div>
        <div className="form">
          <span />
          <label className="check"><input type="checkbox" checked={m.include} onChange={(e) => { m.include = e.target.checked; edited() }} /> Draw this material</label>
          <label>Game material</label>
          <div className="row tight">
            <code>{c.internalName}[_alt]</code>
            <input className="short" value={m.suffix} maxLength={8} onChange={(e) => {
              if (/^(_[A-Za-z0-9]{0,7})?$/.test(e.target.value)) {
                m.suffix = e.target.value
                edited()
              }
            }} />
          </div>
          <label>Texture</label>
          <div className="row tight">
            <label className="check"><input type="radio" checked={!m.texture} onChange={() => { m.texture = null; edited() }} /> The model's own</label>
            <label className="check"><input type="radio" checked={Boolean(m.texture)} onChange={() => { if (!m.texture) void choose('texture') }} /> A picture:</label>
            <button className="small" onClick={() => choose('texture')}>Choose...</button>
          </div>
          <label>Size</label>
          <div className="row tight">
            <select value={m.size[0]} onChange={(e) => { m.size = [Number(e.target.value), m.size[1]]; edited() }}>{SIZES.map((v) => <option key={v}>{v}</option>)}</select>
            x
            <select value={m.size[1]} onChange={(e) => { m.size = [m.size[0], Number(e.target.value)]; edited() }}>{SIZES.map((v) => <option key={v}>{v}</option>)}</select>
            <span className="note">pixels in the game (most characters use 256x256)</span>
          </div>
          <span />
          <label className="check"><input type="checkbox" checked={m.twoSided} onChange={(e) => { m.twoSided = e.target.checked; edited() }} /> Draw both sides (capes, thin cloth)</label>
          <label>Costume 2</label>
          <div className="row tight">
            <select value={altMode} onChange={(e) => {
              const v = Number(e.target.value)
              if (v === 2) return void choose('alt')
              m.alt = v === 0 ? 'same' : 'hue:0'
              edited()
            }}>
              <option value={0}>Same texture</option>
              <option value={1}>Hue shift</option>
              <option value={2}>Another picture</option>
            </select>
            <NumberInput className="short" min={-180} max={180} disabled={altMode !== 1} value={altMode === 1 ? Math.trunc(parseFloat(m.alt.slice(4))) : 0}
              onChange={(v) => {
                m.alt = `hue:${Math.trunc(v)}`
                edited()
              }} />°
            <button className="small" onClick={() => choose('alt')}>Choose...</button>
          </div>
          <label>Fixed to</label>
          <div>
            <select value={m.bind ?? ''} onChange={(e) => { m.bind = e.target.value === '' ? null : Number(e.target.value); edited() }}>
              <option value="">(follows its skin weights)</option>
              {(sk?.nodes ?? []).map((n) => <option key={n.index} value={n.index}>{n.index} {n.name}</option>)}
            </select>
            <Note>Normally a material follows the skin weights. Fix it to one game bone for a prop (Daredevil's club is bone 39), and model it where that bone is.</Note>
          </div>
        </div>
      </div>
    </div>
  )
}
