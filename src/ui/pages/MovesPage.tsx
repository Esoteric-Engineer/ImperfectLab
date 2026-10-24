import { addOptions, animations, CATEGORIES, type Catalog, type Move, MOVE_IDS, MOVES, options, WALL_JUMPS } from '../../core/build/moves'
import { formatG } from '../../core/format'
import { keys, label } from '../../core/game/roster'
import { BASE_MOVES, GAMEPLAY, type MoveEffect, THROW_REACH, type Wall, WALL, type WallKey } from '../../core/package/imperfect'
import { ColorButton, Note, NumberInput, Warning } from '../components/common'
import { store, useStore } from '../store'

// Categories shown open; the rest start folded.
const OPEN = new Set(['Attacks', 'Super attacks', 'Air and wall attacks', 'Ranged attacks', 'Throws'])

const stem = (anim: string | null) => (anim ?? '').replace(/\.nad$/i, '')
const RANGE = GAMEPLAY.super_throw_range
const effectCount = (n: number) => `${n} effect${n === 1 ? '' : 's'}`

// Picking a super throw brings its range along, unless the range was set by hand.
function pickSuperThrow(cat: Catalog, from: string | undefined) {
  const c = store.character, gp = c.gameplay
  const was = cat[c.moves.SuperThrow ?? c.base]?.range
  if (gp.super_throw_range !== undefined && gp.super_throw_range !== was) return
  const next = cat[from ?? c.base]?.range
  if (from === undefined || next === undefined || next === cat[c.base]?.range) delete gp.super_throw_range
  else gp.super_throw_range = next
}

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
  const added = new Set(cat && mine ? wallRows(cat).map((r) => r.id) : [])
  const swapped = Object.keys(c.moves).filter((id) => !added.has(id)).length

  return (
    <div className="page">
      <h3>Moves</h3>
      <Note>
        Swap any of {label(c.base)}'s moves for another character's version of the move. The move's animations are copied into this character, along with the victim's side of a throw.<br />
        What the move does stays {label(c.base)}'s: its damage, cost and reach, its sounds, and whether the AI uses it. Its effects play from {label(c.base)}'s own unless you pick the other character's under Effects.<br />
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
      {swapped > 0 && <div className="row"><span>{swapped} move{swapped === 1 ? '' : 's'} swapped</span><button onClick={() => {
        for (const id of Object.keys(c.moves)) if (!added.has(id)) delete c.moves[id]
        edited()
      }}>Set all back to {label(c.base)}'s</button></div>}
      {!cat ? <p className="muted">Reading every character's moves...</p> : !mine ? <p className="muted">{label(c.base)}'s moves could not be read from this disc.</p> : (
        CATEGORIES.map((category) => {
          const rows = MOVES.filter((m) => m.category === category && animations(cat, c.base, m))
          if (!rows.length) return null
          const changed = rows.filter((m) => c.moves[m.id]).length
          return (
            <details key={category} open={OPEN.has(category) || changed > 0}>
              <summary><b>{category}</b> <span className="muted">({rows.length}{changed ? `, ${changed} swapped` : ''})</span></summary>
              <table className="gameplay">
                <thead><tr><th>Move</th><th>{label(c.base)}'s animation</th><th>Taken from</th><th>Effects</th></tr></thead>
                <tbody>{rows.map((m) => <MoveRow key={m.id} cat={cat} move={m} />)}</tbody>
              </table>
            </details>
          )
        })
      )}
      {mine && WALL.some((w) => !w.bases.includes(c.base)) && <WallMoves cat={cat!} />}
      {mine && <GrabRange cat={cat!} />}
      <LineColors />
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
            if (move.id === 'SuperThrow') pickSuperThrow(cat, e.target.value || undefined)
            if (e.target.value) c.moves[move.id] = e.target.value
            else {
              delete c.moves[move.id]
              delete c.moveEffects[move.id]
            }
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
      <td>{picked && <MoveEffects id={move.id} from={picked} />}</td>
    </tr>
  )
}

function MoveEffects({ id, from }: { id: string; from: string }) {
  const c = store.character
  const fits = store.moveEffectFit()
  if (!fits) return <span className="muted">...</span>
  const fit = fits[id]
  if (!fit) return <span className="muted">-</span>
  const how = c.moveEffects[id] ?? ''
  const missing = how === 'theirs' && fit.fit < fit.total
  return (
    <span>
      <select value={how} onChange={(e) => {
        if (e.target.value) c.moveEffects[id] = e.target.value as MoveEffect
        else delete c.moveEffects[id]
        store.touch('character')
      }}>
        <option value="">{label(c.base)}'s</option>
        <option value="theirs">{label(from)}'s{fit.line ? ' (with its line)' : ''}</option>
        <option value="none">None</option>
      </select>
      {how !== 'theirs' && fit.fit < fit.total && <span className="muted"> {label(from)}'s: only {fit.fit} of {effectCount(fit.total)} would fit</span>}
      {missing && <span className="muted"> only {fit.fit} of {effectCount(fit.total)} fit: the rest play as {label(c.base)}'s</span>}
    </span>
  )
}

const WALL_FROM: Record<WallKey, Record<string, string>> = {
  wall_climb: { male: 'spiderman', female: 'elektra', brute: 'venom' },
  wall_run: { male: 'wolverine', female: 'elektra', brute: 'wolverine' },
}

// The states added to the base: those of each ability it is given, and the jumps off a wall it has none of.
function wallRows(cat: Catalog): { id: string; required: boolean }[] {
  const c = store.character
  const given = WALL.filter((w) => c.gameplay[w.key] && !w.bases.includes(c.base))
  const jumps = given.length ? WALL_JUMPS.filter((id) => !animations(cat, c.base, MOVE_IDS.get(id)!)) : []
  return [...given.flatMap((w) => w.states.map((id) => ({ id, required: true }))), ...jumps.map((id) => ({ id, required: false }))]
}

function takeAll(cat: Catalog, from: string, ids: string[]) {
  const c = store.character
  for (const id of ids) {
    if (animations(cat, from, MOVE_IDS.get(id)!)) c.moves[id] = from
    else {
      delete c.moves[id]
      delete c.moveEffects[id]
    }
  }
}

function setWall(cat: Catalog, w: Wall, on: boolean) {
  const c = store.character
  const before = new Set(wallRows(cat).map((r) => r.id))
  if (on) c.gameplay[w.key] = true
  else delete c.gameplay[w.key]
  const after = wallRows(cat).map((r) => r.id)
  for (const id of before) {
    if (after.includes(id)) continue
    delete c.moves[id]
    delete c.moveEffects[id]
  }
  if (!on) return
  const pick = WALL_FROM[w.key][cat[c.base].body]
  const from = cat[pick] ? pick : w.bases.find((k) => cat[k])
  if (from) takeAll(cat, from, after.filter((id) => !before.has(id)))
}

// Shown for a base missing wall climbing or running.
function WallMoves({ cat }: { cat: Catalog }) {
  const c = store.character
  const edited = () => store.touch('character')
  const offered = WALL.filter((w) => !w.bases.includes(c.base))
  const rows = wallRows(cat)
  const required = rows.filter((r) => r.required).map((r) => r.id)
  const froms = keys().filter((k) => k !== c.base && cat[k] && required.every((id) => animations(cat, k, MOVE_IDS.get(id)!)))
  const picked = new Set(rows.flatMap((r) => c.moves[r.id] ?? []))
  return (
    <>
      <h3>Wall moves</h3>
      <Note>
        Lets {label(c.base)} {offered.map((w) => (w.key === 'wall_climb' ? 'climb walls like Spider-Man' : 'run along walls like Wolverine')).join(' or ')}.<br />
        Each action plays the animation picked here, copied into this character. The jumps off the wall are optional: Venom has animations for only one of them.
      </Note>
      <div className="row">
        {offered.map((w) => (
          <label key={w.key} className="check"><input type="checkbox" checked={Boolean(c.gameplay[w.key])} onChange={(e) => {
            setWall(cat, w, e.target.checked)
            edited()
          }} /> {w.label[0].toUpperCase() + w.label.slice(1)}</label>
        ))}
        {rows.length > 0 && (
          <>
            <label>Take all from</label>
            <select value={picked.size === 1 ? [...picked][0] : ''} onChange={(e) => {
              if (!e.target.value) return
              takeAll(cat, e.target.value, rows.map((r) => r.id))
              edited()
            }}>
              {picked.size !== 1 && <option value="">(mixed)</option>}
              {froms.map((k) => <option key={k} value={k}>{label(k)}{cat[k].body !== cat[c.base].body ? ` (${cat[k].body}, approximate)` : ''}</option>)}
            </select>
          </>
        )}
      </div>
      {rows.length > 0 && (
        <table className="gameplay">
          <thead><tr><th>Action</th><th>Taken from</th><th>Effects</th></tr></thead>
          <tbody>{rows.map((r) => <WallRow key={r.id} cat={cat} move={MOVE_IDS.get(r.id)!} required={r.required} />)}</tbody>
        </table>
      )}
    </>
  )
}

function WallRow({ cat, move, required }: { cat: Catalog; move: Move; required: boolean }) {
  const c = store.character
  const opts = addOptions(cat, c.base, move)
  const picked = c.moves[move.id]
  const at = picked ? opts.findIndex((o) => o.from.includes(picked)) : -1
  return (
    <tr>
      <td>{move.label}</td>
      <td>
        <select value={at >= 0 ? opts[at].from[0] : (picked ?? '')} onChange={(e) => {
          if (e.target.value) c.moves[move.id] = e.target.value
          else {
            delete c.moves[move.id]
            delete c.moveEffects[move.id]
          }
          store.touch('character')
        }}>
          {(!required || !picked) && <option value="">{required ? '(pick one)' : 'None'}</option>}
          {opts.map((o) => (
            <option key={o.from[0]} value={o.from[0]}>
              {o.from.map(label).join(', ')}: {stem(o.anims.find((a) => a !== null) ?? null)}{o.body !== cat[c.base].body ? ` (${o.body}, approximate)` : ''}
            </option>
          ))}
          {picked && at < 0 && <option value={picked}>{label(picked)} (has no {move.label.toLowerCase()})</option>}
        </select>
      </td>
      <td>{picked && <MoveEffects id={move.id} from={picked} />}</td>
    </tr>
  )
}

function GrabRange({ cat }: { cat: Catalog }) {
  const c = store.character
  const gp = c.gameplay
  const have = gp.super_throw_range !== undefined
  const from = c.moves.SuperThrow
  const base = cat[c.base]?.range
  if (base === undefined || !animations(cat, c.base, MOVE_IDS.get('SuperThrow')!)) return null
  const edited = () => store.touch('character')
  return (
    <>
      <h3>Super throw range</h3>
      <Note>
        How far away the opponent can be for the super throw (R + X grab) to start.
        A long-range grab (Daredevil's cable, Spider-Man's web) starts where the character stands; a close one first moves the character to the opponent, so a long range makes it slide over.
      </Note>
      <table className="gameplay">
        <thead><tr><th>Value</th><th>Base</th><th>New</th></tr></thead>
        <tbody>
          <tr>
            <td><label className="check"><input type="checkbox" checked={have} onChange={(e) => {
              if (e.target.checked) gp.super_throw_range = from ? cat[from]?.range ?? base : base
              else delete gp.super_throw_range
              edited()
            }} /> Super throw grab range</label></td>
            <td>{formatG(base)} m{from && cat[from] && cat[from].range !== base ? ` (${label(from)}'s ${formatG(cat[from].range)} m)` : ''}</td>
            <td><span><NumberInput disabled={!have} min={RANGE[0]} max={RANGE[1]} step={0.5} value={gp.super_throw_range ?? base} onChange={(v) => {
              gp.super_throw_range = Math.round(v * 10) / 10
              edited()
            }} /> m</span></td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

function LineColor({ color, onChange }: { color: string | null; onChange: (c: string | null) => void }) {
  return (
    <span className="check">
      <select value={color === null ? 'theirs' : 'color'} onChange={(e) => onChange(e.target.value === 'theirs' ? null : '#C0C0C0')}>
        <option value="theirs">As taken</option>
        <option value="color">Recolored</option>
      </select>
      {color !== null && <ColorButton color={color} alpha onChange={onChange} />}
    </span>
  )
}

// Shown once a swapped move plays another character's line (cable, web).
function LineColors() {
  const c = store.character
  const fits = store.moveEffectFit()
  const lined = Object.entries(c.moveEffects).some(([id, how]) => how === 'theirs' && fits?.[id]?.line)
  if (!lined && c.moveLines.color === null && c.moveLines.alt_color === null) return null
  const edited = () => store.touch('character')
  return (
    <>
      <h3>Grab line color</h3>
      <Note>
        The line a taken move draws from the hand to the opponent, such as Daredevil's cable or Spider-Man's web. A recolored line adds a small copy of it to the game's effects for each costume.
      </Note>
      <div className="row">
        <label>Costume 1</label>
        <LineColor color={c.moveLines.color} onChange={(v) => { c.moveLines.color = v; edited() }} />
        <label>Costume 2</label>
        <LineColor color={c.moveLines.alt_color} onChange={(v) => { c.moveLines.alt_color = v; edited() }} />
      </div>
    </>
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