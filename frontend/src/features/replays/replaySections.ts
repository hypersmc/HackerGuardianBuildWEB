import type { ReplayEvent, WorldChunkData } from './types'
import {
  blockKey,
  isAir,
  normalizeState,
  type TimedReplayEvent,
  type VoxelWorld,
} from './voxel'

/**
 * Lightweight section descriptor retained on the browser main thread. The RLE
 * payload is deliberately not expanded into hundreds of thousands of Map entries
 * until it reaches the replay mesh worker.
 */
export type ReplayWorldSection = {
  key: string
  world: string
  chunkX: number
  chunkZ: number
  baseY: number
  height: number
  anchorMs: number
  palette: string[]
  runs: Array<[number, number]>
}

export function worldSectionKey(world: string, chunkX: number, baseY: number, chunkZ: number) {
  return `${world}:${chunkX},${baseY},${chunkZ}`
}

/**
 * Index the replay's stored sections without expanding the RLE voxel payload.
 * Expansion/model resolution is CPU-heavy and belongs in replayMesh.worker.ts.
 */
export function decodeReplayWorldSections(chunks: WorldChunkData[]): ReplayWorldSection[] {
  const result: ReplayWorldSection[] = []
  for (const chunk of chunks) {
    for (const section of chunk.sections) {
      result.push({
        key: worldSectionKey(chunk.world, chunk.chunk_x, section.base_y, chunk.chunk_z),
        world: chunk.world,
        chunkX: chunk.chunk_x,
        chunkZ: chunk.chunk_z,
        baseY: section.base_y,
        height: section.height,
        anchorMs: Math.max(0, chunk.anchor_ms ?? 0),
        palette: section.palette,
        runs: section.runs,
      })
    }
  }
  return result
}

export function decodeSectionBlocks(section: ReplayWorldSection): VoxelWorld {
  const blocks: VoxelWorld = new Map()
  let linear = 0

  for (const [paletteIndex, count] of section.runs) {
    const rawState = section.palette[paletteIndex]
    if (rawState === undefined) {
      linear += count
      continue
    }

    const state = normalizeState(rawState)
    for (let i = 0; i < count; i++, linear++) {
      if (isAir(state)) continue
      const localY = Math.floor(linear / 256)
      const remainder = linear % 256
      const localX = Math.floor(remainder / 16)
      const localZ = remainder % 16
      blocks.set(
        blockKey(
          section.chunkX * 16 + localX,
          section.baseY + localY,
          section.chunkZ * 16 + localZ,
        ),
        state,
      )
    }
  }

  return blocks
}

export function indexBlockEventsBySection(events: TimedReplayEvent[], defaultWorld: string): Map<string, TimedReplayEvent[]> {
  const result = new Map<string, TimedReplayEvent[]>()

  for (const event of events) {
    if (!isBlockEvent(event) || !event.position) continue
    const world = typeof event.world === 'string' && event.world ? event.world : defaultWorld
    const chunkX = Math.floor(event.position.x / 16)
    const chunkZ = Math.floor(event.position.z / 16)
    const baseY = Math.floor(event.position.y / 16) * 16
    const key = worldSectionKey(world, chunkX, baseY, chunkZ)
    const list = result.get(key) ?? []
    list.push(event)
    result.set(key, list)
  }

  for (const list of result.values()) list.sort((a, b) => a.t - b.t)
  return result
}

export function sectionWorldRevision(events: TimedReplayEvent[], playhead: number, anchor: number) {
  let count = 0
  if (playhead >= anchor) {
    for (const event of events) {
      if (event.t > anchor && event.t <= playhead) count++
    }
    return count === 0 ? 'base' : `forward:${count}`
  }

  for (const event of events) {
    if (event.t > playhead && event.t <= anchor) count++
  }
  return count === 0 ? 'base' : `reverse:${count}`
}

export function applySectionAtTime(base: VoxelWorld, events: TimedReplayEvent[], playhead: number, anchor: number): VoxelWorld {
  if (events.length === 0) return base
  const world = new Map(base)

  if (playhead >= anchor) {
    for (const event of events) {
      if (event.t > anchor && event.t <= playhead) applyForward(world, event)
    }
  } else {
    for (const event of events) {
      if (event.t > playhead && event.t <= anchor) applyReverse(world, event)
    }
  }
  return world
}

export function collectRecordedBlockStates(chunks: WorldChunkData[]) {
  const states = new Set<string>()
  for (const chunk of chunks) {
    for (const section of chunk.sections) {
      for (const state of section.palette) {
        if (!isAir(state)) states.add(normalizeState(state))
      }
    }
  }
  return states
}

export function countRecordedBlocks(chunks: WorldChunkData[]) {
  let count = 0
  for (const chunk of chunks) {
    for (const section of chunk.sections) {
      for (const [paletteIndex, runLength] of section.runs) {
        const state = section.palette[paletteIndex]
        if (state !== undefined && !isAir(state)) count += runLength
      }
    }
  }
  return count
}

function applyForward(world: VoxelWorld, event: TimedReplayEvent) {
  if (!event.position) return
  const key = blockKey(event.position.x, event.position.y, event.position.z)
  if (event.type === 'BLOCK_BREAK') world.delete(key)
  if (event.type === 'BLOCK_PLACE' && typeof event.block === 'string') world.set(key, normalizeState(event.block))
}

function applyReverse(world: VoxelWorld, event: TimedReplayEvent) {
  if (!event.position) return
  const key = blockKey(event.position.x, event.position.y, event.position.z)
  if (event.type === 'BLOCK_BREAK' && typeof event.block === 'string') world.set(key, normalizeState(event.block))
  if (event.type === 'BLOCK_PLACE') {
    if (typeof event.previous_block === 'string' && !isAir(event.previous_block)) world.set(key, normalizeState(event.previous_block))
    else world.delete(key)
  }
}

function isBlockEvent(event: ReplayEvent): event is ReplayEvent & { position: { x: number; y: number; z: number } } {
  return (event.type === 'BLOCK_BREAK' || event.type === 'BLOCK_PLACE') && event.position !== undefined
}
