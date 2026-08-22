import type { MinecraftAssetCatalog } from './minecraftAssets'
import { normalizeLegacyReplayEvents } from './legacyBlockState'
import {
  buildMinecraftGeometry,
  createMinecraftGeometryCache,
  type MinecraftGeometryCache,
  type MinecraftGeometryGroup,
  type MinecraftRenderLayer,
} from './minecraftModels'
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
  packId: string
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

type DynamicInput = {
  section: ReplayWorldSection
  base: VoxelWorld
  events: TimedReplayEvent[]
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

function revisionPlan(events: TimedReplayEvent[], anchor: number) {
  const times = new Set<number>([Math.max(0, anchor), 0])
  for (const event of events) times.add(Math.max(0, event.t))

  const seen = new Set<string>()
  const result: Array<{ playhead: number; revision: string }> = []
  for (const playhead of [...times].sort((a, b) => a - b)) {
    const revision = sectionWorldRevision(events, playhead, anchor)
    if (seen.has(revision)) continue
    seen.add(revision)
    result.push({ playhead, revision })
  }
  return result
}

function buildDynamicSection(
  input: DynamicInput,
  catalog: MinecraftAssetCatalog,
  cache: MinecraftGeometryCache,
  revisionOffset: number,
  totalRevisions: number,
): SerializedDynamicReplaySection {
  const { section, base, events } = input
  const revisions: Record<string, SerializedReplayGeometry[]> = {}
  const plan = revisionPlan(events, section.anchorMs)

  for (let index = 0; index < plan.length; index++) {
    const { playhead, revision } = plan[index]
    progress({
      phase: 'dynamic',
      completed: revisionOffset + index,
      total: totalRevisions,
      revisions: revisionOffset + index,
      detail: `Preparing block-event revision ${index + 1}/${plan.length} for ${section.key}`,
    })
    const world = applySectionAtTime(base, events, playhead, section.anchorMs)
    const groups = buildMinecraftGeometry(world, catalog, cache)
    revisions[revision] = groups.map((group) => {
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

async function loadCatalog(packId: string): Promise<MinecraftAssetCatalog> {
  progress({ phase: 'catalog', completed: 0, total: 1, revisions: 0, detail: `Loading Minecraft render catalog ${packId} inside mesh worker` })
  const response = await fetch(`/api/v1/replay-assets/${encodeURIComponent(packId)}/catalog`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  const body = await response.json().catch(() => null) as {
    data?: { catalog?: MinecraftAssetCatalog }
    message?: string
  } | null

  if (!response.ok) throw new Error(body?.message ?? `Minecraft render catalog request failed with HTTP ${response.status}.`)
  const catalog = body?.data?.catalog
  if (!catalog) throw new Error(`Minecraft render catalog ${packId} did not contain a catalog payload.`)
  progress({ phase: 'catalog', completed: 1, total: 1, revisions: 0, detail: `Minecraft render catalog ${packId} ready` })
  return catalog
}

async function build(message: BuildMessage) {
  try {
    const { sections, packId } = message
    const catalog = await loadCatalog(packId)
    const cache = createMinecraftGeometryCache(catalog)
    const eventsBySection = new Map(message.eventsBySection)
    const staticGeometryGroups = new Map<string, StaticAccumulator>()
    const staticChunks = new Map<string, VoxelWorld>()
    const dynamicInputs: DynamicInput[] = []
    const dynamicSections: SerializedDynamicReplaySection[] = []
    let staticSectionCount = 0

    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]
      progress({
        phase: 'decoding',
        completed: index,
        total: sections.length,
        revisions: 0,
        detail: `Expanding recorded section ${index + 1}/${sections.length}`,
      })
      // New recordings already carry exact BlockData. Legacy recordings can only
      // tell us the Material name; normalize those events to one deterministic,
      // valid resource-pack variant for rendering without modifying evidence.
      const events = normalizeLegacyReplayEvents(eventsBySection.get(section.key) ?? [], catalog)
      const base = decodeSectionBlocks(section)
      if (events.length === 0) {
        const key = chunkKey(section)
        const chunk = staticChunks.get(key) ?? new Map<string, string>()
        mergeWorld(chunk, base)
        staticChunks.set(key, chunk)
        staticSectionCount++
      } else {
        dynamicInputs.push({ section, base, events })
      }
    }
    progress({ phase: 'decoding', completed: sections.length, total: sections.length, revisions: 0, detail: `${sections.length} recorded sections expanded` })

    const totalRevisions = dynamicInputs.reduce((sum, input) => sum + revisionPlan(input.events, input.section.anchorMs).length, 0)
    let revisionCount = 0
    for (const input of dynamicInputs) {
      const dynamic = buildDynamicSection(input, catalog, cache, revisionCount, totalRevisions)
      revisionCount += Object.keys(dynamic.revisions).length
      dynamicSections.push(dynamic)
      progress({
        phase: 'dynamic',
        completed: revisionCount,
        total: totalRevisions,
        revisions: revisionCount,
        detail: `${revisionCount}/${totalRevisions} block-event revisions prepared`,
      })
    }

    const staticEntries = [...staticChunks.entries()]
    for (let index = 0; index < staticEntries.length; index++) {
      const [key, world] = staticEntries[index]
      progress({
        phase: 'meshing',
        completed: index,
        total: staticEntries.length,
        revisions: revisionCount,
        detail: `Meshing recorded chunk ${index + 1}/${staticEntries.length} · ${key}`,
      })
      appendStatic(staticGeometryGroups, buildMinecraftGeometry(world, catalog, cache))
    }
    progress({
      phase: 'meshing',
      completed: staticEntries.length,
      total: staticEntries.length,
      revisions: revisionCount,
      detail: `${staticEntries.length} static chunks meshed`,
    })

    progress({
      phase: 'combining',
      completed: 0,
      total: staticGeometryGroups.size,
      revisions: revisionCount,
      detail: `Combining ${staticGeometryGroups.size} texture/render groups`,
    })

    const staticGroups: SerializedReplayGeometry[] = []
    let combined = 0
    for (const accumulator of staticGeometryGroups.values()) {
      staticGroups.push(finalizeStatic(accumulator))
      combined++
      if (combined % 8 === 0 || combined === staticGeometryGroups.size) {
        progress({
          phase: 'combining',
          completed: combined,
          total: staticGeometryGroups.size,
          revisions: revisionCount,
          detail: `Combining static geometry ${combined}/${staticGeometryGroups.size}`,
        })
      }
    }

    const result: SerializedReplayMeshWorld = {
      staticGroups,
      dynamicSections,
      sectionCount: sections.length,
      staticSectionCount,
      dynamicSectionCount: dynamicInputs.length,
      revisionCount,
    }

    scope.postMessage({ type: 'result', result }, transferList(result))
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

scope.onmessage = (event) => {
  if (event.data.type !== 'build') return
  void build(event.data)
}

scope.postMessage({ type: 'ready' })
