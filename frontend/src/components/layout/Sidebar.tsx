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
  {
    to: '/blocks', label: 'Blocks',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
    ),
  },
]

const navAnalysis = [
  {
    to: '/topology', label: 'Topology',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
        <line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/>
      </svg>
    ),
  },
  {
    to: '/backups', label: 'Config Backups',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    to: '/reports', label: 'Reports',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    to: '/audit', label: 'Audit Log',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
  {
    to: '/system-events', label: 'System Logs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
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
        {/* Cloud Web Manage logo */}
        <svg viewBox="0 0 160 50" style={{ width: 110, height: 34, flexShrink: 0 }}>
          {/* Cloud icon */}
          <path d="M38 18c0-6-4.5-10.5-10.2-10.5c-4.2 0-7.8 2.5-9.3 6.2C17 12.5 15 11.5 12.8 11.5
            C9 11.5 6 14.5 6 18.3c0 .3 0 .5.05.8C3 19.8 1 22.3 1 25.2C1 29 4 32 7.8 32h26.4
            c4.5 0 8-3.5 8-8c0-3.5-2.2-6.5-5.5-7.5" fill="none" stroke="#29ABE2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          {/* Swoosh arc */}
          <path d="M10 28c8-2 18-12 30-8" fill="none" stroke="#29ABE2" strokeWidth="1.8" strokeLinecap="round" opacity="0.6"/>
          {/* "Cloud" text */}
          <text x="44" y="20" fontFamily="DM Sans, sans-serif" fontWeight="700" fontSize="16" fill="#29ABE2">Cloud</text>
          {/* "Web Manage" text */}
          <text x="44" y="32" fontFamily="DM Sans, sans-serif" fontWeight="400" fontSize="9" fill="#666" letterSpacing="0.5">Web Manage</text>
        </svg>
        <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }}></div>
        {/* NMP logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z"/>
            </svg>
          </div>
          <div className="logo-text">N<span>MP</span></div>
        </div>
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
