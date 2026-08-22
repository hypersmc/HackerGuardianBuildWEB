export type HgEnvelope<T> = {
  ok: true
  data: T
  meta: { api_version: number; time_ms: number }
}

export type ReplaySummary = {
  id: number
  player_uuid: string
  player_name: string
  server_name: string
  started_at: number
  ended_at: number | null
  duration_ms: number
  trigger_type: string
  trigger_meta: Record<string, unknown>
  format_version: number
  codec: string
  size_bytes: number
  chunk_count: number
}

export type ReplayList = {
  page: number
  per_page: number
  total: number
  pages: number
  replays: ReplaySummary[]
}

export type ReplayChunkMeta = {
  seq: number
  start_ms: number
  end_ms: number
  size_bytes: number
}

export type WorldChunkMeta = {
  world: string
  chunk_x: number
  chunk_z: number
  size_bytes: number
}

export type WorldSnapshotManifest = {
  available: boolean
  format: string
  anchor_ms: number
  anchor_precision: string
  chunk_count: number
  size_bytes: number
  chunks: WorldChunkMeta[]
}

export type ReplayManifest = ReplaySummary & {
  capture_start_at: number | null
  capture_end_at: number | null
  trigger_offset_ms: number
  world: { name: string } | null
  chunks: ReplayChunkMeta[]
  world_snapshot?: WorldSnapshotManifest
  events: Array<{
    time_ms: number
    type: string
    trigger_type?: string
    metadata?: Record<string, unknown>
    score?: number
  }>
}

export type ReplayPlayerFrame = {
  uuid: string
  name: string
  subject: boolean
  world: string
  position: { x: number; y: number; z: number }
  rotation: { yaw: number; pitch: number }
  on_ground?: boolean
  sneaking?: boolean
  sprinting?: boolean
  held_item?: string
}

export type ReplayEvent = {
  type: string
  world?: string
  position?: { x: number; y: number; z: number }
  velocity?: { x: number; y: number; z: number }
  block?: string
  previous_block?: string
  projectile?: string
  hit_type?: string
  hit_entity?: string
  enabled?: boolean
  item?: string
  [key: string]: unknown
}

export type ReplayFrame = {
  t: number
  players: ReplayPlayerFrame[]
  events: ReplayEvent[]
}

export type ReplayChunkData = {
  replay_id: number
  seq: number
  start_ms: number
  end_ms: number
  format: string
  frames: ReplayFrame[]
}

export type WorldSection = {
  base_y: number
  height: number
  palette: string[]
  runs: Array<[number, number]>
}

export type WorldChunkData = {
  replay_id: number
  format: string
  world: string
  chunk_x: number
  chunk_z: number
  anchor_ms: number
  min_y: number
  max_y: number
  order: 'y-x-z'
  sections: WorldSection[]
}

export type PlayerSample = ReplayPlayerFrame & { t: number }
export type CameraMode = 'free' | 'follow' | 'pov'
