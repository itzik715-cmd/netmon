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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-100 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h3>Create User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4">
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
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="must_change"
                checked={form.must_change_password}
                onChange={(e) => setForm((p) => ({ ...p, must_change_password: e.target.checked }))}
                className="h-4 w-4 rounded bg-dark-200 border-slate-600"
              />
              <label htmlFor="must_change" className="text-sm text-slate-300">
                Force password change on first login
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 p-5 border-t border-slate-700">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
