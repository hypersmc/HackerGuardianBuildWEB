import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { WebGpuRouteGuard } from './components/WebGpuRouteGuard'
import {
  DashboardPage,
  DetectionPage,
  ModerationPage,
  ReportsPage,
  ServersPage,
  SettingsPage,
  UsersPage,
} from './pages/ConsolePages'
import { Replay3DPage } from './pages/Replay3DPage'
import { LoginPage } from './pages/LoginPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/replays" element={<WebGpuRouteGuard><Replay3DPage /></WebGpuRouteGuard>} />
        <Route path="/moderation" element={<ModerationPage />} />
        <Route path="/detection" element={<DetectionPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
