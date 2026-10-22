import { ColorButton, Note } from '../components/common'
import { store, useStore } from '../store'

const TEXTS: [string, string][] = [
  ['base', "The normal base character's"],
  ['swap', "Swapped: costume 1 gets the base's alternate aura and costume 2 the normal one"],
  ['tint', "Tinted (experimental): the base's idle and power-up effects recolored"],
]

export function AuraPage() {
  useStore()
  const s = store
  const c = s.character
  const base = s.base()
  const details = s.baseDetails()
  const edited = () => s.touch('character')
  const tint = c.aura.mode === 'tint'
  let about = 'Choose your game disc to see what the base character\'s aura is.'
  let tintable = true
  let cost = ''
  if (base && details) {
    const [roots, alt, bytes, free] = details.tint
    tintable = roots.length > 0 || alt.length > 0
    about = `${base.label}'s effects: ${roots.join(', ') || 'none'}. ${tintable ? '' : 'There is nothing to tint; Base and Swap still apply.'}`
    cost = tintable ? `A tint copies ${bytes} bytes of effects; ${free} bytes are free.` : ''
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
        <label>Costume 1 color</label>
        <ColorButton color={c.aura.color} disabled={!tint} onChange={(v) => { c.aura.color = v.slice(0, 7); edited() }} />
        <label>Costume 2 color</label>
        <ColorButton color={c.aura.alt_color} disabled={!tint} onChange={(v) => { c.aura.alt_color = v.slice(0, 7); edited() }} />
      </div>
      <Note>
        The glow the game draws in power mode belongs to the base's cast name and cannot be recolored yet (its file has no reader); a tint changes the effects around it. The tint's copies take room in the game's effect memory; the patch checks it fits.
      </Note>
      <p>{cost}</p>
    </div>
  )
}
