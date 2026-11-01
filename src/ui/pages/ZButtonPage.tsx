import * as gun from '../../core/build/gun'
import { formatG } from '../../core/format'
import { Z_SECONDS, Z_SIZE, Z_SLOW, Z_VISIBLE, type ZAction } from '../../core/game/dol'
import { label } from '../../core/game/roster'
import { encodePng } from '../../core/image/png'
import { defaultGun, GAMEPLAY as RANGES, GUN_BULLETS, GUN_DAMAGE, GUN_ENERGY, GUN_SIDES, gunBone, type GunSide, LIFT, type ZButton, type ZCostume, Z_COSTUMES, type ZStats, zTexture } from '../../core/package/imperfect'
import { decodePicture, pickFile } from '../../io/files'
import { Note, NumberInput } from '../components/common'
import { store, useStore } from '../store'
import { DamageTable } from '../components/DamageTable'
import { HolsterPlace } from './MovesPage'

const ACTIONS: [ZAction, string][] = [
  ['stealth', 'Stealth Mode'],
  ['costume', 'Costume Change'],
  ['stats', 'Stat Change'],
  ['size', 'Change Size'],
  ['bullet', 'Bullet Time'],
  ['gun', 'Gun'],
]

const EFFECTS: ['undetected' | 'untouchable', string][] = [
  ['undetected', 'Enemies can\'t detect you: CPU opponents lose track of you'],
  ['untouchable', 'Enemies can\'t hit you: no hits, projectiles, grabs or throws'],
]

const COSTUME_LABELS: Record<ZCostume, string> = { normal: 'Costume 1', alt: 'Costume 2' }
const PICTURES = '.png,.jpg,.jpeg,.webp,.bmp,.gif'

const fresh = (action: ZAction): Partial<ZButton> => {
  if (action === 'stealth') return { stealth: { undetected: true, untouchable: true, visible: 0.2 } }
  if (action === 'costume') return { costume: { normal: {}, alt: {} } }
  if (action === 'size') return { size: 2 }
  if (action === 'bullet') return { bullet: 0.5 }
  if (action === 'gun') return { gun: defaultGun() }
  return { stats: {} }
}

export function ZButtonPage() {
  useStore()
  const c = store.character
  const z = c.zButton
  const energy = z?.requires.energy
  const edited = () => store.touch('character')
  const setAction = (action: ZAction, on: boolean) => {
    if (action === 'gun' && !on && z?.gun) unbindGun(z.gun.side)
    const next: ZButton = { ...(z ?? { stealth: null, costume: null, stats: null, size: null, bullet: null, gun: null, requires: {} }), ...(on ? fresh(action) : { [action]: null }) }
    c.zButton = next.stealth || next.costume || next.stats || next.size !== null || next.bullet !== null || next.gun ? next : null
    edited()
  }
  return (
    <div className="page">
      <h3>Z-Button Actions</h3>
      <Note>The Z button is never used in normal gameplay, and can be assigned to custom actions for ImperfectLab characters.<br />
      Pick what Z does in a match, and what it needs. Holding Z runs every ticked action at once. CPU players will never use these abilities.
      </Note>
      <h4>Requirements</h4>
      <div className={`card zaction ${energy ? 'on' : ''}`}>
        <label className="check zaction-head">
          <input type="checkbox" disabled={!z} checked={!!energy} onChange={(e) => {
            z!.requires = e.target.checked ? { ...z!.requires, energy: { seconds: 8, regen: false } } : {}
            edited()
          }} /> Drains Energy
        </label>
        <Note>The actions use energy while active, and can't start with none.</Note>
        {z && energy && (
          <div className="zaction-body">
            <div className="row tight">
              A full bar lasts <NumberInput className="short" min={Z_SECONDS[0]} max={Z_SECONDS[1]} step={1} value={energy.seconds} onChange={(v) => { energy.seconds = Math.round(v); edited() }} /> seconds
            </div>
            <label className="check block">
              <input type="checkbox" checked={energy.regen} onChange={(e) => { energy.regen = e.target.checked; edited() }} /> Keep the game's energy regeneration running while active (it lasts longer)
            </label>
          </div>
        )}
      </div>
      <h4>Actions</h4>
      {ACTIONS.map(([action, text]) => (
        <div key={action} className={`card zaction ${z?.[action] ? 'on' : ''}`}>
          <label className="check zaction-head">
            <input type="checkbox" checked={!!z?.[action]} onChange={(e) => setAction(action, e.target.checked)} /> {text}
          </label>
          {action === 'stealth' && z?.stealth && <Stealth />}
          {action === 'costume' && z?.costume && <Costume />}
          {action === 'stats' && z?.stats && <Stats />}
          {action === 'size' && z?.size && <Size />}
          {action === 'bullet' && z?.bullet && <BulletTime />}
          {action === 'gun' && z?.gun && <Gun />}
        </div>
      ))}
    </div>
  )
}

function Stealth() {
  const s = store.character.zButton!.stealth!
  const count = [s.undetected, s.untouchable, s.visible !== null].filter(Boolean).length
  const edited = () => store.touch('character')
  return (
    <div className="zaction-body">
      {EFFECTS.map(([key, text]) => (
        <label key={key} className="check block">
          <input type="checkbox" checked={s[key]} disabled={s[key] && count === 1}
            onChange={(e) => { s[key] = e.target.checked; edited() }} /> {text}
        </label>
      ))}
      <label className="check block">
        <input type="checkbox" checked={s.visible !== null} disabled={s.visible !== null && count === 1}
          onChange={(e) => { s.visible = e.target.checked ? 0.2 : null; edited() }} /> Fade out: you're only partly visible
      </label>
      {s.visible !== null && (
        <div className="row tight zaction-indent">
          <input type="range" min={100 * Z_VISIBLE[0]} max={100 * Z_VISIBLE[1]} step={5} value={Math.round(100 * s.visible)} aria-label="Visibility"
            onChange={(e) => { s.visible = Number(e.target.value) / 100; edited() }} /> {Math.round(100 * s.visible)}% visible{s.visible === 0 && ' (not drawn at all)'}
        </div>
      )}
    </div>
  )
}

function Costume() {
  const c = store.character
  const included = c.materials.filter((m) => m.include)
  return (
    <div className="zaction-body">
      <Note>While Z is held, costumes are replaced with the textures below. Uses additional in-match memory.</Note>
      {!included.length ? <Note>Import a model in the Model step first.</Note> : (
        <table className="gameplay grid">
          <thead><tr><th>Material</th>{Z_COSTUMES.map((k) => <th key={k}>{COSTUME_LABELS[k]} while Z is held</th>)}</tr></thead>
          <tbody>
            {included.map((m) => (
              <tr key={m.gltfMaterial}>
                <td>{m.name || m.gltfMaterial}</td>
                {Z_COSTUMES.map((k) => <td key={k}><CostumeTexture costume={k} material={m.gltfMaterial} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CostumeTexture({ costume, material }: { costume: ZCostume; material: number }) {
  const v = zTexture(store.character.zButton!, costume, material)
  const mode = v === 'normal' || v === 'alt' ? v : v.startsWith('hue:') ? 'hue' : 'file'
  const set = (next: string) => {
    store.character.zButton!.costume![costume][material] = next
    store.touch('character')
  }
  const choose = async () => {
    const file = await pickFile(PICTURES)
    if (!file) return false
    return store.edit(async () => {
      let im
      try {
        im = await decodePicture(file)
      } catch (e) {
        store.fail(`The picture could not be read:\n${(e as Error).message}`)
        return false
      }
      const member = `textures/mat${material}_${costume === 'alt' ? 'altz' : 'z'}.png`
      store.character.files.set(member, encodePng(im))
      set(member)
      return true
    })
  }
  return (
    <div className="row tight">
      <select value={mode} onChange={(e) => {
        const next = e.target.value
        if (next === 'file') return void choose()
        set(next === 'hue' ? 'hue:0' : next)
      }}>
        <option value="normal">Costume 1's texture</option>
        <option value="alt">Costume 2's texture</option>
        <option value="hue">Hue shift of Costume 1's</option>
        <option value="file">Another picture</option>
      </select>
      {mode === 'hue' && <><NumberInput className="short" min={-180} max={180} value={Math.trunc(parseFloat(v.slice(4)))}
        onChange={(n) => set(`hue:${Math.trunc(n)}`)} />°</>}
      {mode === 'file' && <button className="small" onClick={() => choose()}>Choose...</button>}
    </div>
  )
}

function Size() {
  const z = store.character.zButton!
  return (
    <div className="zaction-body">
      <div className="row tight">
        <NumberInput className="short" step={0.05} min={Z_SIZE[0]} max={Z_SIZE[1]} value={z.size!} onChange={(v) => {
          z.size = v
          store.touch('character')
        }} />x
      </div>
      <Note>Times the character's size while Z is held, on top of the Model page's size.</Note>
    </div>
  )
}

function BulletTime() {
  const z = store.character.zButton!
  return (
    <div className="zaction-body">
      <div className="row tight">
        <input type="range" min={100 * Z_SLOW[0]} max={100 * Z_SLOW[1]} step={5} value={Math.round(100 * z.bullet!)} aria-label="World speed"
          onChange={(e) => { z.bullet = Number(e.target.value) / 100; store.touch('character') }} /> {Math.round(100 * z.bullet!)}% world speed
      </div>
      <Note>While Z is held, everything else (opponents, CPU players, projectiles and thrown objects) moves at this speed, and you move at full speed.</Note>
    </div>
  )
}

function Stats() {
  const c = store.character
  const stats = c.zButton!.stats!
  const bv = store.baseDetails()
  const set = (key: keyof ZStats, v: number | string | null) => {
    const st = store.character.zButton!.stats! as Record<string, number | string>
    if (v === null) delete st[key]
    else st[key] = v
    store.touch('character')
  }
  const taken = c.gameplay.damage_taken ?? bv?.gameplay.damage_taken
  const lift = c.gameplay.lift ?? bv?.lift
  const [lo, hi] = RANGES.damage_taken
  return (
    <div className="zaction-body">
      <Note>While Z is held, these values replace the character's own.</Note>
      {store.game && <DamageTable values={stats as Record<string, number | undefined>} set={(k, v) => set(k as keyof ZStats, v === null ? null : Math.round(v * 10) / 10)} own />}
      <table className="gameplay grid">
        <thead><tr><th>Value</th><th className="num">Normal</th><th>While Z is held</th></tr></thead>
        <tbody>
          <tr>
            <td><label className="check"><input type="checkbox" checked={stats.damage_taken !== undefined} onChange={(e) => {
              set('damage_taken', e.target.checked ? Math.round(1000 * (taken ?? 1)) / 1000 : null)
            }} /> Damage taken</label></td>
            <td className="num">{taken === undefined ? '-' : `${formatG(Math.round(1000 * taken) / 10)}%`}</td>
            <td><NumberInput className="short" disabled={stats.damage_taken === undefined} min={100 * lo} max={100 * hi} step={0.1}
              value={Math.round(1000 * (stats.damage_taken ?? taken ?? 1)) / 10} onChange={(v) => set('damage_taken', Math.round(v * 10) / 1000)} />%</td>
          </tr>
          <tr>
            <td><label className="check"><input type="checkbox" checked={stats.lift !== undefined} onChange={(e) => {
              set('lift', e.target.checked ? lift ?? 'medium' : null)
            }} /> Lifting strength</label></td>
            <td className="num">{lift ?? '-'}</td>
            <td><select disabled={stats.lift === undefined} value={stats.lift ?? lift ?? 'medium'} onChange={(e) => set('lift', e.target.value)}>
              {LIFT.map((v) => <option key={v}>{v}</option>)}</select></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function unbindGun(side: GunSide) {
  const c = store.character
  for (const m of c.materials) if (m.bind === gunBone(c.base, side)) m.bind = null
}

function Gun() {
  const c = store.character
  const z = c.zButton!, g = z.gun!
  const edited = () => store.touch('character')
  const bone = (side: GunSide) => gunBone(c.base, side)
  const part = c.materials.findIndex((m) => m.include && m.bind === bone(g.side))
  const set = (next: Partial<typeof g>) => {
    z.gun = { ...g, ...next }
    edited()
  }
  const setSide = (side: GunSide) => {
    const was = bone(g.side)
    for (const m of c.materials) if (m.bind === was) m.bind = bone(side)
    const [x, y, zz] = g.holster.position, [rx, ry, rz] = g.holster.rotation
    set({ side, holster: { position: [-x, y, zz], rotation: [rx, -ry, -rz] } })
  }
  const setPart = (i: number) => {
    unbindGun(g.side)
    if (i >= 0) c.materials[i] = { ...c.materials[i], bind: bone(g.side), include: true }
    edited()
  }
  return (
    <div className="zaction-body">
      <Note>
        The gun rides in a holster at the hip. While holding Z, the character holds the gun and any attack fires the gun.<br />
        The bullets make {label(c.base)}'s super attack sound: the game picks a move's sounds through scripts that other moves share, so the gun can't have a sound of its own yet.
      </Note>
      <table className="gameplay grid">
        <thead><tr><th>Value</th><th>Setting</th></tr></thead>
        <tbody>
          <tr>
            <td>Hand and holster side</td>
            <td><select value={g.side} onChange={(e) => setSide(e.target.value as GunSide)}>
              {GUN_SIDES.map((side) => <option key={side} value={side}>{side}</option>)}
            </select></td>
          </tr>
          <tr>
            <td>Gun part (material)</td>
            <td><select value={part} onChange={(e) => setPart(Number(e.target.value))}>
              <option value={-1}>(none)</option>
              {c.materials.map((m, i) => <option key={i} value={i}>{m.name || `material ${m.gltfMaterial}`}{m.include ? '' : ' (excluded)'}</option>)}
            </select></td>
          </tr>
          <tr>
            <td>Damage per bullet</td>
            <td><NumberInput min={GUN_DAMAGE[0]} max={GUN_DAMAGE[1]} step={1} value={g.damage} onChange={(v) => set({ damage: Math.round(v) })} /> <span className="muted">Elektra's sai: {gun.DEFAULT_DAMAGE}</span></td>
          </tr>
          <tr>
            <td>Energy per shot</td>
            <td><NumberInput min={GUN_ENERGY[0]} max={GUN_ENERGY[1]} step={0.5} value={g.energy} onChange={(v) => set({ energy: Math.round(v * 10) / 10 })} /> <span className="muted">of a full bar of 100</span></td>
          </tr>
          <tr>
            <td>Bullets per shot</td>
            <td><NumberInput min={GUN_BULLETS[0]} max={GUN_BULLETS[1]} step={1} value={g.bullets} onChange={(v) => set({ bullets: Math.round(v) })} /> <span className="muted">fired in a quick burst</span></td>
          </tr>
          <tr>
            <td>Machine gun</td>
            <td><label className="check"><input type="checkbox" checked={g.automatic} onChange={(e) => set({ automatic: e.target.checked })} /> Keep shooting while attack is held</label></td>
          </tr>
        </tbody>
      </table>
      <HolsterPlace h={g.holster} from={`the ${g.side} thigh`} view="front" gun onChange={(h) => set({ holster: { position: h.position, rotation: h.rotation } })} />
    </div>
  )
}
