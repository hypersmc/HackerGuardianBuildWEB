import { api } from '../../api/client'
import type {
  HgEnvelope,
  ReplayChunkData,
  ReplayList,
  ReplayManifest,
  WorldChunkData,
  WorldSnapshotManifest,
} from './types'

async function hgData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const envelope = await api<HgEnvelope<T>>(path, { signal })
  return envelope.data
}

export const replayApi = {
  list(params = new URLSearchParams({ page: '1', per_page: '30' }), signal?: AbortSignal) {
    return hgData<ReplayList>(`/api/v1/replays?${params.toString()}`, signal)
  },

  manifest(replayId: number, signal?: AbortSignal) {
    return hgData<ReplayManifest>(`/api/v1/replays/${replayId}`, signal)
  },

  chunk(replayId: number, seq: number, signal?: AbortSignal) {
    return hgData<ReplayChunkData>(`/api/v1/replays/${replayId}/chunks/${seq}`, signal)
  },

  world(replayId: number, signal?: AbortSignal) {
    return hgData<WorldSnapshotManifest & { replay_id: number }>(`/api/v1/replays/${replayId}/world`, signal)
  },

  worldChunk(replayId: number, chunkX: number, chunkZ: number, world?: string, signal?: AbortSignal) {
    const params = new URLSearchParams()
    if (world) params.set('world', world)
    const suffix = params.size ? `?${params.toString()}` : ''
    return hgData<WorldChunkData>(`/api/v1/replays/${replayId}/world/chunks/${chunkX}/${chunkZ}${suffix}`, signal)
  },
}
