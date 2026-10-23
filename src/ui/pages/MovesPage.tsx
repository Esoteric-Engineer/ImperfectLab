import { animations, CATEGORIES, type Catalog, type Move, MOVES, options } from '../../core/build/moves'
import { formatG } from '../../core/format'
import { label } from '../../core/game/roster'
import { BASE_MOVES, THROW_REACH } from '../../core/package/imperfect'
import { Note, NumberInput, Warning } from '../components/common'
import { store, useStore } from '../store'

// Categories shown open; the rest start folded.
const OPEN = new Set(['Attacks', 'Super attacks', 'Air and wall attacks', 'Ranged attacks', 'Throws'])

const stem = (anim: string | null) => (anim ?? '').replace(/\.nad$/i, '')

export function MovesPage() {
  useStore()
  const c = store.character
  const cat = store.moveCatalog()
  const edited = () => store.touch('character')

  if (!store.game) {
    return (
      <div className="page">
        <h3>Moves</h3>
        <Note>Choose your game disc first: every character's moves are read from it.</Note>
      </div>
    )
  }
  const mine = cat?.[c.base]
  const cross = mine ? Object.entries(c.moves).filter(([, from]) => cat![from] && cat![from].body !== mine.body).map(([id]) => id) : []
  const swapped = Object.keys(c.moves).length

  return (
    <div className="page">
      <h3>Moves</h3>
      <Note>
        Swap any of {label(c.base)}'s moves for another character's version of the move. The move's animations are copied into this character, along with the victim's side of a throw.<br />
        What the move does stays {label(c.base)}'s: its damage, cost and reach, its sounds and effects (played from {label(c.base)}'s own), and whether the AI uses it.<br />
        A match loads both fighters' animations, so every swapped move uses a little more of the memory a match has.
      </Note>
      {cross.length > 0 && (
        <Warning title="Moves from another body class are approximate">
          <p>
            {cross.length === 1 ? 'One move comes' : `${cross.length} moves come`} from a character with a different skeleton
            ({mine!.body} here). The animations are moved over bone by bone, but limb lengths differ: a brute's grab on a male character reaches at arm's length, for example.
          </p>
        </Warning>
      )}
      {swapped > 0 && <div className="row"><span>{swapped} move{swapped === 1 ? '' : 's'} swapped</span><button onClick={() => { c.moves = {}; edited() }}>Set all back to {label(c.base)}'s</button></div>}
      {!cat ? <p className="muted">Reading every character's moves...</p> : !mine ? <p className="muted">{label(c.base)}'s moves could not be read from this disc.</p> : (
        CATEGORIES.map((category) => {
          const rows = MOVES.filter((m) => m.category === category && animations(cat, c.base, m))
          if (!rows.length) return null
          const changed = rows.filter((m) => c.moves[m.id]).length
          return (
            <details key={category} open={OPEN.has(category) || changed > 0}>
              <summary><b>{category}</b> <span className="muted">({rows.length}{changed ? `, ${changed} swapped` : ''})</span></summary>
              <table className="gameplay">
                <thead><tr><th>Move</th><th>{label(c.base)}'s animation</th><th>Taken from</th></tr></thead>
                <tbody>{rows.map((m) => <MoveRow key={m.id} cat={cat} move={m} />)}</tbody>
              </table>
            </details>
          )
        })
      )}
      {(BASE_MOVES[c.base] ?? []).length > 0 && <BaseMoves />}
    </div>
  )
}

function MoveRow({ cat, move }: { cat: Catalog; move: Move }) {
  const c = store.character
  const own = animations(cat, c.base, move)!
  const opts = options(cat, c.base, move)
  const picked = c.moves[move.id]
  const at = picked ? opts.findIndex((o) => o.from.includes(picked)) : -1
  const locked = move.id === 'SuperAttackFar' && c.baseMoves.throw_reach !== undefined
  const first = own.find((a) => a !== null) ?? null
  const more = own.filter((a) => a !== null).length - 1
  return (
    <tr>
      <td title={move.states.join(', ')}>{move.label}</td>
      <td className="muted">{stem(first)}{more > 0 ? ` (+${more})` : ''}</td>
      <td>
        <select value={at >= 0 ? opts[at].from[0] : (picked ?? '')} disabled={locked || (!opts.length && !picked)}
          title={locked ? 'The baton throw reach changes this move: untick it below to swap the move' : undefined}
          onChange={(e) => {
            if (e.target.value) c.moves[move.id] = e.target.value
            else delete c.moves[move.id]
            store.touch('character')
          }}>
          <option value="">{label(c.base)} (base)</option>
          {opts.map((o) => (
            <option key={o.from[0]} value={o.from[0]}>
              {o.from.map(label).join(', ')}: {stem(o.anims.find((a) => a !== null) ?? null)}{o.body !== cat[c.base].body ? ` (${o.body}, approximate)` : ''}
            </option>
          ))}
          {picked && at < 0 && <option value={picked}>{label(picked)} (not available for {label(c.base)})</option>}
        </select>
        {!opts.length && !picked && <span className="muted"> no other version</span>}
      </td>
    </tr>
  )
}

// Options for one base's own moves; only Daredevil's baton throw so far.
function BaseMoves() {
  const c = store.character
  const bv = store.baseDetails()
  const mv = c.baseMoves
  const edited = () => store.touch('character')
  const reach = mv.throw_reach !== undefined
  const cable = mv.throw_cable !== undefined
  const farSwapped = Boolean(c.moves.SuperAttackFar)
  return (
    <>
      <h3>{label(c.base)}-specific moves</h3>
      <Note>
        Whatever is fixed to game bone 39, the club/baton, is what flies: on the Materials page, fix a prop to that bone.<br />
        The cable is drawn from the forearm to the baton all the time.
        {farSwapped && <><br />Super attack far is swapped above, so the reach can't be changed.</>}
      </Note>
      <table className="gameplay">
        <thead><tr><th>Value</th><th>Base</th><th>New</th></tr></thead>
        <tbody>
          <tr>
            <td><label className="check"><input type="checkbox" checked={reach} disabled={farSwapped && !reach} onChange={(e) => {
              if (e.target.checked) mv.throw_reach = 35
              else delete mv.throw_reach
              edited()
            }} /> Baton throw reach</label></td>
            <td>{bv ? `${formatG(bv.gameplay.throw_reach)} m` : '-'}</td>
            <td><span><NumberInput disabled={!reach} min={THROW_REACH[0]} max={THROW_REACH[1]} step={1} value={mv.throw_reach ?? null} onChange={(v) => {
              mv.throw_reach = Math.round(v * 10) / 10
              edited()
            }} /> m</span></td>
          </tr>
          <tr>
            <td><label className="check"><input type="checkbox" checked={cable} onChange={(e) => {
              if (e.target.checked) mv.throw_cable = false
              else delete mv.throw_cable
              edited()
            }} /> Baton cable</label></td>
            <td>on</td>
            <td><select disabled={!cable} value={mv.throw_cable === false ? 'off' : 'on'} onChange={(e) => { mv.throw_cable = e.target.value === 'on'; edited() }}>
              <option>off</option><option>on</option></select></td>
          </tr>
        </tbody>
      </table>
    </>
  )
}