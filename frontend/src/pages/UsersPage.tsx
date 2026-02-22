import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { User, Role } from '../types'
import { RefreshCw, Unlock, Trash2 } from 'lucide-react'
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => { toast.success('User deactivated'); qc.invalidateQueries({ queryKey: ['users'] }) },
  })
  const unlockMutation = useMutation({
    mutationFn: (id: number) => usersApi.unlock(id),
    onSuccess: () => { toast.success('Account unlocked'); qc.invalidateQueries({ queryKey: ['users'] }) },
  })
  const resetPwMutation = useMutation({
    mutationFn: (id: number) => usersApi.resetPassword(id),
    onSuccess: () => toast.success('Password reset required on next login'),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p>{users?.length || 0} active users</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary btn-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 13, height: 13 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add User
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="empty-state card-body"><p>Loading users...</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Username</th><th>Email</th><th>Role</th><th>Auth Source</th><th>Status</th><th>Last Login</th><th>Failed Attempts</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {(users || []).map((user) => (
                  <tr key={user.id}>
                    <td style={{ fontWeight: 600 }}>
                      {user.username}
                      {user.must_change_password && <span className="tag-orange" style={{ marginLeft: 8, fontSize: 10 }}>pwd change</span>}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{user.email}</td>
                    <td>{roleBadge(user.role.name)}</td>
                    <td>{authBadge(user.auth_source)}</td>
                    <td>
                      {user.account_locked
                        ? <span className="tag-red">Locked</span>
                        : user.is_active
                          ? <span className="tag-green">Active</span>
                          : <span className="tag-gray">Inactive</span>
                      }
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-light)' }}>
                      {user.last_login ? formatDistanceToNow(new Date(user.last_login), { addSuffix: true }) : 'Never'}
                    </td>
                    <td>
                      <span style={{ color: user.failed_attempts > 0 ? 'var(--accent-orange)' : 'var(--text-muted)' }}>{user.failed_attempts}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button onClick={() => resetPwMutation.mutate(user.id)} title="Force password reset"
                          style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-orange)', display: 'flex' }}>
                          <RefreshCw size={13} />
                        </button>
                        {user.account_locked && (
                          <button onClick={() => unlockMutation.mutate(user.id)} title="Unlock account"
                            style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-green)', display: 'flex' }}>
                            <Unlock size={13} />
                          </button>
                        )}
                        <button onClick={() => { if (confirm(`Deactivate user ${user.username}?`)) deleteMutation.mutate(user.id) }} title="Deactivate user"
                          style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-red)', display: 'flex' }}>
                          <Trash2 size={13} />
                        </button>
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
