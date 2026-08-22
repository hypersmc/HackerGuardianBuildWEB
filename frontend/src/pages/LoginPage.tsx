import { FormEvent, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { HgLogo } from '../components/HgLogo'
import type { PanelUser } from '../components/AppShell'

type MeResponse = {
  user: PanelUser
}

export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cachedUser = queryClient.getQueryData<MeResponse>(['auth', 'me'])?.user

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api<MeResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, remember }),
      })
      queryClient.setQueryData(['auth', 'me'], response)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  if (cachedUser) return <Navigate to="/dashboard" replace />

  return (
    <main className="login-screen">
      <section className="login-identity">
        <div className="login-identity__brand">
          <HgLogo />
          <div>
            <span className="micro-label">CONTROL PLANE</span>
            <h1>HackerGuardian</h1>
          </div>
        </div>

        <div className="login-identity__copy">
          <h2>Moderation without leaving the evidence behind.</h2>
          <p>Review reports, inspect replay evidence and control HackerGuardian from one operator interface.</p>
        </div>

        <div className="login-readout">
          <div><span>01</span><strong>Panel authentication</strong><small>Laravel session + CSRF protection</small></div>
          <div><span>02</span><strong>Game-plane isolation</strong><small>No browser access to plugin credentials or database</small></div>
          <div><span>03</span><strong>Signed bridge</strong><small>Laravel signs outbound HackerGuardian API requests</small></div>
        </div>
      </section>

      <section className="login-gate">
        <div className="login-gate__inner">
          <div className="login-gate__header">
            <span className="gate-number">ACCESS / STAFF</span>
            <h2>Sign in</h2>
            <p>Use a local HackerGuardian panel account.</p>
          </div>

          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                autoFocus
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

            <label className="remember-row">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>Keep this operator session signed in</span>
            </label>

            {error && <div className="error-box" role="alert">{error}</div>}

            <button className="authenticate-button" type="submit" disabled={loading}>
              <span>{loading ? 'Checking credentials…' : 'Enter control plane'}</span>
              <span aria-hidden="true">↳</span>
            </button>
          </form>
        </div>

        <div className="login-gate__footer">
          <span className="status-light" />
          Local control plane ready
        </div>
      </section>
    </main>
  )
}
