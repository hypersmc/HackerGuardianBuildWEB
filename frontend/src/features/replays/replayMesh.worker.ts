import type { MinecraftAssetCatalog } from './minecraftAssets'
import { buildMinecraftGeometry, type MinecraftGeometryGroup, type MinecraftRenderLayer } from './minecraftModels'
import {
  applySectionAtTime,
  decodeSectionBlocks,
  sectionWorldRevision,
  type ReplayWorldSection,
} from './replaySections'
import type {
  ReplayMeshWorkerProgress,
  SerializedDynamicReplaySection,
  SerializedReplayGeometry,
  SerializedReplayMeshWorld,
} from './replayMeshTypes'
import type { TimedReplayEvent, VoxelWorld } from './voxel'

type BuildMessage = {
  type: 'build'
  sections: ReplayWorldSection[]
  eventsBySection: Array<[string, TimedReplayEvent[]]>
  catalog: MinecraftAssetCatalog
}

type StaticAccumulator = {
  key: string
  texture: string | null
  layer: MinecraftRenderLayer
  positions: Float32Array[]
  normals: Float32Array[]
  uvs: Float32Array[]
  colors: Float32Array[]
  positionLength: number
  normalLength: number
  uvLength: number
  colorLength: number
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<BuildMessage>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope

function floatArray(group: MinecraftGeometryGroup, attribute: 'position' | 'normal' | 'uv' | 'color') {
  const raw = group.geometry.getAttribute(attribute).array
  return raw instanceof Float32Array ? raw : Float32Array.from(raw as ArrayLike<number>)
}

function serializedGeometry(group: MinecraftGeometryGroup): SerializedReplayGeometry {
  const sphere = group.geometry.boundingSphere
  return {
    key: group.key,
    texture: group.texture,
    layer: group.layer,
    positions: floatArray(group, 'position'),
    normals: floatArray(group, 'normal'),
    uvs: floatArray(group, 'uv'),
    colors: floatArray(group, 'color'),
    sphere: sphere ? [sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius] : null,
  }
}

function appendStatic(target: Map<string, StaticAccumulator>, groups: MinecraftGeometryGroup[]) {
  for (const group of groups) {
    const positions = floatArray(group, 'position')
    const normals = floatArray(group, 'normal')
    const uvs = floatArray(group, 'uv')
    const colors = floatArray(group, 'color')
    let accumulator = target.get(group.key)
    if (!accumulator) {
      accumulator = {
        key: group.key,
        texture: group.texture,
        layer: group.layer,
        positions: [], normals: [], uvs: [], colors: [],
        positionLength: 0, normalLength: 0, uvLength: 0, colorLength: 0,
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
      }
      target.set(group.key, accumulator)
    }

    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]
      const y = positions[index + 1]
      const z = positions[index + 2]
      if (x < accumulator.minX) accumulator.minX = x
      if (y < accumulator.minY) accumulator.minY = y
      if (z < accumulator.minZ) accumulator.minZ = z
      if (x > accumulator.maxX) accumulator.maxX = x
      if (y > accumulator.maxY) accumulator.maxY = y
      if (z > accumulator.maxZ) accumulator.maxZ = z
    }

    accumulator.positions.push(positions)
    accumulator.normals.push(normals)
    accumulator.uvs.push(uvs)
    accumulator.colors.push(colors)
    accumulator.positionLength += positions.length
    accumulator.normalLength += normals.length
    accumulator.uvLength += uvs.length
    accumulator.colorLength += colors.length
    group.geometry.dispose()
  }
}

function concat(parts: Float32Array[], length: number) {
  const result = new Float32Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function finalizeStatic(accumulator: StaticAccumulator): SerializedReplayGeometry {
  const centerX = (accumulator.minX + accumulator.maxX) / 2
  const centerY = (accumulator.minY + accumulator.maxY) / 2
  const centerZ = (accumulator.minZ + accumulator.maxZ) / 2
  const halfX = (accumulator.maxX - accumulator.minX) / 2
  const halfY = (accumulator.maxY - accumulator.minY) / 2
  const halfZ = (accumulator.maxZ - accumulator.minZ) / 2
  const radius = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ)

  return {
    key: accumulator.key,
    texture: accumulator.texture,
    layer: accumulator.layer,
    positions: concat(accumulator.positions, accumulator.positionLength),
    normals: concat(accumulator.normals, accumulator.normalLength),
    uvs: concat(accumulator.uvs, accumulator.uvLength),
    colors: concat(accumulator.colors, accumulator.colorLength),
    sphere: Number.isFinite(radius) ? [centerX, centerY, centerZ, radius] : null,
  }
}

function revisionPlayheads(events: TimedReplayEvent[], anchor: number) {
  const times = new Set<number>([Math.max(0, anchor), 0])
  for (const event of events) times.add(Math.max(0, event.t))
  return [...times].sort((a, b) => a - b)
}

function buildDynamicSection(
  section: ReplayWorldSection,
  base: VoxelWorld,
  events: TimedReplayEvent[],
  catalog: MinecraftAssetCatalog,
): SerializedDynamicReplaySection {
  const revisions: Record<string, SerializedReplayGeometry[]> = {}

  for (const playhead of revisionPlayheads(events, section.anchorMs)) {
    const revision = sectionWorldRevision(events, playhead, section.anchorMs)
    if (revisions[revision]) continue
    const world = applySectionAtTime(base, events, playhead, section.anchorMs)
    const groups = buildMinecraftGeometry(world, catalog)
    revisions[revision] = groups.map((group) => {
      const serialized = serializedGeometry(group)
      group.geometry.dispose()
      return serialized
    })
  }

  if (!revisions.base) {
    const groups = buildMinecraftGeometry(base, catalog)
    revisions.base = groups.map((group) => {
      const serialized = serializedGeometry(group)
      group.geometry.dispose()
      return serialized
    })
  }

  return { key: section.key, anchorMs: section.anchorMs, events, revisions }
}

function chunkKey(section: ReplayWorldSection) {
  return `${section.world}:${section.chunkX},${section.chunkZ}`
}

function mergeWorld(target: VoxelWorld, source: VoxelWorld) {
  for (const [key, state] of source) target.set(key, state)
}

function transferList(world: SerializedReplayMeshWorld) {
  const list: Transferable[] = []
  const seen = new Set<ArrayBuffer>()
  const add = (group: SerializedReplayGeometry) => {
    for (const array of [group.positions, group.normals, group.uvs, group.colors]) {
      const buffer = array.buffer
      if (buffer instanceof ArrayBuffer && !seen.has(buffer)) {
        seen.add(buffer)
        list.push(buffer)
      }
    }
  }
  for (const group of world.staticGroups) add(group)
  for (const section of world.dynamicSections) {
    for (const groups of Object.values(section.revisions)) {
      for (const group of groups) add(group)
    }
  }
  return list
}

function progress(value: ReplayMeshWorkerProgress) {
  scope.postMessage({ type: 'progress', progress: value })
}

scope.onmessage = (event) => {
  if (event.data.type !== 'build') return

  try {
    const { sections, catalog } = event.data
    const eventsBySection = new Map(event.data.eventsBySection)
    const staticGeometryGroups = new Map<string, StaticAccumulator>()
    const staticChunks = new Map<string, VoxelWorld>()
    const dynamicSections: SerializedDynamicReplaySection[] = []
    const staticChunkKeys = new Set(
      sections
        .filter((section) => (eventsBySection.get(section.key)?.length ?? 0) === 0)
        .map(chunkKey),
    )
    const totalUnits = sections.length + staticChunkKeys.size
    let completedUnits = 0
    let staticSectionCount = 0
    let dynamicSectionCount = 0
    let revisionCount = 0

    // First expand every section in the worker. Event-free sections are retained in
    // chunk-sized worlds so model resolution/culling happens once per chunk rather
    // than once per vertical 16x16x16 section. Eventful sections remain independent
    // because playback swaps their precomputed revisions by timestamp.
    for (const section of sections) {
      const events = eventsBySection.get(section.key) ?? []
      const base = decodeSectionBlocks(section)
      if (events.length === 0) {
        const key = chunkKey(section)
        const chunk = staticChunks.get(key) ?? new Map<string, string>()
        mergeWorld(chunk, base)
        staticChunks.set(key, chunk)
        staticSectionCount++
      } else {
        const dynamic = buildDynamicSection(section, base, events, catalog)
        revisionCount += Object.keys(dynamic.revisions).length
        dynamicSections.push(dynamic)
        dynamicSectionCount++
      }

      completedUnits++
      progress({ phase: 'meshing', completed: completedUnits, total: totalUnits, revisions: revisionCount })
    }

    // Static chunk meshing is substantially cheaper than section-by-section model
    // resolution and also removes hidden faces between adjacent static Y sections.
    for (const world of staticChunks.values()) {
      appendStatic(staticGeometryGroups, buildMinecraftGeometry(world, catalog))
      completedUnits++
      progress({ phase: 'meshing', completed: completedUnits, total: totalUnits, revisions: revisionCount })
    }

    progress({ phase: 'combining', completed: totalUnits, total: totalUnits, revisions: revisionCount })

    const result: SerializedReplayMeshWorld = {
      staticGroups: [...staticGeometryGroups.values()].map(finalizeStatic),
      dynamicSections,
      sectionCount: sections.length,
      staticSectionCount,
      dynamicSectionCount,
      revisionCount,
    }

    scope.postMessage({ type: 'result', result }, transferList(result))
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
