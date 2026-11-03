import * as projectileswap from '../../core/build/projectileswap'
import { NO_SHOTS, PROJECTILE_BASES, PROJECTILE_BONES, PROJECTILE_FROM, PROJECTILE_POSITION, type ProjectileFrom, projectileDefault } from '../../core/package/imperfect'
import { ColorButton, Note, NumberInput } from '../components/common'
import { store, useStore } from '../store'
import { PlacementView } from './MovesPage'

const FROM_TEXTS: Record<ProjectileFrom, string> = {
  own: "Where the base's own shots leave from (usually the hands)",
  bone: 'A chosen spot on the body',
}

const ARM = new Set(['clavicle', 'upper_arm', 'upper_twist', 'forearm', 'forearm_twist', 'hand'])
const BONE_GROUPS: [string, (bone: string) => boolean][] = [
  ['Torso', (b) => !b.includes('.')],
  ['Right arm', (b) => b.startsWith('R.') && ARM.has(b.slice(2))],
  ['Left arm', (b) => b.startsWith('L.') && ARM.has(b.slice(2))],
  ['Right leg', (b) => b.startsWith('R.') && !ARM.has(b.slice(2))],
  ['Left leg', (b) => b.startsWith('L.') && !ARM.has(b.slice(2))],
]

// 'R.upper_twist' -> 'Right upper arm twist'
function boneLabel(bone: string): string {
  const [side, part] = bone.includes('.') ? bone.split('.') : ['', bone]
  const name = part === 'upper_twist' ? 'upper arm twist' : part.replace('_', ' ')
  return side ? `${side === 'R' ? 'Right' : 'Left'} ${name}` : name[0].toUpperCase() + name.slice(1)
}

const AXES: string[] = ['X (side)', 'Y (forward)', 'Z (up)']

export function ProjectilesPage() {
  useStore()
  const s = store
  const c = s.character
  const p = c.projectile
  const base = s.base()
  const edited = () => s.touch('character')
  const none = NO_SHOTS.includes(c.base)
  const bytes = projectileswap.bytes(p)
  const lead = projectileswap.lead(p)
  const setAxis = (k: number, v: number) => {
    p.position = p.position.map((x, i) => (i === k ? Math.round(v * 1000) / 1000 : x)) as typeof p.position
    edited()
  }
  const place = (at: [number, number, number]) => {
    p.position = at.map((v) => Math.round(v * 1000) / 1000) as typeof p.position
    edited()
  }
  return (
    <div className="page">
      <h3>Projectiles</h3>
      <Note>
        Make changes to a character's projectiles. The moves keep their animations, damage and sound.
      </Note>
      {none && <Note>{base?.label ?? 'This base'} has no moves that launch a projectile, so there is nothing to swap.</Note>}
      <label className="check block">
        <input type="checkbox" checked={p.on} disabled={none && !p.on} onChange={(ev) => { p.on = ev.target.checked; edited() }} /> Replace every projectile
      </label>
      <div className="form">
        <label>Projectile</label>
        <select value={p.base} disabled={!p.on} onChange={(ev) => { p.base = ev.target.value; edited() }}>
          {PROJECTILE_BASES.map((k) => <option key={k} value={k}>{projectileswap.DONORS[k].label}</option>)}
        </select>
        <label>Costume 1 color</label>
        <ColorButton color={p.color} alpha disabled={!p.on} onChange={(v) => { p.color = v; edited() }} />
        <label>Costume 2 color</label>
        <ColorButton color={p.alt_color} alpha disabled={!p.on} onChange={(v) => { p.alt_color = v; edited() }} />
      </div>
      <Note>
        The color sets the shot's hue and keeps its brightness, as the aura tint does. A fully transparent color (0%) hides the shot but it still hits.
      </Note>
      <h4>Launched From</h4>
      {PROJECTILE_FROM.map((from) => (
        <label key={from} className="check block">
          <input type="radio" name="projectile-from" checked={p.from === from} disabled={!p.on} onChange={() => { p.from = from; edited() }} /> {FROM_TEXTS[from]}
        </label>
      ))}
      {p.on && p.from === 'bone' && (
        <>
          <div className="form">
            <label>Bone</label>
            <select value={p.bone} onChange={(ev) => { p.bone = ev.target.value; p.position = projectileDefault(p.bone, p.base); edited() }}>
              {BONE_GROUPS.map(([group, has]) => (
                <optgroup key={group} label={group}>
                  {PROJECTILE_BONES.filter(has).map((b) => <option key={b} value={b}>{boneLabel(b)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <Note>
            Where the shots leave from, in meters from the bone. The dot in the view is the exact launch point. During a move, it will turn with the bone.
            {lead ? ` The shot draws a tail about ${lead} m long behind its first frame, so from the head keep the point about that far ahead of the face, or the tail shows behind it.` : ''}
          </Note>
          <div className="row">
            <div>
              <table className="gameplay grid">
                <thead><tr><th>Axis</th><th>Position</th></tr></thead>
                <tbody>
                  {AXES.map((axis, k) => (
                    <tr key={axis}>
                      <td>{axis}</td>
                      <td><span><NumberInput min={PROJECTILE_POSITION[0]} max={PROJECTILE_POSITION[1]} step={0.005} value={p.position[k]} onChange={(v) => setAxis(k, v)} /> m</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <button onClick={() => place(projectileDefault(p.bone, p.base))}>Reset</button>
                {c.eyes.on && p.bone === 'head' && <button onClick={() => place([0, c.eyes.position[1] + lead, c.eyes.position[2]])}>Between the glowing eyes</button>}
              </div>
            </div>
            {/* remounted per bone, so the view frames the new spot */}
            <PlacementView key={p.bone} first="front" method="projectilePreview" what="the launch point" />
          </div>
        </>
      )}
      <p>{p.on ? `The projectile adds ${bytes} bytes to the game's effect memory.` : ''}</p>
    </div>
  )
}