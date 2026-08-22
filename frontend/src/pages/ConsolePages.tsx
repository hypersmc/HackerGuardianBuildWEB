import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import { hg } from '../api/hg'
import type { PanelUser, ShellContext } from '../components/AppShell'
import type {
  HgDetectionEvent,
  HgDetectionRecent,
  HgDetectionStatus,
  HgHealth,
  HgLearningPlayers,
  HgLearningStatus,
  HgModerationData,
  HgReplayChunk,
  HgReplayManifest,
  HgReplayPlayer,
  HgReplaysData,
  HgReport,
  HgReportsData,
  HgServersData,
  HgSettings,
} from '../types/hg'

type DashboardResponse = {
  user: PanelUser
  stats: {
    open_reports: number | null
    replays_24h: number | null
    moderation_actions_24h: number | null
    detection_alerts: number | null
    panel_users: number
  }
  recent_reports: HgReport[]
  recent_detections: HgDetectionEvent[]
  system: {
    api: string
    hg_gateway: string
    role: string | null
    plugin_version: string | null
    players_online: number | null
    database_healthy: boolean | null
    capabilities: Record<string, boolean>
    servers_online: number | null
  }
}

type UsersResponse = {
  data: Array<PanelUser & { created_at: string | null }>
  total: number
}

type SystemResponse = {
  app: { environment: string; debug: boolean }
  session: { driver: string; lifetime_minutes: number }
  hg_gateway: {
    configured: boolean
    url: string | null
    connect_timeout_seconds: number
    timeout_seconds: number
  }
}

function PageHeader({ section, title, description, actions }: {
  section: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="page-heading__section">{section}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  )
}

function StateFlag({ state }: { state: string }) {
  const normalized = state.toLowerCase()
  const tone = normalized.includes('online') || normalized.includes('ready') || normalized.includes('available') || normalized === 'configured' || normalized === 'enabled' || normalized === 'loaded'
    ? 'ok'
    : normalized.includes('not_configured') || normalized.includes('disabled') || normalized.includes('unavailable') || normalized.includes('not configured') || normalized.includes('not loaded')
      ? 'muted'
      : 'warn'

  return <span className={`state-flag state-flag--${tone}`}>{state.replaceAll('_', ' ')}</span>
}

function formatEpoch(value: number | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function formatTime(ms: number) {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = Math.floor(total % 1000)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function ModuleUnavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="module-empty">
      <div className="module-empty__mark">HG</div>
      <div><strong>{title}</strong><p>{children}</p></div>
    </div>
  )
}

function ErrorState({ error, fallback }: { error: unknown; fallback: string }) {
  return <ModuleUnavailable title="Unavailable">{error instanceof Error ? error.message : fallback}</ModuleUnavailable>
}

export function DashboardPage() {
  const { user } = useOutletContext<ShellContext>()
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('/api/v1/dashboard'),
    refetchInterval: 30_000,
  })

  if (dashboard.isLoading) return <div className="page-loading">Loading control-plane state…</div>
  if (dashboard.isError || !dashboard.data) return <div className="page-error">Dashboard state could not be loaded.</div>

  const data = dashboard.data
  const counters = [
    ['Open reports', data.stats.open_reports, 'RP'],
    ['Replays / 24h', data.stats.replays_24h, 'RV'],
    ['Moderation / 24h', data.stats.moderation_actions_24h, 'MD'],
    ['Recent detections', data.stats.detection_alerts, 'DT'],
  ] as const

  return (
    <>
      <PageHeader
        section="Overview"
        title="Command overview"
        description="Live HackerGuardian state, current investigations and game-plane health."
        actions={<><Link className="text-action" to="/reports">Open reports</Link><Link className="primary-link" to="/replays">Replay library</Link></>}
      />

      <section className="counter-strip" aria-label="Control plane statistics">
        {counters.map(([label, value, code]) => (
          <div className="counter-strip__item" key={label}>
            <span className="counter-strip__code">{code}</span>
            <div><small>{label}</small><strong>{value ?? '—'}</strong></div>
          </div>
        ))}
        <div className="counter-strip__item counter-strip__item--quiet">
          <span className="counter-strip__code">US</span>
          <div><small>Panel users</small><strong>{data.stats.panel_users}</strong></div>
        </div>
      </section>

      <section className="command-grid">
        <article className="board board--queue">
          <div className="board-heading">
            <div><span className="board-kicker">Investigation queue</span><h2>Open reports</h2></div>
            <Link to="/reports">View all</Link>
          </div>
          {data.recent_reports.length > 0 ? (
            <div className="data-table">
              <div className="data-row data-row--header report-grid"><span>ID</span><span>Player</span><span>Reason</span><span>Reporter</span><span>Received</span></div>
              {data.recent_reports.map((report) => (
                <div className="data-row report-grid" key={report.id}>
                  <span className="mono">#{report.id}</span>
                  <strong>{report.reported.name ?? report.reported.uuid ?? 'Unknown'}</strong>
                  <span className="truncate">{report.reason}</span>
                  <span>{report.reporter.name ?? 'Unknown'}</span>
                  <span className="muted-text">{formatEpoch(report.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <ModuleUnavailable title={data.system.hg_gateway === 'online' ? 'No open reports' : 'HG gateway unavailable'}>
              {data.system.hg_gateway === 'online' ? 'The connected HackerGuardian environment has no open reports.' : 'The panel could not read the HackerGuardian API.'}
            </ModuleUnavailable>
          )}
        </article>

        <aside className="dashboard-side">
          <article className="board">
            <div className="board-heading"><div><span className="board-kicker">Connection</span><h2>Game plane</h2></div></div>
            <div className="key-value-list">
              <div><span>Laravel API</span><StateFlag state={data.system.api} /></div>
              <div><span>HG gateway</span><StateFlag state={data.system.hg_gateway} /></div>
              <div><span>Role</span><strong>{data.system.role ?? '—'}</strong></div>
              <div><span>HG version</span><strong>{data.system.plugin_version ?? '—'}</strong></div>
              <div><span>Players online</span><strong>{data.system.players_online ?? '—'}</strong></div>
              <div><span>Backends online</span><strong>{data.system.servers_online ?? '—'}</strong></div>
            </div>
          </article>
          <article className="operator-board">
            <span className="operator-board__label">Operator</span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
            <div className="operator-board__line"><span className="status-light" />Authenticated panel session</div>
          </article>
        </aside>
      </section>

      <section className="capability-board">
        <div className="capability-board__heading"><span>HG API capabilities</span><small>Reported by /v1/health, not inferred from panel configuration</small></div>
        {Object.keys(data.system.capabilities).length === 0 ? (
          <ModuleUnavailable title="No capability data">Connect the HG API to populate runtime capabilities.</ModuleUnavailable>
        ) : Object.entries(data.system.capabilities).map(([name, available]) => (
          <div className="capability-row" key={name}><strong>{name}</strong><span>Server-reported capability</span><StateFlag state={available ? 'available' : 'unavailable'} /></div>
        ))}
      </section>

      {data.recent_detections.length > 0 && (
        <section className="board dashboard-detections">
          <div className="board-heading"><div><span className="board-kicker">Evidence journal</span><h2>Recent detections</h2></div><Link to="/detection">Detection view</Link></div>
          <div className="data-table">
            <div className="data-row data-row--header detection-grid"><span>Time</span><span>Player</span><span>Detector</span><span>Strength</span><span>Score</span></div>
            {data.recent_detections.map((event) => (
              <div className="data-row detection-grid" key={event.id}>
                <span className="muted-text">{formatEpoch(event.time_ms)}</span><strong>{event.player_name}</strong><span className="mono">{event.detector}</span><StateFlag state={event.evidence_strength} /><span>{Math.round(event.score * 100)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

export function ReportsPage() {
  const [status, setStatus] = useState('open')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const reports = useQuery({
    queryKey: ['reports', status, query],
    queryFn: () => {
      const params = new URLSearchParams({ status, page: '1', per_page: '25' })
      if (query) params.set('q', query)
      return hg<HgReportsData>(`/api/v1/reports?${params.toString()}`)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setQuery(search.trim())
  }

  return (
    <>
      <PageHeader section="Operations / Reports" title="Player reports" description="Live report data from the signed HackerGuardian API." />
      <form className="filter-bar" onSubmit={submit}>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select></label>
        <label className="filter-bar__search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Player, reporter, UUID or report ID" /></label>
        <button type="submit">Apply</button>
      </form>
      <article className="board">
        <div className="board-heading"><div><span className="board-kicker">Report index</span><h2>Reports</h2></div>{reports.data && <span className="record-count">{reports.data.total} records</span>}</div>
        {reports.isLoading && <div className="page-loading page-loading--inline">Retrieving reports…</div>}
        {reports.isError && <ErrorState error={reports.error} fallback="The HG report API could not be reached." />}
        {reports.data?.reports.length === 0 && <ModuleUnavailable title="Nothing in this queue">No reports matched the current filters.</ModuleUnavailable>}
        {reports.data && reports.data.reports.length > 0 && (
          <div className="data-table">
            <div className="data-row data-row--header full-report-grid"><span>ID</span><span>Reported player</span><span>Reporter</span><span>Reason</span><span>Status</span><span>Created</span></div>
            {reports.data.reports.map((report) => (
              <div className="data-row full-report-grid" key={report.id}>
                <span className="mono">#{report.id}</span><strong>{report.reported.name ?? report.reported.uuid ?? 'Unknown'}</strong><span>{report.reporter.name ?? 'Unknown'}</span><span className="truncate" title={report.reason}>{report.reason}</span><StateFlag state={report.status} /><span className="muted-text">{formatEpoch(report.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </>
  )
}

function ReplayMap({ players }: { players: HgReplayPlayer[] }) {
  const subject = players.find((player) => player.subject) ?? players[0]
  if (!subject) return <div className="replay-map-empty">No player snapshot at this point in the capture.</div>

  return (
    <div className="replay-map" aria-label="Top-down replay player map">
      <div className="replay-map__axis replay-map__axis--x" /><div className="replay-map__axis replay-map__axis--z" />
      {players.map((player) => {
        const dx = player.position.x - subject.position.x
        const dz = player.position.z - subject.position.z
        const left = Math.max(4, Math.min(96, 50 + dx * 4.5))
        const top = Math.max(4, Math.min(96, 50 + dz * 4.5))
        return (
          <div className={`replay-player${player.subject ? ' replay-player--subject' : ''}`} key={player.uuid} style={{ left: `${left}%`, top: `${top}%` }} title={`${player.name} (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)})`}>
            <i style={{ transform: `rotate(${player.rotation.yaw}deg)` }} /><span>{player.name}</span>
          </div>
        )
      })}
      <div className="replay-map__scale">±10 blocks around subject</div>
    </div>
  )
}

export function ReplaysPage() {
  const [playerSearch, setPlayerSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  const list = useQuery({
    queryKey: ['replays', playerSearch],
    queryFn: () => {
      const params = new URLSearchParams({ page: '1', per_page: '50' })
      if (playerSearch.trim()) params.set('player_name', playerSearch.trim())
      return hg<HgReplaysData>(`/api/v1/replays?${params.toString()}`)
    },
  })

  useEffect(() => {
    if (selectedId === null && list.data?.replays.length) setSelectedId(list.data.replays[0].id)
  }, [list.data, selectedId])

  useEffect(() => {
    setCurrentTime(0)
    setPlaying(false)
  }, [selectedId])

  const manifest = useQuery({
    queryKey: ['replay', selectedId],
    queryFn: () => hg<HgReplayManifest>(`/api/v1/replays/${selectedId}`),
    enabled: selectedId !== null,
  })

  const duration = manifest.data?.duration_ms ?? 0
  const chunkMeta = useMemo(() => {
    const chunks = manifest.data?.chunks ?? []
    return chunks.find((chunk) => currentTime >= chunk.start_ms && currentTime <= chunk.end_ms)
      ?? chunks.find((chunk) => currentTime < chunk.end_ms)
      ?? chunks.at(-1)
      ?? null
  }, [manifest.data?.chunks, currentTime])

  const chunk = useQuery({
    queryKey: ['replay-chunk', selectedId, chunkMeta?.seq],
    queryFn: () => hg<HgReplayChunk>(`/api/v1/replays/${selectedId}/chunks/${chunkMeta!.seq}`),
    enabled: selectedId !== null && chunkMeta !== null,
    staleTime: Infinity,
  })

  const frame = useMemo(() => {
    const frames = chunk.data?.frames ?? []
    const eligible = frames.filter((candidate) => candidate.t <= currentTime && candidate.players.length > 0)
    return eligible.at(-1) ?? frames.find((candidate) => candidate.players.length > 0) ?? null
  }, [chunk.data?.frames, currentTime])

  const nearbyEvents = useMemo(() => {
    return (chunk.data?.frames ?? [])
      .filter((candidate) => Math.abs(candidate.t - currentTime) <= 300)
      .flatMap((candidate) => candidate.events.map((event) => ({ time: candidate.t, event })))
      .slice(0, 12)
  }, [chunk.data?.frames, currentTime])

  useEffect(() => {
    if (!playing || duration <= 0) return
    const timer = window.setInterval(() => {
      setCurrentTime((previous) => {
        const next = previous + 50 * speed
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
    }, 50)
    return () => window.clearInterval(timer)
  }, [playing, speed, duration])

  const triggerOffset = manifest.data?.trigger_offset_ms ?? 0
  const triggerPercent = duration > 0 ? Math.max(0, Math.min(100, triggerOffset / duration * 100)) : 0

  return (
    <>
      <PageHeader section="Operations / Replays" title="Replay investigation" description="Decoded HG replay chunks are loaded on demand through Laravel; internal replay BLOBs never reach the browser." />
      <section className="replay-workbench replay-workbench--live">
        <aside className="replay-library board">
          <div className="board-heading"><div><span className="board-kicker">Library</span><h2>Captured replays</h2></div>{list.data && <span className="record-count">{list.data.total}</span>}</div>
          <input className="replay-search" value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Filter by player name" />
          {list.isLoading && <div className="page-loading page-loading--inline">Loading replay index…</div>}
          {list.isError && <ErrorState error={list.error} fallback="Replay index unavailable." />}
          <div className="replay-list">
            {list.data?.replays.map((replay) => (
              <button className={`replay-list__item${selectedId === replay.id ? ' replay-list__item--active' : ''}`} type="button" key={replay.id} onClick={() => setSelectedId(replay.id)}>
                <span><strong>{replay.player_name}</strong><small>#{replay.id} · {replay.server_name}</small></span>
                <span><b>{replay.trigger_type}</b><small>{formatEpoch(replay.started_at)}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <article className="replay-stage board">
          {!selectedId ? (
            <ModuleUnavailable title="No replay selected">Choose a captured replay from the library.</ModuleUnavailable>
          ) : manifest.isError ? (
            <ErrorState error={manifest.error} fallback="Replay manifest unavailable." />
          ) : (
            <>
              <div className="replay-stage__meta">
                <div><span>Replay</span><strong>#{selectedId}</strong></div>
                <div><span>Player</span><strong>{manifest.data?.player_name ?? 'Loading…'}</strong></div>
                <div><span>Server</span><strong>{manifest.data?.server_name ?? '—'}</strong></div>
                <div><span>World</span><strong>{manifest.data?.world?.name ?? '—'}</strong></div>
                <div><span>Trigger</span><strong>{manifest.data?.trigger_type ?? '—'}</strong></div>
              </div>
              <div className="replay-stage__viewport replay-stage__viewport--map">
                {chunk.isLoading ? <div className="replay-stage__empty"><strong>Loading chunk {chunkMeta?.seq ?? '…'}</strong></div> : <ReplayMap players={frame?.players ?? []} />}
                <div className="replay-readout">
                  <span>{formatTime(currentTime)}</span>
                  {frame?.players.find((player) => player.subject) && <span>Y {frame.players.find((player) => player.subject)!.position.y.toFixed(2)}</span>}
                  <span>chunk {chunkMeta?.seq ?? '—'}</span>
                </div>
              </div>
              <div className="replay-timeline replay-timeline--live">
                <button type="button" onClick={() => setPlaying((value) => !value)} disabled={!manifest.data}>{playing ? 'Ⅱ' : '▶'}</button>
                <span className="mono">{formatTime(currentTime)}</span>
                <div className="timeline-control">
                  <input type="range" min={0} max={Math.max(1, duration)} step={50} value={Math.min(currentTime, Math.max(1, duration))} onChange={(event) => { setCurrentTime(Number(event.target.value)); setPlaying(false) }} />
                  <i className="timeline-trigger" style={{ left: `${triggerPercent}%` }} title={`Trigger at ${formatTime(triggerOffset)}`} />
                </div>
                <span className="mono">{formatTime(duration)}</span>
                <button type="button" onClick={() => setSpeed((value) => value === 1 ? 2 : value === 2 ? 0.5 : 1)}>{speed}×</button>
              </div>
              <div className="replay-evidence-strip">
                <div><span>Trigger offset</span><strong>{formatTime(triggerOffset)}</strong></div>
                <div><span>Chunks</span><strong>{manifest.data?.chunk_count ?? '—'}</strong></div>
                <div><span>Stored size</span><strong>{manifest.data ? formatBytes(manifest.data.size_bytes) : '—'}</strong></div>
                <div><span>Format</span><strong>{chunk.data?.format ?? 'hg-web-replay-v1'}</strong></div>
              </div>
              <div className="replay-event-log">
                <div className="board-heading"><div><span className="board-kicker">Frame evidence</span><h2>Events near playhead</h2></div></div>
                {nearbyEvents.length === 0 ? <span className="replay-event-log__empty">No discrete event within ±300 ms.</span> : nearbyEvents.map(({ time, event }, index) => <div className="replay-event" key={`${time}-${index}`}><span className="mono">{formatTime(time)}</span><strong>{event.type}</strong><code>{JSON.stringify(event)}</code></div>)}
              </div>
            </>
          )}
        </article>
      </section>
    </>
  )
}

export function ModerationPage() {
  const actions = useQuery({
    queryKey: ['moderation-actions'],
    queryFn: () => hg<HgModerationData>('/api/v1/moderation/actions?page=1&per_page=50'),
    refetchInterval: 30_000,
  })

  return (
    <>
      <PageHeader section="Operations / Moderation" title="Moderation desk" description="Read-only moderation history from HackerGuardian. Writes remain intentionally unavailable in API v1." />
      <article className="board">
        <div className="board-heading"><div><span className="board-kicker">Action log</span><h2>Recent moderation</h2></div>{actions.data && <span className="record-count">{actions.data.total} records</span>}</div>
        {actions.isLoading && <div className="page-loading page-loading--inline">Loading moderation history…</div>}
        {actions.isError && <ErrorState error={actions.error} fallback="Moderation history unavailable." />}
        {actions.data?.actions.length === 0 && <ModuleUnavailable title="No moderation actions">No actions matched the current view.</ModuleUnavailable>}
        {actions.data && actions.data.actions.length > 0 && <div className="data-table"><div className="data-row data-row--header moderation-grid"><span>Time</span><span>Type</span><span>Target</span><span>Actor</span><span>Reason</span><span>Server</span></div>{actions.data.actions.map((action) => <div className="data-row moderation-grid" key={`${action.type}-${action.id}`}><span className="muted-text">{formatEpoch(action.created_at)}</span><StateFlag state={action.type} /><strong>{action.target_name ?? action.target_uuid ?? '—'}</strong><span>{action.actor_name ?? 'system'}</span><span className="truncate">{action.reason ?? '—'}</span><span>{action.server_name ?? '—'}</span></div>)}</div>}
      </article>
    </>
  )
}

export function DetectionPage() {
  const status = useQuery({ queryKey: ['detection-status'], queryFn: () => hg<HgDetectionStatus>('/api/v1/detection/status'), refetchInterval: 15_000 })
  const recent = useQuery({ queryKey: ['detection-recent'], queryFn: () => hg<HgDetectionRecent>('/api/v1/detection/recent?limit=100'), refetchInterval: 10_000 })
  const learning = useQuery({ queryKey: ['learning-status'], queryFn: () => hg<HgLearningStatus>('/api/v1/learning/status'), refetchInterval: 30_000 })
  const learningPlayers = useQuery({ queryKey: ['learning-players'], queryFn: () => hg<HgLearningPlayers>('/api/v1/learning/players?trusted_only=true&limit=100') })

  const detectorGroups = ['deterministic', 'snapshot', 'ml', 'normality']

  return (
    <>
      <PageHeader section="Operations / Detection" title="Detection operations" description="Deterministic, snapshot, supervised and normality evidence are kept as separate sources." />
      {status.isError && <ErrorState error={status.error} fallback="Detection status unavailable." />}
      {status.data && (
        <>
          <section className="counter-strip">
            <div className="counter-strip__item"><span className="counter-strip__code">ST</span><div><small>Runtime</small><strong>{status.data.enabled ? 'ON' : 'OFF'}</strong></div></div>
            <div className="counter-strip__item"><span className="counter-strip__code">PL</span><div><small>Tracked players</small><strong>{status.data.tracked_players}</strong></div></div>
            <div className="counter-strip__item"><span className="counter-strip__code">CK</span><div><small>Checks</small><strong>{status.data.detectors.length}</strong></div></div>
            <div className="counter-strip__item"><span className="counter-strip__code">TR</span><div><small>Trusted players</small><strong>{status.data.learning.trusted_players}</strong></div></div>
          </section>
          <section className="detection-lanes detection-lanes--live">
            {detectorGroups.map((group) => {
              const detectors = status.data!.detectors.filter((detector) => detector.type === group)
              return <article className="lane" key={group}><span className="lane__code">{group.slice(0, 3).toUpperCase()}</span><strong>{group}</strong><p>{detectors.length} active source{detectors.length === 1 ? '' : 's'}</p><div className="detector-list">{detectors.length === 0 ? <span>none loaded</span> : detectors.map((detector) => <code key={detector.id}>{detector.id}{detector.model_loaded === false ? ' · model unavailable' : ''}</code>)}</div></article>
            })}
          </section>
        </>
      )}

      <section className="two-column-page detection-lower">
        <article className="board">
          <div className="board-heading"><div><span className="board-kicker">Evidence journal</span><h2>Recent findings</h2></div>{recent.data && <span className="record-count">{recent.data.events.length} loaded</span>}</div>
          {recent.isLoading && <div className="page-loading page-loading--inline">Loading findings…</div>}
          {recent.isError && <ErrorState error={recent.error} fallback="Detection journal unavailable." />}
          {recent.data && <div className="data-table"><div className="data-row data-row--header detection-grid"><span>Time</span><span>Player</span><span>Detector</span><span>Strength</span><span>Score</span></div>{recent.data.events.map((event) => <div className="data-row detection-grid" key={event.id}><span className="muted-text">{formatEpoch(event.time_ms)}</span><strong>{event.player_name}</strong><span className="mono truncate">{event.detector}</span><StateFlag state={event.evidence_strength} /><span>{Math.round(event.score * 100)}%</span></div>)}</div>}
        </article>

        <article className="board">
          <div className="board-heading"><div><span className="board-kicker">Learning mode</span><h2>Population baseline</h2></div>{learning.data && <StateFlag state={learning.data.enabled ? 'enabled' : 'disabled'} />}</div>
          {learning.isError && <ErrorState error={learning.error} fallback="Learning status unavailable." />}
          {learning.data && <div className="key-value-list"><div><span>Trusted players</span><strong>{learning.data.trusted_players}</strong></div><div><span>Active hours</span><strong>{learning.data.total_active_hours.toFixed(1)}</strong></div><div><span>Normality model</span><StateFlag state={learning.data.model.loaded ? 'loaded' : 'not loaded'} /></div><div><span>Probes</span><strong>{learning.data.probes.active} active</strong></div><div><span>Candidate rows</span><strong>{learning.data.candidate_rows ?? 'not aggregated'}</strong></div></div>}
          {learningPlayers.data && learningPlayers.data.players.length > 0 && <div className="learning-player-list">{learningPlayers.data.players.slice(0, 12).map((player) => <div key={`${player.server_name}-${player.uuid}`}><span><strong>{player.name}</strong><small>{player.server_name}</small></span><span><b>{player.active_hours.toFixed(1)} h</b><small>{player.baseline_mature ? 'baseline mature' : 'collecting'}</small></span></div>)}</div>}
        </article>
      </section>
    </>
  )
}

export function ServersPage() {
  const health = useQuery({ queryKey: ['hg-health'], queryFn: () => hg<HgHealth>('/api/v1/hg/health'), refetchInterval: 15_000 })
  const servers = useQuery({ queryKey: ['hg-servers'], queryFn: () => hg<HgServersData>('/api/v1/servers'), refetchInterval: 15_000 })

  return (
    <>
      <PageHeader section="Administration / Servers" title="Server bridge" description="Authoritative proxy/standalone health and secret-free backend heartbeats." />
      {health.isError && <ErrorState error={health.error} fallback="HG health endpoint unavailable." />}
      {health.data && <article className="board config-board"><div className="board-heading"><div><span className="board-kicker">HG API</span><h2>{health.data.instance_name}</h2></div><StateFlag state="online" /></div><div className="configuration-grid"><div><span>Role</span><strong>{health.data.role}</strong></div><div><span>Plugin</span><strong>{health.data.plugin_version}</strong></div><div><span>Players</span><strong>{health.data.players_online}</strong></div><div><span>Database</span><StateFlag state={health.data.database.healthy ? 'online' : 'unhealthy'} /></div></div></article>}
      <article className="board server-table-board">
        <div className="board-heading"><div><span className="board-kicker">Backends</span><h2>Paper servers</h2></div>{servers.data && <span className="record-count">{servers.data.servers.length}</span>}</div>
        {servers.isLoading && <div className="page-loading page-loading--inline">Loading backend heartbeats…</div>}
        {servers.isError && <ErrorState error={servers.error} fallback="Backend status unavailable." />}
        {servers.data && <div className="data-table"><div className="data-row data-row--header server-grid"><span>Server</span><span>State</span><span>Players</span><span>Minecraft</span><span>Detection</span><span>Learning</span><span>Last seen</span></div>{servers.data.servers.map((server) => <div className="data-row server-grid" key={server.name}><strong>{server.name}</strong><StateFlag state={server.online ? 'online' : 'offline'} /><span>{server.players_online}</span><span>{server.minecraft_version ?? '—'}</span><StateFlag state={server.detection_enabled ? 'enabled' : 'disabled'} /><span>{server.learning_enabled ? `${server.trusted_players} trusted` : 'off'}</span><span className="muted-text">{formatEpoch(server.last_seen_ms)}</span></div>)}</div>}
      </article>
    </>
  )
}

export function UsersPage() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UsersResponse>('/api/v1/users') })
  return (
    <>
      <PageHeader section="Administration / Users" title="Panel users" description="Accounts that can authenticate to the HackerGuardian web control plane." actions={<span className="hint-command">php artisan hg:user:create</span>} />
      <article className="board"><div className="board-heading"><div><span className="board-kicker">Local identities</span><h2>Accounts</h2></div>{users.data && <span className="record-count">{users.data.total} users</span>}</div>{users.isLoading && <div className="page-loading page-loading--inline">Loading users…</div>}{users.isError && <div className="page-error">Panel users could not be loaded.</div>}{users.data && <div className="data-table"><div className="data-row data-row--header user-grid"><span>ID</span><span>Name</span><span>Email</span><span>Created</span></div>{users.data.data.map((user) => <div className="data-row user-grid" key={user.id}><span className="mono">{user.id}</span><strong>{user.name}</strong><span>{user.email}</span><span className="muted-text">{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</span></div>)}</div>}</article>
    </>
  )
}

function SettingsGroup({ name, values }: { name: string; values: Record<string, unknown> }) {
  return <article className="settings-row"><div><strong>{name}</strong><span>Effective HackerGuardian setting</span></div><div className="settings-values">{Object.entries(values).map(([key, value]) => <span key={key}>{key.replaceAll('_', ' ')} <b>{value === null ? '—' : String(value)}</b></span>)}</div></article>
}

export function SettingsPage() {
  const system = useQuery({ queryKey: ['system'], queryFn: () => api<SystemResponse>('/api/v1/system') })
  const settings = useQuery({ queryKey: ['hg-settings'], queryFn: () => hg<HgSettings>('/api/v1/hg/settings') })

  return (
    <>
      <PageHeader section="Administration / Configuration" title="Control-plane configuration" description="Safe effective runtime state only. Secrets and arbitrary YAML are not exposed." />
      {system.isLoading && <div className="page-loading">Loading panel configuration…</div>}
      {system.data && <section className="settings-stack"><article className="settings-row"><div><strong>Web application</strong><span>Laravel runtime</span></div><div className="settings-values"><span>Environment <b>{system.data.app.environment}</b></span><span>Debug <b>{system.data.app.debug ? 'on' : 'off'}</b></span></div></article><article className="settings-row"><div><strong>HG gateway</strong><span>Laravel-to-HackerGuardian transport</span></div><div className="settings-values"><span>Configured <b>{system.data.hg_gateway.configured ? 'yes' : 'no'}</b></span><span>Endpoint <b>{system.data.hg_gateway.url ?? '—'}</b></span></div></article></section>}
      {settings.isError && <ErrorState error={settings.error} fallback="HG settings endpoint unavailable." />}
      {settings.data && <section className="settings-stack settings-stack--hg"><SettingsGroup name="Detection" values={settings.data.detection} /><SettingsGroup name="Learning" values={settings.data.learning} /><SettingsGroup name="Replays" values={settings.data.replays} /><SettingsGroup name="Moderation" values={settings.data.moderation} /></section>}
    </>
  )
}
