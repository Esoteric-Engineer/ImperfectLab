import { formatG } from '../../core/format'
import { FLYERS, type Gameplay } from '../../core/package/imperfect'
import { Note, NumberInput } from '../components/common'
import { store, useStore } from '../store'

const NAMES = ['Intel', 'Strength', 'Speed', 'Durability', 'Energy', 'Skill']
const ORDER = [3, 5, 0, 2, 1, 4]
type Key = keyof Gameplay
const GAMEPLAY: [Key, string, string, number, number, boolean][] = [
  ['damage_taken', 'Damage taken', '%', 10, 300, true],
  ['lift', 'Lifting strength', '', 0, 0, true],
  ['wire_swing', 'Wire swing', '', 0, 0, true],
  ['flight', 'Flight', '', 0, 0, true],
  ['health', 'Health', '', 10, 1000, true],
  ['run_speed', 'Run speed', '', 1, 30, false],
  ['sprint_speed', 'Sprint speed', '', 1, 40, false],
  ['rage_per_super', 'Rage per super attack', '', 0, 100, false],
  ['rage_duration', 'Rage duration', ' ms', 1000, 120000, false],
]

function StatBar({ value, base }: { value: number; base: number | null }) {
  return (
    <span className="statbar">
      {Array.from({ length: 7 }, (_, i) => <span key={i} className={`pip ${i < value ? 'on' : ''} ${base !== null && i === base - 1 ? 'base' : ''}`} />)}
    </span>
  )
}

export function StatsPage() {
  useStore()
  const s = store
  const c = s.character
  const b = s.base()
  const bv = s.baseDetails()
  const linked = c.stats.normal.every((v, i) => v === c.stats.alt[i])
  const gp = c.gameplay as Record<string, number | string | boolean | undefined>
  const edited = () => s.touch('character')

  const baseValue = (key: Key): number | string | undefined => {
    if (!bv) return undefined
    if (key === 'lift') return bv.lift
    if (key === 'wire_swing') return bv.wireSwing
    if (key === 'flight') return FLYERS.includes(c.base) ? 'on' : 'off'
    if (key === 'health') return bv.health
    return bv.gameplay[key]
  }

  const setStat = (costume: 'normal' | 'alt', r: number, v: number) => {
    c.stats[costume][r] = v
    if (costume === 'normal' && linked) c.stats.alt[r] = v
    edited()
  }

  return (
    <div className="page">
      <h3>Select-screen stats</h3>
      <Note>These stats are just for Versus Mode display and don't change how the character fights. Every character in the game has these values, but they don't all display.</Note>
      <label className="check block"><input type="checkbox" checked={linked} onChange={(e) => {
        if (e.target.checked) c.stats.alt = [...c.stats.normal]
        else c.stats.alt = [...c.stats.alt]
        edited()
      }} /> Same stats for both costumes</label>
      <table className="stats">
        <thead><tr><th /><th colSpan={3}>Costume 1</th><th colSpan={3}>Costume 2</th></tr></thead>
        <tbody>
          {ORDER.map((r) => (
            <tr key={r}>
              <td>{NAMES[r]}</td>
              {(['normal', 'alt'] as const).map((costume) => {
                const base = b ? (costume === 'normal' ? b.stats : b.altStats)[r] ?? null : null
                const v = c.stats[costume][r]
                return [
                  <td key={costume + 's'}><input type="range" min={1} max={7} value={v} disabled={costume === 'alt' && linked} onChange={(e) => setStat(costume, r, Number(e.target.value))} /></td>,
                  <td key={costume + 'b'}><StatBar value={v} base={base} /></td>,
                  <td key={costume + 'v'}>{v}{base ? ` (base ${base})` : ''}</td>,
                ]
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Gameplay</h3>
      <Note>Leave a value unticked to keep the base character's. The CPU difficulty levels keep the base's spread. Experimental values have not been tried in the game yet.</Note>
      <table className="gameplay">
        <thead><tr><th>Value</th><th>Base</th><th>New</th></tr></thead>
        <tbody>
          {GAMEPLAY.map(([key, label, suffix, lo, hi, tested]) => {
            const have = gp[key] !== undefined
            const value = baseValue(key)
            const noWire = key === 'wire_swing' && bv !== null && !bv.hasWire
            const noFlight = key === 'flight' && !FLYERS.includes(c.base)
            let baseText = '-'
            if (value !== undefined) {
              if (key === 'damage_taken') baseText = `${Math.round(100 * (value as number))}%`
              else if (typeof value === 'string') baseText = noWire ? 'off (the base has no wire moves)' : noFlight ? 'off (the base can\'t fly)' : value
              else baseText = formatG(value)
            }
            const toggle = (on: boolean) => {
              if (!on) delete gp[key]
              else if (key === 'damage_taken') gp[key] = Math.round(1000 * ((value as number) ?? 1)) / 1000
              else if (key === 'lift') gp[key] = (value as string) ?? 'medium'
              else if (key === 'wire_swing') gp[key] = value === 'on'
              else if (key === 'flight') gp[key] = false
              else if (key === 'health' || key === 'rage_duration') gp[key] = Math.round((value as number) ?? lo)
              else gp[key] = Math.round(100 * ((value as number) ?? lo)) / 100
              edited()
            }
            let editor
            if (key === 'lift') {
              editor = <select disabled={!have} value={(gp[key] as string) ?? (value as string) ?? 'medium'} onChange={(e) => { gp[key] = e.target.value; edited() }}>
                {['light', 'medium', 'heavy'].map((v) => <option key={v}>{v}</option>)}</select>
            } else if (key === 'wire_swing') {
              editor = <select disabled={!have} value={have ? (gp[key] ? 'on' : 'off') : ((value as string) ?? 'off')} onChange={(e) => { gp[key] = e.target.value === 'on'; edited() }}>
                <option>off</option><option>on</option></select>
            } else if (key === 'flight') {
              editor = <span>{have ? 'off' : '-'}</span>
            } else {
              const shown = key === 'damage_taken' ? 100 * ((gp[key] as number) ?? (value as number) ?? 1) : ((gp[key] as number) ?? (value as number) ?? lo)
              const step = key === 'rage_duration' ? 500 : key === 'health' ? 10 : key === 'damage_taken' ? 0.1 : 0.01
              editor = <span><NumberInput disabled={!have} min={lo} max={hi} step={step}
                value={Number.isFinite(shown) ? Math.round(shown * 1000) / 1000 : null} onChange={(v) => {
                  if (key === 'damage_taken') gp[key] = Math.round(v * 10) / 1000
                  else if (key === 'health' || key === 'rage_duration') gp[key] = Math.round(v)
                  else gp[key] = Math.round(v * 100) / 100
                  edited()
                }} />{suffix}</span>
            }
            return (
              <tr key={key}>
                <td><label className="check"><input type="checkbox" checked={have} disabled={noWire || (noFlight && !have)} onChange={(e) => toggle(e.target.checked)} /> {label}{tested ? '' : '  (experimental)'}</label></td>
                <td>{baseText}</td>
                <td>{editor}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

