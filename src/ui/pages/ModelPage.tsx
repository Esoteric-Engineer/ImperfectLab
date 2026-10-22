import { useEffect, useMemo, useRef, useState } from 'react'
import * as mapping from '../../core/model/mapping'
import { copyCharacter } from '../../core/package/imperfect'
import type { BoneLine, MeshData } from '../../core/preview'
import { pickFile } from '../../io/files'
import type { ImportedModel, PreviewResult } from '../../worker/protocol'
import { NumberInput, ProblemList } from '../components/common'
import { Viewport } from '../components/viewport'
import { engine, errorText } from '../engine'
import { ModelView, store, useStore } from '../store'

const MODES = ['Fitted over base', 'Fitted', 'Your model', 'Base character']
const NONE = '(none)'

function useViewport(): [React.RefObject<HTMLCanvasElement | null>, React.RefObject<Viewport | null>] {
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<Viewport | null>(null)
  useEffect(() => {
    view.current = new Viewport(canvas.current!)
    return () => view.current?.dispose()
  }, [])
  return [canvas, view]
}

type Scene = { ok: true; r: PreviewResult } | { ok: false; bones: BoneLine[] }

class Preview {
  running = false
  again = false
  timer = 0
  base: { key: string; meshes: MeshData[] } | null = null
  reframe = true
  lastMode: number | null = null
  private setScene: (s: Scene | null) => void
  private setReport: (s: string) => void
  private setBusy: (b: boolean) => void

  constructor(setScene: (s: Scene | null) => void, setReport: (s: string) => void, setBusy: (b: boolean) => void) {
    this.setScene = setScene
    this.setReport = setReport
    this.setBusy = setBusy
  }

  schedule(reframe = false) {
    if (reframe) this.reframe = true
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.update(), 350)
  }

  async update() {
    if (this.running) {
      this.again = true
      return
    }
    const skel = store.game ? store.skeleton() : null
    if (!skel || !store.model) {
      this.setScene(null)
      return
    }
    this.running = true
    this.setBusy(true)
    const spec = copyCharacter({ ...store.character, glb: null })
    const needBase = this.base?.key !== spec.base
    try {
      const r = await engine.call<PreviewResult>('preview', [spec, needBase])
      if (r.base) this.base = { key: spec.base, meshes: r.base }
      if (Array.isArray(r.stats)) {
        const [parts, tris, size, baseSize] = r.stats
        this.setReport(`Scale ${r.scale.toFixed(3)}${r.flip ? ', facing backwards (turned)' : ''}. In the game: ${tris} triangles in ${parts} parts; model bundle ${Math.floor(size / 1024)} KB (${store.base()?.label}'s is ${Math.floor(baseSize / 1024)} KB).`)
      } else {
        this.setReport('✖ ' + r.stats)
      }
      this.setScene({ ok: true, r })
    } catch (e) {
      const lines = errorText(e).trim().split('\n')
      this.setReport('✖ ' + lines[lines.length - 1])
      const J = skel.positions()
      this.setScene({ ok: false, bones: skel.nodes.filter((n) => n.parent >= 0).map((n) => [J[n.parent], J[n.index], n.index]) })
    } finally {
      this.running = false
      this.setBusy(false)
      if (this.again) {
        this.again = false
        void this.update()
      }
    }
  }

  show(view: Viewport, scene: Scene | null, mode: number) {
    if (!scene) {
      view.setScene([], [])
      return
    }
    if (!scene.ok) {
      view.setScene([], scene.bones)
      return
    }
    const r = scene.r
    const fit = this.reframe || mode !== this.lastMode
    this.reframe = false
    this.lastMode = mode
    const base = this.base?.meshes ?? []
    if (mode === 2) view.setScene(r.source, r.sourceBones, fit)
    else if (mode === 3) view.setScene(base, r.gameBones, fit)
    else if (mode === 1) view.setScene(r.fitted, r.gameBones, fit)
    else view.setScene([...r.fitted, ...base.map((m) => ({ ...m, alpha: 0.25 }))], r.gameBones, fit)
  }
}

export function ModelPage() {
  useStore()
  const s = store
  const c = s.character
  const model = s.model
  const sk = s.game ? s.skeleton() : null
  const [canvas, view] = useViewport()
  const [mode, setMode] = useState(0)
  const [bones, setBones] = useState(true)
  const [tab, setTab] = useState<'game' | 'model' | 'fit'>('game')
  const [selNode, setSelNode] = useState<number | null>(null)
  const [selJoint, setSelJoint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState('')
  const [scene, setScene] = useState<Scene | null>(null)
  const [preview] = useState(() => new Preview(setScene, setReport, setBusy))

  useEffect(() => preview.schedule(true), [s.versions.model, s.versions.game, preview])
  useEffect(() => preview.schedule(), [s.versions.mapping, s.versions.character, preview])
  useEffect(() => {
    if (view.current) preview.show(view.current, scene, mode)
  }, [scene, mode, view, preview])

  useEffect(() => view.current?.setShowBones(bones), [bones, view])

  useEffect(() => {
    const v = view.current
    if (!v) return
    if (tab === 'model') {
      if (mode === 2) v.setHighlight(selJoint)
      else if (selJoint !== null && model) v.setHighlight(mapping.effective(model, c.mapping, c.overrides).get(selJoint) ?? null)
      else v.setHighlight(null)
      return
    }
    v.setHighlight(selNode === null ? null : mode === 2 ? (c.mapping.get(selNode) ?? null) : selNode)
  }, [tab, mode, selNode, selJoint, model, c, s.versions.mapping, view])

  const importGlb = async () => {
    const c = store.character
    const file = await pickFile('.glb')
    if (!file) return
    let imported: ImportedModel
    try {
      imported = await engine.call<ImportedModel>('importModel', [new Uint8Array(await file.arrayBuffer())])
    } catch (e) {
      store.fail(`The model could not be imported:\n${errorText(e)}`)
      return
    }
    c.glb = imported.slim
    c.materials = imported.materials
    c.mapping = new Map()
    c.overrides = new Map()
    store.model = new ModelView(imported.info)
    store.modelError = null
    if (sk) {
      const auto = await engine.call<mapping.AutoMap | null>('autoMap', [c.base])
      if (auto) {
        c.mapping = auto.mapping
        c.overrides = auto.overrides
        store.message(`Imported ${file.name} (${Math.floor(imported.slim.length / 1024)} KB after dropping animations and unused data); mapped with the ${auto.preset} preset`)
      }
    }
    const name = file.name.replace(/\.[^.]*$/, '')
    if (!c.credits.assets.some((a) => a.what === 'model')) c.credits.assets.push({ what: 'model', by: '', license: '', url: name })
    store.touch('model')
  }

  const autoMap = async () => {
    const c = store.character
    if (!sk || !model) return
    const auto = await engine.call<mapping.AutoMap | null>('autoMap', [c.base])
    if (!auto) return
    c.mapping = auto.mapping
    c.overrides = auto.overrides
    store.message(`Mapped with the ${auto.preset} preset`)
    store.touch('mapping')
  }

  const clear = () => {
    const c = store.character
    c.mapping = new Map()
    c.overrides = new Map()
    store.touch('mapping')
  }

  let info: string
  if (s.modelError) info = `The model could not be read: ${s.modelError}`
  else if (!model) info = "Import your character's model: a .glb with one skinned mesh (a rig of any common kind)."
  else info = `${model.joints.length} joints, ${model.info.triangles} triangles, ${model.info.materials.length} materials`
  if (!s.game) info += ' - choose your game disc to map the model.'
  else if (!sk) info += ` - ${s.base()?.label}'s skeleton is not supported yet; pick another base.`

  const problems = useMemo(() => (sk && model ? mapping.check(model, sk, c.mapping, c.overrides) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sk, model, s.versions.mapping, s.versions.model])

  return (
    <div className="page model-page">
      <div className="row">
        <button onClick={importGlb}>Import model (.glb)...</button>
        <button onClick={autoMap} disabled={!sk || !model}>Auto-map</button>
        <button onClick={clear}>Clear mapping</button>
        <span className="info">{info}</span>
      </div>
      <div className="split">
        <div className="left">
          <canvas ref={canvas} className="viewport" />
          <div className="row">
            <select value={mode} onChange={(e) => setMode(Number(e.target.value))}>
              {MODES.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            {(['front', 'right', 'back'] as const).map((n) => (
              <button key={n} className="small" onClick={() => view.current?.view(n)}>{n[0].toUpperCase() + n.slice(1)}</button>
            ))}
            <label className="check"><input type="checkbox" checked={bones} onChange={(e) => setBones(e.target.checked)} /> Bones</label>
            <span className="busy">{busy ? 'updating...' : ''}</span>
          </div>
          <p className="hint">Drag to turn, shift-drag to move, scroll to zoom.</p>
        </div>
        <div className="right">
          <div className="tabs">
            <button className={tab === 'game' ? 'active' : ''} onClick={() => setTab('game')}>By game bone</button>
            <button className={tab === 'model' ? 'active' : ''} onClick={() => setTab('model')}>By model joint</button>
            <button className={tab === 'fit' ? 'active' : ''} onClick={() => setTab('fit')}>Fit</button>
          </div>
          <div className="tab-body">
            {tab === 'game' && <GameTree selected={selNode} onSelect={setSelNode} />}
            {tab === 'model' && <ModelTree selected={selJoint} onSelect={setSelJoint} />}
            {tab === 'fit' && <FitOptions report={report} />}
          </div>
          <h4>Problems</h4>
          {problems ? <ProblemList problems={problems} ok="The mapping is complete." /> : <ul className="problems" />}
        </div>
      </div>
    </div>
  )
}

function GameTree({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  useStore()
  const s = store
  const sk = s.game ? s.skeleton() : null
  const c = s.character
  const joints = s.model?.jointNames() ?? []
  if (!sk) return <p className="note">Choose the game disc and a supported base to see its bones.</p>
  const twist = new Set(Object.values(sk.twist).map((t) => sk.node(t[0])))
  const groups = sk.byGroup()
  return (
    <div className="tree">
      {[...groups].map(([g, nodes]) => (
        <div key={g} className="group">
          <div className="group-title">{g.charAt(0).toUpperCase() + g.slice(1)}</div>
          {nodes.map((n) => (
            <div key={n.index} className={`tree-row ${selected === n.index ? 'selected' : ''}`} onClick={() => onSelect(n.index)}
              title={`game bone ${n.index}${n.required ? ', required' : ''}`}>
              <span className="name">{n.name}{n.required ? ' *' : ''}</span>
              {twist.has(n.index) ? <span className="muted">automatic (twist)</span> : (
                <select value={c.mapping.get(n.index) ?? NONE} onFocus={() => onSelect(n.index)} onChange={(e) => {
                  if (e.target.value === NONE) c.mapping.delete(n.index)
                  else c.mapping.set(n.index, e.target.value)
                  store.touch('mapping')
                }}>
                  <option>{NONE}</option>
                  {joints.map((j) => <option key={j}>{j}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ModelTree({ selected, onSelect }: { selected: string | null; onSelect: (j: string) => void }) {
  useStore()
  const s = store
  const model = s.model
  const sk = s.game ? s.skeleton() : null
  const c = s.character
  if (!model) return <p className="note">Import a model first.</p>
  const weighted = model.weighted()
  const eff = sk ? mapping.effective(model, c.mapping, c.overrides) : null
  const mapped = new Set(c.mapping.values())
  const order: [string, number][] = []
  const children = new Map<string | null, string[]>()
  const seen = new Set<string>()
  for (const j of model.joints) {
    const p = j.parent !== null && seen.has(j.parent) ? j.parent : null
    if (!children.has(p)) children.set(p, [])
    children.get(p)!.push(j.name)
    seen.add(j.name)
  }
  const walk = (p: string | null, d: number) => {
    for (const n of children.get(p) ?? []) {
      order.push([n, d])
      walk(n, d + 1)
    }
  }
  walk(null, 0)
  return (
    <div className="tree">
      <div className="tree-row header"><span className="name">Your model's joint</span><span>Vertices</span><span>Moves with</span><span>Override</span></div>
      {order.map(([name, depth]) => {
        const node = eff?.get(name) ?? null
        const direct = c.overrides.has(name) || mapped.has(name)
        return (
          <div key={name} className={`tree-row joint ${selected === name ? 'selected' : ''}`} onClick={() => onSelect(name)}>
            <span className="name" style={{ paddingLeft: depth * 8 }} title={name}>{name}</span>
            <span>{weighted.get(name) ?? 0}</span>
            <span className={direct ? '' : 'muted'} title={sk && node !== null && node < sk.nodes.length ? sk.nodes[node].name : ''}>{sk ? (node !== null && node < sk.nodes.length ? sk.nodes[node].name : 'pelvis (no mapped parent)') : ''}</span>
            {sk && weighted.get(name) ? (
              <select value={c.overrides.get(name) ?? ''} onFocus={() => onSelect(name)} onChange={(e) => {
                if (e.target.value === '') c.overrides.delete(name)
                else c.overrides.set(name, Number(e.target.value))
                store.touch('mapping')
              }}>
                <option value="">(follows its parent)</option>
                {sk.nodes.map((n) => <option key={n.index} value={n.index}>{n.index} {n.name}</option>)}
              </select>
            ) : <span />}
          </div>
        )
      })}
    </div>
  )
}

function FitOptions({ report }: { report: string }) {
  useStore()
  const s = store
  const f = s.character.fit
  const edited = () => s.touch('character')
  return (
    <div className="form">
      <label>Scale</label>
      <div>
        <label className="check"><input type="checkbox" checked={!f.scale} onChange={(e) => {
          f.scale = e.target.checked ? null : 1.0
          edited()
        }} /> Automatic (the legs get the base's length)</label>
        <NumberInput step={0.01} min={0.0001} max={10000} disabled={!f.scale} value={f.scale} onChange={(v) => {
          if (v > 0) {
            f.scale = v
            edited()
          }
        }} />
      </div>
      <label>Torso</label>
      <label className="check"><input type="checkbox" checked={f.torso_squash} onChange={(e) => { f.torso_squash = e.target.checked; edited() }} /> Fit the torso to the base's shoulder height</label>
      <label>Facing</label>
      <select value={f.flip === null ? 0 : f.flip ? 2 : 1} onChange={(e) => { f.flip = [null, false, true][Number(e.target.value)]; edited() }}>
        <option value={0}>Detect from the arms</option>
        <option value={1}>Facing forwards</option>
        <option value={2}>Facing backwards</option>
      </select>
      <p className="report" style={{ gridColumn: '1 / -1' }}>{report}</p>
    </div>
  )
}

