import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { User, Role } from '../types'
import { Users, Plus, Key, Unlock, Loader2, Shield, ShieldOff, UserCheck, UserX } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import AddUserModal from '../components/forms/AddUserModal'

function roleBadge(role: string) {
  const map: Record<string, string> = { admin: 'tag-red', operator: 'tag-orange', readonly: 'tag-gray' }
  return <span className={map[role] || 'tag-gray'}>{role}</span>
}

function authBadge(source: string) {
  return source === 'ldap' ? <span className="tag-blue">LDAP</span> : <span className="tag-gray">Local</span>
}

export default function UsersPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then((r) => r.data as User[]),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => usersApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const unlockMutation = useMutation({
    mutationFn: (id: number) => usersApi.unlock(id),
    onSuccess: () => { toast.success('Account unlocked'); qc.invalidateQueries({ queryKey: ['users'] }) },
  })
  const resetPwMutation = useMutation({
    mutationFn: (id: number) => usersApi.resetPassword(id),
    onSuccess: () => toast.success('Password reset required on next login'),
  })

  const handleToggleActive = (user: User) => {
    const next = !user.is_active
    toggleMutation.mutate(
      { id: user.id, data: { is_active: next } },
      { onSuccess: () => toast.success(`${user.username} ${next ? 'enabled' : 'disabled'}`) },
    )
  }

  const handleToggleMfa = (user: User) => {
    const next = !user.mfa_enabled
    toggleMutation.mutate(
      { id: user.id, data: { mfa_enabled: next } },
      { onSuccess: () => toast.success(`MFA ${next ? 'enabled' : 'disabled'} for ${user.username}`) },
    )
  }

  const activeCount = users?.filter((u) => u.is_active).length || 0

  return (
    <div className="content">
      <div className="page-header">
        <div>
          <h1><Users size={20} /> User Management</h1>
          <p>{activeCount} active / {users?.length || 0} total users</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary btn-sm">
          <Plus size={13} />
          Add User
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="empty-state card-body">
            <Loader2 size={20} className="animate-spin" />
            <p>Loading users...</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th><th>Email</th><th>Role</th><th>Auth</th>
                  <th>MFA</th><th>Active</th><th>Last Login</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users || []).map((user) => (
                  <tr key={user.id} style={!user.is_active ? { opacity: 0.5 } : undefined}>
                    <td>
                      <strong>{user.username}</strong>
                      {user.must_change_password && <span className="tag-orange" style={{ marginLeft: 6 }}>pwd change</span>}
                      {user.account_locked && <span className="tag-red" style={{ marginLeft: 6 }}>Locked</span>}
                    </td>
                    <td>{user.email}</td>
                    <td>{roleBadge(user.role.name)}</td>
                    <td>{authBadge(user.auth_source)}</td>
                    <td>
                      <button
                        onClick={() => handleToggleMfa(user)}
                        title={user.mfa_enabled ? 'MFA enabled — click to disable' : 'MFA disabled — click to enable'}
                        className={`btn btn--icon btn-sm ${user.mfa_enabled ? 'btn-outline' : 'btn--ghost'}`}
                        style={user.mfa_enabled ? { color: 'var(--color-success)' } : { color: 'var(--color-text-muted)' }}
                      >
                        {user.mfa_enabled ? <Shield size={14} /> : <ShieldOff size={14} />}
                      </button>
                    </td>
                    <td>
                      <button
                        onClick={() => handleToggleActive(user)}
                        title={user.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}
                        className={`btn btn--icon btn-sm ${user.is_active ? 'btn-outline' : 'btn--ghost'}`}
                        style={user.is_active ? { color: 'var(--color-success)' } : { color: 'var(--color-danger)' }}
                      >
                        {user.is_active ? <UserCheck size={14} /> : <UserX size={14} />}
                      </button>
                    </td>
                    <td>
                      {user.last_login ? formatDistanceToNow(new Date(user.last_login), { addSuffix: true }) : 'Never'}
                    </td>
                    <td>
                      <div className="card__actions">
                        <button onClick={() => resetPwMutation.mutate(user.id)} title="Force password reset" className="btn btn-outline btn--icon btn-sm">
                          <Key size={13} />
                        </button>
                        {user.account_locked && (
                          <button onClick={() => unlockMutation.mutate(user.id)} title="Unlock account" className="btn btn-outline btn--icon btn-sm">
                            <Unlock size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
