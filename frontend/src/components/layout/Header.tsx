import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Bell, ChevronDown, KeyRound, LogOut, User } from 'lucide-react'
import { alertsApi, authApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

/* ── friendly names for every route segment ── */
const SEGMENT_NAMES: Record<string, string> = {
  '': 'Dashboard',
  devices: 'Devices',
  interfaces: 'Interfaces',
  alerts: 'Alerts',
  blocks: 'Blocks',
  flows: 'Flow Analysis',
  wan: 'WAN Dashboard',
  topology: 'Topology',
  backups: 'Config Backups',
  reports: 'Reports',
  users: 'Users',
  settings: 'Settings',
  audit: 'Audit Log',
  'system-events': 'System Events',
  'change-password': 'Change Password',
}

/** Detect numeric-looking path segments and give them a contextual label */
function labelForSegment(seg: string, prevSeg: string | undefined): string {
  if (SEGMENT_NAMES[seg]) return SEGMENT_NAMES[seg]
  if (/^\d+$/.test(seg)) {
    if (prevSeg === 'devices') return 'Device Detail'
    if (prevSeg === 'interfaces') return 'Interface Detail'
    return `#${seg}`
  }
  return seg
}

/** Build breadcrumb items from the current pathname */
function buildBreadcrumbs(pathname: string) {
  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean)

  // root
  if (segments.length === 0) {
    return [{ label: 'Dashboard', path: '/', isLast: true }]
  }

  const crumbs: { label: string; path: string; isLast: boolean }[] = []
  let accumulated = ''

  for (let i = 0; i < segments.length; i++) {
    accumulated += '/' + segments[i]
    const label = labelForSegment(segments[i], segments[i - 1])
    crumbs.push({
      label,
      path: accumulated,
      isLast: i === segments.length - 1,
    })
  }

  return crumbs
}

export default function Header() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  /* ── close dropdown on outside click ── */
  useEffect(() => {
    if (!dropdownOpen) return

    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  /* ── alert summary query ── */
  const { data: alertSummary } = useQuery({
    queryKey: ['alerts', 'summary'],
    queryFn: () => alertsApi.eventsSummary(),
    refetchInterval: 30_000,
  })

  const hasOpenAlerts = (alertSummary?.data?.open ?? 0) > 0

  /* ── breadcrumbs ── */
  const crumbs = buildBreadcrumbs(location.pathname)

  /* ── handlers ── */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (search.trim()) {
      navigate(`/devices?q=${encodeURIComponent(search.trim())}`)
      setSearch('')
    }
  }

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch {
      /* ignore */
    }
    useAuthStore.getState().logout()
    navigate('/login')
  }

  const initials = user?.username?.slice(0, 2).toUpperCase() || 'U'

  return (
    <header className="topbar">
      {/* ── Left: Breadcrumbs ── */}
      <div>
        <nav className="breadcrumb">
          <span className="seg">
            <Link to="/">NMP</Link>
          </span>

          {crumbs.map((crumb, idx) => (
            <span key={crumb.path}>
              <span className="sep">/</span>
              {crumb.isLast ? (
                <span className="current">{crumb.label}</span>
              ) : (
                <span className="seg">
                  <Link to={crumb.path}>{crumb.label}</Link>
                </span>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* ── Right: actions ── */}
      <div className="topbar-right">
        {/* Search */}
        <form onSubmit={handleSearch}>
          <div className="search-bar">
            <Search />
            <input
              type="text"
              placeholder="Search devices, IPs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </form>

        {/* Notification bell */}
        <button className="topbar-btn" onClick={() => navigate('/alerts')}>
          <Bell />
          {hasOpenAlerts && <div className="notif-dot" />}
        </button>

        {/* User dropdown */}
        <div className="user-dropdown" ref={dropdownRef}>
          <div
            className="user-info"
            onClick={() => setDropdownOpen((prev) => !prev)}
          >
            <div className="avatar">{initials}</div>
            <div>
              <div className="user-name">{user?.username}</div>
              <div className="user-role">{user?.role}</div>
            </div>
            <ChevronDown size={14} />
          </div>

          {dropdownOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-header">
                <div className="user-name">{user?.username}</div>
                <div className="user-role">{user?.role} account</div>
              </div>
              <div className="dropdown-body">
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setDropdownOpen(false)
                    navigate('/change-password')
                  }}
                >
                  <KeyRound />
                  Change Password
                </button>
                <button
                  className="dropdown-item dropdown-item--danger"
                  onClick={() => {
                    setDropdownOpen(false)
                    handleLogout()
                  }}
                >
                  <LogOut />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
