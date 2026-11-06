import * as effects from '../../core/build/effects'
import * as projectileswap from '../../core/build/projectileswap'
import * as trails from '../../core/build/trails'
import { EYE_POSITION, EYE_SIZE, EYE_X, EYE_YZ, FLAME_SIZE, TRAIL_LENGTH } from '../../core/package/imperfect'
import { ColorButton, Note, NumberInput, OptionCard, ToggleCard, Warning } from '../components/common'
import { store, useStore } from '../store'
import { PlacementView } from './MovesPage'

const TEXTS: [string, string][] = [
  ['base', "Base: The normal base character's"],
  ['swap', "Swapped: costume 1 gets the base's alternate aura and costume 2 the normal one"],
  ['tint', "Tinted: the base's aura and effects are recolored"],
]

const LEVELS: [string, string][] = [
  ['all', 'Everything: idle, power-up and costume effects, and projectiles'],
  ['power', 'Idle and power-up effects only'],
]

const FLAME_MODES: [string, string][] = [
  ['parts', 'On chosen body parts'],
  ['body', 'Over the entire body'],
]

const PARTS: [string, string][] = [
  ['head', 'Head'], ['chest', 'Chest'], ['r_hand', 'Right hand'], ['l_hand', 'Left hand'], ['r_foot', 'Right foot'], ['l_foot', 'Left foot'],
]

const TRAIL_PARTS: [string, string][] = [['arms', 'Arms'], ['legs', 'Legs'], ['body', 'Body'], ['head', 'Head']]

const EYE_AXES: [string, [number, number]][] = [['X (apart)', EYE_X], ['Y (forward)', EYE_YZ], ['Z (up)', EYE_YZ]]

const kb = (n: number) => (n / 1024).toFixed(1)

function FlameColor({ color, onChange }: { color: string | null; onChange: (c: string | null) => void }) {
  return (
    <span className="check">
      <select value={color === null ? 'fire' : 'color'} onChange={(e) => onChange(e.target.value === 'fire' ? null : '#FF6A00')}>
        <option value="fire">The game's fire</option>
        <option value="color">Recolored</option>
      </select>
      {color !== null && <ColorButton color={color} alpha onChange={onChange} />}
    </span>
  )
}

export function AuraPage() {
  useStore()
  const s = store
  const c = s.character
  const base = s.base()
  const details = s.baseDetails()
  const edited = () => s.touch('character')
  const tint = c.aura.mode === 'tint'
  const f = c.flames
  const flameMode = f.body ? 'body' : f.parts.length ? 'parts' : 'none'
  const t = c.trails
  const e = c.eyes
  const extraBytes = trails.cost(f, t, e)
  const fireBytes = trails.cost(f, { ...t, parts: [] })
  const trailBytes = trails.cost(f, t) - fireBytes
  const eyeBytes = extraBytes - fireBytes - trailBytes
  const extras = trails.label(f, t, e)
  const shareBytes = extraBytes + projectileswap.bytes(c.projectile)
  const plans = details?.tint ?? {}
  const hide = effects.hidden(c.aura.color, c.aura.alt_color)
  const tooBig = (level: string) => effects.tintLevel(plans, level, shareBytes, hide) !== level
  const memory = (level: string) => {
    const p = plans[effects.planKey(level, hide)]
    if (!p) return ''
    const extra = effects.planExtra(p, shareBytes)
    if (tooBig(level)) return ` (needs ${kb(extra)} KB of game memory, more than a match can spare)`
    return extra ? ` (adds ${kb(extra)} KB of game memory)` : ' (fits the game\'s memory)'
  }
  let about = 'Choose your game disc to see what the base character\'s aura is.'
  let tintable = true
  let cost = ''
  const level = effects.tintLevel(plans, c.aura.tint, shareBytes, hide)
  const plan = plans[effects.planKey(level, hide)]
  if (base && details && plans.all) {
    tintable = plans.all.roots.length > 0 || plans.all.alt.length > 0
    about = `${base.label}'s effects: ${plans.power.roots.join(', ') || 'none'}. ${tintable ? '' : 'There is nothing to tint; Base and Swap still apply.'}`
    if (tintable && plan) {
      const extra = effects.planExtra(plan, shareBytes)
      const copied = (hide[0] ? 0 : plan.roots.length) + (hide[1] ? 0 : plan.alt.length)
      const costumes = (on: (i: number) => unknown) => ['1', '2'].filter((_, i) => on(i)).join(' and ')
      const hiddenIn = costumes((i) => hide[i]), greyIn = costumes((i) => plan.grey[i])
      const what = [copied ? `copies ${copied} effects` : '', hiddenIn ? `hides costume ${hiddenIn}'s effects` : ''].filter(Boolean).join(' and ')
      cost = (level !== c.aura.tint ? `${base.label}'s full tint${extras ? ` with ${extras}` : ''} needs more memory than a match can spare, so only the idle and power-up effects are tinted. ` : '') +
        `This tint ${what} (${plan.bytes} bytes); ` +
        (extra ? `the patch adds ${extra} bytes to the game's effect memory for them${extras ? ` and the ${extras}` : ''}.` : 'they fit the game\'s effect memory.') +
        (greyIn ? ` Its fire is redrawn on the grey fire sprite, which costume ${greyIn}'s bundle doesn't have, so the sprite is added to it: ${kb(Math.max(...plan.grey))} KB more of the memory the character loads into${plan.grey[0] && plan.grey[1] ? ', for each costume' : ''}.` : '')
    }
  }
  const setFlameMode = (mode: string) => {
    f.body = mode === 'body'
    f.parts = mode === 'parts' ? ['head'] : []
    edited()
  }
  const togglePart = (part: string, on: boolean) => {
    f.parts = PARTS.map(([p]) => p).filter((p) => (p === part ? on : f.parts.includes(p)))
    edited()
  }
  const setEye = (k: number, v: number) => {
    e.position = e.position.map((p, i) => (i === k ? Math.round(v * 1000) / 1000 : p)) as typeof e.position
    edited()
  }
  const toggleTrail = (part: string, on: boolean) => {
    t.parts = TRAIL_PARTS.map(([p]) => p).filter((p) => (p === part ? on : t.parts.includes(p)))
    edited()
  }
  return (
    <div className="page">
      <h3>Aura and effects</h3>
      <Note>Recolor or swap the character's aura, and add various effects to the character.</Note>
      <h4>Base effects</h4>
      <OptionCard plain head="Aura" note={about}>
        {TEXTS.map(([mode, text]) => (
          <label key={mode} className="check block">
            <input type="radio" name="aura" checked={c.aura.mode === mode} disabled={mode === 'tint' && !tintable}
              onChange={() => { c.aura.mode = mode; edited() }} /> {text}
          </label>
        ))}
        {tint && (
          <>
            <Warning title="Tinting the aura is memory-intensive">
              <p>
                A tint copies the base's effects into the game's effect memory.
                When the copies don't fit, the patch enlarges that memory, taking memory from what the characters are loaded into.
              </p>
              <p>
                A tint paired with a large custom model can easily run a match out of memory (in Dolphin, showing an error like "Invalid write to 0x0000000c"). If that happens, try switching to <b>Idle and power-up effects only</b>. Alternatively, just use the <b>Base</b> or <b>Swapped</b> options, as these don't take any additional memory.
              </p>
              <p>
                Note that tinted auras also require their own tuning files, and only a few of those fit when several characters are patched into a single ISO together.
              </p>
            </Warning>
            <div className="form">
              <label>Tinted effects</label>
              <select value={c.aura.tint} onChange={(e) => { c.aura.tint = e.target.value; edited() }}>
                {LEVELS.map(([l, text]) => <option key={l} value={l} disabled={tooBig(l)}>{text}{memory(l)}</option>)}
              </select>
              <label>Costume 1 color</label>
              <ColorButton color={c.aura.color} alpha onChange={(v) => { c.aura.color = v; edited() }} />
              <label>Costume 2 color</label>
              <ColorButton color={c.aura.alt_color} alpha onChange={(v) => { c.aura.alt_color = v; edited() }} />
            </div>
            <Note>
              A fully transparent color (0%) hides that costume's effects, which takes much less memory than a tint.
              Any other transparency still copies every effect.
            </Note>
            {cost && <p>{cost}</p>}
          </>
        )}
      </OptionCard>
      <ToggleCard title="Keep the base's always-on effect" checked={f.base_effect} onChange={(on) => { f.base_effect = on; edited() }}
        note="If the base has one, such as Human Torch's body fire or Elektra's hair." />

      <h4>Added effects</h4>
      <ToggleCard title="Flames" checked={flameMode !== 'none'} onChange={(on) => setFlameMode(on ? 'parts' : 'none')}
        note="Add flames to the character on chosen parts or the whole body.">
        {FLAME_MODES.map(([mode, text]) => (
          <label key={mode} className="check block">
            <input type="radio" name="flames" checked={flameMode === mode} onChange={() => setFlameMode(mode)} /> {text}
          </label>
        ))}
        {flameMode === 'parts' && (
          <div className="row tight toggle-indent">
            {PARTS.map(([part, text]) => {
              const on = f.parts.includes(part)
              return (
                <label key={part} className="check">
                  <input type="checkbox" checked={on} disabled={on && f.parts.length === 1} onChange={(e) => togglePart(part, e.target.checked)} /> {text}
                </label>
              )
            })}
          </div>
        )}
        <div className="form">
          <label>Costume 1 flames</label>
          <FlameColor color={f.color} onChange={(v) => { f.color = v; edited() }} />
          <label>Costume 2 flames</label>
          <FlameColor color={f.alt_color} onChange={(v) => { f.alt_color = v; edited() }} />
          <label>Flame size</label>
          <NumberInput value={f.size} min={FLAME_SIZE[0]} max={FLAME_SIZE[1]} step={0.1} onChange={(v) => { f.size = v; edited() }} />
        </div>
        <Note>{fireBytes ? `The flames add ${fireBytes} bytes to the game's effect memory.` : 'The flames use the game\'s own effect, which takes no more memory.'}</Note>
      </ToggleCard>
      <ToggleCard title="Motion Trails" checked={t.parts.length > 0} onChange={(on) => { t.parts = on ? [TRAIL_PARTS[0][0]] : []; edited() }}
        note="Colored trails that show while the character is moving.">
        <div className="row tight">
          {TRAIL_PARTS.map(([part, text]) => {
            const on = t.parts.includes(part)
            return (
              <label key={part} className="check">
                <input type="checkbox" checked={on} disabled={on && t.parts.length === 1} onChange={(e) => toggleTrail(part, e.target.checked)} /> {text}
              </label>
            )
          })}
        </div>
        <div className="form">
          <label>Costume 1 trails</label>
          <ColorButton color={t.color} alpha onChange={(v) => { t.color = v; edited() }} />
          <label>Costume 2 trails</label>
          <ColorButton color={t.alt_color} alpha onChange={(v) => { t.alt_color = v; edited() }} />
          <label>Trail length (seconds)</label>
          <NumberInput value={t.length} min={TRAIL_LENGTH[0]} max={TRAIL_LENGTH[1]} step={0.05} onChange={(v) => { t.length = v; edited() }} />
        </div>
        {trailBytes > 0 && <Note>The trails add {trailBytes} bytes to the game's effect memory.</Note>}
      </ToggleCard>
      <ToggleCard title="Glowing Eyes" checked={e.on} onChange={(on) => { e.on = on; edited() }}
        note="A glow at each eye, placed from the head bone.">
        {c.base === 'ironman' && <Note>These replace Iron Man's own eye glow.</Note>}
        <div className="form">
          <label>Costume 1 eyes</label>
          <ColorButton color={e.color} alpha onChange={(v) => { e.color = v; edited() }} />
          <label>Costume 2 eyes</label>
          <ColorButton color={e.alt_color} alpha onChange={(v) => { e.alt_color = v; edited() }} />
          <label>Glow size</label>
          <NumberInput value={e.size} min={EYE_SIZE[0]} max={EYE_SIZE[1]} step={0.05} onChange={(v) => { e.size = v; edited() }} />
        </div>
        <Note>A fully transparent color (0%) gives that costume no glowing eyes.</Note>
        <h4>Eye Location</h4>
        <Note>
          Where the eyes sit from the head bone. X moves both eyes away from the middle, one to each side.
        </Note>
        <div className="row">
          <div>
            <table className="gameplay grid">
              <thead><tr><th>Axis</th><th>Position</th></tr></thead>
              <tbody>
                {EYE_AXES.map(([axis, [lo, hi]], k) => (
                  <tr key={axis}>
                    <td>{axis}</td>
                    <td><span><NumberInput min={lo} max={hi} step={0.005} value={e.position[k]} onChange={(v) => setEye(k, v)} /> m</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => { e.position = [...EYE_POSITION]; edited() }}>Reset to Iron Man's</button>
          </div>
          <PlacementView first="front" method="eyesPreview" what="the eyes" />
        </div>
        {eyeBytes > 0 && <Note>The eyes add {eyeBytes} bytes to the game's effect memory.</Note>}
      </ToggleCard>
    </div>
  )
}