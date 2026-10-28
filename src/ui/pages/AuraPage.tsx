import * as effects from '../../core/build/effects'
import * as flames from '../../core/build/flames'
import { FLAME_SIZE } from '../../core/package/imperfect'
import { ColorButton, Note, NumberInput, Warning } from '../components/common'
import { store, useStore } from '../store'

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
  ['none', 'None'],
  ['parts', 'On chosen body parts'],
  ['body', 'Over the entire body'],
]

const PARTS: [string, string][] = [
  ['head', 'Head'], ['chest', 'Chest'], ['r_hand', 'Right hand'], ['l_hand', 'Left hand'], ['r_foot', 'Right foot'], ['l_foot', 'Left foot'],
]

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
  const flameBytes = flames.cost(f)
  const plans = details?.tint ?? {}
  const hide = effects.hidden(c.aura.color, c.aura.alt_color)
  const tooBig = (level: string) => effects.tintLevel(plans, level, flameBytes, hide) !== level
  const memory = (level: string) => {
    const p = plans[effects.planKey(level, hide)]
    if (!p) return ''
    const extra = effects.planExtra(p, flameBytes)
    if (tooBig(level)) return ` (needs ${kb(extra)} KB of game memory, more than a match can spare)`
    return extra ? ` (adds ${kb(extra)} KB of game memory)` : ' (fits the game\'s memory)'
  }
  let about = 'Choose your game disc to see what the base character\'s aura is.'
  let tintable = true
  let cost = ''
  const level = effects.tintLevel(plans, c.aura.tint, flameBytes, hide)
  const plan = plans[effects.planKey(level, hide)]
  if (base && details && plans.all) {
    tintable = plans.all.roots.length > 0 || plans.all.alt.length > 0
    about = `${base.label}'s effects: ${plans.power.roots.join(', ') || 'none'}. ${tintable ? '' : 'There is nothing to tint; Base and Swap still apply.'}`
    if (tintable && plan) {
      const extra = effects.planExtra(plan, flameBytes)
      const copied = (hide[0] ? 0 : plan.roots.length) + (hide[1] ? 0 : plan.alt.length)
      const costumes = (on: (i: number) => unknown) => ['1', '2'].filter((_, i) => on(i)).join(' and ')
      const hiddenIn = costumes((i) => hide[i]), greyIn = costumes((i) => plan.grey[i])
      const what = [copied ? `copies ${copied} effects` : '', hiddenIn ? `hides costume ${hiddenIn}'s effects` : ''].filter(Boolean).join(' and ')
      cost = (level !== c.aura.tint ? `${base.label}'s full tint${flameBytes ? ' with flames' : ''} needs more memory than a match can spare, so only the idle and power-up effects are tinted. ` : '') +
        `This tint ${what} (${plan.bytes} bytes); ` +
        (extra ? `the patch adds ${extra} bytes to the game's effect memory for them${flameBytes ? ' and the flames' : ''}.` : 'they fit the game\'s effect memory.') +
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
  return (
    <div className="page">
      <h3>Aura and effects</h3>
      <Note>{about}</Note>
      {TEXTS.map(([mode, text]) => (
        <label key={mode} className="check block">
          <input type="radio" name="aura" checked={c.aura.mode === mode} disabled={mode === 'tint' && !tintable}
            onChange={() => { c.aura.mode = mode; edited() }} /> {text}
        </label>
      ))}
      {tint && (
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
      )}
      <div className="form">
        <label>Tinted effects</label>
        <select value={c.aura.tint} disabled={!tint} onChange={(e) => { c.aura.tint = e.target.value; edited() }}>
          {LEVELS.map(([l, text]) => <option key={l} value={l} disabled={tooBig(l)}>{text}{memory(l)}</option>)}
        </select>
        <label>Costume 1 color</label>
        <ColorButton color={c.aura.color} alpha disabled={!tint} onChange={(v) => { c.aura.color = v; edited() }} />
        <label>Costume 2 color</label>
        <ColorButton color={c.aura.alt_color} alpha disabled={!tint} onChange={(v) => { c.aura.alt_color = v; edited() }} />
      </div>
      <Note>
        A fully transparent color (0%) hides that costume's effects, which takes much less memory than a tint.
        Any other transparency still copies every effect.
      </Note>
      <p>{cost}</p>

      <h3>Flames</h3>
      <Note>
        Add flames to the character on chosen parts or the whole body.
      </Note>
      {FLAME_MODES.map(([mode, text]) => (
        <label key={mode} className="check block">
          <input type="radio" name="flames" checked={flameMode === mode} onChange={() => setFlameMode(mode)} /> {text}
        </label>
      ))}
      {flameMode === 'parts' && (
        <div>
          {PARTS.map(([part, text]) => (
            <label key={part} className="check">
              <input type="checkbox" checked={f.parts.includes(part)} onChange={(e) => togglePart(part, e.target.checked)} /> {text}
            </label>
          ))}
        </div>
      )}
      <div className="form">
        <label>Costume 1 flames</label>
        <FlameColor color={f.color} onChange={(v) => { f.color = v; edited() }} />
        <label>Costume 2 flames</label>
        <FlameColor color={f.alt_color} onChange={(v) => { f.alt_color = v; edited() }} />
        <label>Flame size</label>
        <NumberInput value={f.size} min={FLAME_SIZE[0]} max={FLAME_SIZE[1]} step={0.1} disabled={flameMode === 'none'} onChange={(v) => { f.size = v; edited() }} />
      </div>
      <p>
        {flameMode === 'none' ? '' : flameBytes ? `The flames add ${flameBytes} bytes to the game's effect memory.` : 'The flames use the game\'s own effect, which takes no more memory.'}
      </p>
      <h3>Always-On Effect</h3>
      <label className="check block">
        <input type="checkbox" checked={f.base_effect} onChange={(e) => { f.base_effect = e.target.checked; edited() }} />
        {' '}Keep the base's own always-on effect, if it has one (such as Human Torch's body fire or Elektra's hair).
      </label>
    </div>
  )
}
