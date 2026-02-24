import { useState, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { systemEventsApi } from '../services/api'
import { Terminal, Filter } from 'lucide-react'

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
  return <span className="tag-gray">{source}</span>
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
    <div className="flex-col-gap">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>System Logs</h1>
          <p>Operational events from background services (backups, polling, flows...)</p>
        </div>
        <button onClick={() => refetch()} className="btn btn-outline btn-sm">
          <Terminal size={13} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex-row-gap-lg">
        <Filter size={14} className="text-muted" />
        <select
          className="select"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
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
        >
          <option value="">All sources</option>
          {SOURCES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="ml-auto text-sm text-muted">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="card">
        {isLoading ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Terminal /></div>
            <p className="empty-state__title">Loading events...</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Source</th>
                  <th>Resource</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <Fragment key={ev.id}>
                    <tr
                      className={ev.details ? 'cursor-pointer' : ''}
                      onClick={() => ev.details && setExpanded(expanded === ev.id ? null : ev.id)}
                    >
                      <td className="text-xs text-light mono">
                        {formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })}
                      </td>
                      <td>{levelBadge(ev.level)}</td>
                      <td>{sourceBadge(ev.source)}</td>
                      <td className="text-sm text-muted">
                        {ev.resource_id || '\u2014'}
                      </td>
                      <td>
                        {ev.message}
                        {ev.details && (
                          <span className="text-xs text-muted ml-2">
                            {expanded === ev.id ? '\u25B2 hide' : '\u25BC details'}
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded === ev.id && ev.details && (
                      <tr>
                        <td colSpan={5} className="card-body">
                          <pre className="form-section mono">{ev.details}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-table-cell">
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
