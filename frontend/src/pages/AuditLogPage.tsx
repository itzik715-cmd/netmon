import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '../services/api'
import { AuditLog } from '../types'
import { format } from 'date-fns'

function actionColor(action: string): string {
  if (action.includes('login')) return action.includes('failed') ? 'var(--accent-red)' : 'var(--accent-green)'
  if (action.includes('delete') || action.includes('deleted')) return 'var(--accent-red)'
  if (action.includes('created') || action.includes('added')) return 'var(--primary)'
  if (action.includes('updated') || action.includes('changed')) return 'var(--accent-orange)'
  return 'var(--text-muted)'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Read-only system activity log</p>
        </div>
      </div>

      <div className="search-bar" style={{ height: 38, maxWidth: 400 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input style={{ width: '100%' }} placeholder="Search by username, action, IP..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="empty-state"><p>Loading audit logs...</p></div>
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
                      <td style={{ fontSize: 11, color: 'var(--text-light)', fontFamily: 'DM Mono, monospace' }}>
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{log.username || '—'}</td>
                      <td>
                        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: actionColor(log.action) }}>{log.action}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {log.resource_type && <span>{log.resource_type}{log.resource_id && <span style={{ color: 'var(--text-light)' }}> #{log.resource_id}</span>}</span>}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-light)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.details}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-light)' }}>{log.source_ip || '—'}</td>
                      <td><span className={log.success ? 'tag-green' : 'tag-red'}>{log.success ? 'OK' : 'FAIL'}</span></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>No audit logs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Showing {filtered.length} of {logs?.length} entries</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="btn btn-outline btn-sm">Previous</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 8px' }}>Page {page + 1}</span>
              <button onClick={() => setPage(page + 1)} disabled={(logs?.length || 0) < pageSize} className="btn btn-outline btn-sm">Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
