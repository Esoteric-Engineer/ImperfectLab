import { Fragment, useEffect, useState } from 'react'
import { COMMIT, RELEASES, REPO_URL, VERSION } from './core/version'
import * as actions from './ui/actions'
import { restoreDisc } from './ui/disc'
import { engine } from './ui/engine'
import { droppedCharacter } from './io/files'
import { Modal } from './ui/components/common'
import { type Menu, MenuBar } from './ui/components/MenuBar'
import { ArtPage } from './ui/pages/ArtPage'
import { AuraPage } from './ui/pages/AuraPage'
import { BatchPage } from './ui/pages/BatchPage'
import { CharacterPage } from './ui/pages/CharacterPage'
import { CutscenesPage } from './ui/pages/CutscenesPage'
import { ExportPage } from './ui/pages/ExportPage'
import { GamePage } from './ui/pages/GamePage'
import { MaterialsPage } from './ui/pages/MaterialsPage'
import { ModelPage } from './ui/pages/ModelPage'
import { MovesPage } from './ui/pages/MovesPage'
import { ProjectilesPage } from './ui/pages/ProjectilesPage'
import { SoundsPage } from './ui/pages/SoundsPage'
import { StatsPage } from './ui/pages/StatsPage'
import { ZButtonPage } from './ui/pages/ZButtonPage'
import { store, useStore } from './ui/store'
import { THEMES, hasMenuArt, setMenuArt, setTheme, useTheme } from './ui/theme'
import './App.css'

const STEPS: [string, () => React.JSX.Element][] = [
  ['1. Game', GamePage],
  ['2. Character', CharacterPage],
  ['3. Model', ModelPage],
  ['4. Materials', MaterialsPage],
  ['5. Aura', AuraPage],
  ['6. Stats', StatsPage],
  ['7. Moves', MovesPage],
  ['8. Projectiles', ProjectilesPage],
  ['9. Z-Button Actions', ZButtonPage],
  ['10. Cutscenes', CutscenesPage],
  ['11. Sounds', SoundsPage],
  ['12. Art', ArtPage],
  ['13. Save & patch', ExportPage],
]
// After the steps, separate section.
const PAGES: [string, () => React.JSX.Element][] = [...STEPS, ['Multi-Character Patch', BatchPage]]

const NON_TEXT = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'file'])
function editingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !NON_TEXT.has(target.type)
}

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null
}

function stepHistory(redo: boolean) {
  if (!dialogOpen()) void (redo ? store.redo() : store.undo())
}

function App() {
  useStore()
  const s = store
  const [step, setStep] = useState(0)
  const [about, setAbout] = useState(false)
  const [whatsNew, setWhatsNew] = useState(false)
  const [dragging, setDragging] = useState(false)
  const theme = useTheme()

  useEffect(() => {
    document.title = s.title()
  })

  useEffect(() => {
    void restoreDisc()
  }, [])

  const gameKey = s.game?.key ?? null
  useEffect(() => {
    if (theme !== 'nemesis' || !gameKey || hasMenuArt(gameKey)) return
    engine.call<Uint8Array>('menuArt').then((png) => {
      if (store.game?.key === gameKey) setMenuArt(gameKey, png)
    }, () => {})
  }, [theme, gameKey])

  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (store.dirty) e.preventDefault()
    }
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') {
        if (dialogOpen()) return
        e.preventDefault()
        if (e.repeat) return
        if (editingText(e.target)) (e.target as HTMLElement).blur()
        stepHistory(k === 'y' || e.shiftKey)
      } else if (k === 's') {
        e.preventDefault()
        void (e.shiftKey ? actions.saveAs() : actions.save())
      } else if (k === 'o') {
        e.preventDefault()
        void actions.open().then((ok) => ok && setStep(store.game ? STEPS.length - 1 : 0))
      }
    }
    // Files dragged in from the file explorer.
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const dragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const dragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const dragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      if (dialogOpen()) return
      const pending = droppedCharacter(e.dataTransfer!)
      if (!pending) {
        const names = [...e.dataTransfer!.files].map((f) => f.name)
        const what = names.length === 1 ? names[0] : names.length ? `These ${names.length} files` : 'That'
        store.fail(`${what} can't be opened here.\nOnly ImperfectLab character files (.imperfect) can be dropped in.`)
        return
      }
      void actions.openDropped(pending).then((ok) => ok && setStep(store.game ? STEPS.length - 1 : 0))
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('keydown', keys)
    window.addEventListener('dragenter', dragEnter)
    window.addEventListener('dragover', dragOver)
    window.addEventListener('dragleave', dragLeave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('keydown', keys)
      window.removeEventListener('dragenter', dragEnter)
      window.removeEventListener('dragover', dragOver)
      window.removeEventListener('dragleave', dragLeave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New character', onSelect: async () => (await actions.newCharacter()) && setStep(1) },
        { label: 'Open...', shortcut: `${mod}O`, onSelect: async () => (await actions.open()) && setStep(store.game ? STEPS.length - 1 : 0) },
        { separator: true },
        { label: 'Save', shortcut: `${mod}S`, onSelect: () => actions.save() },
        { label: 'Save as...', shortcut: `${mod}${mod === '⌘' ? '⇧' : 'Shift+'}S`, onSelect: () => actions.saveAs() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: `${mod}Z`, disabled: !s.canUndo, onSelect: () => stepHistory(false) },
        { label: 'Redo', shortcut: `${mod}${mod === '⌘' ? '⇧Z' : 'Y'}`, disabled: !s.canRedo, onSelect: () => stepHistory(true) },
      ],
    },
    {
      label: 'View',
      items: [
        { heading: 'Theme' },
        ...THEMES.map((t) => ({ label: t.label, checked: t.id === theme, onSelect: () => setTheme(t.id) })),
      ],
    },
    {
      label: 'Help',
      items: [
        { label: "What's New", onSelect: () => setWhatsNew(true) },
        { label: 'About ImperfectLab', onSelect: () => setAbout(true) },
      ],
    },
  ]

  const Page = PAGES[step][1]
  return (
    <div className="app">
      <header>
        <div className="header-left">
          <span className="brand">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
            ImperfectLab
          </span>
          <MenuBar menus={menus} />
        </div>
        <span className="file">{s.fileName ?? `${s.character.displayName} (unsaved)`}{s.dirty ? ' *' : ''}</span>
      </header>
      <aside>
        {PAGES.map(([title], i) => (
          <Fragment key={title}>
            {i === STEPS.length && <hr className="divider" />}
            <button className={i === step ? 'active' : ''} onClick={() => setStep(i)}>{title}</button>
          </Fragment>
        ))}
      </aside>
      <main><Page /></main>
      <footer>
        <span>{s.status}</span>
        <span>{s.game ? `Game: ${s.game.name}` : 'No game disc chosen'}</span>
      </footer>
      {dragging && <div className="drop-overlay">Drop a .imperfect file to open it</div>}
      {s.error && (
        <Modal title="ImperfectLab" onClose={() => store.dismissError()}>
          <pre className="message">{s.error}</pre>
          <div className="row end"><button onClick={() => store.dismissError()}>OK</button></div>
        </Modal>
      )}
      {s.credits && (
        <Modal title="Credits" onClose={actions.closeCredits}>
          <div className="credits-view">
            <div className="credits-title">
              {s.credits.tile && <img className="credits-tile" src={s.credits.tile} alt="" />}
              <div>
                <div className="credits-name" style={{ color: s.credits.color }}>{s.credits.name}</div>
                {s.credits.author && <pre className="message">by {s.credits.author}</pre>}
              </div>
            </div>
            {s.credits.description && <pre className="message credits-section">{s.credits.description}</pre>}
            {s.credits.assets.length > 0 && <ul className="credits-section credits-list">{s.credits.assets.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          </div>
          <div className="row end"><button onClick={actions.closeCredits}>OK</button></div>
        </Modal>
      )}
      {whatsNew && (
        <Modal title="What's New" onClose={() => setWhatsNew(false)}>
          {RELEASES.length === 0 && <p className="note">No release notes in this build.</p>}
          {RELEASES.map((r) => (
            <section key={r.version}>
              <h3>
                <a href={r.pr ? `${REPO_URL}/pull/${r.pr}` : `${REPO_URL}/commit/${r.hash}`} target="_blank" rel="noreferrer">{r.version}</a>
                {' '}<span className="note">{r.date}</span>
              </h3>
              <ul className="release-notes">
                {r.changes.map((c) => (
                  <li key={c.hash}>
                    {c.subject}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {RELEASES.length > 0 && (
            <p className="note">
              Looking for older changes? View the project on <a href={`${REPO_URL}/commits/main/?after=${RELEASES[RELEASES.length - 1].hash}+0`} target="_blank" rel="noreferrer">GitHub</a>.
            </p>
          )}
          <div className="row end"><button onClick={() => setWhatsNew(false)}>OK</button></div>
        </Modal>
      )}
      {about && (
        <Modal title="About ImperfectLab" onClose={() => setAbout(false)}>
          <p><b>ImperfectLab {VERSION}</b> <span className="note">({COMMIT})</span></p>
          <p>Custom character creator for Marvel Nemesis: Rise of the Imperfects (GameCube, USA).</p>
          <p>
            By <a href="https://esotericengineer.com" target="_blank" rel="noreferrer">EsotericEngineer</a>
            {' | '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
          </p>
          <p className="note">This is a fan project, not affiliated with or endorsed by Marvel, Electronic Arts or Nintendo. No game files are included: everything taken from the game is read from your own disc, in your browser.</p>
          <div className="row end"><button onClick={() => setAbout(false)}>OK</button></div>
        </Modal>
      )}
    </div>
  )
}

export default App
