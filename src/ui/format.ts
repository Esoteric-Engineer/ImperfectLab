export function titleCase(s: string): string {
  return s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

export function fileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_')
}

export function artName(c: { displayName: string; internalName: string }): string {
  return fileName(c.displayName || c.internalName || 'character')
}
