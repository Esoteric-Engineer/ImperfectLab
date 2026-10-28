// Which model joint drives which game node: presets for common rigs, inheritance for unmapped joints, and the checks a mapping must pass before a fit.
import type { JointModel as Model } from './glb'
import { CHAINS, SIDES, type Skeleton } from './skeleton'

export type Mapping = Map<number, string>
export type Overrides = Map<string, number>

type Normalize = (name: string) => string

class Preset {
  name: string
  sides: [string, string]
  torso: Record<string, string[]>
  limbs: Record<string, string[]>
  fingers: Record<string, string[]>
  extra: Record<string, string[]>
  normalize: Normalize

  constructor(name: string, sides: [string, string], torso: Record<string, string[]>, limbs: Record<string, string[]>,
    fingers: Record<string, string[]>, extra: Record<string, string[]>, normalize: Normalize) {
    this.name = name
    this.sides = sides
    this.torso = torso
    this.limbs = limbs
    this.fingers = fingers
    this.extra = extra
    this.normalize = normalize
  }

  candidates(): [[string, string[]][], [string, string][]] {
    const fill = (n: string, s: string) => n.replaceAll('{s}', s)
    const out: [string, string[]][] = Object.entries(this.torso)
    SIDES.forEach((side, i) => {
      const spelled = this.sides[i]
      for (const [role, names] of Object.entries(this.limbs)) out.push([`${side}.${role}`, names.map((n) => fill(n, spelled))])
      for (const [chain, names] of Object.entries(this.fingers)) names.forEach((n, k) => out.push([`${side}.${chain}.${k}`, [fill(n, spelled)]]))
    })
    const extra: [string, string][] = []
    SIDES.forEach((side, i) => {
      for (const [chain, names] of Object.entries(this.extra)) names.forEach((n, k) => extra.push([fill(n, this.sides[i]), `${side}.${chain}.${k}`]))
    })
    return [out, extra]
  }
}

const strip = (pattern: string): Normalize => {
  const rx = new RegExp(pattern, 'gi')
  return (name) => name.replace(rx, '').trim().toLowerCase()
}

const biped: Normalize = (name) => name.replace(/_\d+$/, '').replace(/^bip0*1[ _]/i, 'bip01 ').trim().toLowerCase()

const rigify: Normalize = (name) =>
  name.replace(/^(def|org|mch)[-_]/i, '').replace(/[._]([lr])$/i, (_, s: string) => '.' + s).trim().toLowerCase()

export const PRESETS: Preset[] = [
  new Preset('3ds Max Biped (MUA, many game rips)', ['R', 'L'],
    { pelvis: ['Bip01 Pelvis'], spine: ['Bip01 Spine'], chest: ['Bip01 Spine2', 'Bip01 Spine1'], neck: ['Bip01 Neck'], head: ['Bip01 Head'] },
    { clavicle: ['Bip01 {s} Clavicle'], upper_arm: ['Bip01 {s} UpperArm'], forearm: ['Bip01 {s} Forearm'], hand: ['Bip01 {s} Hand'],
      thigh: ['Bip01 {s} Thigh'], calf: ['Bip01 {s} Calf'], foot: ['Bip01 {s} Foot'], toe: ['Bip01 {s} Toe0'] },
    { finger_a: ['Bip01 {s} Finger1', 'Bip01 {s} Finger11', 'Bip01 {s} Finger12'],
      finger_b: ['Bip01 {s} Finger3', 'Bip01 {s} Finger31', 'Bip01 {s} Finger32'],
      thumb: ['Bip01 {s} Finger0', 'Bip01 {s} Finger01', 'Bip01 {s} Finger02'] },
    { finger_a: ['Bip01 {s} Finger2', 'Bip01 {s} Finger21', 'Bip01 {s} Finger22'],
      finger_b: ['Bip01 {s} Finger4', 'Bip01 {s} Finger41', 'Bip01 {s} Finger42'] }, biped),
  new Preset('Mixamo', ['Right', 'Left'],
    { pelvis: ['Hips'], spine: ['Spine'], chest: ['Spine2', 'Spine1'], neck: ['Neck'], head: ['Head'] },
    { clavicle: ['{s}Shoulder'], upper_arm: ['{s}Arm'], forearm: ['{s}ForeArm'], hand: ['{s}Hand'],
      thigh: ['{s}UpLeg'], calf: ['{s}Leg'], foot: ['{s}Foot'], toe: ['{s}ToeBase'] },
    { finger_a: ['{s}HandIndex1', '{s}HandIndex2', '{s}HandIndex3'],
      finger_b: ['{s}HandRing1', '{s}HandRing2', '{s}HandRing3'],
      thumb: ['{s}HandThumb1', '{s}HandThumb2', '{s}HandThumb3'] },
    { finger_a: ['{s}HandMiddle1', '{s}HandMiddle2', '{s}HandMiddle3'],
      finger_b: ['{s}HandPinky1', '{s}HandPinky2', '{s}HandPinky3'] }, strip('^mixamorig\\d*[:_]')),
  new Preset('Blender Rigify / metarig', ['R', 'L'],
    { pelvis: ['spine'], spine: ['spine.001'], chest: ['spine.003', 'spine.002'], neck: ['spine.004'], head: ['spine.006', 'spine.005'] },
    { clavicle: ['shoulder.{s}'], upper_arm: ['upper_arm.{s}'], forearm: ['forearm.{s}'], hand: ['hand.{s}'],
      thigh: ['thigh.{s}'], calf: ['shin.{s}'], foot: ['foot.{s}'], toe: ['toe.{s}'] },
    { finger_a: ['f_index.01.{s}', 'f_index.02.{s}', 'f_index.03.{s}'],
      finger_b: ['f_ring.01.{s}', 'f_ring.02.{s}', 'f_ring.03.{s}'],
      thumb: ['thumb.01.{s}', 'thumb.02.{s}', 'thumb.03.{s}'] },
    { finger_a: ['f_middle.01.{s}', 'f_middle.02.{s}', 'f_middle.03.{s}'],
      finger_b: ['f_pinky.01.{s}', 'f_pinky.02.{s}', 'f_pinky.03.{s}'] }, rigify),
  new Preset('Unreal mannequin', ['r', 'l'],
    { pelvis: ['pelvis'], spine: ['spine_01'], chest: ['spine_03', 'spine_02'], neck: ['neck_01'], head: ['head'] },
    { clavicle: ['clavicle_{s}'], upper_arm: ['upperarm_{s}'], forearm: ['lowerarm_{s}'], hand: ['hand_{s}'],
      thigh: ['thigh_{s}'], calf: ['calf_{s}'], foot: ['foot_{s}'], toe: ['ball_{s}'] },
    { finger_a: ['index_01_{s}', 'index_02_{s}', 'index_03_{s}'],
      finger_b: ['ring_01_{s}', 'ring_02_{s}', 'ring_03_{s}'], thumb: ['thumb_01_{s}', 'thumb_02_{s}', 'thumb_03_{s}'] },
    { finger_a: ['middle_01_{s}', 'middle_02_{s}', 'middle_03_{s}'],
      finger_b: ['pinky_01_{s}', 'pinky_02_{s}', 'pinky_03_{s}'] }, strip('^$')),
  new Preset('VRM / VRoid', ['R', 'L'],
    { pelvis: ['J_Bip_C_Hips'], spine: ['J_Bip_C_Spine'], chest: ['J_Bip_C_UpperChest', 'J_Bip_C_Chest'], neck: ['J_Bip_C_Neck'], head: ['J_Bip_C_Head'] },
    { clavicle: ['J_Bip_{s}_Shoulder'], upper_arm: ['J_Bip_{s}_UpperArm'], forearm: ['J_Bip_{s}_LowerArm'], hand: ['J_Bip_{s}_Hand'],
      thigh: ['J_Bip_{s}_UpperLeg'], calf: ['J_Bip_{s}_LowerLeg'], foot: ['J_Bip_{s}_Foot'], toe: ['J_Bip_{s}_ToeBase'] },
    { finger_a: ['J_Bip_{s}_Index1', 'J_Bip_{s}_Index2', 'J_Bip_{s}_Index3'],
      finger_b: ['J_Bip_{s}_Ring1', 'J_Bip_{s}_Ring2', 'J_Bip_{s}_Ring3'],
      thumb: ['J_Bip_{s}_Thumb1', 'J_Bip_{s}_Thumb2', 'J_Bip_{s}_Thumb3'] },
    { finger_a: ['J_Bip_{s}_Middle1', 'J_Bip_{s}_Middle2', 'J_Bip_{s}_Middle3'],
      finger_b: ['J_Bip_{s}_Little1', 'J_Bip_{s}_Little2', 'J_Bip_{s}_Little3'] }, strip('^$')),
  new Preset('Unity Humanoid', ['Right', 'Left'],
    { pelvis: ['Hips'], spine: ['Spine'], chest: ['UpperChest', 'Chest'], neck: ['Neck'], head: ['Head'] },
    { clavicle: ['{s}Shoulder'], upper_arm: ['{s}UpperArm'], forearm: ['{s}LowerArm'], hand: ['{s}Hand'],
      thigh: ['{s}UpperLeg'], calf: ['{s}LowerLeg'], foot: ['{s}Foot'], toe: ['{s}Toes'] },
    { finger_a: ['{s}IndexProximal', '{s}IndexIntermediate', '{s}IndexDistal'],
      finger_b: ['{s}RingProximal', '{s}RingIntermediate', '{s}RingDistal'],
      thumb: ['{s}ThumbProximal', '{s}ThumbIntermediate', '{s}ThumbDistal'] },
    { finger_a: ['{s}MiddleProximal', '{s}MiddleIntermediate', '{s}MiddleDistal'],
      finger_b: ['{s}LittleProximal', '{s}LittleIntermediate', '{s}LittleDistal'] }, strip('^$')),
]

const KEYWORDS: [string, string[]][] = [
  ['pelvis', ['pelvis', 'hips', 'hip']], ['chest', ['chest', 'upperchest', 'spine2', 'spine3']],
  ['spine', ['spine', 'spine1', 'torso', 'abdomen']], ['neck', ['neck']], ['head', ['head']],
  ['clavicle', ['clavicle', 'shoulder', 'collar']], ['forearm', ['forearm', 'lowerarm', 'elbow']],
  ['upper_arm', ['upperarm', 'arm']], ['hand', ['hand', 'wrist']], ['thigh', ['thigh', 'upleg', 'upperleg']],
  ['calf', ['calf', 'shin', 'lowerleg', 'knee', 'leg']], ['foot', ['foot', 'ankle']],
  ['toe', ['toe', 'toes', 'toebase', 'ball']],
]
const SIDE_TOKENS: Record<string, string[]> = { R: ['r', 'right', 'rt'], L: ['l', 'left', 'lt'] }
const TORSO = ['pelvis', 'spine', 'chest', 'neck', 'head']

export interface AutoMap {
  preset: string
  mapping: Mapping
  overrides: Overrides
}

function compareScore(a: [number, number], b: [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

// Rigs built on an exported base keep this tool's own bone names. Covers every node.
const gameName: Normalize = (name) => name.replace(/[\s_]+/g, ' ').trim().toLowerCase()

function gameNameMap(model: Model, skeleton: Skeleton): Mapping {
  const lookup = new Map<string, string>()
  for (const n of model.jointNames()) {
    const k = gameName(n)
    if (!lookup.has(k)) lookup.set(k, n)
  }
  const mapping: Mapping = new Map()
  for (const node of skeleton.nodes) {
    const j = lookup.get(gameName(node.name))
    if (j !== undefined) mapping.set(node.index, j)
  }
  return mapping
}

export function autoMap(model: Model, skeleton: Skeleton): AutoMap {
  const weighted = model.weighted()
  const names = model.jointNames()
  const required = skeleton.requiredRoles()
  const native = gameNameMap(model, skeleton)
  let best: [[number, number], AutoMap] | null = [[required.filter((r) => native.has(skeleton.node(r)!)).length, native.size],
    { preset: 'game bone names', mapping: native, overrides: new Map() }]
  for (const preset of PRESETS) {
    const lookup = new Map<string, string>()
    for (const n of names) {
      const k = preset.normalize(n)
      if (!lookup.has(k)) lookup.set(k, n)
    }
    const [primary, extra] = preset.candidates()
    const mapping: Mapping = new Map()
    const used = new Set<string>()
    for (const [role, cands] of primary) {
      const node = skeleton.node(role)
      if (node === undefined) continue
      for (const c of cands) {
        const j = lookup.get(preset.normalize(c))
        if (j !== undefined && !used.has(j)) {
          mapping.set(node, j)
          used.add(j)
          break
        }
      }
    }
    const overrides: Overrides = new Map()
    for (const [cand, role] of extra) {
      const j = lookup.get(preset.normalize(cand)), node = skeleton.node(role)
      if (j !== undefined && node !== undefined && !used.has(j) && weighted.has(j)) overrides.set(j, node)
    }
    const score: [number, number] = [required.filter((r) => mapping.has(skeleton.node(r)!)).length, mapping.size]
    if (best === null || compareScore(score, best[0]) > 0) best = [score, { preset: preset.name, mapping, overrides }]
  }
  if (best![0][0] < required.length) {
    const fuzzy = keywordMap(model, skeleton)
    const score: [number, number] = [required.filter((r) => fuzzy.has(skeleton.node(r)!)).length, fuzzy.size]
    if (compareScore(score, best![0]) > 0) return { preset: 'name keywords (check every row)', mapping: fuzzy, overrides: new Map() }
  }
  return best![1]
}

export function tokens(name: string): string[] {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^A-Za-z0-9]+/).filter(Boolean)
}

function sideOf(toks: string[]): string | null {
  for (const [side, words] of Object.entries(SIDE_TOKENS)) if (toks.some((t) => words.includes(t))) return side
  return null
}

export function keywordMap(model: Model, skeleton: Skeleton): Mapping {
  const mapping: Mapping = new Map()
  const used = new Set<string>()
  const joints = model.joints.map((j) => [j.name, tokens(j.name)] as [string, string[]])
  for (const [role, words] of KEYWORDS) {
    for (const side of [null, ...SIDES]) {
      const full = TORSO.includes(role) ? role : null
      if ((full && side !== null) || (!full && side === null)) continue
      const node = skeleton.node(full ?? `${side}.${role}`)
      if (node === undefined || mapping.has(node)) continue
      for (const [name, toks] of joints) {
        if (used.has(name) || sideOf(toks) !== side) continue
        const drop = SIDE_TOKENS[side ?? ''] ?? []
        const flat = toks.filter((t) => !drop.includes(t)).join('')
        if (words.some((w) => flat.endsWith(w) || toks.includes(w))) {
          mapping.set(node, name)
          used.add(name)
          break
        }
      }
    }
  }
  return mapping
}

export function translate(mapping: Mapping, overrides: Overrides, old: Skeleton, next: Skeleton): [Mapping, Overrides] {
  const same = old.body === next.body
  const move = (node: number | null | undefined): number | undefined => {
    if (node === null || node === undefined || node >= old.nodes.length) return undefined
    const role = old.nodes[node].role
    if (role) return next.node(role)
    return same && node < next.nodes.length && next.nodes[node].name === old.nodes[node].name ? node : undefined
  }
  const m: Mapping = new Map()
  for (const [node, joint] of mapping) {
    const n = move(node)
    if (n !== undefined) m.set(n, joint)
  }
  const o: Overrides = new Map()
  for (const [joint, node] of overrides) {
    const n = move(node)
    if (n !== undefined) o.set(joint, n)
  }
  return [m, o]
}

export function direct(mapping: Mapping, overrides: Overrides): Map<string, number> {
  const out = new Map<string, number>()
  for (const [node, joint] of [...mapping].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))) {
    if (!out.has(joint)) out.set(joint, node)
  }
  for (const [j, n] of overrides) if (n !== null && n !== undefined) out.set(j, n)
  return out
}

export function effective(model: Model, mapping: Mapping, overrides: Overrides): Map<string, number | null> {
  const d = direct(mapping, overrides)
  const out = new Map<string, number | null>()
  for (const jt of model.joints) {
    const chain: string[] = []
    let name: string | null = jt.name
    while (name !== null && !out.has(name) && !d.has(name)) {
      chain.push(name)
      name = model.joint(name).parent
    }
    const t = name === null ? null : out.has(name) ? out.get(name)! : (d.get(name) ?? null)
    for (const n of chain) out.set(n, t)
    if (d.has(jt.name)) out.set(jt.name, d.get(jt.name)!)
  }
  return out
}

export type Problem = ['error' | 'warning' | 'note', string]

export function check(model: Model, skeleton: Skeleton, mapping: Mapping, overrides: Overrides): Problem[] {
  const out: Problem[] = []
  const names = new Set(model.jointNames())
  const count = skeleton.nodes.length
  const seen = new Map<string, number>()
  for (const [node, joint] of mapping) {
    if (!(node >= 0 && node < count)) out.push(['error', `game bone ${node} does not exist on this base`])
    if (!names.has(joint)) out.push(['error', `the model has no joint ${joint}`])
    else if (seen.has(joint)) out.push(['error', `${joint} is mapped to two game bones (${skeleton.nodes[seen.get(joint)!]?.name} and ${skeleton.nodes[node]?.name})`])
    if (!seen.has(joint)) seen.set(joint, node)
  }
  for (const [joint, node] of overrides) {
    if (!names.has(joint)) out.push(['error', `the model has no joint ${joint}`])
    if (node !== null && node !== undefined && !(node >= 0 && node < count)) out.push(['error', `game bone ${node} does not exist on this base`])
  }
  for (const role of skeleton.requiredRoles()) {
    if (!mapping.has(skeleton.node(role)!)) out.push(['error', `${skeleton.nodes[skeleton.node(role)!].name} is not mapped`])
  }
  for (const side of SIDES) {
    for (const chain of CHAINS) {
      const mapped = skeleton.chain(side, chain).map((n) => mapping.has(n))
      const sorted = [...mapped].sort((a, b) => Number(b) - Number(a))
      if (mapped.some(Boolean) && mapped.some((v, i) => v !== sorted[i])) out.push(['error', `${side} ${chain}: map the chain from its first bone, without gaps`])
    }
  }
  const eff = effective(model, mapping, overrides)
  const lost = [...model.weighted().keys()].filter((n) => (eff.get(n) ?? null) === null)
  if (lost.length && !out.length) {
    out.push(['warning', `${lost.length} joint(s) with weights have no mapped parent and follow the pelvis: ${lost.sort().slice(0, 5).join(', ')}`])
  }
  return out
}
