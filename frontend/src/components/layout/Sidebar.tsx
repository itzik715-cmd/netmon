import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

const navMain = [
  {
    to: '/', label: 'Dashboard', exact: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    to: '/devices', label: 'Devices',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    ),
  },
  {
    to: '/alerts', label: 'Alerts',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
    badge: 'red',
  },
  {
    to: '/flows', label: 'Flow Analysis',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
]

const navAnalysis = [
  {
    to: '/audit', label: 'Audit Log',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
]

const navAdmin = [
  {
    to: '/users', label: 'Users & RBAC',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
      </svg>
    ),
  },
  {
    to: '/settings', label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
      </svg>
    ),
  },
]

export default function Sidebar() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const initials = user?.username?.slice(0, 2).toUpperCase() || 'U'

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z"/>
          </svg>
        </div>
        <div className="logo-text">N<span>MP</span></div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">Main</div>
        {navMain.map(({ to, label, icon, exact, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {icon}
            {label}
            {badge && <span className={`nav-badge ${badge}`}></span>}
          </NavLink>
        ))}

        <div className="nav-section">Analysis</div>
        {navAnalysis.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {icon}
            {label}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="nav-section">Administration</div>
            {navAdmin.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                {icon}
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div className="avatar">{initials}</div>
          <div>
            <div className="user-name">{user?.username || 'User'}</div>
            <div className="user-role">{user?.role || 'readonly'}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
