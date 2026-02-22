import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { User, Role } from '../types'
import { Plus, Lock, Unlock, Trash2, RefreshCw, UserCheck } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import AddUserModal from '../components/forms/AddUserModal'

function roleBadge(role: string) {
  const map: Record<string, string> = {
    admin: 'badge-danger', operator: 'badge-warning', readonly: 'badge-gray',
  }
  return <span className={map[role] || 'badge-gray'}>{role}</span>
}

function authBadge(source: string) {
  return source === 'ldap'
    ? <span className="badge-info">LDAP</span>
    : <span className="badge-gray">Local</span>
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
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users?.length || 0} active users</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-primary btn-sm flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading users...</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Auth Source</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Failed Attempts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((user) => (
                <tr key={user.id}>
                  <td className="font-medium">
                    {user.username}
                    {user.must_change_password && (
                      <span className="ml-2 badge-warning text-xs">pwd change</span>
                    )}
                  </td>
                  <td className="text-gray-500 text-sm">{user.email}</td>
                  <td>{roleBadge(user.role.name)}</td>
                  <td>{authBadge(user.auth_source)}</td>
                  <td>
                    {user.account_locked ? (
                      <span className="badge-danger">Locked</span>
                    ) : user.is_active ? (
                      <span className="badge-success">Active</span>
                    ) : (
                      <span className="badge-gray">Inactive</span>
                    )}
                  </td>
                  <td className="text-gray-400 text-xs">
                    {user.last_login
                      ? formatDistanceToNow(new Date(user.last_login), { addSuffix: true })
                      : 'Never'}
                  </td>
                  <td>
                    <span className={user.failed_attempts > 0 ? 'text-amber-600' : 'text-gray-500'}>
                      {user.failed_attempts}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => resetPwMutation.mutate(user.id)}
                        className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                        title="Force password reset"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      {user.account_locked && (
                        <button
                          onClick={() => unlockMutation.mutate(user.id)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Unlock account"
                        >
                          <Unlock className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Deactivate user ${user.username}?`)) {
                            deleteMutation.mutate(user.id)
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Deactivate user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
