import * as effects from '../../core/build/effects'
import { ColorButton, Note } from '../components/common'
import { store, useStore } from '../store'

const TEXTS: [string, string][] = [
  ['base', "The normal base character's"],
  ['swap', "Swapped: costume 1 gets the base's alternate aura and costume 2 the normal one"],
  ['tint', "Tinted: the base's effects recolored"],
]

const LEVELS: [string, string][] = [
  ['all', 'Everything: idle, power-up and costume effects, and projectiles'],
  ['power', 'Idle and power-up effects only'],
]

const kb = (n: number) => (n / 1024).toFixed(1)

export function AuraPage() {
  useStore()
  const s = store
  const c = s.character
  const base = s.base()
  const details = s.baseDetails()
  const edited = () => s.touch('character')
  const tint = c.aura.mode === 'tint'
  const plans = details?.tint ?? {}
  const tooBig = (level: string) => effects.tintLevel(plans, level) !== level
  const memory = (level: string) => {
    const p = plans[level]
    if (!p) return ''
    if (tooBig(level)) return ` (needs ${kb(p.extra)} KB of game memory, more than a match can spare)`
    return p.extra ? ` (adds ${kb(p.extra)} KB of game memory)` : ' (fits the game\'s memory)'
  }
  let about = 'Choose your game disc to see what the base character\'s aura is.'
  let tintable = true
  let cost = ''
  const level = effects.tintLevel(plans, c.aura.tint)
  const plan = plans[level]
  if (base && details && plans.all) {
    tintable = plans.all.roots.length > 0 || plans.all.alt.length > 0
    about = `${base.label}'s effects: ${plans.power.roots.join(', ') || 'none'}. ${tintable ? '' : 'There is nothing to tint; Base and Swap still apply.'}`
    if (tintable && plan) {
      cost = (level !== c.aura.tint ? `${base.label}'s full tint needs more memory than a match can spare, so only the idle and power-up effects are tinted. ` : '') +
        `This tint copies ${plan.roots.length + plan.alt.length} effects (${plan.bytes} bytes); ` +
        (plan.extra ? `the patch adds ${plan.extra} bytes to the game's effect memory for them.` : 'they fit the game\'s effect memory.')
    }
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
      <div className="form">
        <label>Tinted effects</label>
        <select value={c.aura.tint} disabled={!tint} onChange={(e) => { c.aura.tint = e.target.value; edited() }}>
          {LEVELS.map(([l, text]) => <option key={l} value={l} disabled={tooBig(l)}>{text}{memory(l)}</option>)}
        </select>
        <label>Costume 1 color</label>
        <ColorButton color={c.aura.color} disabled={!tint} onChange={(v) => { c.aura.color = v.slice(0, 7); edited() }} />
        <label>Costume 2 color</label>
        <ColorButton color={c.aura.alt_color} disabled={!tint} onChange={(v) => { c.aura.alt_color = v.slice(0, 7); edited() }} />
      </div>
      <Note>
        The glow the game draws in power mode belongs to the base's cast name and cannot be recolored yet (its file has no reader); a tint changes the effects around it.
      </Note>
      <Note>
        A tint's copies take room in the game's effect memory. When they don't fit, the patch enlarges it, and that memory comes out of what a match has to load into.
        If a match crashes while loading (in Dolphin, "Invalid write to 0x0000000c"), choose Idle and power-up effects only, or the Base or Swap aura:
        a full tint and large custom models together can run the game out of memory.
      </Note>
      <p>{cost}</p>
    </div>
  )
}
