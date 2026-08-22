import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { HgLogo } from './HgLogo'

export type PanelUser = {
  id: number
  name: string
  email: string
}

type MeResponse = {
  user: PanelUser
}

export type ShellContext = {
  user: PanelUser
}

type NavItem = {
  to: string
  code: string
  label: string
}

const operations: NavItem[] = [
  { to: '/dashboard', code: 'OV', label: 'Overview' },
  { to: '/reports', code: 'RP', label: 'Reports' },
  { to: '/replays', code: 'RV', label: 'Replays' },
  { to: '/moderation', code: 'MD', label: 'Moderation' },
  { to: '/detection', code: 'DT', label: 'Detection' },
]

const administration: NavItem[] = [
  { to: '/servers', code: 'SV', label: 'Servers' },
  { to: '/users', code: 'US', label: 'Users' },
  { to: '/settings', code: 'CF', label: 'Configuration' },
]

function NavigationGroup({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="nav-section">
      <div className="nav-section__title">{title}</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
        >
          <span className="nav-code">{item.code}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  )
}

export function AppShell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/api/v1/auth/me'),
    retry: false,
  })

  async function logout() {
    try {
      await api('/api/v1/auth/logout', { method: 'POST' })
    } finally {
      queryClient.clear()
      navigate('/login', { replace: true })
    }
  }

  if (me.isLoading) {
    return (
      <main className="boot-screen">
        <HgLogo />
        <div>
          <strong>HackerGuardian</strong>
          <span>Opening control plane…</span>
        </div>
      </main>
    )
  }

  if (me.isError || !me.data?.user) {
    return <Navigate to="/login" replace />
  }

  const user = me.data.user

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

        <nav className="sidebar-nav" aria-label="HackerGuardian navigation">
          <NavigationGroup title="Operations" items={operations} />
          <NavigationGroup title="Administration" items={administration} />
        </nav>

        <div className="sidebar-footer">
          <div className="operator-card">
            <span className="operator-card__label">Signed in</span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button className="sidebar-signout" type="button" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="shell-main">
        <div className="top-rail">
          <div className="top-rail__brand">HG / CONTROL</div>
          <div className="top-rail__status"><span className="status-light" />Panel session active</div>
        </div>
        <main className="workspace">
          <Outlet context={{ user } satisfies ShellContext} />
        </main>
      </div>
    </div>
  )
}
