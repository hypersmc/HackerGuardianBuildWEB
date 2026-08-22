import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MathUtils,
  Vector3,
} from 'three'
import type {
  Direction,
  MinecraftAssetCatalog,
  MinecraftBlockstate,
  MinecraftModel,
  MinecraftModelApply,
  MinecraftModelElement,
  MinecraftModelFace,
} from './minecraftAssets'
import { blockId, blockKey, isAir, isTransparent, normalizeState, type VoxelWorld } from './voxel'

export type MinecraftRenderLayer = 'opaque' | 'cutout' | 'translucent'
export type MinecraftGeometryGroup = {
  key: string
  texture: string | null
  layer: MinecraftRenderLayer
  geometry: BufferGeometry
}

type Buffers = {
  positions: number[]
  normals: number[]
  uvs: number[]
  colors: number[]
}

type ResolvedModel = MinecraftModel & {
  textures: Record<string, string>
  elements: MinecraftModelElement[]
}

type BlockState = {
  id: string
  properties: Record<string, string>
}

export type MinecraftGeometryCache = {
  textureSet: Set<string>
  modelCache: Map<string, ResolvedModel | null>
  stateCache: Map<string, BlockState>
}

const DIRECTIONS: Record<Direction, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
}

const TRIANGLES = [0, 1, 2, 0, 2, 3] as const

export function createMinecraftGeometryCache(catalog: MinecraftAssetCatalog): MinecraftGeometryCache {
  return {
    textureSet: new Set(catalog.textures ?? []),
    modelCache: new Map<string, ResolvedModel | null>(),
    stateCache: new Map<string, BlockState>(),
  }
}

export function buildMinecraftGeometry(
  world: VoxelWorld,
  catalog: MinecraftAssetCatalog,
  cache: MinecraftGeometryCache = createMinecraftGeometryCache(catalog),
): MinecraftGeometryGroup[] {
  const groups = new Map<string, { texture: string | null; layer: MinecraftRenderLayer; buffers: Buffers }>()

  for (const [key, rawState] of world) {
    const [x, y, z] = key.split(',').map(Number)
    if (![x, y, z].every(Number.isFinite)) continue
    let state = cache.stateCache.get(rawState)
    if (!state) {
      state = parseBlockState(rawState)
      cache.stateCache.set(rawState, state)
    }
    if (isAir(state.id)) continue

    const definition = catalog.blockstates[state.id]
    const applies = definition ? selectApplies(definition, state.properties, x, y, z) : []
    if (applies.length === 0) {
      appendFallbackCube(groups, world, state.id, x, y, z)
      continue
    }

    let rendered = false
    for (const apply of applies) {
      const modelId = normalizeResource(apply.model)
      const model = resolveModel(catalog, modelId, cache.modelCache, new Set())
      if (!model || model.elements.length === 0) continue
      appendModel(groups, world, cache.textureSet, state, x, y, z, model, apply)
      rendered = true
    }

    if (!rendered) appendFallbackCube(groups, world, state.id, x, y, z)
  }

  const result: MinecraftGeometryGroup[] = []
  for (const [key, group] of groups) {
    if (group.buffers.positions.length === 0) continue
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(group.buffers.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(group.buffers.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(group.buffers.uvs, 2))
    geometry.setAttribute('color', new Float32BufferAttribute(group.buffers.colors, 3))
    geometry.computeBoundingSphere()
    result.push({ key, texture: group.texture, layer: group.layer, geometry })
  }

  return result
}

function appendModel(
  groups: Map<string, { texture: string | null; layer: MinecraftRenderLayer; buffers: Buffers }>,
  world: VoxelWorld,
  textureSet: Set<string>,
  state: BlockState,
  x: number,
  y: number,
  z: number,
  model: ResolvedModel,
  apply: MinecraftModelApply,
) {
  for (const element of model.elements) {
    for (const [direction, face] of Object.entries(element.faces) as Array<[Direction, MinecraftModelFace | undefined]>) {
      if (!face) continue

      if (face.cullface) {
        const cullDirection = rotateDirection(face.cullface, apply)
        const delta = DIRECTIONS[cullDirection]
        const neighbor = world.get(blockKey(x + delta[0], y + delta[1], z + delta[2]))
        if (neighbor && isOccluding(neighbor)) continue
      }

      const texture = resolveTexture(face.texture, model.textures)
      const existingTexture = texture && textureSet.has(texture) ? texture : null
      const layer = renderLayer(state.id, texture)
      const group = groupFor(groups, existingTexture, layer)
      const corners = faceCorners(element, direction)
      const normal = new Vector3(...DIRECTIONS[direction])

      for (const corner of corners) applyElementRotation(corner, element)
      for (const corner of corners) applyBlockstateRotation(corner, apply)
      applyBlockstateRotation(normal, apply, true)
      normal.normalize()

      const uv = faceUv(element, direction, face)
      const tint = face.tintindex === undefined ? new Color(1, 1, 1) : tintColor(state.id, face.tintindex)
      const shade = faceShade(normal)
      tint.multiplyScalar(shade)

      for (const index of TRIANGLES) {
        const corner = corners[index]
        group.positions.push(x + corner.x, y + corner.y, z + corner.z)
        group.normals.push(normal.x, normal.y, normal.z)
        group.uvs.push(uv[index][0], uv[index][1])
        group.colors.push(tint.r, tint.g, tint.b)
      }
    }
  }
}

function resolveModel(
  catalog: MinecraftAssetCatalog,
  id: string,
  cache: Map<string, ResolvedModel | null>,
  visiting: Set<string>,
): ResolvedModel | null {
  if (cache.has(id)) return cache.get(id) ?? null
  if (visiting.has(id)) return null
  visiting.add(id)

  const own = catalog.models[id]
  if (!own) {
    cache.set(id, null)
    visiting.delete(id)
    return null
  }

  let parent: ResolvedModel | null = null
  if (own.parent && !own.parent.startsWith('builtin/')) {
    parent = resolveModel(catalog, normalizeResource(own.parent), cache, visiting)
  }

  const resolved: ResolvedModel = {
    ...parent,
    ...own,
    textures: { ...(parent?.textures ?? {}), ...(own.textures ?? {}) },
    elements: own.elements ?? parent?.elements ?? [],
  }
  visiting.delete(id)
  cache.set(id, resolved)
  return resolved
}

function selectApplies(definition: MinecraftBlockstate, properties: Record<string, string>, x: number, y: number, z: number) {
  const selected: MinecraftModelApply[] = []

  if (definition.variants) {
    const entries = Object.entries(definition.variants).sort(([a], [b]) => b.length - a.length)
    for (const [condition, apply] of entries) {
      if (!variantMatches(condition, properties)) continue
      selected.push(weightedApply(apply, x, y, z, condition))
      break
    }
  }

  for (const part of definition.multipart ?? []) {
    if (part.when !== undefined && !whenMatches(part.when, properties)) continue
    selected.push(weightedApply(part.apply, x, y, z, JSON.stringify(part.when ?? {})))
  }

  return selected
}

function variantMatches(condition: string, properties: Record<string, string>) {
  if (condition === '') return true
  for (const token of condition.split(',')) {
    const [key, value] = token.split('=', 2)
    if (!key || value === undefined || properties[key] !== value) return false
  }
  return true
}

function whenMatches(when: unknown, properties: Record<string, string>): boolean {
  if (!when || typeof when !== 'object' || Array.isArray(when)) return true
  const object = when as Record<string, unknown>
  if (Array.isArray(object.OR)) return object.OR.some((entry) => whenMatches(entry, properties))
  if (Array.isArray(object.AND)) return object.AND.every((entry) => whenMatches(entry, properties))

  return Object.entries(object).every(([key, expected]) => {
    if (key === 'OR' || key === 'AND') return true
    const actual = properties[key]
    const choices = String(expected).split('|')
    return choices.some((choice) => choice.startsWith('!') ? actual !== choice.slice(1) : actual === choice)
  })
}

function weightedApply(value: MinecraftModelApply | MinecraftModelApply[], x: number, y: number, z: number, salt: string): MinecraftModelApply {
  if (!Array.isArray(value)) return value
  if (value.length === 1) return value[0]
  const total = value.reduce((sum, entry) => sum + Math.max(1, entry.weight ?? 1), 0)
  let target = positiveHash(`${x},${y},${z}:${salt}`) % total
  for (const entry of value) {
    target -= Math.max(1, entry.weight ?? 1)
    if (target < 0) return entry
  }
  return value[0]
}

function parseBlockState(raw: string): BlockState {
  const normalized = normalizeState(raw)
  const open = normalized.indexOf('[')
  if (open < 0 || !normalized.endsWith(']')) return { id: normalized, properties: {} }
  const properties: Record<string, string> = {}
  for (const token of normalized.slice(open + 1, -1).split(',')) {
    const [key, value] = token.split('=', 2)
    if (key && value !== undefined) properties[key] = value
  }
  return { id: normalized.slice(0, open), properties }
}

function faceCorners(element: MinecraftModelElement, direction: Direction): [Vector3, Vector3, Vector3, Vector3] {
  const x0 = element.from[0] / 16
  const y0 = element.from[1] / 16
  const z0 = element.from[2] / 16
  const x1 = element.to[0] / 16
  const y1 = element.to[1] / 16
  const z1 = element.to[2] / 16

  switch (direction) {
    case 'east': return [new Vector3(x1,y0,z0), new Vector3(x1,y1,z0), new Vector3(x1,y1,z1), new Vector3(x1,y0,z1)]
    case 'west': return [new Vector3(x0,y0,z1), new Vector3(x0,y1,z1), new Vector3(x0,y1,z0), new Vector3(x0,y0,z0)]
    case 'up': return [new Vector3(x0,y1,z1), new Vector3(x1,y1,z1), new Vector3(x1,y1,z0), new Vector3(x0,y1,z0)]
    case 'down': return [new Vector3(x0,y0,z0), new Vector3(x1,y0,z0), new Vector3(x1,y0,z1), new Vector3(x0,y0,z1)]
    case 'south': return [new Vector3(x1,y0,z1), new Vector3(x1,y1,z1), new Vector3(x0,y1,z1), new Vector3(x0,y0,z1)]
    case 'north': return [new Vector3(x0,y0,z0), new Vector3(x0,y1,z0), new Vector3(x1,y1,z0), new Vector3(x1,y0,z0)]
  }
}

function faceUv(element: MinecraftModelElement, direction: Direction, face: MinecraftModelFace): [[number, number], [number, number], [number, number], [number, number]] {
  const raw = face.uv ?? defaultUv(element, direction)
  const base: [[number, number], [number, number], [number, number], [number, number]] = [
    [raw[0] / 16, 1 - raw[3] / 16],
    [raw[0] / 16, 1 - raw[1] / 16],
    [raw[2] / 16, 1 - raw[1] / 16],
    [raw[2] / 16, 1 - raw[3] / 16],
  ]
  const steps = ((face.rotation ?? 0) / 90) % 4
  for (let i = 0; i < steps; i++) {
    const last = base.pop() as [number, number]
    base.unshift(last)
  }
  return base
}

function defaultUv(element: MinecraftModelElement, direction: Direction): [number, number, number, number] {
  const [fx, fy, fz] = element.from
  const [tx, ty, tz] = element.to
  switch (direction) {
    case 'up': return [fx, fz, tx, tz]
    case 'down': return [fx, 16 - tz, tx, 16 - fz]
    case 'north': return [16 - tx, 16 - ty, 16 - fx, 16 - fy]
    case 'south': return [fx, 16 - ty, tx, 16 - fy]
    case 'west': return [fz, 16 - ty, tz, 16 - fy]
    case 'east': return [16 - tz, 16 - ty, 16 - fz, 16 - fy]
  }
}

function applyElementRotation(point: Vector3, element: MinecraftModelElement) {
  const rotation = element.rotation
  if (!rotation || rotation.angle === 0) return point
  const origin = new Vector3(rotation.origin[0] / 16, rotation.origin[1] / 16, rotation.origin[2] / 16)
  const axis = rotation.axis === 'x' ? new Vector3(1, 0, 0) : rotation.axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  point.sub(origin).applyAxisAngle(axis, MathUtils.degToRad(-rotation.angle)).add(origin)
  return point
}

function applyBlockstateRotation(point: Vector3, apply: MinecraftModelApply, directionOnly = false) {
  const center = directionOnly ? new Vector3(0, 0, 0) : new Vector3(0.5, 0.5, 0.5)
  point.sub(center)
  if (apply.x) point.applyAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(-apply.x))
  if (apply.y) point.applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(-apply.y))
  point.add(center)
  return point
}

function rotateDirection(direction: Direction, apply: MinecraftModelApply): Direction {
  const vector = new Vector3(...DIRECTIONS[direction])
  applyBlockstateRotation(vector, apply, true)
  const candidates = Object.entries(DIRECTIONS) as Array<[Direction, [number, number, number]]>
  let best: Direction = direction
  let dot = -Infinity
  for (const [name, raw] of candidates) {
    const score = vector.dot(new Vector3(...raw))
    if (score > dot) {
      dot = score
      best = name
    }
  }
  return best
}

function resolveTexture(reference: string, textures: Record<string, string>): string | null {
  let current = reference
  const seen = new Set<string>()
  while (current.startsWith('#')) {
    const key = current.slice(1)
    if (seen.has(key)) return null
    seen.add(key)
    current = textures[key]
    if (!current) return null
  }
  return normalizeResource(current)
}

function normalizeResource(resource: string) {
  const value = resource.toLowerCase()
  return value.includes(':') ? value : `minecraft:${value}`
}

function renderLayer(block: string, texture: string | null): MinecraftRenderLayer {
  const id = blockId(block)
  const value = `${id} ${texture ?? ''}`
  if (value.includes('water') || value.includes('glass') || value.includes('ice') || value.includes('slime_block')
      || value.includes('honey_block') || value.includes('portal')) return 'translucent'
  if (value.includes('leaves') || value.includes('sapling') || value.includes('flower') || value.includes('grass')
      || value.includes('fern') || value.includes('vine') || value.includes('door') || value.includes('trapdoor')
      || value.includes('torch') || value.includes('rail') || value.includes('mushroom') || value.includes('crop')) return 'cutout'
  return 'opaque'
}

function tintColor(block: string, tintIndex: number) {
  const id = blockId(block)
  if (id.includes('water')) return new Color('#3f76e4')
  if (id.includes('spruce_leaves')) return new Color('#619961')
  if (id.includes('birch_leaves')) return new Color('#80a755')
  if (id.includes('leaves')) return new Color('#59ae30')
  if (id.includes('grass') || id.includes('fern') || id.includes('vine')) return new Color('#91bd59')
  return tintIndex >= 0 ? new Color('#91bd59') : new Color(1, 1, 1)
}

function faceShade(normal: Vector3) {
  if (normal.y > 0.5) return 1
  if (normal.y < -0.5) return 0.5
  if (Math.abs(normal.x) > 0.5) return 0.8
  return 0.6
}

function isOccluding(state: string) {
  const id = blockId(state)
  if (isTransparent(state)) return false
  return !(id.endsWith('_slab') || id.endsWith('_stairs') || id.endsWith('_fence') || id.endsWith('_wall')
    || id.endsWith('_door') || id.endsWith('_trapdoor') || id.endsWith('_carpet') || id.includes('torch')
    || id.includes('flower') || id.includes('sapling') || id.includes('grass') || id.includes('pane'))
}

function appendFallbackCube(
  groups: Map<string, { texture: string | null; layer: MinecraftRenderLayer; buffers: Buffers }>,
  world: VoxelWorld,
  block: string,
  x: number,
  y: number,
  z: number,
) {
  const group = groupFor(groups, null, isTransparent(block) ? 'translucent' : 'opaque')
  const color = fallbackColor(block)
  for (const [direction, delta] of Object.entries(DIRECTIONS) as Array<[Direction, [number, number, number]]>) {
    const neighbor = world.get(blockKey(x + delta[0], y + delta[1], z + delta[2]))
    if (neighbor && isOccluding(neighbor) && !isTransparent(block)) continue
    const element: MinecraftModelElement = { from: [0, 0, 0], to: [16, 16, 16], faces: {} }
    const corners = faceCorners(element, direction)
    const normal = new Vector3(...delta)
    const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0,0],[0,1],[1,1],[1,0]]
    for (const index of TRIANGLES) {
      const corner = corners[index]
      group.positions.push(x + corner.x, y + corner.y, z + corner.z)
      group.normals.push(normal.x, normal.y, normal.z)
      group.uvs.push(uv[index][0], uv[index][1])
      const shade = faceShade(normal)
      group.colors.push(color.r * shade, color.g * shade, color.b * shade)
    }
  }
}

function groupFor(
  groups: Map<string, { texture: string | null; layer: MinecraftRenderLayer; buffers: Buffers }>,
  texture: string | null,
  layer: MinecraftRenderLayer,
) {
  const key = `${layer}|${texture ?? '__fallback__'}`
  let group = groups.get(key)
  if (!group) {
    group = { texture, layer, buffers: { positions: [], normals: [], uvs: [], colors: [] } }
    groups.set(key, group)
  }
  return group.buffers
}

function fallbackColor(state: string) {
  const id = blockId(state)
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return new Color().setHSL((positiveHash(String(hash)) % 360) / 360, 0.25, 0.55)
}

function positiveHash(value: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
