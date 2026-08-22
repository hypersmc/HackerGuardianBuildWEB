import {
  LinearMipmapLinearFilter,
  NearestFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import type {
  MinecraftAssetCatalog,
  MinecraftBlockstate,
  MinecraftModel,
  MinecraftModelApply,
  MinecraftModelElement,
} from './minecraftAssets'
import { minecraftAssetApi } from './minecraftAssets'
import { resolveLegacyRenderState } from './legacyBlockState'
import { isAir, normalizeState } from './voxel'

type BlockState = {
  id: string
  properties: Record<string, string>
}

type ResolvedModel = MinecraftModel & {
  textures: Record<string, string>
  elements: MinecraftModelElement[]
}

function normalizeResource(resource: string) {
  const value = resource.toLowerCase()
  return value.includes(':') ? value : `minecraft:${value}`
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
    return String(expected)
      .split('|')
      .some((choice) => choice.startsWith('!') ? actual !== choice.slice(1) : actual === choice)
  })
}

function asApplies(value: MinecraftModelApply | MinecraftModelApply[]) {
  return Array.isArray(value) ? value : [value]
}

/**
 * Return every model that can be selected for this state, including all weighted
 * alternatives. Runtime rendering picks one weighted model per block position, but
 * preload must fetch every possible asset so playback can never trigger a late load.
 */
function applicableModels(definition: MinecraftBlockstate, properties: Record<string, string>) {
  const applies: MinecraftModelApply[] = []

  if (definition.variants) {
    const entries = Object.entries(definition.variants).sort(([a], [b]) => b.length - a.length)
    for (const [condition, value] of entries) {
      if (!variantMatches(condition, properties)) continue
      applies.push(...asApplies(value))
      break
    }
  }

  for (const part of definition.multipart ?? []) {
    if (part.when !== undefined && !whenMatches(part.when, properties)) continue
    applies.push(...asApplies(part.apply))
  }

  return applies
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

/**
 * Find every texture that can be used by the block states present anywhere in a
 * replay. Callers include both complete world keyframes and recorded block-event
 * states. This is the finite preload set for one replay, not the whole game pack.
 */
export function collectReplayTextureAssets(states: Iterable<string>, catalog: MinecraftAssetCatalog) {
  const availableTextures = new Set(catalog.textures ?? [])
  const required = new Set<string>()
  const modelCache = new Map<string, ResolvedModel | null>()

  for (const raw of states) {
    // Legacy block events can contain only `GRASS_BLOCK`/`OAK_STAIRS`, which is
    // insufficient to match modern blockstate variants. Resolve a deterministic
    // render-only variant before deciding which textures must be preloaded.
    const state = parseBlockState(resolveLegacyRenderState(raw, catalog))
    if (isAir(state.id)) continue
    const definition = catalog.blockstates[state.id]
    if (!definition) continue

    for (const apply of applicableModels(definition, state.properties)) {
      const model = resolveModel(catalog, normalizeResource(apply.model), modelCache, new Set())
      if (!model) continue
      for (const element of model.elements) {
        for (const face of Object.values(element.faces)) {
          if (!face) continue
          const texture = resolveTexture(face.texture, model.textures)
          if (texture && availableTextures.has(texture)) required.add(texture)
        }
      }
    }
  }

  return [...required].sort()
}

export type ReplayTextureProgress = {
  loaded: number
  total: number
}

/** Decode every required image before the replay is unlocked. */
export async function loadReplayTextures(
  packId: string,
  assets: string[],
  onProgress?: (progress: ReplayTextureProgress) => void,
  concurrency = 8,
): Promise<Map<string, Texture>> {
  const unique = [...new Set(assets)]
  const textures = new Map<string, Texture>()
  onProgress?.({ loaded: 0, total: unique.length })
  if (unique.length === 0) return textures

  const loader = new TextureLoader()
  let cursor = 0
  let loaded = 0

  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= unique.length) return
      const asset = unique[index]
      const texture = await loader.loadAsync(minecraftAssetApi.textureUrl(packId, asset))
      texture.colorSpace = SRGBColorSpace
      texture.magFilter = NearestFilter
      texture.minFilter = LinearMipmapLinearFilter
      texture.generateMipmaps = true
      texture.needsUpdate = true
      textures.set(asset, texture)
      loaded++
      onProgress?.({ loaded, total: unique.length })
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), unique.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return textures
}
