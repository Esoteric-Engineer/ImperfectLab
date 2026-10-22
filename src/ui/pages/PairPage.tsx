import { Fragment, useEffect, useRef, useState } from 'react'
import { TINT_ALL_LIMIT } from '../../core/build/effects'
import * as R from '../../core/game/roster'
import { type Character, copyCharacter, load } from '../../core/package/imperfect'
import { canSaveInPlace, download, downloadBlob, openCharacter, opfsFile, removeOpfs } from '../../io/files'
import type { PairCheckResult } from '../../worker/protocol'
import { Note, ProblemList, Progress } from '../components/common'
import { engine, errorText } from '../engine'
import { titleCase } from '../format'
import { type PairSlot, store, useStore } from '../store'
import { choosePatchTarget, OPFS_NAME } from '../target'

const SLOTS = ['19th fighter', '20th fighter']
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`

function aura(c: Character): string {
  if (c.aura.mode === 'tint') return `tinted (${c.aura.tint === 'all' ? 'all effects' : 'idle and power-up'})`
  return c.aura.mode === 'swap' ? 'swapped' : "the base's"
}

function SlotCard({ index, slot, busy }: { index: number; slot: PairSlot | null; busy: boolean }) {
  const choose = async () => {
    try {
      const opened = await openCharacter()
      if (!opened) return
      store.setPair(index, { source: opened.name, character: load(opened.bytes) })
    } catch (e) {
      store.fail(`The character could not be opened:\n${errorText(e)}`)
    }
  }
  const useOpen = () => store.setPair(index, { source: `the editor${store.dirty ? ' (with unsaved changes)' : ''}`, character: copyCharacter(store.character) })
  const c = slot?.character
  return (
    <div className="card">
      <h4>{SLOTS[index]}</h4>
      {c ? (
        <div className="form">
          <label>Name:</label><span><b>{c.displayName}</b> <span className="swatch" style={{ background: c.nameColor }} title={`select-screen color ${c.nameColor}`} /></span>
          <label>Internal name:</label><span>{c.internalName}</span>
          <label>Base:</label><span>{c.base in R.BASES ? R.label(c.base) : c.base}</span>
          <label>Aura:</label><span>{aura(c)}</span>
          <label>Model file:</label><span>{c.glb ? kb(c.glb.length) : 'none'}</span>
          <label>From:</label><span className="muted">{slot.source}</span>
        </div>
      ) : <p className="muted">No character chosen.</p>}
      <div className="row">
        <button onClick={choose} disabled={busy}>Choose .imperfect...</button>
        <button onClick={useOpen} disabled={busy} title={`Use ${store.character.displayName}, the character open in the editor`}>Use the open character</button>
        {slot && <button onClick={() => store.setPair(index, null)} disabled={busy}>Clear</button>}
      </div>
    </div>
  )
}

export function PairPage() {
  useStore()
  const s = store
  const [a, b] = s.pair
  const g = s.game
  const check = s.pairCheck
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [log, setLog] = useState('')
  const [reportText, setReportText] = useState<string | null>(null)
  const [opfsReady, setOpfsReady] = useState<string | null>(null)
  const [outName, setOutName] = useState<string | null>(null)
  const checking = useRef<unknown>(null)

  const stem = g ? g.name.replace(/\.(iso|gcm|ciso)$/i, '') : ''
  const out = outName ?? (a && b ? `${stem} (${titleCase(a.character.displayName)} & ${titleCase(b.character.displayName)}).iso` : `${stem} (two characters).iso`)
  const errors = check ? check.problems.filter(([l]) => l === 'error').length : 0

  const onProgress = (stage: string, done: number, total: number) => {
    setBusy(stage + '...')
    setProgress([done, total])
  }

  // The check builds both characters in memory; a result for slots that have changed since is dropped.
  const runCheck = async () => {
    if (!a || !b || !g) return
    const key = {}
    checking.current = key
    setBusy('Checking...')
    setProgress([0, 0])
    setLog('')
    try {
      const r = await engine.call<PairCheckResult>('checkPair', [[a.character, b.character]], onProgress)
      if (checking.current === key && store.pair[0] === a && store.pair[1] === b) {
        store.pairCheck = r
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
    if (a && b && g && !check && checking.current === null) void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, g, check])

  const runPatch = async () => {
    if (!a || !b || !check || check.token === null) return
    const chosen = await choosePatchTarget(out)
    if (!chosen) return
    const [target, savedAs] = chosen
    setLog('')
    setReportText(null)
    setOpfsReady(null)
    setBusy('Starting...')
    setProgress([0, 0])
    try {
      const text = await engine.call<string>('patchPair', [[a.character, b.character], target, g?.verified ?? false, check.token], onProgress)
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
      <h3>Patch two characters</h3>
      <Note>
        Puts two characters into the game at once, as the 19th and 20th fighters.
        Choose a .imperfect file for each. Everything is checked against your disc before anything is written.
      </Note>
      <div className="slots">
        <SlotCard index={0} slot={a} busy={busy !== null} />
        <SlotCard index={1} slot={b} busy={busy !== null} />
      </div>
      <div className="row"><button onClick={() => store.swapPair()} disabled={busy !== null || (!a && !b)}>Swap the order</button></div>

      <h3>Check</h3>
      {!g ? <Note>Choose your game disc in the Game step first.</Note>
        : !(a && b) ? <Note>Choose both characters to check them.</Note>
        : check ? (
          <>
            <ProblemList problems={check.problems} ok="No conflicts or size problems found: both characters build against this disc." />
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
            <div className="row"><button onClick={() => { store.pairCheck = null; store.emit() }} disabled={busy !== null}>Check again</button></div>
          </>
        ) : !busy && <div className="row"><button onClick={runCheck}>Check</button></div>}

      <h3>Patch the game</h3>
      <Note>Writes a new disc image with both characters. Your disc is only read. It must be an unmodified dump: patch a fresh copy each time, not an image that was already patched.</Note>
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
