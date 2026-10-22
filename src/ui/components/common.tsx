import { type ReactNode, useEffect, useRef, useState } from 'react'

export interface ImageData8 {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

export function ImageView({ image, side, zoom, checker = true, className }: { image: ImageData8 | null; side?: number; zoom?: number; checker?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    const data = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.width * image.height * 4)
    ctx.putImageData(new ImageData(data.slice(), image.width, image.height), 0, 0)
  }, [image])
  if (!image) return <div className={`thumb empty ${className ?? ''}`} style={side ? { width: side, height: side } : undefined}>-</div>
  let w = image.width, h = image.height
  if (zoom) {
    w *= zoom
    h *= zoom
  } else if (side) {
    const k = Math.min(1, (side - 4) / Math.max(w, h))
    w = Math.max(1, Math.round(w * k))
    h = Math.max(1, Math.round(h * k))
  }
  return (
    <div className={`thumb ${checker ? 'checker' : ''} ${className ?? ''}`} style={side ? { width: side, height: side } : undefined}>
      <canvas ref={ref} style={{ width: w, height: h, imageRendering: zoom ? 'pixelated' : 'auto' }} />
    </div>
  )
}

export function ColorButton({ color, alpha = false, onChange, disabled }: { color: string; alpha?: boolean; onChange: (c: string) => void; disabled?: boolean }) {
  const rgb = color.slice(0, 7).toUpperCase()
  const a = color.length === 9 ? parseInt(color.slice(7, 9), 16) : 255
  const hex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase()
  const emit = (r: string, alp: number) => onChange(r + (alpha ? hex(alp) : ''))
  const [draft, setDraft] = useState<string | null>(null)
  const commitDraft = (text: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(text.trim())
    if (m) emit('#' + m[1].toUpperCase(), a)
    setDraft(null)
  }
  const css = `rgb(${parseInt(rgb.slice(1, 3), 16)} ${parseInt(rgb.slice(3, 5), 16)} ${parseInt(rgb.slice(5, 7), 16)}`
  return (
    <span className={`color-button ${disabled ? 'disabled' : ''}`}>
      <label className="swatch checker-bg" title="Pick a color">
        <span style={{ background: `${css} / ${(a / 255).toFixed(3)})` }} />
        <input type="color" value={rgb.toLowerCase()} disabled={disabled} onChange={(e) => emit(e.target.value.toUpperCase(), a)} />
      </label>
      <input type="text" className="hex" value={draft ?? rgb} maxLength={7} spellCheck={false} disabled={disabled} title="Color"
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commitDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(e.currentTarget.value) }} />
      {alpha && (
        <>
          <span className="alpha-track checker-bg">
            <input type="range" min={0} max={255} value={a} disabled={disabled} title="Opacity" aria-label="Opacity"
              style={{ backgroundImage: `linear-gradient(to right, ${css} / 0), ${css} / 1))` }}
              onChange={(e) => emit(rgb, Number(e.target.value))} />
          </span>
          <span className="alpha-value">
            <NumberInput min={0} max={100} step={1} value={Math.round((a * 100) / 255)} disabled={disabled}
              onChange={(v) => emit(rgb, Math.round((v * 255) / 100))} />%
          </span>
        </>
      )}
    </span>
  )
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="modal-backdrop">
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>
}

export function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="callout-warn" role="note">
      <strong>⚠ {title}</strong>
      {children}
    </div>
  )
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="progress">
      <div className={total ? 'bar' : 'bar indeterminate'} style={total ? { width: `${(100 * done) / total}%` } : undefined} />
    </div>
  )
}

export function ProblemList({ problems, ok }: { problems: [string, string][]; ok: string }) {
  if (!problems.length) return <ul className="problems"><li className="ok">✔ {ok}</li></ul>
  return (
    <ul className="problems">
      {problems.map(([level, msg], i) => (
        <li key={i} className={level}>{level === 'error' ? '✖' : '⚠'} {msg}</li>
      ))}
    </ul>
  )
}

export function NumberInput({ value, onChange, min, max, step, disabled, className }: {
  value: number | null; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean; className?: string
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  const shown = focused ? text : value === null ? '' : String(value)
  const commit = (raw: string, final: boolean) => {
    const v = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(v)) return
    if (!final && ((min !== undefined && v < min) || (max !== undefined && v > max))) return
    onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)))
  }
  return (
    <input type="number" className={className} value={shown} min={min} max={max} step={step} disabled={disabled}
      onFocus={() => {
        setText(value === null ? '' : String(value))
        setFocused(true)
      }}
      onBlur={(e) => {
        commit(e.target.value, true)
        setFocused(false)
      }}
      onChange={(e) => {
        setText(e.target.value)
        commit(e.target.value, false)
      }} />
  )
}
