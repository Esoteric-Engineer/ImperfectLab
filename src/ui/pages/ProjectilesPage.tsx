import * as projectileswap from '../../core/build/projectileswap'
import { NO_SHOTS, PROJECTILE_BASES, PROJECTILE_FROM, PROJECTILE_POSITION, type ProjectileFrom, projectileDefault } from '../../core/package/imperfect'
import { BoneSelect, PositionTable } from '../components/bones'
import { ColorButton, Note, ToggleCard } from '../components/common'
import { store, useStore } from '../store'
import { PlacementView } from './MovesPage'

const FROM_TEXTS: Record<ProjectileFrom, string> = {
  own: "Where the base's own shots leave from (usually the hands)",
  bone: 'A chosen spot on the body',
}

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
        Make changes to a character's projectiles. The moves keep their animations, damage, and sound, unless changed elsewhere.
      </Note>
      <ToggleCard title="Replace every projectile" checked={p.on} disabled={none && !p.on} onChange={(on) => { p.on = on; edited() }}
        note={none
          ? `${base?.label ?? 'This base'} has no moves that launch a projectile, so there is nothing to swap.`
          : 'Every move that launches a shot launches the chosen projectile instead.'}>
        <div className="form">
          <label>Projectile</label>
          <select value={p.base} onChange={(ev) => { p.base = ev.target.value; edited() }}>
            {PROJECTILE_BASES.map((k) => <option key={k} value={k}>{projectileswap.DONORS[k].label}</option>)}
          </select>
          <label>Costume 1 color</label>
          <ColorButton color={p.color} alpha onChange={(v) => { p.color = v; edited() }} />
          <label>Costume 2 color</label>
          <ColorButton color={p.alt_color} alpha onChange={(v) => { p.alt_color = v; edited() }} />
        </div>
        <Note>
          The color sets the shot's hue and keeps its brightness, as the aura tint does. A fully transparent color (0%) hides the shot but it still hits.
        </Note>
        <h4>Launched From</h4>
        {PROJECTILE_FROM.map((from) => (
          <label key={from} className="check block">
            <input type="radio" name="projectile-from" checked={p.from === from} onChange={() => { p.from = from; edited() }} /> {FROM_TEXTS[from]}
          </label>
        ))}
        {p.from === 'bone' && (
          <>
            <div className="form">
              <label>Bone</label>
              <BoneSelect value={p.bone} onChange={(bone) => { p.bone = bone; p.position = projectileDefault(bone, p.base); edited() }} />
            </div>
            <Note>
              Where the shots leave from, in meters from the bone. The dot in the view is the exact launch point. During a move, it will turn with the bone.<br />
              {lead ? ` The shot draws a tail about ${lead} m long behind its first frame, so from the head keep the point about that far ahead of the face, or the tail shows behind it.` : ''}
            </Note>
            <div className="row">
              <div>
                <PositionTable value={p.position} range={PROJECTILE_POSITION} onChange={setAxis} />
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
        <Note>The projectile adds {bytes} bytes to the game's effect memory.</Note>
      </ToggleCard>
    </div>
  )
}