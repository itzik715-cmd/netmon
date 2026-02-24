import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff, Loader2, Check, Circle } from 'lucide-react'
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
          <div className="auth-logo-icon auth-logo-icon--warning">
            <Shield size={28} color="white" />
          </div>
          <h1 className="auth-title">Change Password</h1>
          {isMustChange && (
            <p className="auth-subtitle auth-subtitle--warning">
              You must change your password before accessing the system
            </p>
          )}
        </div>

        {error && (
          <div className="alert-error">{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          {!isMustChange && (
            <div className="form-field">
              <label className="form-label">Current Password</label>
              <input
                type="password"
                className="form-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required={!isMustChange}
              />
            </div>
          )}

          <div className="form-field">
            <label className="form-label">New Password</label>
            <div className="form-input-wrap">
              <input
                type={showNew ? 'text' : 'password'}
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn--ghost btn--icon btn--sm form-input-toggle"
                onClick={() => setShowNew(!showNew)}
              >
                {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {newPassword.length > 0 && (
            <div className="form-field">
              <div className="password-rules">
                {RULES.map((rule) => {
                  const passes = rule.test(newPassword)
                  return (
                    <div key={rule.label} className={`password-rule ${passes ? 'password-rule--pass' : ''}`}>
                      <span className="password-rule__icon">
                        {passes ? <Check size={14} /> : <Circle size={14} />}
                      </span>
                      <span>{rule.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="form-field">
            <label className="form-label">Confirm New Password</label>
            <input
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {confirmPassword && !passwordsMatch && (
              <p className="form-error">Passwords do not match</p>
            )}
          </div>

          <div className="form-field">
            <button
              type="submit"
              disabled={loading || !allRulesPass || !passwordsMatch}
              className="btn btn-primary btn--full"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Change Password
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
