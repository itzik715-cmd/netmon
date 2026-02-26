import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import Layout from './components/layout/Layout'
import DashboardPage from './pages/DashboardPage'
import DevicesPage from './pages/DevicesPage'
import DeviceDetailPage from './pages/DeviceDetailPage'
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
import NocPage from './pages/NocPage'

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
        <Route index element={<DashboardPage />} />
        <Route path="noc" element={<NocPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="devices/:id" element={<DeviceDetailPage />} />
        <Route path="interfaces/:id" element={<InterfaceDetailPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="flows" element={<FlowsPage />} />
        <Route path="wan" element={<WanDashboardPage />} />
        <Route path="power" element={<PowerDashboardPage />} />
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
