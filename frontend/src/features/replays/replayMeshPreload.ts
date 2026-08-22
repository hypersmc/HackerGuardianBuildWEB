import { BufferGeometry, Float32BufferAttribute, Sphere, Vector3 } from 'three'
import type { MinecraftRenderLayer } from './minecraftModels'
import type { ReplayWorldSection } from './replaySections'
import type { ReplayMeshWorkerProgress, SerializedReplayGeometry, SerializedReplayMeshWorld } from './replayMeshTypes'
import type { TimedReplayEvent } from './voxel'

export type ReplayMeshProgress = ReplayMeshWorkerProgress | {
  phase: 'hydrating'
  completed: number
  total: number
  revisions: number
  detail?: string
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
  | { type: 'ready' }
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
      if (completed % 16 === 0) {
        onProgress?.({
          phase: 'hydrating',
          completed,
          total,
          revisions: serialized.revisionCount,
          detail: `Creating GPU-ready buffers ${completed}/${total}`,
        })
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

  onProgress?.({
    phase: 'hydrating',
    completed: total,
    total,
    revisions: serialized.revisionCount,
    detail: `${total} GPU geometry groups ready`,
  })
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
  packId: string,
  onProgress?: (progress: ReplayMeshProgress) => void,
  signal?: AbortSignal,
): Promise<PreparedReplayMeshWorld> {
  if (signal?.aborted) throw new Error('Replay mesh preload aborted.')
  onProgress?.({
    phase: 'starting',
    completed: 0,
    total: 1,
    revisions: 0,
    detail: 'Starting replay mesh worker',
  })

  const worker = new Worker(new URL('./replayMesh.worker.ts', import.meta.url), { type: 'module' })

  const serialized = await new Promise<SerializedReplayMeshWorld>((resolve, reject) => {
    let settled = false
    let buildSent = false
    const bootTimeout = window.setTimeout(() => {
      if (settled || buildSent) return
      settled = true
      worker.terminate()
      reject(new Error('Replay mesh worker did not start within 15 seconds. Check the browser console for worker/module errors.'))
    }, 15_000)

    const cleanup = () => {
      window.clearTimeout(bootTimeout)
      signal?.removeEventListener('abort', abort)
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      worker.terminate()
      reject(error)
    }

    const abort = () => fail(new Error('Replay mesh preload aborted.'))
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'ready') {
        if (buildSent || settled) return
        buildSent = true
        window.clearTimeout(bootTimeout)
        onProgress?.({
          phase: 'transferring',
          completed: 0,
          total: sections.length,
          revisions: 0,
          detail: `Sending ${sections.length} compressed replay sections to worker`,
        })
        try {
          worker.postMessage({
            type: 'build',
            sections,
            eventsBySection: [...eventsBySection.entries()],
            packId,
          })
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
        return
      }

      if (message.type === 'progress') {
        onProgress?.(message.progress)
        return
      }

      if (settled) return
      settled = true
      cleanup()
      worker.terminate()
      if (message.type === 'error') reject(new Error(message.message))
      else resolve(message.result)
    }

    worker.onerror = (event) => fail(new Error(event.message || 'Replay mesh worker failed.'))
    worker.onmessageerror = () => fail(new Error('Replay mesh worker returned data that the browser could not deserialize.'))
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
