import { BufferGeometry, Float32BufferAttribute, Sphere, Vector3 } from 'three'
import type { MinecraftAssetCatalog } from './minecraftAssets'
import type { MinecraftRenderLayer } from './minecraftModels'
import type { ReplayWorldSection } from './replaySections'
import type { ReplayMeshWorkerProgress, SerializedReplayGeometry, SerializedReplayMeshWorld } from './replayMeshTypes'
import type { TimedReplayEvent } from './voxel'

export type ReplayMeshProgress = {
  phase: 'meshing' | 'combining' | 'hydrating'
  completed: number
  total: number
  revisions: number
}

export type PreparedReplayGeometry = {
  key: string
  texture: string | null
  layer: MinecraftRenderLayer
  geometry: BufferGeometry
}

export type PreparedDynamicReplaySection = {
  key: string
  anchorMs: number
  events: TimedReplayEvent[]
  revisions: Record<string, PreparedReplayGeometry[]>
}

export type PreparedReplayMeshWorld = {
  staticGroups: PreparedReplayGeometry[]
  dynamicSections: PreparedDynamicReplaySection[]
  sectionCount: number
  staticSectionCount: number
  dynamicSectionCount: number
  revisionCount: number
}

type WorkerResponse =
  | { type: 'progress'; progress: ReplayMeshWorkerProgress }
  | { type: 'result'; result: SerializedReplayMeshWorld }
  | { type: 'error'; message: string }

function hydrateGeometry(group: SerializedReplayGeometry): PreparedReplayGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(group.positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(group.normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(group.uvs, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(group.colors, 3))
  if (group.sphere) {
    geometry.boundingSphere = new Sphere(new Vector3(group.sphere[0], group.sphere[1], group.sphere[2]), group.sphere[3])
  }
  return { key: group.key, texture: group.texture, layer: group.layer, geometry }
}

function browserYield() {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function hydrateWorld(serialized: SerializedReplayMeshWorld, onProgress?: (progress: ReplayMeshProgress) => void) {
  const total = serialized.staticGroups.length + serialized.dynamicSections.reduce(
    (sum, section) => sum + Object.values(section.revisions).reduce((count, groups) => count + groups.length, 0),
    0,
  )
  let completed = 0

  const hydrateGroups = async (groups: SerializedReplayGeometry[]) => {
    const result: PreparedReplayGeometry[] = []
    for (const group of groups) {
      result.push(hydrateGeometry(group))
      completed++
      if (completed % 24 === 0) {
        onProgress?.({ phase: 'hydrating', completed, total, revisions: serialized.revisionCount })
        await browserYield()
      }
    }
    return result
  }

  const staticGroups = await hydrateGroups(serialized.staticGroups)
  const dynamicSections: PreparedDynamicReplaySection[] = []
  for (const section of serialized.dynamicSections) {
    const revisions: Record<string, PreparedReplayGeometry[]> = {}
    for (const [revision, groups] of Object.entries(section.revisions)) revisions[revision] = await hydrateGroups(groups)
    dynamicSections.push({ key: section.key, anchorMs: section.anchorMs, events: section.events, revisions })
  }

  onProgress?.({ phase: 'hydrating', completed: total, total, revisions: serialized.revisionCount })
  return {
    staticGroups,
    dynamicSections,
    sectionCount: serialized.sectionCount,
    staticSectionCount: serialized.staticSectionCount,
    dynamicSectionCount: serialized.dynamicSectionCount,
    revisionCount: serialized.revisionCount,
  } satisfies PreparedReplayMeshWorld
}

export async function preloadReplayMeshWorld(
  sections: ReplayWorldSection[],
  eventsBySection: ReadonlyMap<string, TimedReplayEvent[]>,
  catalog: MinecraftAssetCatalog,
  onProgress?: (progress: ReplayMeshProgress) => void,
  signal?: AbortSignal,
): Promise<PreparedReplayMeshWorld> {
  if (signal?.aborted) throw new Error('Replay mesh preload aborted.')
  const worker = new Worker(new URL('./replayMesh.worker.ts', import.meta.url), { type: 'module' })

  const serialized = await new Promise<SerializedReplayMeshWorld>((resolve, reject) => {
    const abort = () => {
      worker.terminate()
      reject(new Error('Replay mesh preload aborted.'))
    }
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress?.(message.progress)
        return
      }
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (message.type === 'error') reject(new Error(message.message))
      else resolve(message.result)
    }

    worker.onerror = (event) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      reject(new Error(event.message || 'Replay mesh worker failed.'))
    }

    worker.postMessage({ type: 'build', sections, eventsBySection: [...eventsBySection.entries()], catalog })
  })

  if (signal?.aborted) throw new Error('Replay mesh preload aborted.')
  return hydrateWorld(serialized, onProgress)
}

export function disposeReplayMeshWorld(world: PreparedReplayMeshWorld | null | undefined) {
  if (!world) return
  const seen = new Set<BufferGeometry>()
  const dispose = (groups: PreparedReplayGeometry[]) => {
    for (const group of groups) {
      if (seen.has(group.geometry)) continue
      seen.add(group.geometry)
      group.geometry.dispose()
    }
  }
  dispose(world.staticGroups)
  for (const section of world.dynamicSections) {
    for (const groups of Object.values(section.revisions)) dispose(groups)
  }
}
