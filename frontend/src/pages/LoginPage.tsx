import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../services/api'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await authApi.login(username, password)
      const { access_token, refresh_token, role, must_change_password } = response.data

      setAuth(access_token, refresh_token, {
        id: 0,
        username,
        role,
        must_change_password,
      })

      // Get full user info
      const meResponse = await authApi.me()
      setAuth(access_token, refresh_token, {
        id: meResponse.data.id,
        username: meResponse.data.username,
        role: meResponse.data.role,
        must_change_password: meResponse.data.must_change_password,
      })

      if (must_change_password) {
        toast('Password change required on first login', { icon: '⚠️' })
        navigate('/change-password')
      } else {
        toast.success(`Welcome back, ${username}!`)
        navigate('/')
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-dark-300 flex items-center justify-center p-4">
      {/* Background pattern */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-900/10 via-transparent to-purple-900/10" />
      </div>

      <div className="w-full max-w-md z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-blue-900/50 rounded-2xl border border-blue-700/50 mb-4">
            <Network className="h-10 w-10 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold text-slate-100">NetMon Platform</h1>
          <p className="text-slate-400 mt-1">Network Monitoring & Visibility</p>
        </div>

        {/* Login Card */}
        <div className="card shadow-2xl">
          <h2 className="text-lg font-semibold mb-6 text-slate-100">Sign In</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          NetMon Platform — Secure Network Monitoring
        </p>
      </div>
    </div>
  )
}
