import { type AudioSlot, type Catalog, dropUnfitAudio, LABELS, removeAudio } from '../../core/build/cutscenes'
import { keys, label } from '../../core/game/roster'
import * as asftool from '../../core/mnroi/asftool'
import { type CutsceneEffects, CUTSCENE_KINDS, type CutsceneKind, MAX_AUDIO_SECONDS } from '../../core/package/imperfect'
import { download, pickFile } from '../../io/files'
import { decodeSound, play, wav } from '../audio'
import { Note, Warning } from '../components/common'
import { engine } from '../engine'
import { store, useStore } from '../store'

const AUDIO = 'audio/*,.wav,.mp3,.ogg,.m4a,.flac'
const seconds = (s: number) => `${s.toFixed(1)} s`

const source = (kind: CutsceneKind) => store.character.cutscenes[kind] ?? store.character.base

async function sound(method: string, args: unknown[], save?: string) {
  try {
    const [channels, rate] = await engine.call<[Int16Array[], number]>(method, args)
    if (save) download(wav(channels, rate), save, 'audio/wav')
    else play(channels, rate)
  } catch (e) {
    store.fail(e)
  }
}

export function CutscenesPage() {
  useStore()
  const c = store.character
  const cat = store.cutsceneCatalog()

  if (!store.game) {
    return (
      <div className="page">
        <h3>Cutscenes</h3>
        <Note>Choose your game disc first: every character's cutscenes are read from it.</Note>
      </div>
    )
  }
  const mine = cat?.[c.base]
  const cross = mine ? CUTSCENE_KINDS.filter((k) => cat![source(k)] && cat![source(k)].body !== mine.body) : []

  return (
    <div className="page">
      <h3>Cutscenes</h3>
      <Note>
        Use another character's intro, victory, or finisher, and replace their audio.<br /><br />
        A cutscene taken from another character starts {label(c.base)}'s effects at its cues, which may not suit it.<br />
        Use the <b>Effects</b> choice to play the other character's instead, as far as {label(c.base)} has room for them (the page says how many fit), or None. Projectiles and sounds stay {label(c.base)}'s.<br /><br />
        New audio replaces the whole track (voice, music and sounds), for both costumes. It always lasts exactly as long as the audio it replaces, since the cutscene keeps time with its audio: a shorter file is padded with silence, a longer one cut.
      </Note>
      <details>
        <summary><b>Memory, disc space and other limits</b></summary>
        <ul>
          <li>
            <b>Tuning list.</b> Any change on this page gives the character its own tuning file, as changed stats or an aura tint do (it is one file however many of those it has).
            One character always fits, but the game's list of tuning files has room for only a few more, so a <b>Multi-Character Patch</b> fits two to five such characters, depending on how long their internal names are.
          </li>
          <li>
            <b>Changing custcenes or audio never affects match memory.</b> The game plays a cutscene from the disc a piece at a time and streams its audio, so a bigger cutscene or new audio is never loaded whole.
          </li>
          <li>
            <b>Effects.</b> A custom character has room for only a few effects besides its own; each <b>Effects</b> choice says how many fit. Projectiles and sounds in a cutscene are always the custom characters's, and an aura tint does not recolour the other character's effects.
          </li>
        </ul>
      </details>
      {cross.length > 0 && (
        <Warning title="Cutscenes from another body class are approximate">
          <p>
            The {cross.map((k) => LABELS[k].toLowerCase()).join(' and ')} {cross.length === 1 ? 'comes' : 'come'} from a character with a different skeleton
            ({mine!.body} here). The animation is moved over bone by bone, but limb lengths usually differ.
          </p>
        </Warning>
      )}
      {!cat ? <p className="muted">Reading every character's cutscenes...</p> : !mine ? <p className="muted">{label(c.base)}'s cutscenes could not be read from this disc.</p> : (
        CUTSCENE_KINDS.map((kind) => <Kind key={kind} cat={cat} kind={kind} />)
      )}
    </div>
  )
}

function Kind({ cat, kind }: { cat: Catalog; kind: CutsceneKind }) {
  const c = store.character
  const from = source(kind)
  const info = cat[from]?.kinds[kind]
  const slots = info?.slots ?? []
  const stale = Object.keys(c.cutscenes.audio).filter((k) => k.startsWith(kind + '_') && !slots.some((s) => s.key === k))

  const pick = (key: string) => {
    if (key === c.base) {
      delete c.cutscenes[kind]
      delete c.cutscenes.effects[kind]
    } else c.cutscenes[kind] = key
    const dropped = dropUnfitAudio(c, cat, kind)
    if (dropped.length) store.message(`${dropped.length} new audio track${dropped.length === 1 ? '' : 's'} removed: ${dropped.length === 1 ? 'it does' : 'they do'} not fit ${label(key)}'s ${LABELS[kind].toLowerCase()}`)
    store.touch('character')
  }

  return (
    <>
      <h4>{LABELS[kind]}</h4>
      <div className="row">
        <span>Taken from</span>
        <select value={from} onChange={(e) => pick(e.target.value)}>
          {keys().map((k) => (
            <option key={k} value={k}>
              {label(k)}{k === c.base ? ' (base)' : ''}{cat[k] && cat[c.base] && cat[k].body !== cat[c.base].body ? ` (${cat[k].body}, approximate)` : ''}
            </option>
          ))}
        </select>
        {info && <span className="muted">{info.cuts.map((n) => n.replace(/\.cut$/i, '')).join(', ')}</span>}
      </div>
      {from !== c.base && (
        <>
          <div className="row">
            <span>Effects</span>
            <select value={c.cutscenes.effects[kind] ?? 'base'} onChange={(e) => {
              if (e.target.value === 'base') delete c.cutscenes.effects[kind]
              else c.cutscenes.effects[kind] = e.target.value as CutsceneEffects
              store.touch('character')
            }}>
              <option value="base">{label(c.base)}'s (base)</option>
              <option value="theirs">{label(from)}'s</option>
              <option value="none">None</option>
            </select>
            <EffectRoom kind={kind} />
          </div>
          <EffectWarning kind={kind} from={from} />
        </>
      )}
      <table className="gameplay">
        <thead><tr><th>Audio</th><th>{label(from)}'s</th><th>New</th></tr></thead>
        <tbody>
          {slots.map((s) => <AudioRow key={s.key} kind={kind} slot={s} />)}
          {stale.map((k) => (
            <tr key={k}>
              <td>{k.replace('_', ' ')}</td>
              <td className="muted">not in {label(from)}'s {LABELS[kind].toLowerCase()}</td>
              <td><button onClick={() => { removeAudio(c, k); store.touch('character') }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const effectCount = (n: number) => `${n} effect${n === 1 ? '' : 's'}`
const allOf = (n: number) => (n === 1 ? 'its one effect' : n === 2 ? 'both its effects' : `all ${n} of its effects`)

function EffectRoom({ kind }: { kind: CutsceneKind }) {
  const c = store.character
  if (c.cutscenes.effects[kind] === 'none') return <span className="muted">the cutscene itself starts no effects ({label(c.base)}'s always-on glows still show)</span>
  const fit = store.effectFit()?.[kind]
  if (!fit) return null
  const base = label(c.base), from = label(source(kind))
  if (!fit.total) return <span className="muted">{from}'s and {base}'s are the same here</span>
  if (fit.chosen) return fit.fit === fit.total ? <span className="muted">{allOf(fit.total)} play</span> : null
  return <span className="muted">with {from}'s, {fit.fit === fit.total ? `${allOf(fit.total)} would play` : `only ${fit.fit} of its ${effectCount(fit.total)} would play`}</span>
}

function EffectWarning({ kind, from }: { kind: CutsceneKind; from: string }) {
  const c = store.character
  const fits = store.effectFit()
  const fit = fits?.[kind]
  if (!fit?.chosen || fit.fit === fit.total) return null
  const base = label(c.base), others = CUTSCENE_KINDS.filter((k) => k !== kind && c.cutscenes.effects[k] === 'theirs' && (fits![k]?.fit ?? 0) > 0)
  return (
    <Warning title={`${fit.fit ? `Only ${fit.fit}` : 'None'} of ${label(from)}'s ${effectCount(fit.total)} fit${fit.fit ? '' : 's'}`}>
      <p>
        {base} has room for only a few effects besides its own, so {fit.total - fit.fit === 1 ? 'one plays' : `${fit.total - fit.fit} play`} as {base}'s instead.
        {others.length > 0 && <> The {others.map((k) => LABELS[k].toLowerCase()).join(' and ')} take{others.length === 1 ? 's' : ''} some of that room: set {others.length === 1 ? 'it' : 'one'} to {base}'s or None to make more.</>}
      </p>
    </Warning>
  )
}

function AudioRow({ kind, slot }: { kind: CutsceneKind; slot: AudioSlot }) {
  const c = store.character
  const member = c.cutscenes.audio[slot.key]
  const body = member ? c.files.get(member) : undefined

  const upload = async () => {
    const file = await pickFile(AUDIO)
    if (!file) return
    await store.edit(async () => {
      let channels: Int16Array[]
      try {
        channels = await decodeSound(file, asftool.RATE, slot.seconds)
      } catch (e) {
        store.fail(`The sound could not be read:\n${(e as Error).message}`)
        return
      }
      let data: Uint8Array
      try {
        data = await engine.call<Uint8Array>('encodeCutsceneAudio', [channels, slot.samples])
      } catch (e) {
        store.fail(e)
        return
      }
      const name = `cutscenes/${slot.key}.asf`
      c.files.set(name, data)
      c.cutscenes.audio[slot.key] = name
      store.touch('character')
    })
  }

  return (
    <tr>
      <td title={slot.stream}>{slot.label}</td>
      <td>
        <button title="Play" onClick={() => sound('cutscenePcm', [source(kind), kind, slot.key])}>▶</button>{' '}
        <button title="Download as .wav" onClick={() => sound('cutscenePcm', [source(kind), kind, slot.key], slot.stream.replace(/\.asf$/i, '.wav'))}>⤓</button>{' '}
        <span className="muted">{seconds(slot.seconds)}</span>
      </td>
      <td>
        {body ? (
          <>
            <button title="Play" onClick={() => sound('decodeCutsceneAudio', [body])}>▶</button>{' '}
            <button title="Download as .wav" onClick={() => sound('decodeCutsceneAudio', [body], `${c.internalName}_${slot.key}.wav`)}>⤓</button>{' '}
            <button onClick={upload}>Replace...</button>{' '}
            <button onClick={() => { removeAudio(c, slot.key); store.touch('character') }}>Remove</button>
          </>
        ) : !slot.samples ? (
          <span className="muted">not on this disc</span>
        ) : slot.seconds > MAX_AUDIO_SECONDS ? (
          <span className="muted">longer than {MAX_AUDIO_SECONDS} s, too long to replace</span>
        ) : (
          <button onClick={upload}>Upload...</button>
        )}
      </td>
    </tr>
  )
}
