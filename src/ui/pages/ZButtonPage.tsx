import { Z_SECONDS, Z_VISIBLE, type ZAction } from '../../core/game/dol'
import type { ZButton } from '../../core/package/imperfect'
import { Note, NumberInput } from '../components/common'
import { store, useStore } from '../store'

const ACTIONS: [ZAction | null, string][] = [
  [null, 'None: Z does nothing, as in the game'],
  ['stealth', 'Stealth Mode: while Z is held'],
]

const EFFECTS: ['undetected' | 'untouchable', string][] = [
  ['undetected', 'Enemies can\'t detect you: CPU opponents lose track of you'],
  ['untouchable', 'Enemies can\'t hit you: no hits, projectiles, grabs or throws'],
]

export function ZButtonPage() {
  useStore()
  const c = store.character
  const z = c.zButton
  const energy = z?.requires.energy
  const edited = () => store.touch('character')
  const setAction = (action: ZAction | null) => {
    c.zButton = action ? { action, stealth: { undetected: true, untouchable: true, visible: 0.2 }, requires: z?.requires ?? {} } : null
    edited()
  }
  const effects = (s: ZButton['stealth']) => [s.undetected, s.untouchable, s.visible !== null].filter(Boolean).length
  return (
    <div className="page">
      <h3>Z-Button Actions</h3>
      <Note>The Z button is never used in normal gameplay, and can be assigned to custom actions for ImperfectLab characters.<br />
      Pick what Z does in a match, and what it needs. CPU players will never use these abilities.
      </Note>
      <h4>Requirements</h4>
      <label className="check block">
        <input type="checkbox" disabled={!z} checked={!!energy} onChange={(e) => {
          z!.requires = e.target.checked ? { ...z!.requires, energy: { seconds: 8, regen: false } } : {}
          edited()
        }} /> Drains Energy: the action uses energy while active, and can't start with none
      </label>
      {z && energy && (
        <div className="block">
          A full bar lasts <NumberInput min={Z_SECONDS[0]} max={Z_SECONDS[1]} step={1} value={energy.seconds} onChange={(v) => { energy.seconds = Math.round(v); edited() }} /> seconds
          <label className="check block">
            <input type="checkbox" checked={energy.regen} onChange={(e) => { energy.regen = e.target.checked; edited() }} /> Keep the game's energy regeneration running while active (it lasts longer)
          </label>
        </div>
      )}
      <h4>Actions</h4>
      {ACTIONS.map(([action, text]) => (
        <label key={action ?? 'none'} className="check block">
          <input type="radio" name="zbutton" checked={(z?.action ?? null) === action} onChange={() => setAction(action)} /> {text}
        </label>
      ))}
      {z?.action === 'stealth' && (
        <div className="block">
          {EFFECTS.map(([key, text]) => (
            <label key={key} className="check block">
              <input type="checkbox" checked={z.stealth[key]} disabled={z.stealth[key] && effects(z.stealth) === 1}
                onChange={(e) => { z.stealth[key] = e.target.checked; edited() }} /> {text}
            </label>
          ))}
          <label className="check block">
            <input type="checkbox" checked={z.stealth.visible !== null} disabled={z.stealth.visible !== null && effects(z.stealth) === 1}
              onChange={(e) => { z.stealth.visible = e.target.checked ? 0.2 : null; edited() }} /> Fade out: you're only partly visible
          </label>
          {z.stealth.visible !== null && (
            <div className="block">
              <input type="range" min={100 * Z_VISIBLE[0]} max={100 * Z_VISIBLE[1]} step={5} value={Math.round(100 * z.stealth.visible)} aria-label="Visibility"
                onChange={(e) => { z.stealth.visible = Number(e.target.value) / 100; edited() }} /> {Math.round(100 * z.stealth.visible)}% visible{z.stealth.visible === 0 && ' (not drawn at all)'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
