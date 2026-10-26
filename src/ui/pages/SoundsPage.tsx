import { useState } from 'react'
import * as dsp from '../../core/audio/dspadpcm'
import { type BankInfo, type Catalog, gameRef, MAX_BANK, type Sound, soundName } from '../../core/build/sounds'
import { keys, label, VOICES } from '../../core/game/roster'
import { type Character, MAX_SOUND_SECONDS, type SoundSource } from '../../core/package/imperfect'
import { pickFile } from '../../io/files'
import { decodeSound, play } from '../audio'
import { Note, Warning } from '../components/common'
import { engine, errorText } from '../engine'
import { store, useStore } from '../store'

const AUDIO = 'audio/*,.wav,.mp3,.ogg,.m4a,.flac'
// Rates offered for uploads besides the slot's own: smaller sounds for long clips.
const RATES = [16000, 11025]

const seconds = (s: Sound) => `${(s.samples / s.rate).toFixed(2)} s`
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`
const align = (n: number) => Math.ceil(n / 0x20) * 0x20

function sourceBytes(cat: Catalog, files: Map<string, Uint8Array>, from: SoundSource): number | null {
  if ('file' in from) {
    const body = files.get(from.file)
    return body ? body.length - dsp.DSP_HEADER : null
  }
  try {
    const [base, i] = gameRef(from.game)
    const s = cat[base]?.sounds[i]
    return s ? dsp.dataSize(s.samples) : null
  } catch {
    return null
  }
}

const sourceKey = (from: SoundSource) => ('file' in from ? from.file : from.game)

function estimate(cat: Catalog, mine: BankInfo, files: Map<string, Uint8Array>, sounds: Record<string, SoundSource>): number {
  let size = mine.bytes
  const seen = new Set<string>()
  for (const [slot, from] of Object.entries(sounds)) {
    const old = mine.sounds[Number(slot)], bytes = seen.has(sourceKey(from)) ? 0 : sourceBytes(cat, files, from)
    seen.add(sourceKey(from))
    if (old && bytes !== null) size += align(bytes) - align(old.bytes)
  }
  return size
}

const uploads = (c: Character) => [...c.files.keys()].filter((k) => k.startsWith('sounds/')).sort()
const uploadName = (member: string) => member.slice('sounds/'.length, -'.dsp'.length)

function newMember(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'sound'
  let member = `sounds/${stem}.dsp`
  for (let n = 2; store.character.files.has(member); n++) member = `sounds/${stem}_${n}.dsp`
  return member
}

async function preview(base: string, index: number) {
  try {
    const [pcm, rate] = await engine.call<[Int16Array, number]>('soundPcm', [base, index])
    play([pcm], rate)
  } catch (e) {
    store.fail(e)
  }
}

function clear(slot: number) {
  const c = store.character
  const from = c.sounds[slot]
  delete c.sounds[slot]
  if (from && 'file' in from && !Object.values(c.sounds).some((s) => 'file' in s && s.file === from.file)) c.files.delete(from.file)
}

function setFile(slot: number, member: string) {
  const from = store.character.sounds[slot]
  if (from && 'file' in from && from.file === member) return
  clear(slot)
  store.character.sounds[slot] = { file: member }
  store.touch('character')
}

function setGame(cat: Catalog, slot: number, base: string, index: number) {
  clear(slot)
  store.character.sounds[slot] = { game: `${base}:${Math.min(index, cat[base].sounds.length - 1)}` }
  store.touch('character')
}

function previewFile(body: Uint8Array | undefined) {
  if (!body) return
  const d = dsp.readDsp(body)
  play([dsp.decode(d)], d.rate)
}

export function SoundsPage() {
  useStore()
  const c = store.character
  const cat = store.soundCatalog()
  const [rate, setRate] = useState(0)
  const [busy, setBusy] = useState<number | null>(null)

  const voice = (
    <div className="row">
      <label>Versus Mode selection sound effect:</label>
      <select value={c.ui.ready_voice ?? ''} onChange={(e) => { c.ui.ready_voice = e.target.value || null; store.touch('character') }}>
        <option value="">none (no sound effect)</option>
        {keys().map((k) => <option key={k} value={VOICES[k]}>{label(k)}'s</option>)}
      </select>
    </div>
  )
  if (!store.game) {
    return (
      <div className="page">
        <h3>Sounds</h3>
        {voice}
        <Note>Choose your game disc first: every character's sounds are read from it.</Note>
      </div>
    )
  }
  const mine = cat?.[c.base]
  const changed = Object.keys(c.sounds).length
  const size = cat && mine ? estimate(cat, mine, c.files, c.sounds) : 0
  const stale = mine ? Object.keys(c.sounds).map(Number).filter((i) => i >= mine.sounds.length) : []

  const resetAll = () => {
    for (const slot of Object.keys(c.sounds)) clear(Number(slot))
    store.touch('character')
  }
  const upload = async (slot: number, own: number) => {
    const file = await pickFile(AUDIO)
    if (!file) return
    const r = rate || own
    setBusy(slot)
    await store.edit(async () => {
      try {
        const [pcm] = await decodeSound(file, r, MAX_SOUND_SECONDS, 1)
        const body = await engine.call<Uint8Array>('encodeSound', [pcm, r])
        clear(slot)
        const member = newMember(file.name)
        store.character.files.set(member, body)
        store.character.sounds[slot] = { file: member }
        store.touch('character')
      } catch (e) {
        store.fail(`The sound could not be used:\n${errorText(e)}`)
      } finally {
        setBusy(null)
      }
    })
  }

  return (
    <div className="page">
      <h3>Sounds</h3>
      <Note>Change sounds for your character.</Note>
      <h4>Menu</h4>
      {voice}
      <h4>Sound Effects</h4>
      <Note>
        Replace any sound effects with another character's sound effects, or custom.<br />
        Uploads are converted to the game's own mono format. Silence at either end is cut. Uploads can be up to {MAX_SOUND_SECONDS} seconds each.<br />
        The game does not ship any names for the sounds, so a few of them have been named by hand by EsotericEngineer. Want to contribute names? <a href="https://github.com/Esoteric-Engineer/ImperfectLab/fork" target='_blank'>Create a fork and open a PR.</a>
      </Note>
      <Warning title={`Matches against ${label(c.base)} share one set of sounds`}>
        <p>
          In a match with your custom character against {label(c.base)}, or against another character built on {label(c.base)}, both fighters use the first player's sounds.<br />
          Loading only {label(c.base)} in a match will still result in {label(c.base)}'s original sounds playing.
        </p>
      </Warning>
      {!cat ? <p className="muted">Reading every character's sounds...</p> : !mine ? <p className="muted">{label(c.base)}'s sounds could not be read from this disc.</p> : (
        <>
          <div className="row">
            <span>Sound bank: about {kb(size)} of the {kb(MAX_BANK)} a match can load</span>
            <progress max={MAX_BANK} value={Math.min(size, MAX_BANK)} />
            <label>Uploads at <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              <option value={0}>each sound's own rate</option>
              {RATES.map((r) => <option key={r} value={r}>{r} Hz (smaller)</option>)}
            </select></label>
            {changed > 0 && <button onClick={resetAll}>Set all back to {label(c.base)}'s</button>}
          </div>
          {size > MAX_BANK && (
            <Warning title="The sound bank is too large">
              <p>The new sounds make it larger than {label('roekel')}'s, the largest a match is known to load. Shorten them, upload them at a lower rate, or set some back.</p>
            </Warning>
          )}
          {stale.length > 0 && (
            <Warning title={`Sounds ${label(c.base)} doesn't have`}>
              <p>
                {stale.map((i) => i + 1).join(', ')}: these were set for another base. <button onClick={() => { stale.forEach(clear); store.touch('character') }}>Remove them</button>
              </p>
            </Warning>
          )}
          <table className="gameplay">
            <thead><tr><th>#</th><th>{label(c.base)}'s sound</th><th>Replace with</th><th>New sound</th></tr></thead>
            <tbody>{mine.sounds.map((s, i) => <SoundRow key={i} cat={cat} index={i} sound={s} busy={busy === i} upload={upload} />)}</tbody>
          </table>
        </>
      )}
    </div>
  )
}

function SoundRow({ cat, index, sound, busy, upload }: {
  cat: Catalog; index: number; sound: Sound; busy: boolean; upload: (slot: number, rate: number) => void
}) {
  const c = store.character
  const from = c.sounds[index]
  const mode = !from ? '' : 'file' in from ? 'file' : 'game'
  const [base, other] = from && 'game' in from ? gameRef(from.game) : [Object.keys(cat).find((k) => k !== c.base) ?? c.base, 0]
  const body = from && 'file' in from ? c.files.get(from.file) : undefined
  const file = body ? dsp.readDsp(body) : null
  const mine = uploads(c)
  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <button className="small" title="Play" onClick={() => preview(c.base, index)}>▶</button>{' '}
        {soundName(c.base, index) && <>{soundName(c.base, index)} </>}
        <span className="muted">{seconds(sound)}, {sound.rate} Hz{sound.loop ? ', loops' : ''}{sound.stereo ? ', stereo' : ''}</span>
      </td>
      <td>
        <select value={mode} disabled={busy} onChange={(e) => {
          const v = e.target.value
          if (v === 'game') setGame(cat, index, base, other)
          else if (v === 'file') setFile(index, mine[0])
          else if (v === 'upload') upload(index, sound.rate)
          else {
            clear(index)
            store.touch('character')
          }
        }}>
          <option value="">{label(c.base)}'s (base)</option>
          <option value="game">another character's sound</option>
          {(mine.length > 0 || mode === 'file') && <option value="file">one of your sound files</option>}
          <option value="upload">upload a sound file...</option>
        </select>
        {mode === 'game' && (
          <>
            {' '}<select value={base} onChange={(e) => setGame(cat, index, e.target.value, other)}>
              {Object.keys(cat).map((k) => <option key={k} value={k}>{label(k)}</option>)}
            </select>
            {' '}<select value={other} onChange={(e) => setGame(cat, index, base, Number(e.target.value))}>
              {(cat[base]?.sounds ?? []).map((s, i) => <option key={i} value={i}>{i + 1}: {soundName(base, i) ? `${soundName(base, i)} (${seconds(s)})` : seconds(s)}</option>)}
            </select>
          </>
        )}
        {mode === 'file' && from && 'file' in from && (
          <>
            {' '}<select value={from.file} disabled={busy} onChange={(e) => setFile(index, e.target.value)}>
              {mine.map((m) => <option key={m} value={m}>{uploadName(m)}</option>)}
            </select>
          </>
        )}
        {busy && <span className="muted"> converting...</span>}
      </td>
      <td>
        {mode === 'game' && (cat[base]?.sounds[other]
          ? <><button className="small" title="Play" onClick={() => preview(base, other)}>▶</button> {soundName(base, other) && <>{soundName(base, other)} </>}<span className="muted">{seconds(cat[base].sounds[other])}</span></>
          : <span className="muted">{label(base)} has no sound {other + 1}</span>)}
        {file && <><button className="small" title="Play" onClick={() => previewFile(body)}>▶</button> <span className="muted">{(file.samples / file.rate).toFixed(2)} s, {file.rate} Hz{sound.loop ? ', loops' : ''}</span></>}
      </td>
    </tr>
  )
}
