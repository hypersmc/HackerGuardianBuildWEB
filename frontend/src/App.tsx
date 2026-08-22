import { FormEvent, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'
import { HgLogo } from './components/HgLogo'

type User = { id: number; name: string; email: string }
type MeResponse = { user: User }
type DashboardResponse = {
  user: User
  stats: {
    open_reports: number | null
    replays_24h: number | null
    moderation_actions_24h: number | null
    detection_alerts: number | null
  }
  system: { api: string; hg_gateway: string }
}

type StatCard = {
  label: string
  value: number | null
  hint: string
  tone: 'danger' | 'evidence' | 'audit' | 'signal'
}

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await api<MeResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, remember }),
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-screen">
      <div className="login-grid" aria-hidden="true" />

      <section className="login-intro">
        <div className="login-brandline">
          <HgLogo />
          <div>
            <span className="product-kicker">HG CONTROL PLANE</span>
            <h1>HackerGuardian</h1>
          </div>
        </div>

        <p className="login-lead">
          Investigation, moderation and replay analysis for HackerGuardian protected servers.
        </p>

        <div className="login-system-readout">
          <div><span>CONTROL</span><strong>AUTHORIZED STAFF ONLY</strong></div>
          <div><span>TRANSPORT</span><strong>HTTPS / SIGNED HG API</strong></div>
          <div><span>DATABASE</span><strong>ISOLATED FROM GAME PLANE</strong></div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__head">
          <span className="section-code">AUTH / 01</span>
          <h2>Console sign in</h2>
          <p>Authenticate against the HackerGuardian control plane.</p>
        </div>

        <form onSubmit={submit} className="login-form">
          <label>
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <div className="auth-options">
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>Remember session</span>
            </label>
            <span className="auth-state">SESSION AUTH</span>
          </div>

          {error && <div className="error" role="alert">{error}</div>}

          <button className="primary-action" type="submit" disabled={loading}>
            <span>{loading ? 'AUTHENTICATING' : 'AUTHENTICATE'}</span>
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <footer className="auth-panel__foot">
          <span className="status-light" />
          Laravel control plane available
        </footer>
      </section>
    </main>
  )
}

function DashboardPage() {
  const navigate = useNavigate()
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('/api/v1/dashboard'),
  })

  async function logout() {
    try {
      await api('/api/v1/auth/logout', { method: 'POST' })
    } finally {
      navigate('/login')
    }
  }

  if (dashboard.isLoading) {
    return <main className="centered"><span className="loading-line">INITIALIZING CONTROL PLANE</span></main>
  }

  if (dashboard.isError) return <Navigate to="/login" replace />

  const data = dashboard.data!
  const cards: StatCard[] = [
    { label: 'Open reports', value: data.stats.open_reports, hint: 'Pending review', tone: 'danger' },
    { label: 'Replays', value: data.stats.replays_24h, hint: 'Captured in last 24h', tone: 'evidence' },
    { label: 'Moderation actions', value: data.stats.moderation_actions_24h, hint: 'Last 24h', tone: 'audit' },
    { label: 'Detection alerts', value: data.stats.detection_alerts, hint: 'Current signal queue', tone: 'signal' },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <HgLogo compact />
          <div>
            <strong>HackerGuardian</strong>
            <span>Control Plane</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <span className="nav-group">OPERATIONS</span>
          <button className="nav-item active" type="button"><span>01</span>Dashboard</button>
          <button className="nav-item" type="button"><span>02</span>Reports</button>
          <button className="nav-item" type="button"><span>03</span>Replays</button>
          <button className="nav-item" type="button"><span>04</span>Moderation</button>
          <button className="nav-item" type="button"><span>05</span>Detection</button>

          <span className="nav-group">INFRASTRUCTURE</span>
          <button className="nav-item" type="button"><span>06</span>Servers</button>

          <span className="nav-group">ADMINISTRATION</span>
          <button className="nav-item" type="button"><span>07</span>Users &amp; Roles</button>
          <button className="nav-item" type="button"><span>08</span>Settings</button>
        </nav>

        <div className="sidebar-session">
          <span>ACTIVE SESSION</span>
          <strong>{data.user.name}</strong>
          <small>{data.user.email}</small>
          <button type="button" onClick={logout}>SIGN OUT</button>
        </div>
      </aside>

      <main className="content">
        <header className="page-header">
          <div>
            <p className="breadcrumb"><span>OPERATIONS</span> / OVERVIEW</p>
            <h1>Dashboard</h1>
            <p className="page-description">Current moderation workload and control-plane health.</p>
          </div>
          <div className="system-indicator"><span className="status-light" />CONTROL PLANE ONLINE</div>
        </header>

        <section className="stats-grid" aria-label="Dashboard statistics">
          {cards.map((card) => (
            <article className={`metric-card metric-card--${card.tone}`} key={card.label}>
              <div className="metric-card__label"><span>{card.label}</span><span className="metric-card__marker" /></div>
              <strong>{card.value ?? '—'}</strong>
              <small>{card.hint}</small>
            </article>
          ))}
        </section>

        <section className="dashboard-grid">
          <article className="console-panel activity-panel">
            <div className="panel-heading">
              <div><span className="section-code">AUDIT / LIVE</span><h2>Recent activity</h2></div>
              <span className="panel-note">Panel events only</span>
            </div>

            <div className="activity-table">
              <div className="activity-row activity-row--head"><span>TYPE</span><span>ACTOR / TARGET</span><span>DETAIL</span><span>TIME</span></div>
              <div className="activity-empty">
                <span>NO AUDIT EVENTS LOADED</span>
                <small>Panel login, configuration and moderation activity will appear here.</small>
              </div>
            </div>
          </article>

          <article className="console-panel status-panel">
            <div className="panel-heading">
              <div><span className="section-code">SYSTEM / HEALTH</span><h2>Control status</h2></div>
            </div>

            <div className="health-list">
              <div className="health-row"><span><i className="health-dot health-dot--ok" />Laravel API</span><strong>{data.system.api}</strong></div>
              <div className="health-row"><span><i className="health-dot health-dot--neutral" />HG gateway</span><strong>{data.system.hg_gateway}</strong></div>
              <div className="health-row"><span><i className="health-dot health-dot--ok" />Session</span><strong>AUTHENTICATED</strong></div>
            </div>

            <div className="identity-block">
              <span>IDENTITY</span>
              <strong>{data.user.name}</strong>
              <small>{data.user.email}</small>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
