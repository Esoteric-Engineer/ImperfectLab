// Materials/Shaders/shaders.nsa: one charlight block per new material, as the other characters have.
import { concat, encodeLatin1, indexOfBytes, latin1 } from '../bytes'
import { LabError } from '../errors'

const BLOCK = (m: string, texture: string, texture2: string) =>
  `\n${m}\n{\n\tshader charlight\n\tspecularity\t3.0\n\tshininess\t1.0\n\tintensity\t1.0\n\ttexture ${texture}\n\ttexture2 ${texture2}\n}\n`

// `materials`: names, or [name, texture] for one that draws another's texture.
export function build(data: Uint8Array, materials: (string | [string, string])[], texture2 = 'ge_charlight'): Uint8Array {
  const named = materials.map((m): [string, string] => (typeof m === 'string' ? [m, m] : m))
  const low = encodeLatin1(latin1(data).toLowerCase())
  for (const [m] of named) {
    if (indexOfBytes(low, encodeLatin1('\n' + m.toLowerCase() + '\r\n')) >= 0) throw new LabError(`shaders.nsa already has a material ${m}`)
  }
  if (!(data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10)) data = concat([data, encodeLatin1('\r\n')])
  const blocks = named.map(([m, texture]) => BLOCK(m, texture, texture2)).join('')
  return concat([data, encodeLatin1(blocks.replaceAll('\n', '\r\n'))])
}

export function blocks(data: Uint8Array): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  let name: string | null = null
  let keys = new Map<string, string>()
  let depth = 0
  // eslint-disable-next-line no-control-regex
  for (let line of latin1(data).split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85]/)) {
    line = line.split('//')[0].trim()
    if (!line || line.startsWith(';')) continue
    if (line.startsWith('{')) {
      depth++
      continue
    }
    if (line.startsWith('}')) {
      depth--
      if (depth === 0 && name !== null) {
        if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), keys)
        name = null
      }
      continue
    }
    if (depth === 0) {
      name = line.split(/\s+/)[0]
      keys = new Map()
    } else if (depth === 1) {
      const m = /^(\S+)\s*(.*)$/.exec(line)!
      const k = m[1].toLowerCase()
      if (!keys.has(k)) keys.set(k, m[2].trim())
    }
  }
  return out
}

export function firstWord(v: string | undefined): string {
  return (v ?? '').split(/\s+/).filter(Boolean)[0] ?? ''
}
