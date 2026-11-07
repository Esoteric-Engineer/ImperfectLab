import { useSyncExternalStore } from 'react'

// Each id needs a matching :root[data-theme] block in themes.css.
export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'nemesis', label: 'Nemesis' },
  { id: 'nemesis-classic', label: 'Nemesis Classic' },
]

const DEFAULT = 'dark'
const KEY = 'imperfectlab.theme.v2' // v2 since 'nemesis' changed meaning. public/theme-init.js migrates the old key.
const listeners = new Set<() => void>()

function stored(): string {
  try {
    const id = localStorage.getItem(KEY)
    if (THEMES.some((t) => t.id === id)) return id!
  } catch { /* storage unavailable */ }
  return DEFAULT
}

let current = stored()

export function applyTheme() {
  const root = document.documentElement
  root.dataset.theme = current
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
}

export function setTheme(id: string) {
  if (id === current || !THEMES.some((t) => t.id === id)) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch { /* storage unavailable */ }
  applyTheme()
  listeners.forEach((l) => l())
}

export function onThemeChange(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function useTheme(): string {
  return useSyncExternalStore(onThemeChange, () => current)
}

let menuArt: { key: string; url: string } | null = null

export function hasMenuArt(key: string): boolean {
  return menuArt?.key === key
}

export function setMenuArt(key: string, png: Uint8Array) {
  if (menuArt) URL.revokeObjectURL(menuArt.url)
  menuArt = { key, url: URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })) }
  document.documentElement.style.setProperty('--menu-city', `url("${menuArt.url}")`)
}

export function themeColor(name: string): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.16, 0.17, 0.2]
}