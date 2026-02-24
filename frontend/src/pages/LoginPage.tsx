import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Eye, EyeOff, Loader2 } from 'lucide-react'
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
        toast('Password change required on first login', { icon: '\u26A0\uFE0F' })
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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Monitor size={28} color="white" />
          </div>
          <h1 className="auth-title">NMP</h1>
          <p className="auth-subtitle">Network Monitoring Platform</p>
        </div>

        {error && (
          <div className="alert-error">{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="form-field">
            <label className="form-label">Password</label>
            <div className="form-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="btn--ghost btn--icon btn--sm form-input-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="form-field">
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn btn-primary btn--full"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>

        <p className="auth-subtitle">Secure Network Monitoring — NMP</p>
      </div>
    </div>
  )
}
