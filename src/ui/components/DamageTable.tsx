import * as damage from '../../core/build/damage'
import { damageMoves, type Move } from '../../core/build/moves'
import { formatG } from '../../core/format'
import { GAMEPLAY as RANGES } from '../../core/package/imperfect'
import { store } from '../store'
import { NumberInput } from './common'

type Row = [key: string, name: string, base: number | undefined, moves: Move[] | undefined]

// The five damage values and the moves that use them. `own` shows the character's values as the base, and `batonThrow` adds Daredevil's throw.
export function DamageTable({ values, set, own = false, batonThrow = false }: {
  values: Record<string, number | undefined>
  set: (key: string, v: number | null) => void
  own?: boolean
  batonThrow?: boolean
}) {
  const c = store.character
  const cat = store.moveCatalog()
  const bv = store.baseDetails()
  const base = damage.KEYS.map((k, i) => cat?.[c.base]?.damage[i] ?? bv?.gameplay[k])
  const users = cat?.[c.base] ? damageMoves(cat, c.base, c.moves, c.gameplay[damage.THROW_KEY] !== undefined) : null
  const rows: Row[] = damage.KEYS.map((k, i) => [k, `Damage ${i + 1}`, (own ? c.gameplay[k] : undefined) ?? base[i], users?.[i]])
  if (batonThrow) rows.push([damage.THROW_KEY, 'Baton throw', base[damage.THROW_TIER], cat?.[c.base] ? damageMoves(cat, c.base, c.moves, true)[damage.KEYS.length] : undefined])
  return (
    <table className="gameplay grid damage">
      <thead><tr><th>Value</th><th>Moves</th><th className="num">{own ? 'Normal' : 'Base'}</th><th>New</th><th className="num">Change</th></tr></thead>
      <tbody>
        {rows.map(([key, name, b, moves]) => {
          const v = values[key]
          const have = v !== undefined
          const [lo, hi] = RANGES[key]
          const scaled = have && b! > 0 && v !== b
          return (
            <tr key={key}>
              <td><label className="check"><input type="checkbox" checked={have} disabled={b === undefined} onChange={(e) => set(key, e.target.checked ? b! : null)} /> {name}</label></td>
              <td>
                {!moves ? <span className="muted">reading moves...</span> : moves.length ? <div className="chips">{moves.map((m) => <span key={m.id} className="chip">{m.label}</span>)}</div> : <span className="muted">none</span>}
              </td>
              <td className="num">{b === undefined ? '-' : formatG(b)}</td>
              <td><NumberInput className="short" disabled={!have} min={lo} max={hi} step={1} value={v ?? b ?? null} onChange={(n) => set(key, n)} /></td>
              <td className="num muted">{scaled ? `×${formatG(Math.round((v / b!) * 100) / 100)}` : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}