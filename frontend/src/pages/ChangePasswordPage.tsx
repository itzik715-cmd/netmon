import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../services/api'
import toast from 'react-hot-toast'

const RULES = [
  { label: 'At least 10 characters', test: (p: string) => p.length >= 10 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number', test: (p: string) => /\d/.test(p) },
  { label: 'Special character', test: (p: string) => /[!@#$%^&*(),.?":{}|<>_\-\[\]\\;'/`~+=]/.test(p) },
]

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const { user, updateUser } = useAuthStore()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isMustChange = user?.must_change_password

  const allRulesPass = RULES.every((r) => r.test(newPassword))
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!allRulesPass) {
      setError('Password does not meet requirements')
      return
    }
    if (!passwordsMatch) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await authApi.changePassword({
        current_password: isMustChange ? undefined : currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      updateUser({ must_change_password: false })
      toast.success('Password changed successfully!')
      navigate('/')
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to change password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon" style={{ background: 'var(--accent-orange)' }}>
            <Shield size={28} color="white" />
          </div>
          <h1>Change Password</h1>
          {isMustChange && (
            <p style={{ color: 'var(--accent-orange)' }}>
              You must change your password before accessing the system
            </p>
          )}
        </div>

        {error && (
          <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isMustChange && (
            <div>
              <label className="label">Current Password</label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required={!isMustChange}
              />
            </div>
          )}

          <div>
            <label className="label">New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', display: 'flex', alignItems: 'center' }}
              >
                {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {newPassword.length > 0 && (
            <div style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {RULES.map((rule) => {
                const passes = rule.test(newPassword)
                return (
                  <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ color: passes ? 'var(--accent-green)' : 'var(--text-light)', fontSize: 14, lineHeight: 1 }}>
                      {passes ? '✓' : '○'}
                    </span>
                    <span style={{ color: passes ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                      {rule.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <div>
            <label className="label">Confirm New Password</label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {confirmPassword && !passwordsMatch && (
              <p style={{ color: 'var(--accent-red)', fontSize: 11, marginTop: 4 }}>Passwords do not match</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !allRulesPass || !passwordsMatch}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Change Password
          </button>
        </form>
      </div>
    </div>
  )
}
