import { useState } from 'react'
import { noSecrets, SECRET_OPTIONS, type SecretOptions } from '../../core/build/secret'
import { canSaveInPlace, download, downloadBlob, opfsFile, removeOpfs } from '../../io/files'
import { Note, Progress, ToggleCard } from '../components/common'
import { engine, errorText } from '../engine'
import { store, useStore } from '../store'
import { choosePatchTarget, OPFS_NAME } from '../target'

export function SecretPage({ onLeave }: { onLeave: () => void }) {
  useStore()
  const g = store.game
  const [opts, setOpts] = useState<SecretOptions>(noSecrets)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [log, setLog] = useState('')
  const [reportText, setReportText] = useState<string | null>(null)
  const [opfsReady, setOpfsReady] = useState<string | null>(null)
  const [outName, setOutName] = useState<string | null>(null)

  const stem = g ? g.name.replace(/\.(iso|gcm|ciso)$/i, '') : ''
  const out = outName ?? `${stem} (with secret options).iso`
  const any = SECRET_OPTIONS.some((o) => opts[o.id])

  const onProgress = (stage: string, done: number, total: number) => {
    setBusy(stage + '...')
    setProgress([done, total])
  }

  const runPatch = async () => {
    if (!g || !any) return
    const chosen = await choosePatchTarget(out)
    if (!chosen) return
    const [target, savedAs] = chosen
    setLog('')
    setReportText(null)
    setOpfsReady(null)
    setBusy('Starting...')
    setProgress([0, 0])
    try {
      const text = await engine.call<string>('patchSecret', [opts, target, g.verified], onProgress)
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
      <h3>Secret Options</h3>
      <Note>
        Hidden options! Don't tell anyone (or do, I don't care). <a href="#" onClick={(e) => { e.preventDefault(); onLeave() }}>Back to ImperfectLab</a>
      </Note>
      {SECRET_OPTIONS.map((o) => (
        <ToggleCard key={o.id} title={o.label} checked={opts[o.id]} disabled={busy !== null} note={o.description}
          onChange={(on) => setOpts(on ? { ...noSecrets(), [o.id]: true } : { ...opts, [o.id]: false })}>
          <ul className="release-notes">{o.effects.map((e) => <li key={e}>{e}</li>)}</ul>
        </ToggleCard>
      ))}

      <h3>Patch the game</h3>
      <Note>Writes a new disc image with the options above. Your disc is only read. It must be an <b>unmodified</b> dump, not an image that was already patched.</Note>
      <div className="form">
        <label>Your disc:</label>
        <span>{g ? g.name : 'choose it in the Game step'}</span>
        <label>New disc:</label>
        <input value={out} onChange={(e) => setOutName(e.target.value)} disabled={!g} />
      </div>
      {!canSaveInPlace && <Note>This browser cannot write files directly: the new disc is built in the browser's storage (1.4 GB) and then downloaded.</Note>}
      <div className="row">
        <button onClick={runPatch} disabled={!g || !any || busy !== null}>Patch</button>
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