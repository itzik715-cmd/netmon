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
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="text-sm text-gray-500">
        Network Monitoring & Visibility Platform
      </div>

      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <div className="p-1.5 bg-blue-100 rounded-full">
            <User className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-gray-800">{user?.username}</div>
            <div className="text-xs">
              <span className={roleColors[user?.role || 'readonly'] || 'badge-gray'}>
                {user?.role}
              </span>
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
            <div className="p-3 border-b border-gray-100">
              <div className="text-sm font-medium text-gray-800">{user?.username}</div>
              <div className="text-xs text-gray-500">{user?.role} account</div>
            </div>
            <div className="p-2">
              <button
                onClick={() => { setDropdownOpen(false); navigate('/change-password') }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <User className="h-4 w-4" />
                Change Password
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
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
