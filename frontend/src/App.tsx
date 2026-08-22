import { FormEvent, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'

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
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-eye">◉</span>
        </div>
        <h1>HackerGuardian</h1>
        <p className="muted">Secure access to the moderation console</p>

        <form onSubmit={submit} className="login-form">
          <label>
            <span>Email address</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember this session
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Authenticating…' : 'Authenticate'}</button>
        </form>
      </section>
    </main>
  )
}

function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardResponse>('/api/v1/dashboard'),
  })

  if (dashboard.isLoading) return <main className="centered">Loading HackerGuardian…</main>
  if (dashboard.isError) return <Navigate to="/login" replace />

  const data = dashboard.data!
  const cards = [
    ['Open reports', data.stats.open_reports],
    ['Replays · 24h', data.stats.replays_24h],
    ['Moderation · 24h', data.stats.moderation_actions_24h],
    ['Detection alerts', data.stats.detection_alerts],
  ]

  return (
    <div className="app-shell">
      <aside>
        <div className="sidebar-brand"><strong>HackerGuardian</strong><span>Moderation Console</span></div>
        <nav>
          <a className="active">Dashboard</a>
          <a>Reports</a>
          <a>Replays</a>
          <a>Moderation</a>
          <a>Detection</a>
          <a>Servers</a>
          <a>Users & Roles</a>
          <a>Settings</a>
        </nav>
      </aside>
      <main className="content">
        <header><div><p className="eyebrow">Overview</p><h1>Dashboard</h1></div><span className="status-dot">API online</span></header>
        <section className="stats-grid">
          {cards.map(([label, value]) => (
            <article className="panel stat" key={String(label)}>
              <span className="muted">{label}</span>
              <strong>{value ?? '—'}</strong>
            </article>
          ))}
        </section>
        <section className="dashboard-grid">
          <article className="panel"><h2>Recent activity</h2><p className="muted">Panel audit events will appear here.</p></article>
          <article className="panel"><h2>System status</h2><dl><div><dt>Laravel API</dt><dd>{data.system.api}</dd></div><div><dt>HG gateway</dt><dd>{data.system.hg_gateway}</dd></div><div><dt>Signed in as</dt><dd>{data.user.email}</dd></div></dl></article>
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
