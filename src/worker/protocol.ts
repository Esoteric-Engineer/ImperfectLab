import type { TintPlan } from '../core/build/effects'
import type { BatchCheck } from '../core/build/batch'
import type { RgbaImage } from '../core/image/rgba'
import type { Material, Pose } from '../core/package/imperfect'
import type { BoneLine, MeshData } from '../core/preview'

export type DiscInput = { kind: 'file'; file: File } | { kind: 'folder'; name: string; files: [string, File][] }

export interface DiscInfo {
  name: string
  gameId: string
}

export interface SkeletonData {
  body: string
  nodes: [number[], number[], number, number][]
}

export interface BaseInfo {
  key: string
  label: string
  body: string
  stats: number[]
  altStats: number[]
  hudName: string
  icon: RgbaImage | null
  skeleton: SkeletonData | null
  error: string | null
}

export interface BaseDetails {
  gameplay: Record<string, number>
  lift: string
  wireSwing: string
  hasWire: boolean
  health: number
  tint: Record<string, TintPlan>
  sizes: Record<string, [number, number]>
}

export interface ModelInfo {
  joints: { name: string; parent: string | null; pos: [number, number, number] }[]
  weighted: [string, number][]
  materials: { name: string; image: number | null }[]
  triangles: number
}

export interface ImportedModel {
  slim: Uint8Array
  info: ModelInfo
  materials: Material[]
}

export interface PreviewResult {
  scale: number
  flip: boolean
  fitted: MeshData[]
  source: MeshData[]
  base: MeshData[] | null
  gameBones: BoneLine[]
  sourceBones: BoneLine[]
  stats: [number, number, number, number] | string
}

export interface LayoutInfo {
  canvases: Record<string, { index: number; size: [number, number]; scale: number }>
  sR: number
  originals: Record<string, RgbaImage | null>
}

export interface ComposeArgs {
  pose: Pose
  scale: number
  anchor: [number, number]
  glow: string | null
  fade: number
}

export interface CheckResult {
  notes: string[]
  sets: string[]
  adds: string[]
}

export interface BatchCheckResult extends BatchCheck {
  token: number | null
}

export type PatchTarget = { kind: 'handle'; handle: FileSystemFileHandle } | { kind: 'opfs'; name: string }

export type Request = { id: number; method: string; args: unknown[] }
export type Response =
  | { id: number; progress: [string, number, number] }
  | { id: number; result: unknown }
  | { id: number; error: string; lab: boolean }
