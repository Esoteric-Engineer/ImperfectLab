import { Fragment, useEffect, useRef, useState } from 'react'
import { MAX_BATCH, ordinal } from '../../core/build/batch'
import { TINT_ALL_LIMIT } from '../../core/build/effects'
import * as R from '../../core/game/roster'
import { type Character, copyCharacter, load } from '../../core/package/imperfect'
import { canSaveInPlace, download, downloadBlob, openCharacter, opfsFile, removeOpfs } from '../../io/files'
import type { BatchCheckResult } from '../../worker/protocol'
import { Note, ProblemList, Progress } from '../components/common'
import { engine, errorText } from '../engine'
import { titleCase } from '../format'
import { type BatchSlot, store, useStore } from '../store'
import { choosePatchTarget, OPFS_NAME } from '../target'

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`

function aura(c: Character): string {
  const fire = c.flames.body ? ', flames over the whole body' : c.flames.parts.length ? `, flames on ${c.flames.parts.length} part${c.flames.parts.length > 1 ? 's' : ''}` : ''
  if (c.aura.mode === 'tint') return `tinted (${c.aura.tint === 'all' ? 'all effects' : 'idle and power-up'})${fire}`
  return (c.aura.mode === 'swap' ? 'swapped' : "the base's") + fire
}

async function chooseSlot(): Promise<BatchSlot | null> {
  try {
    const opened = await openCharacter()
    return opened ? { source: opened.name, character: load(opened.bytes) } : null
  } catch (e) {
    store.fail(`The character could not be opened:\n${errorText(e)}`)
    return null
  }
}

const openSlot = (): BatchSlot => ({ source: `the editor${store.dirty ? ' (with unsaved changes)' : ''}`, character: copyCharacter(store.character) })

function SlotCard({ index, slot, count, busy }: { index: number; slot: BatchSlot; count: number; busy: boolean }) {
  const replace = async () => {
    const next = await chooseSlot()
    if (next) store.setBatch(index, next)
  }
  const c = slot.character
  return (
    <div className="card">
      <h4>{ordinal(index)} fighter</h4>
      <div className="form">
        <label>Name:</label><span><b>{c.displayName}</b> <span className="swatch" style={{ background: c.nameColor }} title={`select-screen color ${c.nameColor}`} /></span>
        <label>Internal name:</label><span>{c.internalName}</span>
        <label>Base:</label><span>{c.base in R.BASES ? R.label(c.base) : c.base}</span>
        <label>Aura:</label><span>{aura(c)}</span>
        <label>Model file:</label><span>{c.glb ? kb(c.glb.length) : 'none'}</span>
        <label>From:</label><span className="muted">{slot.source}</span>
      </div>
      <div className="row">
        <button onClick={replace} disabled={busy}>Replace...</button>
        <button onClick={() => store.moveInBatch(index, -1)} disabled={busy || index === 0}>Move up</button>
        <button onClick={() => store.moveInBatch(index, 1)} disabled={busy || index === count - 1}>Move down</button>
        <button onClick={() => store.removeFromBatch(index)} disabled={busy}>Remove</button>
      </div>
    </div>
  )
}

function outputName(stem: string, names: string[]): string {
  if (!names.length) return `${stem} (new characters).iso`
  if (names.length > 3) return `${stem} (${names.length} characters).iso`
  const t = names.map(titleCase)
  return `${stem} (${t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} & ${t[t.length - 1]}`}).iso`
}

export function BatchPage() {
  useStore()
  const s = store
  const batch = s.batch
  const g = s.game
  const check = s.batchCheck
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [log, setLog] = useState('')
  const [reportText, setReportText] = useState<string | null>(null)
  const [opfsReady, setOpfsReady] = useState<string | null>(null)
  const [outName, setOutName] = useState<string | null>(null)
  const checking = useRef<unknown>(null)

  const stem = g ? g.name.replace(/\.(iso|gcm|ciso)$/i, '') : ''
  const out = outName ?? outputName(stem, batch.map((x) => x.character.displayName))
  const errors = check ? check.problems.filter(([l]) => l === 'error').length : 0
  const full = batch.length >= MAX_BATCH

  const onProgress = (stage: string, done: number, total: number) => {
    setBusy(stage + '...')
    setProgress([done, total])
  }

  const add = async () => {
    const slot = await chooseSlot()
    if (slot) store.addToBatch(slot)
  }

  // The check builds every character in memory; a result for a list that has changed since is dropped.
  const runCheck = async () => {
    if (!batch.length || !g) return
    const key = {}
    checking.current = key
    setBusy('Checking...')
    setProgress([0, 0])
    setLog('')
    try {
      const r = await engine.call<BatchCheckResult>('checkBatch', [batch.map((x) => x.character)], onProgress)
      if (checking.current === key && store.batch === batch) {
        store.batchCheck = r
        store.emit()
      }
    } catch (e) {
      if (checking.current === key) setLog('✖ The check failed:\n' + errorText(e))
    }
    if (checking.current === key) {
      checking.current = null
      setBusy(null)
    }
  }

  useEffect(() => {
    if (batch.length && g && !check && checking.current === null) void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, g, check])

  const runPatch = async () => {
    if (!batch.length || !check || check.token === null) return
    const chosen = await choosePatchTarget(out)
    if (!chosen) return
    const [target, savedAs] = chosen
    setLog('')
    setReportText(null)
    setOpfsReady(null)
    setBusy('Starting...')
    setProgress([0, 0])
    try {
      const text = await engine.call<string>('patchBatch', [batch.map((x) => x.character), target, g?.verified ?? false, check.token], onProgress)
      setLog(text)
      setReportText(text)
      if (target.kind === 'opfs') {
        setOpfsReady(out)
        downloadBlob(await opfsFile(OPFS_NAME), out)
      }
      store.message(`Done: ${savedAs}`)
    } catch (e) {
      setLog('✖ Patching failed:\n' + errorText(e))
    }
    setBusy(null)
  }

  return (
    <div className="page">
      <h3>Multi-Character Patch</h3>
      <Note>
        Puts up to {MAX_BATCH} characters into the game at once, as the 19th to the 27th fighters: the third row of the select screen.
        Choose a .imperfect file for each, in the order they should appear. Everything is checked against your disc before anything is written.
      </Note>
      <Note>
        Characters with a tinted aura or changed gameplay each need a line in the game's small tuning list, so only a few of them fit in one patch.
        Characters with the base's or a swapped aura and the base's gameplay have no such limit.
      </Note>
      <div className="slots">
        {batch.map((slot, i) => <SlotCard key={i} index={i} slot={slot} count={batch.length} busy={busy !== null} />)}
      </div>
      {!batch.length && <p className="muted">No characters chosen.</p>}
      <div className="row">
        <button onClick={add} disabled={busy !== null || full}>Add a character...</button>
        <button onClick={() => store.addToBatch(openSlot())} disabled={busy !== null || full} title={`Add ${store.character.displayName}, the character open in the editor`}>Add the open character</button>
        <span className="muted">{batch.length} of {MAX_BATCH} slots</span>
      </div>

      <h3>Check</h3>
      {!g ? <Note>Choose your game disc in the Game step first.</Note>
        : !batch.length ? <Note>Add a character to check it.</Note>
        : check ? (
          <>
            <ProblemList problems={check.problems} ok={`No conflicts or size problems found: ${batch.length === 1 ? 'the character builds' : `all ${batch.length} characters build`} against this disc.`} />
            {check.token !== null && (
              <div className="form">
                {check.models.map(([name, size]) => (
                  <Fragment key={name}><label>{name} model:</label><span>{kb(size)} <span className="muted">(the game's largest is {kb(check.largest)})</span></span></Fragment>
                ))}
                <label>Effect memory:</label>
                <span>
                  {check.cacheExtra ? `the cache grows by ${check.cacheExtra.toLocaleString('en-US')} bytes` : "fits the game's cache"}
                  {' '}<span className="muted">(up to {TINT_ALL_LIMIT.toLocaleString('en-US')} bytes has been tested)</span>
                </span>
              </div>
            )}
            {check.notes.length > 0 && (
              <details>
                <summary className="muted">Build notes</summary>
                <pre className="log">{check.notes.join('\n')}</pre>
              </details>
            )}
            <div className="row"><button onClick={() => { store.batchCheck = null; store.emit() }} disabled={busy !== null}>Check again</button></div>
          </>
        ) : !busy && <div className="row"><button onClick={runCheck}>Check</button></div>}

      <h3>Patch the game</h3>
      <Note>Writes a new disc image with every character above. Your disc is only read. It must be an unmodified dump: patch a fresh copy each time, not an image that was already patched.</Note>
      <div className="form">
        <label>Your disc:</label>
        <span>{g ? g.name : 'choose it in the Game step'}</span>
        <label>New disc:</label>
        <input value={out} onChange={(e) => setOutName(e.target.value)} />
      </div>
      {!canSaveInPlace && <Note>This browser cannot write files directly: the new disc is built in the browser's storage (1.4 GB) and then downloaded.</Note>}
      <div className="row">
        <button onClick={runPatch} disabled={!check || check.token === null || errors > 0 || busy !== null}>Patch</button>
        {reportText && <button onClick={() => download(reportText, out.replace(/\.iso$/i, '') + ' - report.txt', 'text/plain')}>Download report</button>}
        {opfsReady && <button onClick={async () => downloadBlob(await opfsFile(OPFS_NAME), opfsReady)}>Download the disc again</button>}
        {opfsReady && <button onClick={async () => { await removeOpfs(OPFS_NAME); setOpfsReady(null) }}>Free the browser storage</button>}
      </div>
      {busy && <p>{busy}</p>}
      {busy && <Progress done={progress[0]} total={progress[1]} />}
      <pre className="log">{log}</pre>
    </div>
  )
}
