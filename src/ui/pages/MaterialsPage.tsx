import { useEffect, useState } from 'react'
import { zipSync } from 'fflate'
import { ENV_MAPS, FINISH_STRENGTH } from '../../core/build/shaders'
import { encodePng } from '../../core/image/png'
import type { RgbaImage } from '../../core/image/rgba'
import { copyCharacter, DAMAGE_HEALTH, damageMember, damageUpload, gunBone, gunOf, type Material, swapBone, type ZCostume, Z_COSTUMES } from '../../core/package/imperfect'
import { decodePicture, download, pickFile } from '../../io/files'
import { ImageView, Note, NumberInput, ToggleCard } from '../components/common'
import { engine } from '../engine'
import { artName, fileName } from '../format'
import { store, useStore } from '../store'
import { PlacementView } from './MovesPage'

const SIZES = [8, 16, 32, 64, 128, 256, 512, 1024]
const PICTURES = '.png,.jpg,.jpeg,.webp,.bmp,.gif'
const DEFAULT_STRENGTH = 0.6
const COSTUMES = ['costume1', 'costume2']
const COSTUME_LABELS: Record<ZCostume, string> = { normal: 'Costume 1', alt: 'Costume 2' }
type Thumbs = [RgbaImage | null, RgbaImage | null, (RgbaImage | null)[][]]
const NO_THUMBS: Thumbs = [null, null, [[], []]]

function matName(m: Material): string {
  return fileName(m.name || `mat${m.gltfMaterial}`)
}

function texturePngs(index: number | null) {
  return engine.call<[Uint8Array | null, Uint8Array | null, (Uint8Array | null)[][]][]>('materialPngs', [copyCharacter({ ...store.character, glb: null }), index])
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
    const add = (m: Material, what: string, body: Uint8Array | null) => {
      const name = `${matName(m)} - ${what}.png`
      if (body) entries[name in entries ? `${matName(m)} (mat${m.gltfMaterial}) - ${what}.png` : name] = body
    }
      ; (await texturePngs(null)).forEach(([own, alt, stages], i) => {
        const m = c.materials[i]
        add(m, COSTUMES[0], own)
        add(m, COSTUMES[1], alt)
        Z_COSTUMES.forEach((co, k) => stages[k]?.forEach((body, j) => {
          if (m.damage[co][j] !== 'prev') add(m, `${COSTUMES[k]} - damage ${j + 1}`, body)
        }))
      })
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
  const [thumbs, setThumbs] = useState<Thumbs[]>([])

  useEffect(() => {
    let live = true
    if (!c.materials.length) return
    engine.call<Thumbs[]>('materialThumbs', [copyCharacter({ ...store.character, glb: null })])
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
      {c.materials.length > 0 && <div className="materials-layout">
        <div>
          <DamageStages />
          {c.materials.map((_, i) => <MaterialCard key={i} index={i} thumbs={thumbs[i] ?? NO_THUMBS} />)}
        </div>
        <MaterialPreview />
      </div>}
    </div>
  )
}

function MaterialPreview() {
  const [alt, setAlt] = useState(false)
  return (
    <div className="card material-preview">
      <h4>Preview</h4>
      <select value={alt ? 1 : 0} onChange={(e) => setAlt(e.target.value === '1')}>
        <option value={0}>Costume 1</option>
        <option value={1}>Costume 2</option>
      </select>
      <PlacementView first="front" method="materialPreview" args={[alt]} what="the materials" />
      <Note>Metallic finish representation is not perfectly accurate. In-game lighting greatly affects finish.</Note>
    </div>
  )
}

// A picture in c.files that nothing names any more.
function dropUnused(member: string) {
  const c = store.character
  const named = c.materials.some((m) => m.texture === member || m.alt === member || Z_COSTUMES.some((k) => m.damage[k].includes(member))) ||
    Z_COSTUMES.some((k) => Object.values(c.zButton?.costume?.[k] ?? {}).includes(member))
  if (!named) c.files.delete(member)
}

function DamageStages() {
  useStore()
  const c = store.character
  const edited = () => store.touch('character')
  const set = (k: number, next: Partial<(typeof c.damageStages)[number]>) => {
    c.damageStages = c.damageStages.map((st, j) => (j === k ? { ...st, ...next } : st))
    edited()
  }
  const memory = Z_COSTUMES.map((co) => {
    let count = 0, bytes = 0
    for (const m of c.materials) {
      if (!m.include) continue
      c.damageStages.forEach((st, k) => {
        if (!st.enabled || m.damage[co][k] === 'prev') return
        count++
        bytes += (m.size[0] * m.size[1]) / 2
      })
    }
    return `${COSTUME_LABELS[co]}: ${count} texture${count === 1 ? '' : 's'}, ${Math.round(bytes / 1024)} KB`
  })
  const enabled = c.damageStages.filter((st) => st.enabled).length
  return (
    <ToggleCard title="Damage stages" checked={enabled > 0} note="Materials can change texture as health runs down."
      onChange={(on) => {
        c.damageStages = c.damageStages.map((st, j) => ({ ...st, enabled: on && j === 0 }))
        edited()
      }}>
      <div className="form">
        {c.damageStages.map((st, k) => (
          <div key={k} className="row tight" style={{ gridColumn: '1 / -1' }}>
            <label className="check"><input type="checkbox" checked={st.enabled} disabled={st.enabled && enabled === 1} onChange={(e) => set(k, { enabled: e.target.checked })} /> Stage {k + 1}</label>
            at or below
            <NumberInput className="short" min={DAMAGE_HEALTH[0]} max={DAMAGE_HEALTH[1]} disabled={!st.enabled} value={st.health}
              onChange={(v) => set(k, { health: Math.round(v) })} />% health
          </div>
        ))}
      </div>
      <Note>New textures take in-match memory. {memory.join('; ')}.</Note>
    </ToggleCard>
  )
}

function StageTexture({ index, costume, stage, first, thumb }: { index: number; costume: ZCostume; stage: number; first: boolean; thumb: RgbaImage | null }) {
  const m = store.character.materials[index]
  const v = m.damage[costume][stage]
  const mode = v === 'prev' ? 'prev' : v.startsWith('hue:') ? 'hue' : 'file'
  const set = (next: string) => {
    const mat = store.character.materials[index]
    mat.damage = { ...mat.damage, [costume]: mat.damage[costume].map((x, j) => (j === stage ? next : x)) }
    if (damageMember(v) && v !== next) dropUnused(v)
    store.touch('character')
  }
  const choose = async () => {
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
      const member = damageUpload(m.gltfMaterial, stage, costume)
      store.character.files.set(member, encodePng(im))
      set(member)
      return true
    })
  }
  return (
    <div className="row tight">
      <ImageView image={thumb} side={64} />
      <select value={mode} onChange={(e) => {
        const next = e.target.value
        if (next === 'file') return void choose()
        set(next === 'hue' ? 'hue:0' : 'prev')
      }}>
        <option value="prev">{first ? 'Undamaged texture' : 'Same as the stage before'}</option>
        <option value="hue">Hue shift of the undamaged texture</option>
        <option value="file">Another picture</option>
      </select>
      {mode === 'hue' && <><NumberInput className="short" min={-180} max={180} value={Math.trunc(parseFloat(v.slice(4)))}
        onChange={(n) => set(`hue:${Math.trunc(n)}`)} />°</>}
      {mode === 'file' && <button className="small" onClick={() => choose()}>Choose...</button>}
    </div>
  )
}

function MaterialCard({ index, thumbs }: { index: number; thumbs: Thumbs }) {
  useStore()
  const s = store
  const c = s.character
  const m = c.materials[index]
  const sk = s.game ? s.skeleton() : null
  const g = gunOf(c), gunAt = g ? gunBone(c.base, g.side) : undefined, swapAt = g?.swap ? swapBone(c.base, g.side) : undefined
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
      <div className="material-head">
        <h4>Material: {m.name || m.gltfMaterial}</h4>
        <span className="row tight" title="Name this material has in the game">
          <code>{c.internalName}[_alt]</code>
          <input className="short" value={m.suffix} maxLength={8} aria-label="Game material suffix" onChange={(e) => {
            if (/^(_[A-Za-z0-9]{0,7})?$/.test(e.target.value)) {
              m.suffix = e.target.value
              edited()
            }
          }} />
        </span>
        <label className="check head-include"><input type="checkbox" checked={m.include} onChange={(e) => { m.include = e.target.checked; edited() }} /> Draw this material</label>
      </div>
      <div className="material-body">
        <div className="costume">
          <div className="thumb-head">
            <span>Costume 1</span>
            <button className="small" title="Download this texture" aria-label={`Download ${m.name || m.gltfMaterial} costume 1`} disabled={!thumbs[0]}
              onClick={() => downloadTexture(index, 0)}>&#x2B07;</button>
          </div>
          <ImageView image={thumbs[0]} side={128} />
          <select aria-label="Costume 1 texture" value={m.texture ? 1 : 0} onChange={(e) => {
            if (e.target.value === '1') { if (!m.texture) void choose('texture') }
            else { m.texture = null; edited() }
          }}>
            <option value={0}>The model's own</option>
            <option value={1}>A picture</option>
          </select>
          {m.texture && <button className="small" onClick={() => choose('texture')}>Choose...</button>}
        </div>
        <div className="costume">
          <div className="thumb-head">
            <span>Costume 2</span>
            <button className="small" title={m.alt === 'same' ? 'Costume 2 uses the costume 1 texture' : 'Download this texture'}
              aria-label={`Download ${m.name || m.gltfMaterial} costume 2`} disabled={!thumbs[1] || m.alt === 'same'}
              onClick={() => downloadTexture(index, 1)}>&#x2B07;</button>
          </div>
          <ImageView image={thumbs[1]} side={128} />
          <select aria-label="Costume 2 texture" value={altMode} onChange={(e) => {
            const v = Number(e.target.value)
            if (v === 2) return void choose('alt')
            m.alt = v === 0 ? 'same' : 'hue:0'
            edited()
          }}>
            <option value={0}>Same texture</option>
            <option value={1}>Hue shift</option>
            <option value={2}>Another picture</option>
          </select>
          {altMode === 1 && <span className="row tight">
            <NumberInput className="short" min={-180} max={180} value={Math.trunc(parseFloat(m.alt.slice(4)))}
              onChange={(v) => {
                m.alt = `hue:${Math.trunc(v)}`
                edited()
              }} />°
          </span>}
          {altMode === 2 && <button className="small" onClick={() => choose('alt')}>Choose...</button>}
        </div>
        <div className="material-settings">
          <div className="form">
            <label title="Pixels in the game (most characters use 256x256)">Size</label>
            <div className="row tight">
              <select value={m.size[0]} onChange={(e) => { m.size = [Number(e.target.value), m.size[1]]; edited() }}>{SIZES.map((v) => <option key={v}>{v}</option>)}</select>
              x
              <select value={m.size[1]} onChange={(e) => { m.size = [m.size[0], Number(e.target.value)]; edited() }}>{SIZES.map((v) => <option key={v}>{v}</option>)}</select>
            </div>
            <label>Finish</label>
            <div className="row tight">
              <select value={m.finish?.envmap ?? ''} onChange={(e) => {
                m.finish = e.target.value === '' ? null : { envmap: e.target.value, intensity: m.finish?.intensity ?? DEFAULT_STRENGTH }
                edited()
              }}>
                <option value="">None</option>
                {ENV_MAPS.map((e) => <option key={e.name} value={e.name}>Metallic: {e.label}</option>)}
              </select>
              {m.finish && <>
                <span>at strength</span>
                <NumberInput className="short" min={FINISH_STRENGTH[0]} max={FINISH_STRENGTH[1]} step={0.05} value={m.finish.intensity}
                  onChange={(v) => {
                    if (!m.finish) return
                    m.finish = { ...m.finish, intensity: Math.round(v * 100) / 100 }
                    edited()
                  }} />
              </>}
            </div>
            <span />
            <label className="check"><input type="checkbox" checked={m.twoSided} onChange={(e) => { m.twoSided = e.target.checked; edited() }} /> Draw both sides (capes, thin cloth)</label>
          </div>
          <details open={m.bind !== null} className="advanced">
            <summary>Advanced</summary>
            <div className="row tight" title="Normally a material follows the skin weights. Fix it to one game bone for a prop, and model it where that bone is.">
              <span className="muted">Fixed to</span>
              <select value={m.bind ?? ''} onChange={(e) => { m.bind = e.target.value === '' ? null : Number(e.target.value); edited() }}>
                <option value="">(follows its skin weights)</option>
                {(sk?.nodes ?? []).map((n) => <option key={n.index} value={n.index}>{n.index} {n.name}</option>)}
                {m.bind !== null && sk && m.bind >= sk.nodes.length && <option value={m.bind}>{m.bind} {m.bind === gunAt ? 'Gun' : m.bind === swapAt ? 'Gun swap' : '(not on this base)'}</option>}
              </select>
              <span className="note">Set to a bone for a prop (Daredevil's club is 39)</span>
            </div>
          </details>
        </div>
      </div>
      {m.include && c.damageStages.some((st) => st.enabled) && (
        <table className="gameplay grid">
          <thead><tr><th>Damage stage</th>{Z_COSTUMES.map((k) => <th key={k}>{COSTUME_LABELS[k]}</th>)}</tr></thead>
          <tbody>
            {c.damageStages.map((st, k) => st.enabled && (
              <tr key={k}>
                <td>Stage {k + 1} (at or below {st.health}%)</td>
                {Z_COSTUMES.map((co, j) => <td key={co}>
                  <StageTexture index={index} costume={co} stage={k} first={!c.damageStages.slice(0, k).some((x) => x.enabled)} thumb={thumbs[2][j]?.[k] ?? null} />
                </td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
