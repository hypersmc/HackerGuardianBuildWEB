import { api } from '../../api/client'
import type { HgEnvelope } from './types'

export type MinecraftModelFace = {
  uv?: [number, number, number, number]
  texture: string
  cullface?: Direction
  rotation?: 0 | 90 | 180 | 270
  tintindex?: number
}

export type Direction = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

export type MinecraftModelElement = {
  from: [number, number, number]
  to: [number, number, number]
  rotation?: {
    origin: [number, number, number]
    axis: 'x' | 'y' | 'z'
    angle: number
    rescale?: boolean
  }
  shade?: boolean
  faces: Partial<Record<Direction, MinecraftModelFace>>
}

export type MinecraftModel = {
  parent?: string
  ambientocclusion?: boolean
  textures?: Record<string, string>
  elements?: MinecraftModelElement[]
}

export type MinecraftModelApply = {
  model: string
  x?: number
  y?: number
  uvlock?: boolean
  weight?: number
}

export type MinecraftBlockstate = {
  variants?: Record<string, MinecraftModelApply | MinecraftModelApply[]>
  multipart?: Array<{
    when?: Record<string, unknown>
    apply: MinecraftModelApply | MinecraftModelApply[]
  }>
}

export type MinecraftAssetCatalog = {
  format: 'hg-minecraft-assets-v1'
  blockstates: Record<string, MinecraftBlockstate>
  models: Record<string, MinecraftModel>
  textures: string[]
  texture_meta: Record<string, unknown>
}

export type MinecraftAssetManifest = {
  id: string
  version: string
  imported_at: string
  file_count: number
  blockstate_count: number
  model_count: number
  texture_count: number
}

export type MinecraftAssetPack = {
  manifest: MinecraftAssetManifest
  catalog: MinecraftAssetCatalog
}

async function localData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const envelope = await api<HgEnvelope<T>>(path, { signal })
  return envelope.data
}

export const minecraftAssetApi = {
  list(signal?: AbortSignal) {
    return localData<{ packs: MinecraftAssetManifest[] }>('/api/v1/replay-assets', signal)
  },

  catalog(packId: string, signal?: AbortSignal) {
    return localData<MinecraftAssetPack>(`/api/v1/replay-assets/${encodeURIComponent(packId)}/catalog`, signal)
  },

  textureUrl(packId: string, asset: string) {
    const query = new URLSearchParams({ asset })
    return `/api/v1/replay-assets/${encodeURIComponent(packId)}/texture?${query.toString()}`
  },
}
