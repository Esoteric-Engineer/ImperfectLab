import { useState } from 'react'
import { discKey, isVerified, rememberVerified } from '../../io/verified'
import { pickFile, pickFiles } from '../../io/files'
import type { BaseInfo, DiscInfo } from '../../worker/protocol'
import { Note, Progress } from '../components/common'
import { engine, errorText } from '../engine'
import { store, useStore } from '../store'

export function GamePage() {
  useStore()
  const s = store
  const [checking, setChecking] = useState<[number, number] | null>(null)
  const [status, setStatus] = useState('')

  const open = async (kind: 'file' | 'folder') => {
    let key: string, info: DiscInfo
    try {
      if (kind === 'file') {
        const file = await pickFile('.iso,.gcm,.ciso')
        if (!file) return
        key = discKey(file)
        info = await engine.call<DiscInfo>('openFile', [file])
      } else {
        const files = await pickFiles('', { directory: true })
        if (!files.length) return
        const entries = files.map((f) => [(f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, f] as [string, File])
        const name = entries[0][0].split('/')[0]
        const big = entries.find(([p]) => p.toLowerCase().endsWith('files/clash.big'))
        key = `${name}|${big ? discKey(big[1]) : ''}`
        info = await engine.call<DiscInfo>('openFolder', [name, entries])
      }
    } catch (e) {
      s.fail(e)
      return
    }
    if (!isVerified(key)) {
      setStatus('Checking that the disc is an unmodified GVLE69 dump (may take up to a minute the first time)...')
      setChecking([0, 0])
      try {
        await engine.call('verify', [], (_stage, done, total) => setChecking([done, total]))
      } catch (e) {
        setChecking(null)
        setStatus('')
        s.fail(`${info.name} cannot be used:\n${errorText(e)}`)
        return
      }
      setChecking(null)
      rememberVerified(key)
    }
    setStatus('')
    try {
      const bases = await engine.call<BaseInfo[]>('bases')
      s.setGame({ name: info.name, key, verified: true, bases })
    } catch (e) {
      s.fail(e)
    }
  }

  return (
    <div className="page">
      <h3>Your copy of the game</h3>
      <Note>
        ImperfectLab reads the base characters' skeletons, templates, tuning and portrait layouts from your own disc: Marvel Nemesis: Rise of the Imperfects for GameCube, USA (GVLE69), as .iso, .gcm or .ciso, or an extracted disc folder.
        The disc is only ever read, never modified, and it never leaves your computer.
      </Note>
      <div className="row">
        <button onClick={() => open('file')} disabled={checking !== null}>Choose disc image...</button>
        <button onClick={() => open('folder')} disabled={checking !== null}>Choose extracted folder...</button>
      </div>
      {s.game ? (
        <>
          <p><b>{s.game.name}</b></p>
          <p className="good">✔ An unmodified GVLE69 disc. Next: the Character step.</p>
        </>
      ) : (
        <p>No disc chosen.</p>
      )}
      {status && <p>{status}</p>}
      {checking && <Progress done={checking[0]} total={checking[1]} />}
    </div>
  )
}
