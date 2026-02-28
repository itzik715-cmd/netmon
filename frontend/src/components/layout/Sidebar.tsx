import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Server,

  Network,
  Globe,
  Activity,
  ShieldAlert,
  Ban,
  Archive,
  FileText,
  ClipboardList,
  Terminal,
  Users,
  Settings,
  Zap,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
} from 'lucide-react'
import { alertsApi, authApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

const STORAGE_KEY = 'sidebar-collapsed'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
  badge?: 'red'
  adminOnly?: boolean
}

const overviewItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={16} />, end: true },
]

const networkItems: NavItem[] = [
  { to: '/devices', label: 'Devices', icon: <Server size={16} /> },
  { to: '/switches', label: 'Switches', icon: <Network size={16} /> },
]

const trafficItems: NavItem[] = [
  { to: '/wan', label: 'WAN Dashboard', icon: <Globe size={16} /> },
  { to: '/flows', label: 'Flow Analysis', icon: <Activity size={16} /> },
]

const powerItems: NavItem[] = [
  { to: '/power', label: 'Power Dashboard', icon: <Zap size={16} /> },
  { to: '/power/racks', label: 'Rack Power Detail', icon: <Server size={16} /> },
]

const securityItems: NavItem[] = [
  { to: '/alerts', label: 'Alerts', icon: <ShieldAlert size={16} />, badge: 'red' },
  { to: '/blocks', label: 'Blocks', icon: <Ban size={16} /> },
]

const operationsItems: NavItem[] = [
  { to: '/topology', label: 'Datacenter Topology', icon: <Network size={16} /> },
  { to: '/backups', label: 'Config Backups', icon: <Archive size={16} /> },
  { to: '/reports', label: 'Reports', icon: <FileText size={16} /> },
]

const adminItems: NavItem[] = [
  { to: '/audit', label: 'Audit Log', icon: <ClipboardList size={16} /> },
  { to: '/system-events', label: 'System Logs', icon: <Terminal size={16} /> },
  { to: '/users', label: 'Users & Access', icon: <Users size={16} />, adminOnly: true },
  { to: '/settings', label: 'Settings', icon: <Settings size={16} />, adminOnly: true },
]

export default function Sidebar() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const isOperator = user?.role === 'operator'
  const showAdmin = isAdmin || isOperator
  const initial = user?.username?.charAt(0).toUpperCase() || 'U'

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed))
    } catch {
      // localStorage unavailable
    }
  }, [collapsed])

  const { data: alertSummary } = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => alertsApi.eventsSummary().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const openCount = alertSummary?.open ?? 0

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore logout errors
    }
    useAuthStore.getState().logout()
    navigate('/login')
  }

  const renderItems = (items: NavItem[]) =>
    items
      .filter((item) => {
        if (item.adminOnly && !isAdmin) return false
        return true
      })
      .map(({ to, label, icon, end, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          title={collapsed ? label : undefined}
        >
          {icon}
          <span>{label}</span>
          {badge && openCount > 0 && (
            <span className="nav-badge red">{openCount}</span>
          )}
        </NavLink>
      ))

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon">
          <svg viewBox="0 0 32 32">
            <path d="M4 18c-1-0.5-2-2-2-4 0-4 3-6 7-6 1-5 5-9 11-9 5 0 9 3 11 7 3 1 5 4 5 7 0 3-2 6-5 7" stroke="#29ABE2" strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M3 22c3 3 8 5 15 5 9 0 15-4 18-9" stroke="#29ABE2" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7"/>
          </svg>
        </div>
        <div className="logo-text">C<span>WM</span></div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-section">Overview</div>
          {renderItems(overviewItems)}
        </div>

        <div className="nav-group">
          <div className="nav-section">Network</div>
          {renderItems(networkItems)}
        </div>

        <div className="nav-group">
          <div className="nav-section">Traffic</div>
          {renderItems(trafficItems)}
        </div>

        <div className="nav-group">
          <div className="nav-section">Power & Cooling</div>
          {renderItems(powerItems)}
        </div>

        <div className="nav-group">
          <div className="nav-section">Security</div>
          {renderItems(securityItems)}
        </div>

        <div className="nav-group">
          <div className="nav-section">Operations</div>
          {renderItems(operationsItems)}
        </div>

        {showAdmin && (
          <div className="nav-group">
            <div className="nav-section">Admin</div>
            {renderItems(adminItems)}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div className="avatar">{initial}</div>
          <div>
            <div className="user-name">{user?.username || 'User'}</div>
            <div className="user-role">{user?.role || 'readonly'}</div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={handleLogout}
            title="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed((prev) => !prev)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
      </button>
    </aside>
  )
}
