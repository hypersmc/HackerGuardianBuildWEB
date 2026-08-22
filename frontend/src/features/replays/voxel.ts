import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import type { ReplayEvent, ReplayFrame, WorldChunkData } from './types'

export type TimedReplayEvent = ReplayEvent & { t: number }
export type VoxelWorld = Map<string, string>

export function blockKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`
}

export function expandWorldChunks(chunks: WorldChunkData[]): VoxelWorld {
  const world: VoxelWorld = new Map()

  for (const chunk of chunks) {
    for (const section of chunk.sections) {
      let linear = 0
      for (const [paletteIndex, count] of section.runs) {
        const blockState = section.palette[paletteIndex]
        if (blockState === undefined) {
          linear += count
          continue
        }

        for (let i = 0; i < count; i++, linear++) {
          const localY = Math.floor(linear / 256)
          const remainder = linear % 256
          const x = Math.floor(remainder / 16)
          const z = remainder % 16
          const y = section.base_y + localY
          if (!isAir(blockState)) {
            world.set(blockKey(chunk.chunk_x * 16 + x, y, chunk.chunk_z * 16 + z), blockState)
          }
        }
      }
    }
  }

  return world
}

export function flattenEvents(frames: ReplayFrame[]): TimedReplayEvent[] {
  const events: TimedReplayEvent[] = []
  for (const frame of frames) {
    for (const event of frame.events) events.push({ ...event, t: frame.t })
  }
  return events.sort((a, b) => a.t - b.t)
}

export function worldEventRevision(events: TimedReplayEvent[], playhead: number, anchor: number) {
  let revision = 0
  for (const event of events) {
    if (!isBlockEvent(event)) continue
    if (playhead >= anchor) {
      if (event.t > anchor && event.t <= playhead) revision++
    } else if (event.t > playhead && event.t <= anchor) {
      revision++
    }
  }
  return `${playhead >= anchor ? 'f' : 'r'}:${revision}`
}

export function applyWorldAtTime(base: VoxelWorld, events: TimedReplayEvent[], playhead: number, anchor: number): VoxelWorld {
  const world = new Map(base)
  if (playhead >= anchor) {
    for (const event of events) {
      if (event.t <= anchor) continue
      if (event.t > playhead) break
      applyForward(world, event)
    }
  } else {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.t > anchor) continue
      if (event.t <= playhead) break
      applyReverse(world, event)
    }
  }
  return world
}

function applyForward(world: VoxelWorld, event: TimedReplayEvent) {
  if (!isBlockEvent(event) || !event.position) return
  const key = blockKey(event.position.x, event.position.y, event.position.z)
  if (event.type === 'BLOCK_BREAK') world.delete(key)
  if (event.type === 'BLOCK_PLACE' && typeof event.block === 'string') world.set(key, normalizeState(event.block))
}

function applyReverse(world: VoxelWorld, event: TimedReplayEvent) {
  if (!isBlockEvent(event) || !event.position) return
  const key = blockKey(event.position.x, event.position.y, event.position.z)
  if (event.type === 'BLOCK_BREAK' && typeof event.block === 'string') world.set(key, normalizeState(event.block))
  if (event.type === 'BLOCK_PLACE') world.delete(key)
}

function isBlockEvent(event: ReplayEvent): event is ReplayEvent & { position: { x: number; y: number; z: number } } {
  return (event.type === 'BLOCK_BREAK' || event.type === 'BLOCK_PLACE') && event.position !== undefined
}

export function normalizeState(state: string) {
  if (state.includes(':')) return state.toLowerCase()
  return `minecraft:${state.toLowerCase()}`
}

export function isAir(state: string | undefined) {
  if (!state) return true
  const id = blockId(state)
  return id === 'minecraft:air' || id === 'minecraft:cave_air' || id === 'minecraft:void_air'
}

export function blockId(state: string) {
  const normalized = normalizeState(state)
  const bracket = normalized.indexOf('[')
  return bracket >= 0 ? normalized.slice(0, bracket) : normalized
}

function stateProperty(state: string, property: string) {
  const match = state.match(new RegExp(`(?:\\[|,)${property}=([^,\\]]+)`))
  return match?.[1] ?? null
}

function boundsFor(state: string): [number, number] {
  const id = blockId(state)
  if (id.endsWith('_carpet') || id === 'minecraft:moss_carpet') return [0, 1 / 16]
  if (id === 'minecraft:snow') {
    const layers = Math.min(8, Math.max(1, Number(stateProperty(state, 'layers') ?? 1)))
    return [0, layers / 8]
  }
  if (id.endsWith('_slab')) {
    const type = stateProperty(state, 'type')
    if (type === 'top') return [0.5, 1]
    if (type === 'double') return [0, 1]
    return [0, 0.5]
  }
  if (id.includes('pressure_plate')) return [0, 1 / 16]
  if (id.endsWith('_trapdoor')) return [0, 3 / 16]
  return [0, 1]
}

function isFullOpaque(state: string) {
  const id = blockId(state)
  if (isTransparent(state)) return false
  if (id.endsWith('_slab') || id.endsWith('_stairs') || id.endsWith('_fence') || id.endsWith('_wall')) return false
  if (id.endsWith('_carpet') || id.endsWith('_door') || id.endsWith('_trapdoor')) return false
  if (id.includes('torch') || id.includes('flower') || id.includes('sapling') || id.includes('grass')) return false
  return boundsFor(state)[0] === 0 && boundsFor(state)[1] === 1
}

export function isTransparent(state: string) {
  const id = blockId(state)
  return id.includes('glass') || id.includes('water') || id.includes('ice') || id.includes('leaves') || id.includes('portal')
}

function blockColor(state: string) {
  const id = blockId(state)
  const color = new Color()
  if (id.includes('grass_block') || id.includes('moss')) return color.set('#668a47')
  if (id.includes('leaves')) return color.set('#52783d')
  if (id.includes('dirt') || id.includes('mud')) return color.set('#795844')
  if (id.includes('stone') || id.includes('andesite')) return color.set('#777b7d')
  if (id.includes('deepslate') || id.includes('blackstone')) return color.set('#3c4146')
  if (id.includes('cobblestone')) return color.set('#62686a')
  if (id.includes('sandstone')) return color.set('#c7b77c')
  if (id.includes('sand')) return color.set('#d6c77e')
  if (id.includes('gravel')) return color.set('#77706b')
  if (id.includes('oak') || id.includes('planks')) return color.set('#a27a49')
  if (id.includes('spruce')) return color.set('#6f4d2c')
  if (id.includes('birch')) return color.set('#c5b77b')
  if (id.includes('log') || id.includes('wood')) return color.set('#77583a')
  if (id.includes('diamond')) return color.set('#55d9cf')
  if (id.includes('emerald')) return color.set('#38b86d')
  if (id.includes('redstone')) return color.set('#a82b2b')
  if (id.includes('lapis')) return color.set('#325ba8')
  if (id.includes('gold')) return color.set('#d7b33f')
  if (id.includes('iron')) return color.set('#b3aaa0')
  if (id.includes('coal')) return color.set('#34383a')
  if (id.includes('obsidian')) return color.set('#2d243c')
  if (id.includes('bedrock')) return color.set('#373b3d')
  if (id.includes('brick')) return color.set('#944f42')
  if (id.includes('water')) return color.set('#2d6fb0')
  if (id.includes('lava')) return color.set('#e66b24')
  if (id.includes('snow') || id.includes('quartz')) return color.set('#e5e8e4')
  if (id.includes('glass')) return color.set('#9bc3c8')

  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return color.setHSL(((hash >>> 0) % 360) / 360, 0.22, 0.46)
}

type MeshBuffers = { positions: number[]; normals: number[]; colors: number[] }

const faces = [
  { dir: [1, 0, 0], normal: [1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir: [0, 1, 0], normal: [0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
  { dir: [0, -1, 0], normal: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { dir: [0, 0, 1], normal: [0, 0, 1], corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { dir: [0, 0, -1], normal: [0, 0, -1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
] as const

export function buildWorldGeometry(world: VoxelWorld, transparent: boolean) {
  const buffers: MeshBuffers = { positions: [], normals: [], colors: [] }
  const triangleOrder = [0, 1, 2, 0, 2, 3]

  for (const [key, state] of world) {
    if (isTransparent(state) !== transparent) continue
    const [x, y, z] = key.split(',').map(Number)
    const [minY, maxY] = boundsFor(state)
    const color = blockColor(state)

    for (const face of faces) {
      const neighbor = world.get(blockKey(x + face.dir[0], y + face.dir[1], z + face.dir[2]))
      if (neighbor && isFullOpaque(neighbor) && !transparent) continue
      if (neighbor && isTransparent(neighbor) && transparent && blockId(neighbor) === blockId(state)) continue

      for (const cornerIndex of triangleOrder) {
        const corner = face.corners[cornerIndex]
        const cy = corner[1] === 0 ? minY : maxY
        buffers.positions.push(x + corner[0], y + cy, z + corner[2])
        buffers.normals.push(face.normal[0], face.normal[1], face.normal[2])
        const shade = face.normal[1] > 0 ? 1 : face.normal[1] < 0 ? 0.62 : face.normal[0] !== 0 ? 0.82 : 0.72
        buffers.colors.push(color.r * shade, color.g * shade, color.b * shade)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(buffers.normals, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(buffers.colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}
