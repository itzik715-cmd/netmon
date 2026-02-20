import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Server, Bell, Activity, Users,
  ClipboardList, Settings, Network, Shield
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import clsx from 'clsx'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/devices', icon: Server, label: 'Devices' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/flows', icon: Activity, label: 'Flow Analysis' },
]

const adminItems = [
  { to: '/users', icon: Users, label: 'User Management' },
  { to: '/audit', icon: ClipboardList, label: 'Audit Log' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  return (
    <aside className="w-64 bg-dark-200 border-r border-slate-700 flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 p-5 border-b border-slate-700">
        <div className="p-2 bg-blue-900/50 rounded-lg border border-blue-700/50">
          <Network className="h-6 w-6 text-blue-400" />
        </div>
        <div>
          <div className="font-bold text-slate-100">NetMon</div>
          <div className="text-xs text-slate-500">Network Monitoring</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2">
          Monitoring
        </div>
        {navItems.map(({ to, icon: Icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              clsx('nav-link', isActive && 'active')
            }
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2 mt-4">
              Administration
            </div>
            {adminItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx('nav-link', isActive && 'active')
                }
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Version */}
      <div className="p-4 border-t border-slate-700">
        <div className="text-xs text-slate-600 text-center">NetMon v1.0.0</div>
      </div>
    </aside>
  )
}
