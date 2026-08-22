import type { MinecraftRenderLayer } from './minecraftModels'
import type { TimedReplayEvent } from './voxel'

export type SerializedReplayGeometry = {
  key: string
  texture: string | null
  layer: MinecraftRenderLayer
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  colors: Float32Array
  sphere: [number, number, number, number] | null
}

export type SerializedDynamicReplaySection = {
  key: string
  anchorMs: number
  events: TimedReplayEvent[]
  revisions: Record<string, SerializedReplayGeometry[]>
}

export type SerializedReplayMeshWorld = {
  staticGroups: SerializedReplayGeometry[]
  dynamicSections: SerializedDynamicReplaySection[]
  sectionCount: number
  staticSectionCount: number
  dynamicSectionCount: number
  revisionCount: number
}

export type ReplayMeshWorkerProgress = {
  phase: 'meshing' | 'combining'
  completed: number
  total: number
  revisions: number
}
