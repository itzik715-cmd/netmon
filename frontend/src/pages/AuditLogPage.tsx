import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { AuditLog } from '../types'
import { ClipboardList, Search } from 'lucide-react'
import { format } from 'date-fns'

function actionColor(action: string): string {
  if (action.includes('login')) return action.includes('failed') ? 'text-red-400' : 'text-emerald-400'
  if (action.includes('delete') || action.includes('deleted')) return 'text-red-400'
  if (action.includes('created') || action.includes('added')) return 'text-blue-400'
  if (action.includes('updated') || action.includes('changed')) return 'text-amber-400'
  return 'text-slate-400'
}

export default function AuditLogPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => usersApi.auditLogs({ limit: pageSize, offset: page * pageSize }).then((r) => r.data as AuditLog[]),
    refetchInterval: 30_000,
  })

  const filtered = (logs || []).filter(
    (log) =>
      (log.username || '').toLowerCase().includes(search.toLowerCase()) ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      (log.resource_type || '').toLowerCase().includes(search.toLowerCase()) ||
      (log.source_ip || '').includes(search)
  )

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p className="text-sm text-slate-400 mt-0.5">Read-only system activity log</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          className="input pl-10"
          placeholder="Search by username, action, IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading audit logs...</div>
      ) : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Details</th>
                  <th>Source IP</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td className="text-xs text-slate-500 font-mono">
                      {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                    </td>
                    <td className="font-medium text-sm">{log.username || '—'}</td>
                    <td>
                      <span className={`font-mono text-xs ${actionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="text-slate-400 text-sm">
                      {log.resource_type && (
                        <span>
                          {log.resource_type}
                          {log.resource_id && <span className="text-slate-600"> #{log.resource_id}</span>}
                        </span>
                      )}
                    </td>
                    <td className="text-slate-500 text-xs max-w-xs truncate">{log.details}</td>
                    <td className="font-mono text-xs text-slate-500">{log.source_ip || '—'}</td>
                    <td>
                      <span className={log.success ? 'badge-success' : 'badge-danger'}>
                        {log.success ? 'OK' : 'FAIL'}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-500">No audit logs found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">
              Showing {filtered.length} of {logs?.length} entries
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="btn-secondary btn-sm"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm text-slate-400">Page {page + 1}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(logs?.length || 0) < pageSize}
                className="btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
