import { api } from '../../api/client'
import type {
  HgEnvelope,
  ReplayChunkData,
  ReplayList,
  ReplayManifest,
  WorldChunkData,
  WorldSnapshotManifest,
} from './types'

async function hgData<T>(path: string): Promise<T> {
  const envelope = await api<HgEnvelope<T>>(path)
  return envelope.data
}

export const replayApi = {
  list(params = new URLSearchParams({ page: '1', per_page: '30' })) {
    return hgData<ReplayList>(`/api/v1/replays?${params.toString()}`)
  },

  manifest(replayId: number) {
    return hgData<ReplayManifest>(`/api/v1/replays/${replayId}`)
  },

  chunk(replayId: number, seq: number) {
    return hgData<ReplayChunkData>(`/api/v1/replays/${replayId}/chunks/${seq}`)
  },

  world(replayId: number) {
    return hgData<WorldSnapshotManifest & { replay_id: number }>(`/api/v1/replays/${replayId}/world`)
  },

  worldChunk(replayId: number, chunkX: number, chunkZ: number, world?: string) {
    const params = new URLSearchParams()
    if (world) params.set('world', world)
    const suffix = params.size ? `?${params.toString()}` : ''
    return hgData<WorldChunkData>(`/api/v1/replays/${replayId}/world/chunks/${chunkX}/${chunkZ}${suffix}`)
  },
}
