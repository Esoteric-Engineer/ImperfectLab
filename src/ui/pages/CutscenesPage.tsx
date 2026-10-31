import { type AnimationSlot, type AudioSlot, type Catalog, dropAnimations, dropUnfitAudio, LABELS, removeAnimation, removeAudio } from '../../core/build/cutscenes'
import { keys, label } from '../../core/game/roster'
import * as asftool from '../../core/mnroi/asftool'
import { type CutsceneEffects, CUTSCENE_KINDS, type CutsceneKind, MAX_AUDIO_SECONDS } from '../../core/package/imperfect'
import { download, pickFile } from '../../io/files'
import { decodeSound, play, wav } from '../audio'
import { Note, Warning } from '../components/common'
import { engine } from '../engine'
import { store, useStore } from '../store'

const AUDIO = 'audio/*,.wav,.mp3,.ogg,.m4a,.flac'
const GLB = '.glb,model/gltf-binary'
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
        Use another character's intro, victory, or finisher, replace their audio, and re-animate them in Blender.<br /><br />
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
            <b>Effects.</b> A custom character has room for only a few effects besides its own; each <b>Effects</b> choice says how many fit. Projectiles and sounds in a cutscene are always the custom character's, and an aura tint does not recolor the other character's effects.
          </li>
        </ul>
      </details>
      <details>
        <summary><b>Animating a cutscene in Blender</b></summary>
        <ol>
          <li>Download a cutscene from this page as <code>.glb</code>.</li>
          <li>Open Blender and set the scene to <b>30 fps</b> via Output Properties &gt; Frame Rate.</li>
          <li>Go to File &gt; Import &gt; glTF 2.0, and import the downloaded cutscene.</li>
          <li>Make your desired changes to the cutscene.</li>
          <li>
            Export via File &gt; Export &gt; glTF 2.0 (.glb):
            <ul>
              <li>Ensure <b>Format</b> is set to <code>glTF Binary (.glb)</code>.</li>
              <li>Under <b>Include &gt; Data</b>, ensure <b>Cameras</b> is checked.</li>
              <li>Under <b>Animation</b>, ensure <b>Sampling Animations</b> is unchecked.</li>
            </ul>
          </li>
          <li>Upload the modified <code>.glb</code> below.</li>
        </ol>
        <Note>
          Good to Know:
          <ul>
            <li>The downloaded <code>.glb</code> holds:
              <ul>
                <li>the character as an armature</li>
                <li><code>nis_camera</code>: the main camera</li>
                <li><code>nis_camera2</code>: only for intros, the camera for player 2's side</li>
                <li><code>victim</code>: only for finishers, the opponent's armature</li>
              </ul>
            </li>
            <li>Don't rename any object names or bone names. This will break the import.</li>
            <li>Move the character up/down by it's Pelvis, not it's Root. The root is ignored for some reason.</li>
            <li>The edited cutscene must be the same duration as the original cutscene. Anything past the end of the original is left out, and if the new cutscene is shorter, it stays on the last frame for the remaining duration.</li>
            <li>Audio and effect swapping is not done in the menu below, not in the <code>.glb</code>.</li>
            <li>Each shot keeps the original's field of view. Camera changes aren't supported yet.</li>
            <li>The small shapes on the joints are only there so that Blender makes an armature.</li>
            <li>Don't ask me for help with animating. <a href="https://youtu.be/gFAuKtT_o-0" target='_blank'>You can almost certainly do it better than I can.</a></li>
          </ul>
        </Note>
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
  const anims = info?.animations ?? []
  const staleAnims = Object.keys(c.cutscenes.animation).filter((k) => k.startsWith(kind + '_') && !anims.some((s) => s.key === k))

  const pick = (key: string) => {
    if (key === c.base) {
      delete c.cutscenes[kind]
      delete c.cutscenes.effects[kind]
    } else c.cutscenes[kind] = key
    const dropped = dropUnfitAudio(c, cat, kind)
    if (dropped.length) store.message(`${dropped.length} new audio track${dropped.length === 1 ? '' : 's'} removed: ${dropped.length === 1 ? 'it does' : 'they do'} not fit ${label(key)}'s ${LABELS[kind].toLowerCase()}`)
    // the select only reports a change, so any animation was made for the cutscenes it left
    const reanimated = dropAnimations(store.character, kind)
    if (reanimated.length) store.message(`${reanimated.length} new animation${reanimated.length === 1 ? '' : 's'} removed: ${reanimated.length === 1 ? 'it was' : 'they were'} made for the ${LABELS[kind].toLowerCase()} taken before`)
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
      <table className="gameplay">
        <thead><tr><th>Animation</th><th>{label(from)}'s</th><th>New</th></tr></thead>
        <tbody>
          {anims.map((s) => <AnimationRow key={s.key} kind={kind} slot={s} />)}
          {staleAnims.map((k) => (
            <tr key={k}>
              <td>{k.replace('_', ' ')}</td>
              <td className="muted">not in {label(from)}'s {LABELS[kind].toLowerCase()}</td>
              <td><button onClick={() => { removeAnimation(c, k); store.touch('character') }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function AnimationRow({ kind, slot }: { kind: CutsceneKind; slot: AnimationSlot }) {
  const c = store.character
  const member = c.cutscenes.animation[slot.key]
  const body = member ? c.files.get(member) : undefined
  const glb = (data: Uint8Array, name: string) => download(data, name, 'model/gltf-binary')

  const original = async () => {
    try {
      glb(await engine.call<Uint8Array>('cutsceneAnimation', [source(kind), kind, slot.key]), `${slot.cut.replace(/\.cut$/i, '')}.glb`)
    } catch (e) {
      store.fail(e)
    }
  }

  const upload = async () => {
    const file = await pickFile(GLB)
    if (!file) return
    await store.edit(async () => {
      const data = new Uint8Array(await file.arrayBuffer())
      let notes: string[]
      try {
        notes = await engine.call<string[]>('checkCutsceneAnimation', [source(kind), kind, slot.key, data])
      } catch (e) {
        store.fail(`The animation could not be used:\n${(e as Error).message}`)
        return
      }
      const name = `cutscenes/${slot.key}.glb`
      c.files.set(name, data)
      c.cutscenes.animation[slot.key] = name
      if (notes.length) store.message(`${slot.label}: ${notes.join('; ')}`)
      store.touch('character')
    })
  }

  return (
    <tr>
      <td title={slot.cut}>{slot.label}</td>
      <td><button title="Download as .glb, to open in Blender" onClick={original}>⤓ .glb</button></td>
      <td>
        {body ? (
          <>
            <button title="Download as .glb" onClick={() => glb(body, `${c.internalName}_${slot.key}.glb`)}>⤓</button>{' '}
            <button onClick={upload}>Replace...</button>{' '}
            <button onClick={() => { removeAnimation(c, slot.key); store.touch('character') }}>Remove</button>
          </>
        ) : (
          <button onClick={upload}>Upload...</button>
        )}
      </td>
    </tr>
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
