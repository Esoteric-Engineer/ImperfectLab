import { useMemo, useState } from 'react'
import * as effects from '../../core/build/effects'
import * as mapping from '../../core/model/mapping'
import { copyCharacter, problems as characterProblems } from '../../core/package/imperfect'
import { canSaveInPlace, chooseIsoOutput, download, downloadBlob, freeSpace, opfsFile, removeOpfs } from '../../io/files'
import type { CheckResult, PatchTarget } from '../../worker/protocol'
import { Note, ProblemList, Progress } from '../components/common'
import { engine, errorText } from '../engine'
import { store, useStore } from '../store'
import { saveAs } from '../actions'
import { titleCase } from '../format'

const OPFS_NAME = 'imperfectlab-patched.iso'
const GC_DISC_SIZE = 1459978240

export function ExportPage() {
  useStore()
  const s = store
  const c = s.character
  const g = s.game
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [log, setLog] = useState('')
  const [reportText, setReportText] = useState<string | null>(null)
  const [opfsReady, setOpfsReady] = useState<string | null>(null)
  const [outName, setOutName] = useState<string | null>(null)
  const sk = g ? s.skeleton() : null
  const details = s.baseDetails()

  const stem = g ? g.name.replace(/\.(iso|gcm|ciso)$/i, '') : ''
  const defaultOut = `${stem} (${titleCase(c.displayName)}).iso`
  const out = outName ?? defaultOut

  const problems = useMemo(() => {
    const p: [string, string][] = [...characterProblems(c)]
    if (!g) p.push(['warning', 'choose the game disc to check the mapping and to patch'])
    else if (!sk) p.push(['error', `${s.base()?.label}'s skeleton is not supported yet: pick another base`])
    else if (s.model) p.push(...mapping.check(s.model, sk, c.mapping, c.overrides))
    const level = details ? effects.tintLevel(details.tint, c.aura.tint) : c.aura.tint
    const plan = details?.tint[level]
    if (g && c.aura.mode === 'tint' && plan && !plan.roots.length && !plan.alt.length) {
      p.push(['error', `${s.base()?.label} has no effects to tint: choose another aura in the Aura step`])
    }
    if (g && c.aura.mode === 'tint' && level !== c.aura.tint) {
      p.push(['warning', `${s.base()?.label}'s full tint needs more memory than a match can spare: only its idle and power-up effects are tinted`])
    }
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, g, sk, s.model, details, s.versions.character, s.versions.mapping, s.versions.model])

  const onProgress = (stage: string, done: number, total: number) => {
    setBusy(stage + '...')
    setProgress([done, total])
  }

  const fullCheck = async () => {
    setBusy('Building everything in memory...')
    setProgress([0, 0])
    setLog('')
    try {
      const r = await engine.call<CheckResult>('check', [copyCharacter({ ...c, glb: null })], onProgress)
      setLog(`✔ The character builds against this disc.\n\n${r.notes.join('\n')}\n\n${r.sets.map((n) => `changes ${n}`).join('\n')}\n${r.adds.map((n) => `adds ${n}`).join('\n')}`)
    } catch (e) {
      setLog('✖ ' + errorText(e))
    }
    setBusy(null)
  }

  const runPatch = async () => {
    const errors = characterProblems(c).filter(([l]) => l === 'error').map(([, m]) => m)
    if (errors.length) {
      store.fail('Fix these first:\n' + errors.join('\n'))
      return
    }
    let target: PatchTarget
    const handle = await chooseIsoOutput(out)
    if (handle === 'cancel') return
    if (handle) {
      target = { kind: 'handle', handle }
    } else {
      await removeOpfs(OPFS_NAME)
      const free = await freeSpace()
      if (free !== null && free < GC_DISC_SIZE + (64 << 20)) {
        store.fail('Not enough free space in the browser\'s storage for the patched disc (it takes 1.4 GB).')
        return
      }
      target = { kind: 'opfs', name: OPFS_NAME }
    }
    setLog('')
    setReportText(null)
    setOpfsReady(null)
    setBusy('Starting...')
    setProgress([0, 0])
    try {
      const text = await engine.call<string>('patch', [copyCharacter({ ...c, glb: null }), target, g?.verified ?? false], onProgress)
      setLog(text)
      setReportText(text)
      if (target.kind === 'opfs') {
        setOpfsReady(out)
        downloadBlob(await opfsFile(OPFS_NAME), out)
      }
      store.message(`Done: ${handle ? handle.name : out}`)
    } catch (e) {
      setLog('✖ Patching failed:\n' + errorText(e))
    }
    setBusy(null)
  }

  return (
    <div className="page">
      <h3>Checks</h3>
      <ProblemList problems={problems} ok="No problems found (the full check builds everything against the disc)." />
      <div className="row"><button onClick={fullCheck} disabled={!g || busy !== null}>Check against the game disc</button></div>

      <h3>Share</h3>
      <Note>A .imperfect file holds your model, pictures and settings, and no game data: anyone with their own copy of the game can open it and patch the character in.</Note>
      <div className="row"><button onClick={() => saveAs()}>Save .imperfect...</button></div>

      <h3>Patch the game</h3>
      <Note>Writes a new disc image with the character as the 19th fighter. Your disc is only read. It must be an unmodified dump: patch a fresh copy each time, not an image that was already patched.</Note>
      <div className="form">
        <label>Your disc:</label>
        <span>{g ? g.name : 'choose it in the Game step'}</span>
        <label>New disc:</label>
        <input value={out} onChange={(e) => setOutName(e.target.value)} />
      </div>
      {!canSaveInPlace && <Note>This browser cannot write files directly: the new disc is built in the browser's storage (1.4 GB) and then downloaded.</Note>}
      <div className="row">
        <button onClick={runPatch} disabled={!g || busy !== null}>Patch</button>
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
