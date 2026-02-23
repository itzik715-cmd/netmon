import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { systemEventsApi } from '../services/api'

interface SystemEvent {
  id: number
  timestamp: string
  level: string
  source: string
  event_type: string
  resource_type?: string
  resource_id?: string
  message: string
  details?: string
}

const LEVELS = ['', 'info', 'warning', 'error']
const SOURCES = ['', 'backup', 'snmp_poll', 'flow', 'alert_engine', 'scheduler']

function levelBadge(level: string) {
  const cls: Record<string, string> = {
    info: 'tag-blue',
    warning: 'tag-orange',
    error: 'tag-red',
  }
  return <span className={cls[level] || 'tag-gray'}>{level}</span>
}

function sourceBadge(source: string) {
  return <span className="tag-gray" style={{ fontSize: 11 }}>{source}</span>
}

export default function SystemEventsPage() {
  const [level, setLevel]   = useState('')
  const [source, setSource] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data: events = [], isLoading, refetch } = useQuery<SystemEvent[]>({
    queryKey: ['system-events', level, source],
    queryFn: () =>
      systemEventsApi.list({ limit: 500, level: level || undefined, source: source || undefined })
        .then((r) => r.data),
    refetchInterval: 30_000,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>System Logs</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Operational events from background services (backups, polling, flows…)
          </p>
        </div>
        <button onClick={() => refetch()} className="btn btn-outline btn-sm">↻ Refresh</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select
          className="select"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          style={{ width: 140 }}
        >
          <option value="">All levels</option>
          {LEVELS.filter(Boolean).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select
          className="select"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          style={{ width: 160 }}
        >
          <option value="">All sources</option>
          {SOURCES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="card">
        {isLoading ? (
          <div className="empty-state"><p>Loading events…</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Time</th>
                  <th style={{ width: 80 }}>Level</th>
                  <th style={{ width: 100 }}>Source</th>
                  <th style={{ width: 120 }}>Resource</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <>
                    <tr
                      key={ev.id}
                      style={{ cursor: ev.details ? 'pointer' : 'default' }}
                      onClick={() => ev.details && setExpanded(expanded === ev.id ? null : ev.id)}
                    >
                      <td style={{ fontSize: 11, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>
                        {formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })}
                      </td>
                      <td>{levelBadge(ev.level)}</td>
                      <td>{sourceBadge(ev.source)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {ev.resource_id || '—'}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {ev.message}
                        {ev.details && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                            {expanded === ev.id ? '▲ hide' : '▼ details'}
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded === ev.id && ev.details && (
                      <tr key={`${ev.id}-detail`}>
                        <td colSpan={5} style={{ padding: '0 16px 12px' }}>
                          <pre style={{
                            background: 'var(--bg-secondary, #f8fafc)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: '10px 14px',
                            fontSize: 11,
                            fontFamily: 'DM Mono, monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            color: 'var(--accent-red)',
                            margin: 0,
                          }}>
                            {ev.details}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                      No system events recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
