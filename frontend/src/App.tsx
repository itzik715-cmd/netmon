import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import Layout from './components/layout/Layout'
import MainDashboardPage from './pages/MainDashboardPage'
import DevicesPage from './pages/DevicesPage'
import DeviceDetailWrapper from './pages/DeviceDetailWrapper'
import InterfaceDetailPage from './pages/InterfaceDetailPage'
import AlertsPage from './pages/AlertsPage'
import FlowsPage from './pages/FlowsPage'
import UsersPage from './pages/UsersPage'
import AuditLogPage from './pages/AuditLogPage'
import SettingsPage from './pages/SettingsPage'
import BlocksPage from './pages/BlocksPage'
import TopologyPage from './pages/TopologyPage'
import ReportsPage from './pages/ReportsPage'
import BackupsPage from './pages/BackupsPage'
import SystemEventsPage from './pages/SystemEventsPage'
import WanDashboardPage from './pages/WanDashboardPage'
import PowerDashboardPage from './pages/PowerDashboardPage'
import RackPowerPage from './pages/RackPowerPage'
import SwitchesDashboardPage from './pages/SwitchesDashboardPage'
import NocLayout from './components/layout/NocLayout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  if (user?.must_change_password) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  if (user?.must_change_password) return <Navigate to="/change-password" replace />
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { token, user } = useAuthStore()
  const location = useLocation()
  const isNoc = new URLSearchParams(location.search).get('noc') === '1'

  // NOC mode — chromeless layout (no sidebar, no header)
  if (isNoc && token && !user?.must_change_password) {
    return (
      <Routes>
        <Route path="/" element={<NocLayout />}>
          <Route index element={<MainDashboardPage />} />
          <Route path="wan" element={<WanDashboardPage />} />
          <Route path="topology" element={<TopologyPage />} />
          <Route path="power" element={<PowerDashboardPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/?noc=1" replace />} />
      </Routes>
    )
  }

  // Normal mode
  return (
    <Routes>
      <Route
        path="/login"
        element={token && !user?.must_change_password ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/change-password"
        element={token ? <ChangePasswordPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<MainDashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="switches" element={<SwitchesDashboardPage />} />
        <Route path="devices/:id" element={<DeviceDetailWrapper />} />
        <Route path="interfaces/:id" element={<InterfaceDetailPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="flows" element={<FlowsPage />} />
        <Route path="wan" element={<WanDashboardPage />} />
        <Route path="power" element={<PowerDashboardPage />} />
        <Route path="power/racks" element={<RackPowerPage />} />
        <Route path="blocks" element={<BlocksPage />} />
        <Route path="topology" element={<TopologyPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="backups" element={<BackupsPage />} />
        <Route path="system-events" element={<SystemEventsPage />} />
        <Route
          path="users"
          element={<AdminRoute><UsersPage /></AdminRoute>}
        />
        <Route
          path="audit"
          element={<AdminRoute><AuditLogPage /></AdminRoute>}
        />
        <Route
          path="settings"
          element={<AdminRoute><SettingsPage /></AdminRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
