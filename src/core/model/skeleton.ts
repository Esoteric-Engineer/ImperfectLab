// Splits a base game character into a readable format, since the game doesn't store bone names.
import { LabError } from '../errors'
import * as ngmtool from '../mnroi/ngmtool'
import type { BaseCharacter } from '../game/roster'
import brute from './skeletons/brute.json'
import female from './skeletons/female.json'
import male from './skeletons/male.json'

export const SIDES = ['R', 'L'] as const
export const CHAINS = ['finger_a', 'finger_b', 'thumb'] as const

interface NodeInfo {
  name?: string
  group?: string
  role?: string
  required?: boolean
}

interface Table {
  groups: string[]
  twist?: Record<string, [string, string, number, number]>
  nodes: Record<string, NodeInfo>
}

const TABLES = { male, female, brute } as unknown as Record<string, Table>

export function loadTable(body: string): Table {
  const t = TABLES[body]
  if (!t) throw new LabError(`${body} bases are not supported yet (no bone table for that body class)`)
  return t
}

export class Node {
  index: number
  parent: number
  pos: [number, number, number]
  name: string
  group: string
  role: string | null
  required: boolean

  constructor(index: number, parent: number, pos: [number, number, number], info: NodeInfo) {
    this.index = index
    this.parent = parent
    this.pos = pos
    this.name = info.name ?? `Node ${index}`
    this.group = info.group ?? 'props'
    this.role = info.role ?? null
    this.required = info.required ?? false
  }
}

export interface RenderNodes {
  nodes: [ArrayLike<number>, ArrayLike<number>, number, number][]
}

export class Skeleton {
  body: string
  groups: string[]
  twist: Record<string, [string, string, number, number]>
  nodes: Node[] = []
  roles = new Map<string, number>()

  constructor(renderModel: RenderNodes, body: string) {
    const table = loadTable(body)
    this.body = body
    this.groups = table.groups
    this.twist = table.twist ?? {}
    const anchor = new Map<number, number>()
    renderModel.nodes.forEach(([, b, parent], i) => {
      let known = table.nodes[String(i)]
      if (known === undefined && parent >= 0 && parent < this.nodes.length) {
        const up = this.nodes[anchor.get(parent) ?? parent]
        anchor.set(i, up.index)
        known = { name: `Extra ${i} (on ${up.name})`, group: up.role === 'head' ? 'face' : up.group }
      }
      this.nodes.push(new Node(i, parent, [-b[0], -b[1], -b[2]], known ?? {}))
    })
    for (const n of this.nodes) if (n.role) this.roles.set(n.role, n.index)
  }

  static ofBase(base: BaseCharacter): Skeleton {
    const [, models] = ngmtool.read(base.bundleFiles()[0])
    return new Skeleton(models[0], base.body)
  }

  node(role: string): number | undefined {
    return this.roles.get(role)
  }

  positions(): [number, number, number][] {
    return this.nodes.map((n) => n.pos)
  }

  chain(side: string, name: string): number[] {
    const out: number[] = []
    for (let k = 0; this.roles.has(`${side}.${name}.${k}`); k++) out.push(this.roles.get(`${side}.${name}.${k}`)!)
    return out
  }

  requiredRoles(): string[] {
    return this.nodes.filter((n) => n.required).map((n) => n.role!)
  }

  byGroup(): Map<string, Node[]> {
    const out = new Map<string, Node[]>(this.groups.map((g) => [g, []]))
    for (const n of this.nodes) {
      if (!out.has(n.group)) out.set(n.group, [])
      out.get(n.group)!.push(n)
    }
    return out
  }
}
