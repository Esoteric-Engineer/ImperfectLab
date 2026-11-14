// Materials/Shaders/shaders.nsa: one charlight (or metallic glossenvcharlight) block per new material, as the other characters have.
import { concat, encodeLatin1, indexOfBytes, latin1 } from '../bytes'
import { LabError } from '../errors'

export interface Finish {
  envmap: string
  intensity: number
}

export interface ShaderMaterial {
  name: string
  texture: string
  finish: Finish | null
  plain?: boolean // drawn without the character's light
}

export const ENV_MAPS: { name: string; label: string; bundle: string; donor: string }[] = [
  { name: 'GE_env_WinkOnyx', label: "Liquid mirror (Wink's onyx)", bundle: 'wolverine', donor: "Wolverine's" },
  { name: 'GE_env_polishedMetal', label: 'Polished chrome', bundle: 'elektra', donor: "Elektra's" },
  { name: 'GE_env_Iron', label: 'Soft steel (Megalith)', bundle: 'megalith', donor: "Megalith's" },
  { name: 'GE_env_Ironman_look', label: 'Warm metal (Iron Man)', bundle: 'ironman', donor: "Iron Man's" },
  { name: 'GE_env_polishedMetalSpidey', label: 'Blue sky chrome (Spider-Man)', bundle: 'spiderman', donor: "Spider-Man's" },
  { name: 'GE_env_WinkOnyxGold', label: 'Gold onyx', bundle: 'spiderman_b2', donor: "Spider-Man's story level" },
  { name: 'GE_env_WinkOnyxBlue', label: 'Blue onyx', bundle: 'nycstreets_mp', donor: 'the New York streets arena' },
  { name: 'GE_env_WinkOnyx_green', label: 'Green onyx (Biohazard)', bundle: 'biohazard', donor: "Biohazard's" },
]

export const FINISH_STRENGTH: [number, number] = [0, 1]

export function envMap(name: string) {
  return ENV_MAPS.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null
}

const PLAIN = (m: string, texture: string) => `\n${m}\n{\n\tshader normal\n\ttexture ${texture}\n}\n`

const BLOCK = (m: string, texture: string, texture2: string, finish: Finish | null) =>
  finish
    ? `\n${m}\n{\n\tshader glossenvcharlight\n\tspecularity\t3.0\n\tshininess\t1.0\n\tintensity\t${finish.intensity.toFixed(2)}\n\ttexture ${texture}\n\tenvmap ${finish.envmap}\n\ttexture2 ${texture2}\n}\n`
    : `\n${m}\n{\n\tshader charlight\n\tspecularity\t3.0\n\tshininess\t1.0\n\tintensity\t1.0\n\ttexture ${texture}\n\ttexture2 ${texture2}\n}\n`

const ADDITIVE = (m: string) => `\n${m}\n{\n\tshader add\n\ttexture ${m}\n}\n`

export function build(data: Uint8Array, materials: ShaderMaterial[], texture2 = 'ge_charlight', additive: string[] = []): Uint8Array {
  const low = encodeLatin1(latin1(data).toLowerCase())
  for (const { name } of materials) {
    if (indexOfBytes(low, encodeLatin1('\n' + name.toLowerCase() + '\r\n')) >= 0) throw new LabError(`shaders.nsa already has a material ${name}`)
  }
  if (!(data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10)) data = concat([data, encodeLatin1('\r\n')])
  const have = blocks(data)
  const text = materials.map((m) => (m.plain ? PLAIN(m.name, m.texture) : BLOCK(m.name, m.texture, texture2, m.finish))).join('') + additive.filter((m) => !have.has(m.toLowerCase())).map(ADDITIVE).join('')
  return concat([data, encodeLatin1(text.replaceAll('\n', '\r\n'))])
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
