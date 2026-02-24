import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { User, Role } from '../types'
import { Users, Plus, Trash2, Key, Unlock, Loader2 } from 'lucide-react'
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
    <div className="content">
      <div className="page-header">
        <div>
          <h1><Users size={20} /> User Management</h1>
          <p>{users?.length || 0} active users</p>
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
                <tr><th>Username</th><th>Email</th><th>Role</th><th>Auth Source</th><th>Status</th><th>Last Login</th><th>Failed Attempts</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {(users || []).map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.username}</strong>
                      {user.must_change_password && <span className="tag-orange">pwd change</span>}
                    </td>
                    <td>{user.email}</td>
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
                    <td>
                      {user.last_login ? formatDistanceToNow(new Date(user.last_login), { addSuffix: true }) : 'Never'}
                    </td>
                    <td>
                      <span className={user.failed_attempts > 0 ? 'tag-orange' : 'tag-gray'}>{user.failed_attempts}</span>
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
                        <button onClick={() => { if (confirm(`Deactivate user ${user.username}?`)) deleteMutation.mutate(user.id) }} title="Deactivate user" className="btn btn-danger btn--icon btn-sm">
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
