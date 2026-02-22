import { useState, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../../services/api'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Role } from '../../types'

export default function AddUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    role_id: '',
    must_change_password: true,
  })

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => usersApi.roles().then((r) => r.data as Role[]),
  })

  const mutation = useMutation({
    mutationFn: (data: object) => usersApi.create(data),
    onSuccess: () => {
      toast.success('User created successfully')
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.role_id) {
      toast.error('Please select a role')
      return
    }
    mutation.mutate({ ...form, role_id: parseInt(form.role_id) })
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Create User</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Username *</label>
              <input className="input" value={form.username} onChange={set('username')} required
                pattern="[a-zA-Z0-9_.\-]{3,100}" placeholder="username" />
            </div>
            <div>
              <label className="label">Email *</label>
              <input className="input" type="email" value={form.email} onChange={set('email')} required />
            </div>
            <div>
              <label className="label">Initial Password *</label>
              <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={6} />
            </div>
            <div>
              <label className="label">Role *</label>
              <select className="select" value={form.role_id} onChange={set('role_id')} required>
                <option value="">Select role...</option>
                {(roles || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name} — {r.description}</option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.must_change_password}
                onChange={(e) => setForm((p) => ({ ...p, must_change_password: e.target.checked }))}
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-main)' }}>
                Force password change on first login
              </span>
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary">
              {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
