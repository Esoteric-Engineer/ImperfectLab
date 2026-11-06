import { useState } from 'react'
import { pickDiscFile, pickDiscFolder } from '../../io/files'
import { Note, Progress } from '../components/common'
import { describeDisc, loadDisc, reopenDisc } from '../disc'
import { store, useStore } from '../store'

export function GamePage() {
  useStore()
  const s = store
  const [checking, setChecking] = useState<[number, number] | null>(null)
  const [busy, setBusy] = useState(false)

  const onCheck = (p: [number, number] | null) => setChecking(p)

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } catch (e) {
      s.fail(e)
    } finally {
      setBusy(false)
      setChecking(null)
    }
  }

  const open = (kind: 'file' | 'folder') => run(async () => {
    const src = kind === 'file' ? await pickDiscFile() : await pickDiscFolder()
    if (src) await loadDisc(src, onCheck)
  })

  const reopen = () => run(() => reopenDisc(onCheck))

  const disabled = busy || s.restoringDisc
  const remembered = !s.game && !s.restoringDisc ? s.rememberedDisc : null

  return (
    <div className="page">
      <h3>Your copy of the game</h3>
      <Note>
        ImperfectLab reads from your own disc: Marvel Nemesis: Rise of the Imperfects for GameCube, USA (GVLE69), as .iso, .gcm or .ciso, or an extracted disc folder.<br />
        The disc is only ever read, never modified, and it never leaves your computer.
      </Note>
      <div className="row">
        {remembered && <button onClick={reopen} disabled={disabled}>Reopen {remembered.name}</button>}
        <button onClick={() => open('file')} disabled={disabled}>Choose disc image...</button>
        <button onClick={() => open('folder')} disabled={disabled}>Choose extracted folder...</button>
      </div>
      <div className={`card disc-status ${s.game ? 'ready' : ''}`}>
        {s.game ? (
          <>
            <div className="disc-name"><b>{s.game.name}</b> <span className="muted">· {describeDisc(s.game.details)}</span></div>
            <div className="good">✔ An unmodified GVLE69 disc. Next: the Character step.</div>
          </>
        ) : s.restoringDisc && s.rememberedDisc ? (
          <div>Reopening {s.rememberedDisc.name}...</div>
        ) : remembered ? (
          <>
            <div className="disc-name"><b>{remembered.name}</b>{remembered.details && <span className="muted"> · {describeDisc(remembered.details)}</span>}</div>
            <div className="muted">Not open yet. Reopen this disc from last time, or choose another.</div>
          </>
        ) : (
          <div className="muted">No disc chosen.</div>
        )}
        {checking && (
          <div className="disc-check">
            <div className="muted">Checking that the disc is an unmodified GVLE69 dump (may take up to a minute the first time)...</div>
            <Progress done={checking[0]} total={checking[1]} />
          </div>
        )}
      </div>
    </div>
  )
}
