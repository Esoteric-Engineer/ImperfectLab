import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Content-Security-Policy for lab.nemesismods.com (Cloudflare Pages).
const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

describe('security headers', () => {
  it('index.html has no inline scripts, which the CSP would block', () => {
    const scripts = [...read('index.html').matchAll(/<script\b([^>]*)>/gi)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [tag, attrs] of scripts) expect(attrs, tag).toMatch(/\bsrc=/)
  })

  it('_headers keeps the CSP strict and Cloudflare Web Analytics allowed', () => {
    const csp = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(read('public/_headers'))?.[1]
    expect(csp).toBeDefined()
    const directives = new Map(csp!.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
    expect(directives.get('script-src')).toEqual(["'self'", 'https://static.cloudflareinsights.com'])
    expect(directives.get('connect-src')).toContain('https://cloudflareinsights.com')
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
  })
})