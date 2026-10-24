import { dropUnfitAudio } from '../../core/build/cutscenes'
import { WALL_STATES } from '../../core/build/moves'
import * as R from '../../core/game/roster'
import * as mapping from '../../core/model/mapping'
import { type Credit, BASE_MOVES, type BaseMoves, CUTSCENE_KINDS, defaultStats, WALL_CLIMBERS } from '../../core/package/imperfect'
import type { AutoMap } from '../../core/model/mapping'
import { ColorButton, ImageView, Note } from '../components/common'
import { engine } from '../engine'
import { store, useStore } from '../store'

const ASSET_KEYS: (keyof Credit)[] = ['what', 'by', 'license', 'url']

export function CharacterPage() {
  useStore()
  const s = store
  const c = s.character
  const edited = () => s.touch('character')
  const base = s.base()
  const sk = s.skeleton()

  const changeBase = async (key: string) => {
    if (key === c.base) return
    await store.edit(async () => {
      const old = s.game ? s.skeleton(c.base) : null
      c.base = key
      for (const k of Object.keys(c.baseMoves) as (keyof BaseMoves)[]) if (!(BASE_MOVES[key] ?? []).includes(k)) delete c.baseMoves[k]
      for (const [id, from] of Object.entries(c.moves)) if (from === key) delete c.moves[id]
      if (c.gameplay.wall_climb && WALL_CLIMBERS.includes(key)) {
        delete c.gameplay.wall_climb
        for (const id of WALL_STATES) {
          delete c.moves[id]
          delete c.moveEffects[id]
        }
      }
      for (const kind of CUTSCENE_KINDS) if (c.cutscenes[kind] === key) delete c.cutscenes[kind]
      for (const kind of CUTSCENE_KINDS) if (c.cutscenes[kind] === undefined) delete c.cutscenes.effects[kind]
      if (s.game && Object.keys(c.cutscenes.audio).length) {
        const cat = await s.readCutscenes().catch(() => null)
        const dropped = cat ? CUTSCENE_KINDS.flatMap((kind) => dropUnfitAudio(c, cat, kind)) : []
        if (dropped.length) store.message(`${dropped.length} new cutscene audio track${dropped.length === 1 ? '' : 's'} removed: ${dropped.length === 1 ? 'it does' : 'they do'} not fit ${R.label(key)}'s cutscenes`)
      }
      const next = s.skeleton()
      if (next && old) {
        ;[c.mapping, c.overrides] = mapping.translate(c.mapping, c.overrides, old, next)
        for (const m of c.materials) {
          if (m.bind !== null) {
            const [moved] = mapping.translate(new Map([[m.bind, '']]), new Map(), old, next)
            m.bind = moved.keys().next().value ?? null
          }
        }
      }
      if (s.model && next && next.requiredRoles().some((r) => !c.mapping.has(next.node(r)!))) {
        const auto = await engine.call<AutoMap | null>('autoMap', [key]).catch(() => null)
        if (auto) {
          c.mapping = auto.mapping
          c.overrides = auto.overrides
        }
      }
      const b = s.base()
      if (b && b.stats.length && JSON.stringify(c.stats) === JSON.stringify(defaultStats())) c.stats = { normal: [...b.stats], alt: [...b.altStats] }
      store.touch('mapping')
    })
  }

  const assets = c.credits.assets
  return (
    <div className="page">
      <h3>Names</h3>
      <div className="form">
        <label>Internal name</label>
        <div>
          <input value={c.internalName} maxLength={10} onChange={(e) => {
            const v = e.target.value
            if (/^([A-Za-z][A-Za-z0-9]{0,9})?$/.test(v)) {
              c.internalName = v
              edited()
            }
          }} />
          <Note>1-10 letters and digits. Must not be one of the game's own characters.</Note>
        </div>
        <label>Display name</label>
        <div>
          <input value={c.displayName} maxLength={16} onChange={(e) => {
            const v = e.target.value.toUpperCase()
            if (/^[A-Z0-9 .'&!-]{0,16}$/.test(v)) {
              c.displayName = v
              edited()
            }
          }} />
          <Note>Up to 16 characters, shown on the select and loading screens.</Note>
        </div>
        <label>Name color</label>
        <div><ColorButton color={c.nameColor} onChange={(v) => { c.nameColor = v; edited() }} /></div>
      </div>

      <h3>Base character</h3>
      <Note>The new character copies the base's moves, animations, sounds, AI and effects. Its model is fitted onto the base's skeleton.</Note>
      <div className="bases">
        {R.keys().map((key) => {
          const b = s.base(key)
          const supported = !s.game || (b?.skeleton ?? null) !== null
          return (
            <button key={key} className={`base ${key === c.base ? 'selected' : ''}`} onClick={() => changeBase(key)}
              title={supported ? '' : `${b?.body ?? ''}: not supported yet`}>
              {b?.icon ? <ImageView image={b.icon} side={40} checker={false} /> : <span className="icon-placeholder" />}
              <span>{R.label(key)}{supported ? '' : ' (not supported yet)'}</span>
            </button>
          )
        })}
      </div>
      <p className="base-info">
        {!base ? "Choose your game disc to see the base characters' details."
          : `${base.body} body, ${sk ? `${sk.nodes.length} bones` : 'skeleton not supported yet'}; select-screen stats ${base.stats.join(', ')}${sk ? '' : '. Pick another base'}`}
      </p>

      <h3>Credits</h3>
      <Note>Shown to everyone who opens or patches the file. A model under CC BY must be credited.</Note>
      <div className="form">
        <label>Author</label>
        <input value={c.credits.author} onChange={(e) => { c.credits.author = e.target.value; edited() }} />
        <label>Description</label>
        <textarea rows={4} value={c.credits.description} onChange={(e) => { c.credits.description = e.target.value; edited() }} />
      </div>
      <table className="credits">
        <thead><tr><th>What</th><th>By</th><th>License</th><th>Link</th><th /></tr></thead>
        <tbody>
          {assets.map((a, r) => (
            <tr key={r}>
              {ASSET_KEYS.map((k) => (
                <td key={k}><input value={a[k]} onChange={(e) => { a[k] = e.target.value; edited() }} /></td>
              ))}
              <td><button className="small" onClick={() => { assets.splice(r, 1); edited() }}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row"><button onClick={() => { assets.push({ what: '', by: '', license: '', url: '' }); edited() }}>Add credit</button></div>
    </div>
  )
}
