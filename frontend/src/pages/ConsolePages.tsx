import { FormEvent, type ReactNode, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import type { PanelUser, ShellContext } from '../components/AppShell'

type ReportSummary = {
  id: number
  reported_name: string
  reporter_name: string
  reason: string
  status: string
  created_at: number
  updated_at: number
}

type DashboardResponse = {
  user: PanelUser
  stats: {
    open_reports: number | null
    replays_24h: number | null
    moderation_actions_24h: number | null
    detection_alerts: number | null
    panel_users: number
  }
  recent_reports: ReportSummary[]
  system: {
    api: string
    hg_gateway: string
    reports_api: string
  }
}

type ReportsResponse = {
  ok: boolean
  page: number
  per_page: number
  total: number
  pages: number
  data: ReportSummary[]
}

type UsersResponse = {
  data: Array<PanelUser & { created_at: string | null }>
  total: number
}

type SystemResponse = {
  app: {
    environment: string
    debug: boolean
  }
  session: {
    driver: string
    lifetime_minutes: number
  }
  hg_gateway: {
    configured: boolean
    url: string | null
    connect_timeout_seconds: number
    timeout_seconds: number
  }
  capabilities: {
    reports: string
    replays: string
    detection: string
    moderation: string
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
  const tone = normalized.includes('online') || normalized.includes('ready') || normalized.includes('available') || normalized === 'configured'
    ? 'ok'
    : normalized.includes('not_configured') || normalized.includes('pending') || normalized.includes('not_available') || normalized.includes('not configured')
      ? 'muted'
      : 'warn'

  return <span className={`state-flag state-flag--${tone}`}>{state.replaceAll('_', ' ')}</span>
}

function formatEpoch(value: number | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function ModuleUnavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="module-empty">
      <div className="module-empty__mark">HG</div>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
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
    ['Detection alerts', data.stats.detection_alerts, 'DT'],
  ] as const

  return (
    <>
      <PageHeader
        section="Overview"
        title="Command overview"
        description="Live panel state, investigation queue and HackerGuardian bridge health."
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
                  <strong>{report.reported_name}</strong>
                  <span className="truncate">{report.reason}</span>
                  <span>{report.reporter_name}</span>
                  <span className="muted-text">{formatEpoch(report.created_at)}</span>
                </div>
              ))}
            </div>
          ) : data.system.reports_api === 'ready' ? (
            <ModuleUnavailable title="No open reports">The connected HackerGuardian server currently has no open reports.</ModuleUnavailable>
          ) : (
            <ModuleUnavailable title="Report bridge is offline">Configure the HG API in Laravel to pull the live moderation queue into the panel.</ModuleUnavailable>
          )}
        </article>

        <aside className="dashboard-side">
          <article className="board">
            <div className="board-heading"><div><span className="board-kicker">Connection</span><h2>Control plane</h2></div></div>
            <div className="key-value-list">
              <div><span>Laravel API</span><StateFlag state={data.system.api} /></div>
              <div><span>HG gateway</span><StateFlag state={data.system.hg_gateway} /></div>
              <div><span>Reports API</span><StateFlag state={data.system.reports_api} /></div>
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
        <div className="capability-board__heading"><span>Subsystems</span><small>What the web control plane can currently talk to</small></div>
        <div className="capability-row"><strong>Reports</strong><span>Live list through signed HG API</span><StateFlag state={data.system.reports_api} /></div>
        <div className="capability-row"><strong>Replay viewer</strong><span>UI route ready; plugin HTTP replay transport still required</span><StateFlag state="pending" /></div>
        <div className="capability-row"><strong>Detection controls</strong><span>UI route ready; control endpoint not exposed yet</span><StateFlag state="pending" /></div>
      </section>
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
      return api<ReportsResponse>(`/api/v1/reports?${params.toString()}`)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setQuery(search.trim())
  }

  return (
    <>
      <PageHeader section="Operations / Reports" title="Player reports" description="Live report queue retrieved through Laravel from the signed HackerGuardian API." />

      <form className="filter-bar" onSubmit={submit}>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="closed">Closed</option></select></label>
        <label className="filter-bar__search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Player, reporter or reason" /></label>
        <button type="submit">Apply</button>
      </form>

      <article className="board">
        <div className="board-heading">
          <div><span className="board-kicker">Report index</span><h2>{status === 'open' ? 'Open queue' : 'Closed reports'}</h2></div>
          {reports.data && <span className="record-count">{reports.data.total} records</span>}
        </div>

        {reports.isLoading && <div className="page-loading page-loading--inline">Retrieving reports…</div>}
        {reports.isError && <ModuleUnavailable title="Reports unavailable">{reports.error instanceof Error ? reports.error.message : 'The HG report API could not be reached.'}</ModuleUnavailable>}
        {reports.data?.data.length === 0 && <ModuleUnavailable title="Nothing in this queue">No reports matched the current filters.</ModuleUnavailable>}

        {reports.data && reports.data.data.length > 0 && (
          <div className="data-table">
            <div className="data-row data-row--header full-report-grid"><span>ID</span><span>Reported player</span><span>Reporter</span><span>Reason</span><span>Status</span><span>Created</span></div>
            {reports.data.data.map((report) => (
              <div className="data-row full-report-grid" key={report.id}>
                <span className="mono">#{report.id}</span>
                <strong>{report.reported_name}</strong>
                <span>{report.reporter_name}</span>
                <span className="truncate" title={report.reason}>{report.reason}</span>
                <StateFlag state={report.status} />
                <span className="muted-text">{formatEpoch(report.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </>
  )
}

export function ReplaysPage() {
  return (
    <>
      <PageHeader section="Operations / Replays" title="Replay investigation" description="The browser replay workspace will live here rather than in a separate generic media page." />
      <section className="replay-workbench">
        <aside className="replay-library board">
          <div className="board-heading"><div><span className="board-kicker">Library</span><h2>Captured replays</h2></div></div>
          <ModuleUnavailable title="Replay API bridge required">Replay data exists in the plugin database, but the plugin does not expose a web-safe replay list/chunk API yet.</ModuleUnavailable>
        </aside>
        <article className="replay-stage board">
          <div className="replay-stage__viewport">
            <div className="replay-stage__crosshair" />
            <div className="replay-stage__empty"><strong>No replay loaded</strong><span>Selecting a replay will reconstruct the recorded scene here.</span></div>
          </div>
          <div className="replay-timeline">
            <button disabled aria-label="Play replay">▶</button>
            <span className="mono">00:00.000</span>
            <div className="timeline-track"><div className="timeline-playhead" /></div>
            <span className="mono">00:00.000</span>
            <button disabled>1.0×</button>
          </div>
        </article>
      </section>
    </>
  )
}

export function ModerationPage() {
  return (
    <>
      <PageHeader section="Operations / Moderation" title="Moderation desk" description="A focused workspace for actions taken against players and the evidence attached to them." />
      <section className="two-column-page">
        <article className="board"><div className="board-heading"><div><span className="board-kicker">Action log</span><h2>Recent moderation</h2></div></div><ModuleUnavailable title="Moderation API not connected">The web route is active. The next backend layer will expose moderation history and action endpoints from HackerGuardian.</ModuleUnavailable></article>
        <article className="board"><div className="board-heading"><div><span className="board-kicker">Safety</span><h2>Action policy</h2></div></div><div className="info-copy"><p>Moderation writes will stay server-authoritative: React requests an action, Laravel authorizes it, and the HG API records the result.</p><p>No client-side button will be treated as permission by itself.</p></div></article>
      </section>
    </>
  )
}

export function DetectionPage() {
  return (
    <>
      <PageHeader section="Operations / Detection" title="Detection operations" description="Deterministic checks, supervised evidence and learning-mode controls will be surfaced separately instead of being collapsed into one AI score." />
      <section className="detection-lanes">
        <article className="lane"><span className="lane__code">DET</span><strong>Deterministic</strong><p>Physical and protocol checks such as reach, fast-break and through-wall evidence.</p><StateFlag state="endpoint pending" /></article>
        <article className="lane"><span className="lane__code">ML</span><strong>Supervised evidence</strong><p>Model evidence stays independent from deterministic findings and remains observable.</p><StateFlag state="endpoint pending" /></article>
        <article className="lane"><span className="lane__code">LRN</span><strong>Learning mode</strong><p>Population-normality collection, trusted-player state and probe controls.</p><StateFlag state="endpoint pending" /></article>
      </section>
    </>
  )
}

export function ServersPage() {
  const system = useQuery({ queryKey: ['system'], queryFn: () => api<SystemResponse>('/api/v1/system') })

  return (
    <>
      <PageHeader section="Administration / Servers" title="Server bridge" description="Connection state between this Laravel control plane and the HackerGuardian game plane." />
      <article className="board config-board">
        <div className="board-heading"><div><span className="board-kicker">HG API</span><h2>Primary gateway</h2></div>{system.data && <StateFlag state={system.data.hg_gateway.configured ? 'configured' : 'not configured'} />}</div>
        {system.isLoading && <div className="page-loading page-loading--inline">Loading bridge configuration…</div>}
        {system.isError && <div className="page-error">System configuration could not be loaded.</div>}
        {system.data && (
          <div className="configuration-grid">
            <div><span>Endpoint</span><strong>{system.data.hg_gateway.url ?? 'Not configured'}</strong></div>
            <div><span>Connect timeout</span><strong>{system.data.hg_gateway.connect_timeout_seconds}s</strong></div>
            <div><span>Request timeout</span><strong>{system.data.hg_gateway.timeout_seconds}s</strong></div>
            <div><span>Reports</span><StateFlag state={system.data.capabilities.reports} /></div>
          </div>
        )}
      </article>
    </>
  )
}

export function UsersPage() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UsersResponse>('/api/v1/users') })

  return (
    <>
      <PageHeader section="Administration / Users" title="Panel users" description="Accounts that can authenticate to the HackerGuardian web control plane." actions={<span className="hint-command">php artisan hg:user:create</span>} />
      <article className="board">
        <div className="board-heading"><div><span className="board-kicker">Local identities</span><h2>Accounts</h2></div>{users.data && <span className="record-count">{users.data.total} users</span>}</div>
        {users.isLoading && <div className="page-loading page-loading--inline">Loading users…</div>}
        {users.isError && <div className="page-error">Panel users could not be loaded.</div>}
        {users.data && (
          <div className="data-table">
            <div className="data-row data-row--header user-grid"><span>ID</span><span>Name</span><span>Email</span><span>Created</span></div>
            {users.data.data.map((user) => (
              <div className="data-row user-grid" key={user.id}><span className="mono">{user.id}</span><strong>{user.name}</strong><span>{user.email}</span><span className="muted-text">{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</span></div>
            ))}
          </div>
        )}
      </article>
    </>
  )
}

export function SettingsPage() {
  const system = useQuery({ queryKey: ['system'], queryFn: () => api<SystemResponse>('/api/v1/system') })

  return (
    <>
      <PageHeader section="Administration / Configuration" title="Control-plane configuration" description="Non-secret runtime state. API credentials are intentionally never returned to React." />
      {system.isLoading && <div className="page-loading">Loading configuration…</div>}
      {system.isError && <div className="page-error">Configuration could not be loaded.</div>}
      {system.data && (
        <section className="settings-stack">
          <article className="settings-row"><div><strong>Application</strong><span>Laravel runtime</span></div><div className="settings-values"><span>Environment <b>{system.data.app.environment}</b></span><span>Debug <b>{system.data.app.debug ? 'on' : 'off'}</b></span></div></article>
          <article className="settings-row"><div><strong>Session</strong><span>Panel authentication state</span></div><div className="settings-values"><span>Driver <b>{system.data.session.driver}</b></span><span>Lifetime <b>{system.data.session.lifetime_minutes} min</b></span></div></article>
          <article className="settings-row"><div><strong>HackerGuardian API</strong><span>Signed game-plane bridge</span></div><div className="settings-values"><span>Configured <b>{system.data.hg_gateway.configured ? 'yes' : 'no'}</b></span><span>Endpoint <b>{system.data.hg_gateway.url ?? '—'}</b></span></div></article>
        </section>
      )}
    </>
  )
}
