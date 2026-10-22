import * as effects from '../../core/build/effects'
import { ColorButton, Note, Warning } from '../components/common'
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
        Each color's opacity slider fades the recolored effects; at zero they do not show. They are still copied, so they use the same game memory as any tint.
      </Note>
      <Note>
        The glow the game draws in power mode belongs to the base's cast name and cannot be recolored yet (its file has no reader); a tint changes the effects around it.
      </Note>
      <p>{cost}</p>
    </div>
  )
}
