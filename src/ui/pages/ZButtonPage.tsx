import type { ZAction } from '../../core/game/dol'
import { Note } from '../components/common'
import { store, useStore } from '../store'

const CHOICES: [ZAction | null, string][] = [
  [null, 'None: Z does nothing, as in the game'],
  ['jump', 'Jump (test): Z jumps, the same as B'],
]

export function ZButtonPage() {
  useStore()
  const c = store.character
  return (
    <div className="page">
      <h3>Z-Button Actions</h3>
      <Note>The Z button is never used in normal gameplay, and can be assigned to custom actions for ImperfectLab characters.<br />
      Pick what Z does in a match. CPU players will never use these abilities.
      </Note>
      {CHOICES.map(([action, text]) => (
        <label key={action ?? 'none'} className="check block">
          <input type="radio" name="zbutton" checked={c.zButton === action} onChange={() => { c.zButton = action; store.touch('character') }} /> {text}
        </label>
      ))}
    </div>
  )
}
