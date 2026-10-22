const KEY = 'imperfectlab.verified'

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function discKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

export function isVerified(key: string): boolean {
  return load().includes(key)
}

export function rememberVerified(key: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([key, ...load().filter((k) => k !== key)].slice(0, 16)))
  } catch {
    // storage may be unavailable; the disc is then checked again next time
  }
}
