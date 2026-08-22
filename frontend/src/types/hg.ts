export type HgIdentity = {
  uuid: string | null
  name: string | null
}

export type HgReport = {
  id: number
  server_name: string | null
  reported: HgIdentity
  reporter: HgIdentity
  reason: string
  status: string
  created_at: number
  updated_at: number
  resolved_by_uuid: string | null
  resolved_at: number | null
  linked_replays: number
  linked_detections: number
}

export type HgReportsData = {
  page: number
  per_page: number
  total: number
  pages: number
  reports: HgReport[]
}

export type HgReplaySummary = {
  id: number
  player_uuid: string
  player_name: string
  server_name: string
  started_at: number
  ended_at: number | null
  duration_ms: number
  trigger_type: string
  trigger_meta: Record<string, string>
  format_version: number
  codec: string
  size_bytes: number
  chunk_count: number
}

export type HgReplayChunkMeta = {
  seq: number
  start_ms: number
  end_ms: number
  size_bytes: number
}

export type HgReplayManifest = HgReplaySummary & {
  capture_start_at: number | null
  capture_end_at: number | null
  trigger_offset_ms: number
  world: { name: string } | null
  chunks: HgReplayChunkMeta[]
  events: Array<{
    time_ms: number
    type: string
    trigger_type?: string
    metadata?: Record<string, unknown>
    score?: number
  }>
}

export type HgReplayPlayer = {
  uuid: string
  name: string
  subject: boolean
  world: string
  position: { x: number; y: number; z: number }
  rotation: { yaw: number; pitch: number }
  on_ground?: boolean
  held_item?: string
}

export type HgReplayEvent = {
  type: string
  [key: string]: unknown
}

export type HgReplayFrame = {
  t: number
  players: HgReplayPlayer[]
  events: HgReplayEvent[]
}

export type HgReplayChunk = {
  replay_id: number
  seq: number
  start_ms: number
  end_ms: number
  format: string
  frames: HgReplayFrame[]
}

export type HgReplaysData = {
  page: number
  per_page: number
  total: number
  pages: number
  replays: HgReplaySummary[]
}

export type HgDetector = {
  id: string
  type: 'snapshot' | 'deterministic' | 'ml' | 'normality' | string
  enabled: boolean
  model_loaded?: boolean
}

export type HgDetectionStatus = {
  enabled: boolean
  mode: string
  assessment_window_ms: number | null
  tracked_players: number
  detectors: HgDetector[]
  ml: {
    supervised_enabled: boolean
    supervised_model_loaded: boolean
    population_normality_enabled: boolean
    population_model_loaded: boolean
  }
  learning: {
    enabled: boolean
    trusted_players: number
    total_active_hours?: number
    active_probes: number
  }
  journal?: {
    enabled: boolean
    written_events?: number
    dropped_events?: number
  }
}

export type HgDetectionEvent = {
  id: string
  time_ms: number
  player_uuid: string
  player_name: string
  server_name: string
  detector: string
  category: string
  evidence_strength: string
  score: number
  reliability: number
  assessment_risk: number
  metadata: Record<string, number>
  replay_id: number | null
}

export type HgDetectionRecent = {
  events: HgDetectionEvent[]
}

export type HgLearningStatus = {
  enabled: boolean
  candidate_rows: number | null
  eligible_rows: number | null
  candidate_rows_this_process: number | null
  trusted_players: number
  total_active_hours: number
  model: {
    loaded: boolean
    schema: string | null
    trained_players: number | null
    trained_samples: number | null
    trained_at: number | null
  }
  probes: {
    enabled: boolean
    active: number
    completed: number | null
  }
  metrics_note?: string
}

export type HgLearningPlayer = {
  server_name: string
  uuid: string
  name: string
  trusted: boolean
  active_hours: number
  candidate_samples: number | null
  eligible_samples: number | null
  quarantine_until: number | null
  baseline_mature: boolean
  first_trusted: number | null
  last_seen: number | null
  last_probe: number | null
}

export type HgLearningPlayers = {
  players: HgLearningPlayer[]
}

export type HgModerationAction = {
  id: number
  server_name: string | null
  target_uuid: string | null
  target_name: string | null
  type: string
  reason: string | null
  actor_uuid: string | null
  actor_name: string | null
  created_at: number
  expires_at: number | null
  active: boolean | null
  scope: string | null
  linked_report_id: number | null
  linked_replay_id: number | null
}

export type HgModerationData = {
  page: number
  per_page: number
  total: number
  pages: number
  actions: HgModerationAction[]
}

export type HgServer = {
  name: string
  online: boolean
  players_online: number
  minecraft_version: string | null
  plugin_version: string | null
  detection_enabled: boolean
  tracked_players: number
  learning_enabled: boolean
  trusted_players: number
  learning_active_hours: number
  active_probes: number
  synthetic_probes: boolean
  last_seen_ms: number | null
}

export type HgServersData = {
  servers: HgServer[]
}

export type HgHealth = {
  role: 'proxy' | 'backend' | string
  instance_name: string
  plugin_version: string
  minecraft_version: string | null
  uptime_ms: number
  players_online: number
  database: {
    configured: boolean
    healthy: boolean
    type: string | null
  }
  capabilities: Record<string, boolean>
  servers: HgServer[]
}

export type HgSettings = {
  detection: Record<string, unknown>
  learning: Record<string, unknown>
  replays: Record<string, unknown>
  moderation: Record<string, unknown>
}
