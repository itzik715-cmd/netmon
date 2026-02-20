import { LogOut, User, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { authApi } from '../../services/api'
import toast from 'react-hot-toast'

export default function Header() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore
    }
    logout()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  const roleColors: Record<string, string> = {
    admin: 'badge-danger',
    operator: 'badge-warning',
    readonly: 'badge-gray',
  }

  return (
    <header className="bg-dark-200 border-b border-slate-700 px-6 py-3 flex items-center justify-between">
      <div className="text-sm text-slate-400">
        Network Monitoring & Visibility Platform
      </div>

      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-dark-100 transition-colors"
        >
          <div className="p-1.5 bg-blue-900/50 rounded-full">
            <User className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-slate-200">{user?.username}</div>
            <div className="text-xs">
              <span className={roleColors[user?.role || 'readonly'] || 'badge-gray'}>
                {user?.role}
              </span>
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-dark-100 border border-slate-700 rounded-xl shadow-xl z-50">
            <div className="p-3 border-b border-slate-700">
              <div className="text-sm font-medium text-slate-200">{user?.username}</div>
              <div className="text-xs text-slate-500">{user?.role} account</div>
            </div>
            <div className="p-2">
              <button
                onClick={() => { setDropdownOpen(false); navigate('/change-password') }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-slate-100 hover:bg-dark-200 rounded-lg transition-colors"
              >
                <User className="h-4 w-4" />
                Change Password
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
