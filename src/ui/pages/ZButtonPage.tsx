import * as gun from '../../core/build/gun'
import { soundChoices } from '../../core/build/moves'
import { formatG } from '../../core/format'
import { LASER_TICK_SECONDS, Z_SECONDS, Z_SIZE, Z_SLOW, Z_VISIBLE, type ZAction } from '../../core/game/dol'
import { label } from '../../core/game/roster'
import { encodePng } from '../../core/image/png'
import { defaultGun, defaultLaser, GAMEPLAY as RANGES, LASER_DAMAGE, LASER_POSITION, LASER_RANGE, laserDefault, GUN_BULLETS, GUN_DAMAGE, GUN_ENERGY, GUN_PLACES, GUN_SIDES, gunBone, gunHolster, type GunPlace, type GunSide, LIFT, mirrorPlace, swapBone, soundRef, type ZButton, type ZCostume, Z_COSTUMES, type ZStats, zTexture } from '../../core/package/imperfect'
import { decodePicture, pickFile } from '../../io/files'
import { BoneSelect, PositionTable } from '../components/bones'
import { ColorButton, Note, NumberInput, ToggleCard } from '../components/common'
import { store, useStore } from '../store'
import { DamageTable } from '../components/DamageTable'
import { HolsterPlace, PlacementView } from './MovesPage'

const ACTIONS: [ZAction, string][] = [
  ['stealth', 'Stealth Mode'],
  ['costume', 'Costume Change'],
  ['stats', 'Stat Change'],
  ['size', 'Change Size'],
  ['bullet', 'Bullet Time'],
  ['gun', 'Gun'],
  ['laser', 'Laser Beam'],
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
  if (action === 'laser') return { laser: defaultLaser() }
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
    const next: ZButton = { ...(z ?? { stealth: null, costume: null, stats: null, size: null, bullet: null, gun: null, laser: null, requires: {} }), ...(on ? fresh(action) : { [action]: null }) }
    c.zButton = next.stealth || next.costume || next.stats || next.size !== null || next.bullet !== null || next.gun || next.laser ? next : null
    edited()
  }
  return (
    <div className="page">
      <h3>Z-Button Actions</h3>
      <Note>The Z button is never used in normal gameplay, and can be assigned to custom actions for ImperfectLab characters.<br />
      Pick what Z does in a match, and what it needs. Holding Z runs every ticked action at once. CPU players will never use these abilities.
      </Note>
      <h4>Requirements</h4>
      <ToggleCard title="Drains Energy" checked={!!energy} disabled={!z} onChange={(on) => {
        z!.requires = on ? { ...z!.requires, energy: { seconds: 8, regen: false } } : {}
        edited()
      }} note="The actions use energy while active, and can't start with none.">
        {energy && (
          <>
            <div className="row tight">
              A full bar lasts <NumberInput className="short" min={Z_SECONDS[0]} max={Z_SECONDS[1]} step={1} value={energy.seconds} onChange={(v) => { energy.seconds = Math.round(v); edited() }} /> seconds
            </div>
            <label className="check block">
              <input type="checkbox" checked={energy.regen} onChange={(e) => { energy.regen = e.target.checked; edited() }} /> Keep the game's energy regeneration running while active (it lasts longer)
            </label>
          </>
        )}
      </ToggleCard>
      <h4>Actions</h4>
      {ACTIONS.map(([action, text]) => (
        <ToggleCard key={action} title={text} checked={!!z?.[action]} onChange={(on) => setAction(action, on)}>
          {action === 'stealth' && <Stealth />}
          {action === 'costume' && <Costume />}
          {action === 'stats' && <Stats />}
          {action === 'size' && <Size />}
          {action === 'bullet' && <BulletTime />}
          {action === 'gun' && <Gun />}
          {action === 'laser' && <LaserBeam />}
        </ToggleCard>
      ))}
    </div>
  )
}

function Stealth() {
  const s = store.character.zButton!.stealth!
  const count = [s.undetected, s.untouchable, s.visible !== null].filter(Boolean).length
  const edited = () => store.touch('character')
  return (
    <>
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
        <div className="row tight toggle-indent">
          <input type="range" min={100 * Z_VISIBLE[0]} max={100 * Z_VISIBLE[1]} step={5} value={Math.round(100 * s.visible)} aria-label="Visibility"
            onChange={(e) => { s.visible = Number(e.target.value) / 100; edited() }} /> {Math.round(100 * s.visible)}% visible{s.visible === 0 && ' (not drawn at all)'}
        </div>
      )}
    </>
  )
}

function Costume() {
  const c = store.character
  const included = c.materials.filter((m) => m.include)
  return (
    <>
      <Note>While Z is held, costumes are replaced with the textures below. Uses additional in-match memory. Holding Z overrides any health-based texture changes, if those are set.</Note>
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
    </>
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
    <>
      <div className="row tight">
        <NumberInput className="short" step={0.05} min={Z_SIZE[0]} max={Z_SIZE[1]} value={z.size!} onChange={(v) => {
          z.size = v
          store.touch('character')
        }} />x
      </div>
      <Note>Times the character's size while Z is held, on top of the Model page's size.</Note>
    </>
  )
}

function LaserBeam() {
  const c = store.character
  const l = c.zButton!.laser!
  const edited = () => store.touch('character')
  const setAxis = (k: number, v: number) => {
    l.position = l.position.map((x, i) => (i === k ? Math.round(v * 1000) / 1000 : x)) as typeof l.position
    edited()
  }
  return (
    <>
      <Note>While Z is held, the character stands and fires Iron Man's finisher beam straight ahead. The beam stops at the first thing it hits, and whatever it hits takes damage {Math.round(1 / LASER_TICK_SECONDS)} times a second.</Note>
      {c.zButton!.gun && <Note>✖ The Gun also fires with Z: untick one of them.</Note>}
      <div className="form">
        <label>Costume 1 color</label>
        <ColorButton color={l.color} onChange={(v) => { l.color = v; edited() }} />
        <label>Costume 2 color</label>
        <ColorButton color={l.alt_color} onChange={(v) => { l.alt_color = v; edited() }} />
        <label>Damage</label>
        <span><NumberInput className="short" min={LASER_DAMAGE[0]} max={LASER_DAMAGE[1]} step={1} value={l.damage} onChange={(v) => { l.damage = Math.round(v); edited() }} /> a second <span className="muted">(Iron Man's repulsor hits for 20)</span></span>
        <label>Range</label>
        <span><NumberInput className="short" min={LASER_RANGE[0]} max={LASER_RANGE[1]} step={1} value={l.range} onChange={(v) => { l.range = Math.round(v); edited() }} /> m</span>
        <label>Bone</label>
        <BoneSelect value={l.bone} onChange={(bone) => { l.bone = bone; l.position = laserDefault(bone); edited() }} />
      </div>
      <Note>Every part of the beam draws in its costume's color. The beam leaves from this spot, in meters from the bone; the dot in the view is the exact point. It always fires level, whichever way the bone turns during a move.</Note>
      <div className="row">
        <div>
          <PositionTable value={l.position} range={LASER_POSITION} onChange={setAxis} />
          <div className="row">
            <button onClick={() => { l.position = laserDefault(l.bone); edited() }}>Reset</button>
          </div>
        </div>
        {/* remounted per bone, so the view frames the new spot */}
        <PlacementView key={l.bone} first="front" method="laserPreview" what="the beam's origin" />
      </div>
    </>
  )
}

function BulletTime() {
  const z = store.character.zButton!
  return (
    <>
      <div className="row tight">
        <input type="range" min={100 * Z_SLOW[0]} max={100 * Z_SLOW[1]} step={5} value={Math.round(100 * z.bullet!)} aria-label="World speed"
          onChange={(e) => { z.bullet = Number(e.target.value) / 100; store.touch('character') }} /> {Math.round(100 * z.bullet!)}% world speed
      </div>
      <Note>While Z is held, everything else (opponents, CPU players, projectiles and thrown objects) moves at this speed, and you move at full speed.</Note>
    </>
  )
}

const SPEEDS: ['run_speed' | 'sprint_speed', string][] = [['run_speed', 'Run speed'], ['sprint_speed', 'Sprint speed']]

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
    <>
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
          {SPEEDS.map(([key, label]) => {
            const normal = c.gameplay[key] ?? bv?.gameplay[key]
            const [min, max] = RANGES[key]
            return (
              <tr key={key}>
                <td><label className="check"><input type="checkbox" checked={stats[key] !== undefined} onChange={(e) => {
                  set(key, e.target.checked ? normal ?? min : null)
                }} /> {label}</label></td>
                <td className="num">{normal === undefined ? '-' : formatG(Math.round(100 * normal) / 100)}</td>
                <td><NumberInput className="short" disabled={stats[key] === undefined} min={min} max={max} step={0.01}
                  value={stats[key] ?? normal ?? min} onChange={(v) => set(key, v)} /></td>
              </tr>
            )
          })}
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
    </>
  )
}

function unbindGun(side: GunSide, swapOnly = false) {
  const c = store.character
  for (const m of c.materials) if ((!swapOnly && m.bind === gunBone(c.base, side)) || m.bind === swapBone(c.base, side)) m.bind = null
}

const PLACE_LABELS: Record<GunPlace, string> = { hip_right: 'Right hip', hip_left: 'Left hip', back_left: 'Back, over the left shoulder', back_right: 'Back, over the right shoulder' }

function Gun() {
  const c = store.character
  const z = c.zButton!, g = z.gun!
  const edited = () => store.touch('character')
  const bone = (side: GunSide) => gunBone(c.base, side)
  const part = c.materials.findIndex((m) => m.include && m.bind === bone(g.side))
  const swapPart = c.materials.findIndex((m) => m.include && m.bind === swapBone(c.base, g.side))
  const set = (next: Partial<typeof g>) => {
    z.gun = { ...g, ...next }
    if (!z.gun.swap) delete z.gun.swap
    edited()
  }
  const mirror = (p: typeof g.holster.position, r: typeof g.holster.rotation) => ({ position: [-p[0], p[1], p[2]] as typeof p, rotation: [r[0], -r[1], -r[2]] as typeof r })
  const setSide = (side: GunSide) => {
    const [was, wasSwap] = [bone(g.side), swapBone(c.base, g.side)]
    for (const m of c.materials) {
      if (m.bind === was) m.bind = bone(side)
      else if (m.bind === wasSwap) m.bind = swapBone(c.base, side)
    }
    set({ side, holster: { place: mirrorPlace(g.holster.place), ...mirror(g.holster.position, g.holster.rotation) }, swap: g.swap && mirror(g.swap.position, g.swap.rotation) })
  }
  const setPlace = (place: GunPlace) => {
    const holster = gunHolster(g.side, place)
    set({ holster, swap: g.swap && { position: holster.position, rotation: holster.rotation } })
  }
  const setPart = (i: number) => {
    unbindGun(g.side)
    if (i >= 0) c.materials[i] = { ...c.materials[i], bind: bone(g.side), include: true }
    edited()
  }
  const setSwap = (i: number) => {
    unbindGun(g.side, true)
    if (i >= 0) c.materials[i] = { ...c.materials[i], bind: swapBone(c.base, g.side), include: true }
    set({ swap: i < 0 ? undefined : g.swap ?? { position: g.holster.position, rotation: g.holster.rotation } })
  }
  const from = g.holster.place.startsWith('back') ? 'the chest' : `the ${g.holster.place === 'hip_left' ? 'left' : 'right'} thigh`
  const cat = store.moveCatalog()
  const sounds = cat ? soundChoices(cat, c.base) : []
  const events = [...new Set(sounds.map(([event]) => event))]
  const sound = g.sound ? soundRef(g.sound) : 'none'
  const setSound = (v: string) => set({ sound: v === 'none' ? undefined : v.split(':').map(Number) as [number, number] })
  const asIn = (moves: string[]) => (moves.length ? ` (as in ${moves.slice(0, 3).join(', ')}${moves.length > 3 ? `, and ${moves.length - 3} more` : ''})` : '')
  return (
    <>
      <Note>
        The gun rides in a holster at a hip or on the back. Holding Z draws the gun, and once it's in hand any attack except a rise attack fires it.<br />
        What the gun hand holds can swap into the holster as the gun comes out, and back into the hand when it goes back.
      </Note>
      <table className="gameplay grid">
        <thead><tr><th>Value</th><th>Setting</th></tr></thead>
        <tbody>
          <tr>
            <td>Hand</td>
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
            <td>Holster</td>
            <td><select value={g.holster.place} onChange={(e) => setPlace(e.target.value as GunPlace)}>
              {GUN_PLACES.map((place) => <option key={place} value={place}>{PLACE_LABELS[place]}</option>)}
            </select></td>
          </tr>
          <tr>
            <td>Swaps into the holster (material)</td>
            <td><select value={g.swap ? swapPart : -1} onChange={(e) => setSwap(Number(e.target.value))}>
              <option value={-1}>(nothing)</option>
              {c.materials.map((m, i) => (i === part ? null : <option key={i} value={i}>{m.name || `material ${m.gltfMaterial}`}{m.include ? '' : ' (excluded)'}</option>))}
            </select> <span className="muted">held in the {g.side} hand until the gun is drawn</span></td>
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
            <td>Sound</td>
            <td><select value={sound} onChange={(e) => setSound(e.target.value)}>
              <option value="none">Silent (default)</option>
              {sound !== 'none' && !sounds.some(([event, variant]) => `${event}:${variant}` === sound) && <option value={sound}>Event {sound.replace(':', ', variant ')}</option>}
              {events.map((event) => (
                <optgroup key={event} label={`Event ${event}`}>
                  {sounds.filter(([e]) => e === event).map(([, variant, moves]) => (
                    <option key={variant} value={`${event}:${variant}`}>Event {event}, variant {variant}{asIn(moves)}</option>
                  ))}
                </optgroup>
              ))}
            </select>{!cat && <span className="muted"> reading {label(c.base)}'s sounds…</span>}<br />
            <span className="muted">Custom sounds and other characters' sounds can't be used at the moment.<br />Support for this will get added in the future, but isn't on the roadmap any time soon.</span></td>
          </tr>
          <tr>
            <td>Machine gun</td>
            <td><label className="check"><input type="checkbox" checked={g.automatic} onChange={(e) => set({ automatic: e.target.checked })} /> Keep shooting while attack is held</label></td>
          </tr>
        </tbody>
      </table>
      <HolsterPlace h={g.holster} from={from} view={g.holster.place.startsWith('back') ? 'back' : 'front'} kind="gun" what="the gun's middle"
        onChange={(h) => set({ holster: { place: g.holster.place, position: h.position, rotation: h.rotation } })} />
      {g.swap && <HolsterPlace h={g.swap} from={from} view={g.holster.place.startsWith('back') ? 'back' : 'front'} kind="swap" title="Swap Location"
        what="the swapped part's middle, while the gun is drawn," onChange={(h) => set({ swap: { position: h.position, rotation: h.rotation } })} />}
    </>
  )
}
