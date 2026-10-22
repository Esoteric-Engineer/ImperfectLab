import { useEffect, useRef, useState } from 'react'

export type MenuItem =
  | { separator: true }
  | { heading: string }
  | { label: string; shortcut?: string; checked?: boolean; onSelect: () => void }

export interface Menu {
  label: string
  items: MenuItem[]
}

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const focusFirst = useRef(false)

  const triggerEls = () => [...(root.current?.querySelectorAll<HTMLElement>('.menu-trigger') ?? [])]
  const itemEls = () => [...(root.current?.querySelectorAll<HTMLElement>('.menu-popup [role^="menuitem"]') ?? [])]

  useEffect(() => {
    if (open === null) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  useEffect(() => {
    if (open !== null && focusFirst.current) itemEls()[0]?.focus()
    focusFirst.current = false
  }, [open])

  const switchTo = (i: number) => {
    const n = menus.length
    const next = (i + n) % n
    setOpen(next)
    triggerEls()[next]?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const onItem = (e.target as HTMLElement).getAttribute('role')?.startsWith('menuitem')
    if (e.key === 'Escape' && open !== null) {
      e.preventDefault()
      triggerEls()[open]?.focus()
      setOpen(null)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && open !== null) {
      e.preventDefault()
      switchTo(open + (e.key === 'ArrowRight' ? 1 : -1))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = itemEls()
      if (onItem) {
        const at = items.indexOf(e.target as HTMLElement)
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      } else if (open === null) {
        focusFirst.current = true
        setOpen(triggerEls().indexOf(e.target as HTMLElement))
      } else {
        items[e.key === 'ArrowDown' ? 0 : items.length - 1]?.focus()
      }
    }
  }

  return (
    <div className="menubar" role="menubar" ref={root} onKeyDown={onKeyDown}>
      {menus.map((menu, i) => (
        <div className="menu" key={menu.label}>
          <button
            className={`menu-trigger ${open === i ? 'open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="menu-popup" role="menu" aria-label={menu.label}>
              {menu.items.map((item, j) => {
                if ('separator' in item) return <hr key={j} />
                if ('heading' in item) return <div className="menu-heading" key={j}>{item.heading}</div>
                return (
                  <button
                    key={j}
                    role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={item.checked}
                    tabIndex={-1}
                    onClick={() => {
                      setOpen(null)
                      item.onSelect()
                    }}
                  >
                    <span className="check">{item.checked ? '✓' : ''}</span>
                    <span>{item.label}</span>
                    <span className="shortcut">{item.shortcut}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}