import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { authApi } from '../../services/api'
import toast from 'react-hot-toast'

const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard',
  '/devices': 'Devices',
  '/alerts': 'Alerts',
  '/flows': 'Flow Analysis',
  '/users': 'Users & RBAC',
  '/settings': 'Settings',
  '/audit': 'Audit Log',
  '/change-password': 'Change Password',
}

function getPageName(pathname: string): string {
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname]
  if (pathname.startsWith('/devices/') && pathname.includes('/interfaces/')) return 'Interface Detail'
  if (pathname.startsWith('/devices/')) return 'Device Detail'
  if (pathname.startsWith('/interfaces/')) return 'Interface Detail'
  return 'NMP'
}

export default function Header() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')

  const pageName = getPageName(location.pathname)

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* ignore */ }
    logout()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (search.trim()) {
      navigate(`/devices?q=${encodeURIComponent(search.trim())}`)
      setSearch('')
    }
  }

  return (
    <header className="topbar">
      <div>
        <div className="breadcrumb">
          <span className="seg">NMP</span>
          <span className="sep">›</span>
          <span className="current">{pageName}</span>
        </div>
      </div>

      <div className="topbar-right">
        {/* Search */}
        <form onSubmit={handleSearch}>
          <div className="search-bar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search devices, IPs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </form>

        {/* Notifications */}
        <div className="topbar-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <div className="notif-dot"></div>
        </div>

        {/* User dropdown */}
        <div style={{ position: 'relative' }}>
          <div
            className="user-info"
            style={{ cursor: 'pointer' }}
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
              {user?.username?.slice(0, 2).toUpperCase() || 'U'}
            </div>
            <div>
              <div className="user-name">{user?.username}</div>
              <div className="user-role">{user?.role}</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, color: 'var(--text-light)' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>

          {dropdownOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                onClick={() => setDropdownOpen(false)}
              />
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                width: 200, background: 'white',
                border: '1px solid var(--border)', borderRadius: 10,
                boxShadow: 'var(--shadow-md)', zIndex: 100, overflow: 'hidden',
              }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div className="user-name">{user?.username}</div>
                  <div className="user-role">{user?.role} account</div>
                </div>
                <div style={{ padding: '6px' }}>
                  <button
                    onClick={() => { setDropdownOpen(false); navigate('/change-password') }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', background: 'none', border: 'none',
                      borderRadius: 7, cursor: 'pointer', fontSize: 13,
                      color: 'var(--text-muted)', fontFamily: 'inherit',
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                    </svg>
                    Change Password
                  </button>
                  <button
                    onClick={handleLogout}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', background: 'none', border: 'none',
                      borderRadius: 7, cursor: 'pointer', fontSize: 13,
                      color: 'var(--accent-red)', fontFamily: 'inherit',
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#fef0ee' }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Logout
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
