import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { AuditLog } from '../types'
import { format } from 'date-fns'
import { ClipboardList, Search } from 'lucide-react'

function actionColor(action: string): string {
  if (action.includes('login')) return action.includes('failed') ? 'tag-red' : 'tag-green'
  if (action.includes('delete') || action.includes('deleted')) return 'tag-red'
  if (action.includes('created') || action.includes('added')) return 'tag-blue'
  if (action.includes('updated') || action.includes('changed')) return 'tag-orange'
  return 'tag-gray'
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
    <div className="flex-col-gap">
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Read-only system activity log</p>
        </div>
      </div>

      <div className="search-bar">
        <Search size={13} />
        <input placeholder="Search by username, action, IP..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="empty-state">
          <div className="empty-state__icon"><ClipboardList /></div>
          <p className="empty-state__title">Loading audit logs...</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Timestamp</th><th>User</th><th>Action</th><th>Resource</th><th>Details</th><th>Source IP</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {filtered.map((log) => (
                    <tr key={log.id}>
                      <td className="mono text-xs text-light">
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </td>
                      <td className="font-semibold">{log.username || '\u2014'}</td>
                      <td>
                        <span className={actionColor(log.action)}>{log.action}</span>
                      </td>
                      <td className="text-sm text-muted">
                        {log.resource_type && <span>{log.resource_type}{log.resource_id && <span className="text-light"> #{log.resource_id}</span>}</span>}
                      </td>
                      <td className="text-xs text-light truncate">{log.details}</td>
                      <td className="mono text-xs text-light">{log.source_ip || '\u2014'}</td>
                      <td><span className={log.success ? 'tag-green' : 'tag-red'}>{log.success ? 'OK' : 'FAIL'}</span></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="empty-table-cell">No audit logs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pagination-footer">
            <span className="pagination-info">Showing {filtered.length} of {logs?.length} entries</span>
            <div className="pagination-controls">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="btn btn-outline btn-sm">Previous</button>
              <span className="pagination-page-info">Page {page + 1}</span>
              <button onClick={() => setPage(page + 1)} disabled={(logs?.length || 0) < pageSize} className="btn btn-outline btn-sm">Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
