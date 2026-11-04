import { useEffect, useRef, useState } from 'react'
import { animChoice, parseChoice, TURNS } from '../../core/build/moveanim'
import { addOptions, animatable, animations, CATEGORIES, type Catalog, LOW_ENERGY_STUN, type Move, MOVE_IDS, MOVES, options, RANGE_GRAB, WALL_JUMPS } from '../../core/build/moves'
import * as holster from '../../core/build/holster'
import * as reach from '../../core/build/reach'
import { formatG } from '../../core/format'
import { keys, label } from '../../core/game/roster'
import { animFiles, BASE_MOVES, copyCharacter, defaultHolster, GAMEPLAY, type Holster as HolsterPlan, HOLSTER_POSITION, HOLSTER_ROTATION, type MoveEffect, STUN_BASES, THROW_REACH, type Wall, WALL, type WallKey } from '../../core/package/imperfect'
import type { BoneLine, MeshData } from '../../core/preview'
import { ColorButton, Note, NumberInput, Warning } from '../components/common'
import { MovePreviewDialog } from '../components/MovePreviewDialog'
import { Viewport } from '../components/viewport'
import { engine, errorText } from '../engine'
import { pickFile } from '../../io/files'
import type { ImportedAnimations } from '../../worker/protocol'
import { store, useStore } from '../store'

// Categories shown open; the rest start folded.
const OPEN = new Set(['Attacks', 'Super attacks', 'Air and wall attacks', 'Ranged attacks', 'Throws'])

const stem = (anim: string | null) => (anim ?? '').replace(/\.nad$/i, '')
const RANGE = GAMEPLAY.super_throw_range
const effectCount = (n: number) => `${n} effect${n === 1 ? '' : 's'}`
const IDLE = '@idle'

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
  const added = new Set(cat && mine ? [...wallRows(cat).map((r) => r.id), ...(c.baseMoves.range_grab ? RANGE_GRAB : []), ...(c.gameplay.low_energy_stun ? LOW_ENERGY_STUN : [])] : [])
  const swapped = Object.keys(c.moves).filter((id) => !added.has(id)).length + c.moveIdle.length + Object.keys(c.moveAnims).length
  const held = c.baseMoves.holster !== undefined

  return (
    <div className="page">
      <h3>Moves</h3>
      <Note>
        Swap any of {label(c.base)}'s moves for another character's version of the move. The move's animations are copied into this character, along with the victim's side of a throw.<br />
        What the move does stays {label(c.base)}'s: its cost and reach, its sounds, and whether the AI uses it. Its damage is one of the character's damage values (Stats page), though the swapped animation may pick a different one of them. Its effects play from {label(c.base)}'s own unless you pick the other character's under Effects.<br />
        A match loads both fighters' animations, so every swapped move uses a little more of the memory a match has.
      </Note>
      <AnimationFiles />
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
        c.moveIdle = []
        c.moveAnims = {}
        edited()
      }}>Set all back to {label(c.base)}'s</button></div>}
      {!cat ? <p className="muted">Reading every character's moves...</p> : !mine ? <p className="muted">{label(c.base)}'s moves could not be read from this disc.</p> : (
        CATEGORIES.map((category) => {
          const rows = MOVES.filter((m) => m.category === category && animations(cat, c.base, m))
          if (!rows.length) return null
          const changed = rows.filter((m) => c.moves[m.id] || c.moveIdle.includes(m.id) || c.moveAnims[m.id]).length
          return (
            <details key={category} open={OPEN.has(category) || changed > 0}>
              <summary><b>{category}</b> <span className="muted">({rows.length}{changed ? `, ${changed} swapped` : ''})</span></summary>
              <table className="gameplay grid fixed">
                <thead><tr><th className="c-move">Move</th><th className="c-anim">{label(c.base)}'s animation</th><th>Taken from</th><th className="c-fx">Effects</th>{held && <th className="c-held" title="Where the holster's prop is during the move">Prop in hand?</th>}</tr></thead>
                <tbody>{rows.map((m) => <MoveRow key={m.id} cat={cat} move={m} />)}</tbody>
              </table>
            </details>
          )
        })
      )}
      {mine && WALL.some((w) => !w.bases.includes(c.base)) && <WallMoves cat={cat!} />}
      {mine && <GrabRange cat={cat!} />}
      {mine && <LowEnergyStun cat={cat!} />}
      {mine && <Stretching cat={cat!} />}
      <LineColors cat={cat} />
      {(BASE_MOVES[c.base] ?? []).length > 0 && <BaseMoves cat={cat} />}
    </div>
  )
}

function MoveRow({ cat, move }: { cat: Catalog; move: Move }) {
  const c = store.character
  const own = animations(cat, c.base, move)!
  const opts = options(cat, c.base, move)
  const picked = c.moves[move.id]
  const clip = c.moveAnims[move.id]
  const files = animatable(move) ? animFiles(c) : []
  const at = picked ? opts.findIndex((o) => o.from.includes(picked)) : -1
  const locked = move.id === 'SuperAttackFar' && c.baseMoves.throw_reach !== undefined
  const idle = c.moveIdle.includes(move.id), offer = move.id !== 'Stand'
  const first = own.find((a) => a !== null) ?? null
  const more = own.filter((a) => a !== null).length - 1
  const choose = (v: string) => {
    const anim = parseChoice(v)
    if (move.id === 'SuperThrow') pickSuperThrow(cat, v && v !== IDLE && !anim ? v : undefined)
    c.moveIdle = c.moveIdle.filter((id) => id !== move.id)
    delete c.moveAnims[move.id]
    if (anim) {
      delete c.moves[move.id]
      delete c.moveEffects[move.id]
      c.moveAnims[move.id] = anim
    } else if (v && v !== IDLE) c.moves[move.id] = v
    else {
      delete c.moves[move.id]
      delete c.moveEffects[move.id]
    }
    if (v === IDLE) {
      delete c.moveReach[move.id]
      c.moveIdle = [...c.moveIdle, move.id]
    }
    store.touch('character')
  }
  return (
    <tr>
      <td title={move.states.join(', ')}>{move.label}</td>
      <td className="anim">{stem(first)}{more > 0 ? ` (+${more})` : ''}</td>
      <td>
        <div className="move-pick">
          <select value={clip ? animChoice(clip) : idle ? IDLE : at >= 0 ? opts[at].from[0] : (picked ?? '')} disabled={locked || (!opts.length && !offer && !picked && !files.length)}
            title={locked ? 'The baton throw reach changes this move: untick it below to swap the move' : undefined}
            onChange={(e) => choose(e.target.value)}>
            <option value="">{label(c.base)} (base)</option>
            {offer && <option value={IDLE}>Idle: {stem(cat[c.moves.Stand ?? c.base]?.motions.stand ?? null)}</option>}
            {opts.map((o) => (
              <option key={o.from[0]} value={o.from[0]}>
                {o.from.map(label).join(', ')}: {stem(o.anims.find((a) => a !== null) ?? null)}{o.body !== cat[c.base].body ? ` (${o.body}, approximate)` : ''}
              </option>
            ))}
            {picked && at < 0 && <option value={picked}>{label(picked)} (not available for {label(c.base)})</option>}
            {files.map(([member, name, clips]) => (
              <optgroup key={member} label={`Imported: ${name}`}>
                {clips.map((x) => <option key={x.name} value={animChoice({ file: member, clip: x.name })}>{x.name} ({formatG(Math.round(x.seconds * 100) / 100)} s)</option>)}
              </optgroup>
            ))}
            {clip && !files.some(([m, , clips]) => m === clip.file && clips.some((x) => x.name === clip.clip)) && <option value={animChoice(clip)}>{clip.clip} (missing)</option>}
          </select>
          <PreviewButton move={move} onSave={locked ? undefined : (from) => choose(from === c.base ? '' : from)} />
        </div>
        {!opts.length && !offer && !picked && !files.length && <span className="muted"> no other version</span>}
      </td>
      <td className="fx">{picked && <MoveEffects id={move.id} from={picked} />}</td>
      {c.baseMoves.holster && <td><InHand move={move} /></td>}
    </tr>
  )
}

// A file name as an animations/ member, kept apart from the ones already in the project.
function animMember(fileName: string, taken: (m: string) => boolean): string {
  const stemName = fileName.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'animations'
  let member = `animations/${stemName}.glb`
  for (let k = 2; taken(member); k++) member = `animations/${stemName}_${k}.glb`
  return member
}

const TURN_LABELS: Record<number, string> = { 0: 'as in the file', [-90]: 'turned 90° right', 90: 'turned 90° left', 180: 'turned around' }
// which way the clips faced, for a turn that brings them to the front
const TURN_TEXT: Record<number, string> = { [-90]: '90° to the left', 90: '90° to the right', 180: 'the back' }

function AnimationFiles() {
  const c = store.character
  const files = animFiles(c)
  const users = (member: string) => Object.entries(c.moveAnims).filter(([, p]) => p.file === member).map(([id]) => MOVE_IDS.get(id)?.label ?? id)

  const importGlb = async () => {
    const file = await pickFile('.glb')
    if (!file) return
    await store.edit(async () => {
      let imported: ImportedAnimations
      try {
        imported = await engine.call<ImportedAnimations>('importAnimations', [new Uint8Array(await file.arrayBuffer()), c.base, c.mapping])
      } catch (e) {
        store.fail(`The animations could not be imported:\n${errorText(e)}`)
        return
      }
      const member = animMember(file.name, (m) => c.files.has(m))
      c.files.set(member, imported.slim)
      if (imported.turn) c.moveAnimFiles[member] = { turn: imported.turn }
      else delete c.moveAnimFiles[member]
      const name = member.slice('animations/'.length, -'.glb'.length)
      if (!c.credits.assets.some((a) => a.what === 'animations' && a.url === (imported.credit.url || name))) {
        c.credits.assets.push({ what: 'animations', by: imported.credit.by, license: imported.credit.license, url: imported.credit.url || name })
      }
      const facing = imported.turn ? `; its clips face ${TURN_TEXT[imported.turn] ?? `${imported.turn}°`} of the model's front, so they are turned to face it (Facing, below)` : ''
      store.message(`Imported ${imported.clips.length} animation${imported.clips.length === 1 ? '' : 's'} from ${file.name} (${Math.round(imported.slim.length / 1024)} KB kept)${facing}: pick them for a move below`)
      store.touch('character')
    })
  }

  const remove = (member: string) => {
    c.files.delete(member)
    delete c.moveAnimFiles[member]
    store.touch('character')
  }
  const turn = (member: string, deg: number) => {
    if (deg) c.moveAnimFiles[member] = { turn: deg }
    else delete c.moveAnimFiles[member]
    store.touch('character')
  }

  return (
    <section>
      <h4>Imported animations</h4>
      <Note>
        Play a clip from a glTF file (.glb) as a move: import the file, then pick its clip in the move's list, under Imported.
        The clips have to be on your model's rig (the joint names the Model page maps). Some rigs face one way at rest and another in their clips: Facing turns the clips (it is guessed on import from which way the attacks reach). They are fitted onto {label(c.base)}'s skeleton the way the model is, and keep {label(c.base)}'s timing cues (hits, effects, sounds), stretched to the clip's length.<br />
        Moves with a victim (throws) can't take a clip.
      </Note>
      {files.length > 0 && (
        <table className="gameplay grid">
          <thead><tr><th>File</th><th>Clips</th><th title="Which way the clips play: some rigs face one way at rest and another in their clips">Facing</th><th>Played by</th><th></th></tr></thead>
          <tbody>
            {files.map(([member, name, clips]) => {
              const by = users(member)
              return (
                <tr key={member}>
                  <td>{name}</td>
                  <td>{clips.length}</td>
                  <td>
                    <select value={c.moveAnimFiles[member]?.turn ?? 0} onChange={(e) => turn(member, Number(e.target.value))}>
                      {[...new Set([...TURNS, c.moveAnimFiles[member]?.turn ?? 0])].map((t) => <option key={t} value={t}>{TURN_LABELS[t] ?? `turned ${t}°`}</option>)}
                    </select>
                  </td>
                  <td>{by.length ? by.join(', ') : <span className="muted">no move</span>}</td>
                  <td><button className="small" disabled={by.length > 0} title={by.length ? 'Set the moves that play it to something else first' : undefined} onClick={() => remove(member)}>Remove</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="row"><button onClick={importGlb}>Import animations (.glb)...</button></div>
    </section>
  )
}

function PreviewButton({ move, disabled = false, onSave }: { move: Move; disabled?: boolean; onSave?: (from: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="small" disabled={disabled} title="Preview the move's animation" aria-label={`Preview ${move.label}`} onClick={() => setOpen(true)}>▶</button>
      {open && <MovePreviewDialog move={move} onSave={onSave} onClose={() => setOpen(false)} />}
    </>
  )
}

const HOLSTER_SAYS: Record<string, string> = { PowerOn: 'draws', PowerOff: 'puts back' }

function setDrawn(id: string, inHand: boolean | undefined) {
  const h = store.character.baseMoves.holster!
  const drawn = { ...h.drawn }
  if (inHand === undefined) delete drawn[id]
  else drawn[id] = inHand
  store.character.baseMoves.holster = { position: h.position, rotation: h.rotation, ...(Object.keys(drawn).length ? { drawn } : {}) }
  store.touch('character')
}

function InHand({ move }: { move: Move }) {
  const h = store.character.baseMoves.holster!
  const def = holster.defaultDrawn(move.states)
  if (def === null) return <span className="muted">{HOLSTER_SAYS[move.id] ?? '-'}</span>
  const now = h.drawn?.[move.id] ?? def
  const locked = holster.CLUB_MOVES.includes(move.id) && now
  const title = locked ? 'This move throws or hits with the prop, so it stays in hand' : `${def ? 'In hand' : 'On the back'} by default`
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={now} disabled={locked} onChange={(e) => setDrawn(move.id, e.target.checked === def ? undefined : e.target.checked)} />
      {now !== def && <span className="muted">changed</span>}
    </label>
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
        <table className="gameplay grid fixed">
          <thead><tr><th className="c-move">Action</th><th>Taken from</th><th className="c-fx">Effects</th></tr></thead>
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
  const choose = (v: string) => {
    if (v) c.moves[move.id] = v
    else {
      delete c.moves[move.id]
      delete c.moveEffects[move.id]
    }
    store.touch('character')
  }
  return (
    <tr>
      <td>{move.label}</td>
      <td>
        <div className="move-pick">
          <select value={at >= 0 ? opts[at].from[0] : (picked ?? '')} onChange={(e) => choose(e.target.value)}>
            {(!required || !picked) && <option value="">{required ? '(pick one)' : 'None'}</option>}
            {opts.map((o) => (
              <option key={o.from[0]} value={o.from[0]}>
                {o.from.map(label).join(', ')}: {stem(o.anims.find((a) => a !== null) ?? null)}{o.body !== cat[c.base].body ? ` (${o.body}, approximate)` : ''}
              </option>
            ))}
            {picked && at < 0 && <option value={picked}>{label(picked)} (has no {move.label.toLowerCase()})</option>}
          </select>
          <PreviewButton move={move} disabled={!picked} onSave={choose} />
        </div>
      </td>
      <td className="fx">{picked && <MoveEffects id={move.id} from={picked} />}</td>
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
      <table className="gameplay grid">
        <thead><tr><th>Value</th><th className="num">Base</th><th>New</th></tr></thead>
        <tbody>
          <tr>
            <td><label className="check"><input type="checkbox" checked={have} onChange={(e) => {
              if (e.target.checked) gp.super_throw_range = from ? cat[from]?.range ?? base : base
              else delete gp.super_throw_range
              edited()
            }} /> Super throw grab range</label></td>
            <td className="num">{formatG(base)} m{from && cat[from] && cat[from].range !== base ? ` (${label(from)}'s ${formatG(cat[from].range)} m)` : ''}</td>
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

const HIDDEN = '#00000000'

function LineColor({ color, onChange }: { color: string | null; onChange: (c: string | null) => void }) {
  const how = color === null ? 'theirs' : color.length === 9 && color.endsWith('00') ? 'hidden' : 'color'
  return (
    <span className="check">
      <select value={how} onChange={(e) => onChange(e.target.value === 'theirs' ? null : e.target.value === 'hidden' ? HIDDEN : '#C0C0C0')}>
        <option value="theirs">As they are</option>
        <option value="color">Recolored</option>
        <option value="hidden">Hidden</option>
      </select>
      {how === 'color' && <ColorButton color={color!} alpha onChange={onChange} />}
    </span>
  )
}

// Shown once a swapped move plays another character's line (cable, web), or a stretched move draws one.
function LineColors({ cat }: { cat: Catalog | null }) {
  const c = store.character
  const fits = store.moveEffectFit()
  const lined = Object.entries(c.moveEffects).some(([id, how]) => how === 'theirs' && fits?.[id]?.line)
  const stretched = cat !== null && Object.keys(c.moveReach).some((id) => {
    const kind = MOVE_IDS.has(id) ? stretchOf(cat, MOVE_IDS.get(id)!)?.kind : undefined
    return kind === 'line' || kind === 'wire'
  })
  if (!lined && !stretched && c.moveLines.color === null && c.moveLines.alt_color === null) return null
  const edited = () => store.touch('character')
  return (
    <>
      <h3>Line color</h3>
      <Note>
        The line a taken or stretched move draws from the hand, such as Daredevil's cable or Spider-Man's web. A recolored or hidden line adds a small copy of it to the game's effects for each costume.<br />
        A stretched move's line is changed in every move that draws it.
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

const VICTIM = /victim/i

// What the move's animation, the base's or the one taken, can stretch.
function stretchOf(cat: Catalog, move: Move): reach.Summary | null {
  const c = store.character
  if (c.moveIdle.includes(move.id)) return null
  const owner = c.moves[move.id] ?? c.base
  const anims = animations(cat, owner, move)
  if (reach.JUMPS.includes(move.id)) return anims?.some(Boolean) ? reach.jumpSummary : null
  const at = move.states.findIndex((s, i) => !VICTIM.test(s) && anims?.[i])
  const found = at < 0 ? null : cat[owner]?.reach?.[anims![at]!.toLowerCase()]
  return found ? reach.forMove(move.id, found) : null
}

const defaultDistance = (move: Move, kind: reach.Kind) => (kind === 'jump' ? 0.75 : kind === 'line' ? (reach.PULLS.includes(move.id) ? 10 : 5) : move.id === 'SuperAttackFar' ? 12 : 1.5)
const limbNames = (limbs: reach.Limb[]) => limbs.map((l) => reach.LIMB_LABELS[l]).join(' and ')

function freshReach(move: Move, plan: reach.Summary) {
  return plan.kind === 'wire' ? {} : { distance: defaultDistance(move, plan.kind) }
}

// A stretch set for another animation than the move has now.
function stale(plan: reach.Summary, want: { distance?: number; limbs?: reach.Limb[]; hold?: boolean }) {
  return (plan.kind === 'wire') !== (want.distance === undefined) || (want.limbs ?? []).some((l) => !plan.limbs.includes(l))
}

function Stretching({ cat }: { cat: Catalog }) {
  const c = store.character
  const rows = MOVES.map((m): [Move, reach.Summary | null] => [m, stretchOf(cat, m)]).filter(([m, p]) => p || c.moveReach[m.id])
  if (!rows.length) return null
  return (
    <>
      <h3>Stretching Limbs</h3>
      <Note>
        A stretched move sends a limb out and brings it back within the move.<br />
        <ul>
          <li>A hit reaches further ahead than the move does, at about a meter a frame so it can't pass through the opponent</li>
          <li>A wire move goes out to where the wire would reach</li>
          <li>A grab steps the character to its distance from the opponent</li>
          <li>A pickup keeps time with the wire, and its distance is also how far away a prop can be</li>
          <li>A jump lengthens the legs along the shin without changing how high or far it goes</li>
        </ul>
      </Note>
      {CATEGORIES.map((category) => {
        const mine = rows.filter(([m]) => m.category === category)
        if (!mine.length) return null
        const on = mine.filter(([m]) => c.moveReach[m.id]).length
        return (
          <details key={category} open={on > 0}>
            <summary><b>{category}</b> <span className="muted">({mine.length}{on ? `, ${on} stretched` : ''})</span></summary>
            <table className="gameplay grid fixed">
              <thead><tr><th className="c-move">Move</th><th className="c-limb">Limb</th><th>How far</th></tr></thead>
              <tbody>{mine.map(([m, p]) => <StretchRow key={m.id} move={m} plan={p} />)}</tbody>
            </table>
          </details>
        )
      })}
    </>
  )
}

function StretchRow({ move, plan }: { move: Move; plan: reach.Summary | null }) {
  const c = store.character
  const want = c.moveReach[move.id]
  const edited = () => store.touch('character')
  const far = (kind: reach.Kind) => (kind === 'line' ? (reach.PULLS.includes(move.id) ? 'out to the object' : 'out to the opponent') : kind === 'jump' ? 'longer' : 'further')
  const range = plan?.kind === 'jump' ? reach.JUMP_DISTANCE : reach.DISTANCE
  const baton = move.id === 'SuperAttackFar' && c.baseMoves.throw_reach !== undefined
  return (
    <tr>
      <td><label className="check" title={baton ? 'The baton throw reach changes this move: untick it below to stretch the move' : undefined}><input type="checkbox" checked={Boolean(want)} disabled={(!plan || baton) && !want} onChange={(e) => {
        if (e.target.checked && plan) c.moveReach[move.id] = freshReach(move, plan)
        else delete c.moveReach[move.id]
        edited()
      }} /> {move.label}</label></td>
      <td>
        {!plan ? <span className="muted">-</span> : plan.limbs.length < 2 ? limbNames(plan.limbs) : (
          <select disabled={!want} value={want?.limbs?.length === 1 ? want.limbs[0] : ''} onChange={(e) => {
            if (e.target.value) want.limbs = [e.target.value as reach.Limb]
            else delete want.limbs
            edited()
          }}>
            <option value="">{limbNames(plan.limbs)}</option>
            {plan.limbs.map((l) => <option key={l} value={l}>{reach.LIMB_LABELS[l]}</option>)}
          </select>
        )}
      </td>
      <td>
        {!plan ? <span className="muted">The move's animation can't stretch now: untick it.</span>
          : want && stale(plan, want) ? <span className="muted">Set for the move's other animation. <button onClick={() => { c.moveReach[move.id] = freshReach(move, plan); edited() }}>Reset</button></span>
          : plan.kind === 'wire' ? "Out to the wire's end"
          : <span><NumberInput disabled={!want} min={range[0]} max={range[1]} step={plan.kind === 'jump' ? 0.05 : 0.5} value={want?.distance ?? defaultDistance(move, plan.kind)} onChange={(v) => {
            want.distance = Math.round(v * 100) / 100
            edited()
          }} /> m {far(plan.kind)}{plan.kind === 'hit' && reach.RETURNS.includes(move.id) ? ', back from a hit' : ''}
            {plan.kind === 'jump' && <> <label className="check"><input type="checkbox" disabled={!want} checked={Boolean(want?.hold)} onChange={(e) => {
              if (e.target.checked) want.hold = true
              else delete want.hold
              edited()
            }} /> Hold while airborne</label></>}</span>}
      </td>
    </tr>
  )
}

// Options for one base's own moves; only Daredevil's baton throw so far.
function BaseMoves({ cat }: { cat: Catalog | null }) {
  const c = store.character
  const bv = store.baseDetails()
  const mv = c.baseMoves
  const edited = () => store.touch('character')
  const reach = mv.throw_reach !== undefined
  const cable = mv.throw_cable !== undefined
  const farSwapped = Boolean(c.moves.SuperAttackFar), farStretched = Boolean(c.moveReach.SuperAttackFar)
  const grab = BASE_MOVES[c.base].includes('range_grab')
  const held = mv.holster !== undefined
  return (
    <>
      <h3>{label(c.base)}-specific moves</h3>
      <Note>
        Whatever is fixed to game bone 39, the club/baton, is what flies: on the Materials page, fix a prop to that bone.<br />
        The cable is drawn from the forearm to the baton all the time.<br />
        The holster carries the same prop on the back outside power mode: power-on reaches back for it and power-off puts it back. It needs the cable off.
        {farSwapped && <><br />Super attack far is swapped above, so the reach can't be changed.</>}
        {farStretched && <><br />Super attack far is stretched above, so the reach can't be changed.</>}
      </Note>
      <table className="gameplay grid">
        <thead><tr><th>Value</th><th className="num">Base</th><th>New</th></tr></thead>
        <tbody>
          <tr>
            <td><label className="check"><input type="checkbox" checked={reach} disabled={(farSwapped || farStretched) && !reach} onChange={(e) => {
              if (e.target.checked) mv.throw_reach = 35
              else delete mv.throw_reach
              edited()
            }} /> Baton throw reach</label></td>
            <td className="num">{bv ? `${formatG(bv.gameplay.throw_reach)} m` : '-'}</td>
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
            <td className="num">on</td>
            <td><select disabled={!cable} value={mv.throw_cable === false ? 'off' : 'on'} onChange={(e) => { mv.throw_cable = e.target.value === 'on'; edited() }}>
              <option>off</option><option>on</option></select></td>
          </tr>
          <tr>
            <td><label className="check"><input type="checkbox" checked={held} onChange={(e) => {
              if (e.target.checked) {
                mv.holster = defaultHolster()
                mv.throw_cable = false
              } else delete mv.holster
              edited()
            }} />Baton holster location</label></td>
            <td className="num">forearm</td>
            <td>{held ? 'custom' : '-'}</td>
          </tr>
        </tbody>
      </table>
      {held && <Holster />}
      {grab && cat && <RangeGrab cat={cat} />}
    </>
  )
}

const AXES = ["X (character's right)", 'Y (forward)', 'Z (up)']

function Holster() {
  const c = store.character
  return <HolsterPlace h={c.baseMoves.holster!} from="the chest" view="back" onChange={(next) => {
    c.baseMoves.holster = next
    store.touch('character')
  }} />
}

// Where a holster sits from its bone (from), as numbers and in 3D.
export function HolsterPlace({ h, from, view, kind = 'club', title = 'Holster Location', what = "the prop's middle", onChange }: {
  h: HolsterPlan; from: string; view: 'back' | 'right' | 'front'; kind?: HolsterKind; title?: string; what?: string; onChange: (h: HolsterPlan) => void
}) {
  const changed = Object.keys(h.drawn ?? {}).length
  const set = (what: 'position' | 'rotation', k: number, v: number) => {
    const next = [...h[what]] as [number, number, number]
    next[k] = what === 'position' ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10
    onChange({ ...h, [what]: next })
  }
  return (
    <>
      <h4>{title}</h4>
      <Note>
        Where {what} sits from {from}.
        {kind === 'club' && <><br />The "Prop in Hand" column of the Moves tables above picks where it is during each move.</>}
      </Note>
      {changed > 0 && <div className="row"><span>{changed} move{changed === 1 ? '' : 's'} changed from the default</span><button onClick={() => onChange({ position: h.position, rotation: h.rotation })}>Set all back</button></div>}
      <div className="row">
        <table className="gameplay grid">
          <thead><tr><th>Axis</th><th>Position</th><th>Rotation</th></tr></thead>
          <tbody>
            {AXES.map((axis, k) => (
              <tr key={axis}>
                <td>{axis}</td>
                <td><span><NumberInput min={HOLSTER_POSITION[0]} max={HOLSTER_POSITION[1]} step={0.01} value={h.position[k]} onChange={(v) => set('position', k, v)} /> m</span></td>
                <td><span><NumberInput min={HOLSTER_ROTATION[0]} max={HOLSTER_ROTATION[1]} step={5} value={h.rotation[k]} onChange={(v) => set('rotation', k, v)} /> °</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <PlacementView first={view} method="holsterPreview" args={[kind]} what="the holster" />
      </div>
    </>
  )
}

export type HolsterKind = 'club' | 'gun' | 'swap'

// The fitted model from a worker preview (holsterPreview, eyesPreview), turnable to three views.
export function PlacementView({ first, method, args = [], what }: { first: 'back' | 'right' | 'front'; method: string; args?: unknown[]; what: string }) {
  const s = useStore()
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<Viewport | null>(null)
  const framed = useRef(false)
  const [report, setReport] = useState('')
  const argKey = JSON.stringify(args)
  useEffect(() => {
    view.current = new Viewport(canvas.current!)
    view.current.showBones = false
    return () => view.current?.dispose()
  }, [])
  useEffect(() => {
    if (!s.model) return
    let live = true
    const timer = window.setTimeout(() => {
      engine.call<{ meshes: MeshData[]; bones: BoneLine[]; focus?: [[number, number, number], number] } | string>(method, [copyCharacter({ ...store.character, glb: null }), ...(JSON.parse(argKey) as unknown[])]).then((r) => {
        if (!live || !view.current) return
        if (typeof r === 'string') {
          setReport('✖ ' + r)
          view.current.setScene([], [])
          return
        }
        setReport('')
        view.current.setScene(r.meshes, r.bones, !framed.current)
        if (!framed.current) {
          if (r.focus) view.current.focus(...r.focus)
          view.current.view(first)
        }
        framed.current = true
      }, (e) => live && setReport('✖ ' + errorText(e)))
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [s.versions.character, s.versions.model, s.versions.mapping, s.model, first, method, argKey])
  return (
    <div className="holster-view">
      <canvas ref={canvas} className="viewport" />
      {!s.model ? <Note>Import a model on the Model page to see {what}.</Note> : report && <Note>{report}</Note>}
      <div className="row">
        {(['back', 'right', 'front'] as const).map((n) => (
          <button key={n} className="small" onClick={() => view.current?.view(n)}>{n[0].toUpperCase() + n.slice(1)}</button>
        ))}
      </div>
    </div>
  )
}

const RANGE_GRAB_FROM = 'spiderman'

function setRangeGrab(cat: Catalog, on: boolean) {
  const c = store.character
  if (on) {
    c.baseMoves.range_grab = true
    const from = cat[RANGE_GRAB_FROM] ? RANGE_GRAB_FROM : keys().find((k) => k !== c.base && animations(cat, k, MOVE_IDS.get('WirePull')!))
    if (from) takeAll(cat, from, RANGE_GRAB)
    return
  }
  delete c.baseMoves.range_grab
  for (const id of RANGE_GRAB) {
    delete c.moves[id]
    delete c.moveEffects[id]
    delete c.moveReach[id]
  }
}

// Grabbing props from a distance, as Spider-Man does.
function RangeGrab({ cat }: { cat: Catalog }) {
  const c = store.character
  const on = Boolean(c.baseMoves.range_grab)
  return (
    <>
      <div className="row">
        <label className="check"><input type="checkbox" checked={on} onChange={(e) => {
          setRangeGrab(cat, e.target.checked)
          store.touch('character')
        }} /> Range grab</label>
      </div>
      <Note>
        Lets {label(c.base)} pick up props from a distance. The animation is copied into this character like a swapped move.<br />
        Lift strength on the Stats page affects which objects can be picked up. Reach defaults to 10m, but can also be adjusted by setting a stretch for the move.
      </Note>
      {on && (
        <table className="gameplay grid fixed">
          <thead><tr><th className="c-move">Action</th><th>Taken from</th><th className="c-fx">Effects</th></tr></thead>
          <tbody>{RANGE_GRAB.map((id) => <WallRow key={id} cat={cat} move={MOVE_IDS.get(id)!} required />)}</tbody>
        </table>
      )}
    </>
  )
}

function setStun(cat: Catalog, on: boolean) {
  const c = store.character
  const own = STUN_BASES.includes(c.base)
  if (on === own) delete c.gameplay.low_energy_stun
  else c.gameplay.low_energy_stun = on
  if (own) return
  const from = STUN_BASES.find((k) => cat[k])
  if (on && from) takeAll(cat, from, LOW_ENERGY_STUN)
  else if (!on) {
    for (const id of LOW_ENERGY_STUN) {
      delete c.moves[id]
      delete c.moveEffects[id]
    }
  }
}

function LowEnergyStun({ cat }: { cat: Catalog }) {
  const c = store.character
  const own = STUN_BASES.includes(c.base)
  const on = c.gameplay.low_energy_stun ?? own
  return (
    <>
      <h3>Low-energy stun</h3>
      <Note>
        {own && "When Megalith's energy is low, he's stunned in place for a moment."}
        {!own && "Megalith's low-energy stun effect. The stun animation is copied into this character like a swapped move."}
        
      </Note>
      <div className="row">
        <label className="check"><input type="checkbox" checked={on} onChange={(e) => {
          setStun(cat, e.target.checked)
          store.touch('character')
        }} /> Low-energy stun</label>
      </div>
      {on && !own && (
        <table className="gameplay grid fixed">
          <thead><tr><th className="c-move">Action</th><th>Taken from</th><th className="c-fx">Effects</th></tr></thead>
          <tbody>{LOW_ENERGY_STUN.map((id) => <WallRow key={id} cat={cat} move={MOVE_IDS.get(id)!} required />)}</tbody>
        </table>
      )}
    </>
  )
}
