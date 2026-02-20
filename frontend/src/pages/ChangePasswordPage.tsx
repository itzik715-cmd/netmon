import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff, Loader2, CheckCircle, XCircle } from 'lucide-react'
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
    <div className="min-h-screen bg-dark-300 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-amber-900/30 rounded-2xl border border-amber-700/50 mb-4">
            <Shield className="h-10 w-10 text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Change Password</h1>
          {isMustChange && (
            <p className="text-amber-400 text-sm mt-2">
              You must change your password before accessing the system
            </p>
          )}
        </div>

        <div className="card shadow-2xl">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  className="input pr-10"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Password Rules */}
            {newPassword.length > 0 && (
              <div className="p-3 bg-dark-200 rounded-lg space-y-1">
                {RULES.map((rule) => {
                  const passes = rule.test(newPassword)
                  return (
                    <div key={rule.label} className="flex items-center gap-2 text-xs">
                      {passes
                        ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-slate-600 flex-shrink-0" />
                      }
                      <span className={passes ? 'text-emerald-400' : 'text-slate-500'}>
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
                <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !allRulesPass || !passwordsMatch}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Change Password
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
