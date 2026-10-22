import { useEffect, useMemo, useRef, useState } from 'react'
import { cropResize } from '../../core/build/images'
import type { RgbaImage } from '../../core/image/rgba'
import { ImageView, Modal, Note } from './common'

interface Box {
  cx: number
  cy: number
  w: number
  h: number
}

export function CropDialog({ image, size, title, onDone }: { image: RgbaImage; size: [number, number]; title: string; onDone: (im: RgbaImage | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState<Box>(() => {
    const aspect = size[0] / size[1]
    const { width: w, height: h } = image
    const [bw, bh] = w / h > aspect ? [h * aspect, h] : [w, w / aspect]
    return { cx: w / 2, cy: h / 2, w: bw, h: bh }
  })
  const drag = useRef<[number, number] | null>(null)
  const view = Math.min(1, 620 / image.width, 520 / image.height)

  useEffect(() => {
    const c = canvas.current!
    c.width = image.width
    c.height = image.height
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  }, [image])

  const result = useMemo(() => cropResize(image, [box.cx - box.w / 2, box.cy - box.h / 2, box.cx + box.w / 2, box.cy + box.h / 2], size), [image, box, size])
  const previewSide = Math.max(140, size[0] * 2, size[1] * 2)
  const zoom = Math.max(1, Math.min(Math.floor(previewSide / size[0]), Math.floor(previewSide / size[1])))

  return (
    <Modal title={title} onClose={() => onDone(null)} wide>
      <div className="crop">
        <div className="crop-area" style={{ width: image.width * view, height: image.height * view }}
          onWheel={(e) => {
            const k = e.deltaY < 0 ? 0.92 : 1 / 0.92
            setBox((b) => ({ ...b, w: b.w * k, h: b.h * k }))
          }}>
          <canvas ref={canvas} style={{ width: image.width * view, height: image.height * view }} />
          <div className="crop-box"
            style={{ left: (box.cx - box.w / 2) * view, top: (box.cy - box.h / 2) * view, width: box.w * view, height: box.h * view }}
            onPointerDown={(e) => {
              drag.current = [e.clientX, e.clientY]
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (!drag.current) return
              const dx = (e.clientX - drag.current[0]) / view, dy = (e.clientY - drag.current[1]) / view
              drag.current = [e.clientX, e.clientY]
              setBox((b) => ({ ...b, cx: b.cx + dx, cy: b.cy + dy }))
            }}
            onPointerUp={() => (drag.current = null)} />
        </div>
        <div className="crop-side">
          <Note>Drag the box; the mouse wheel resizes it. The result is {size[0]}x{size[1]} pixels.</Note>
          <ImageView image={result} zoom={zoom} />
          <div className="row">
            <button onClick={() => onDone(result)}>OK</button>
            <button onClick={() => onDone(null)}>Cancel</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
