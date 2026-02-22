import { useQuery } from '@tanstack/react-query'
import { devicesApi, alertsApi } from '../services/api'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { AlertEvent, Device } from '../types'

function statusTag(status: string) {
  const map: Record<string, string> = {
    up: 'tag-green', down: 'tag-red', unknown: 'tag-gray', degraded: 'tag-orange',
  }
  const dotMap: Record<string, string> = {
    up: 'dot-green', down: 'dot-red', unknown: 'dot-orange', degraded: 'dot-orange',
  }
  return (
    <span className={map[status] || 'tag-gray'}>
      <span className={`status-dot ${dotMap[status] || 'dot-orange'}`} />
      {status}
    </span>
  )
}

function severityTag(severity: string) {
  const map: Record<string, string> = {
    critical: 'tag-red', warning: 'tag-orange', info: 'tag-blue',
  }
  return <span className={map[severity] || 'tag-gray'}>{severity}</span>
}

function severityIconClass(severity: string) {
  if (severity === 'critical') return 'crit'
  if (severity === 'warning') return 'warn'
  return 'info'
}

export default function DashboardPage() {
  const { data: summary } = useQuery({
    queryKey: ['device-summary'],
    queryFn: () => devicesApi.summary().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: alertSummary } = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => alertsApi.eventsSummary().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: alertEvents } = useQuery({
    queryKey: ['alert-events-open'],
    queryFn: () => alertsApi.listEvents({ status: 'open', limit: 10 }).then((r) => r.data),
    refetchInterval: 30_000,
  })

  const downDevices = (devices as Device[] | undefined)?.filter((d) => d.status === 'down') || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Network overview at a glance</p>
        </div>
        <Link to="/devices" className="btn btn-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Device
        </Link>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <Link to="/devices" style={{ textDecoration: 'none' }}>
          <div className="stat-card">
            <div className="stat-icon blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <div className="stat-body">
              <div className="stat-label">Total Devices</div>
              <div className="stat-value">{summary?.total_devices ?? '—'}</div>
              <div className="stat-sub">configured</div>
            </div>
          </div>
        </Link>

        <div className="stat-card">
          <div className="stat-icon green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div className="stat-body">
            <div className="stat-label">Online</div>
            <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{summary?.devices_up ?? '—'}</div>
            <div className="stat-sub"><span className="stat-up">↑ reachable</span></div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon red">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div className="stat-body">
            <div className="stat-label">Offline / Issues</div>
            <div className="stat-value" style={{ color: 'var(--accent-red)' }}>{summary?.devices_down ?? '—'}</div>
            <div className="stat-sub"><span className="stat-down">↑ from yesterday</span></div>
          </div>
        </div>

        <Link to="/alerts" style={{ textDecoration: 'none' }}>
          <div className="stat-card">
            <div className="stat-icon orange">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div className="stat-body">
              <div className="stat-label">Active Alerts</div>
              <div className="stat-value" style={{ color: 'var(--accent-orange)' }}>{alertSummary?.open ?? '—'}</div>
              {alertSummary && (
                <div className="stat-sub"><span className="stat-down">{alertSummary.critical} critical</span></div>
              )}
            </div>
          </div>
        </Link>
      </div>

      <div className="grid-3-1">
        {/* Down Devices */}
        <div className="card">
          <div className="card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <h3>Down Devices</h3>
            <Link to="/devices" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
              View all →
            </Link>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {downDevices.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 24px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 36, height: 36 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <p>All devices are online</p>
              </div>
            ) : (
              <div>
                {downDevices.slice(0, 6).map((device) => (
                  <Link
                    key={device.id}
                    to={`/devices/${device.id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '11px 18px', borderBottom: '1px solid #f1f5f9',
                    }}
                      onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
                      onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>{device.hostname}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{device.ip_address}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {statusTag(device.status)}
                        {device.last_seen && (
                          <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                            {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="card">
          <div className="card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
            </svg>
            <h3>Active Alerts</h3>
            <span className="tag tag-red" style={{ marginLeft: 'auto' }}>{alertSummary?.open ?? 0} Open</span>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {!alertEvents || alertEvents.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 32, height: 32 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                </svg>
                <p>No active alerts</p>
              </div>
            ) : (
              alertEvents.slice(0, 5).map((event: AlertEvent) => (
                <div key={event.id} className="alert-item">
                  <div className={`alert-icon ${severityIconClass(event.severity)}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  </div>
                  <div className="alert-text">
                    <div className="alert-title">{severityTag(event.severity)} {event.message?.slice(0, 40)}</div>
                    <div className="alert-desc">{event.message}</div>
                  </div>
                  <div className="alert-time">
                    {formatDistanceToNow(new Date(event.triggered_at), { addSuffix: true })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Device Table */}
      <div className="card">
        <div className="card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <h3>All Devices</h3>
          <Link to="/devices" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>
            Manage Devices
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>IP Address</th>
                <th>Type</th>
                <th>Location</th>
                <th>Status</th>
                <th>Interfaces</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {(devices as Device[] | undefined)?.map((device) => (
                <tr key={device.id}>
                  <td>
                    <div className="device-name">
                      <div className="device-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="3" width="20" height="14" rx="2"/>
                        </svg>
                      </div>
                      <Link to={`/devices/${device.id}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
                        {device.hostname}
                      </Link>
                    </div>
                    {device.vendor && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 36 }}>{device.vendor} {device.model}</div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{device.ip_address}</td>
                  <td>
                    {device.device_type && <span className="tag-blue">{device.device_type}</span>}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{device.location?.name || '—'}</td>
                  <td>{statusTag(device.status)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{device.interface_count ?? 0}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-light)' }}>
                    {device.last_seen
                      ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                      : 'Never'}
                  </td>
                </tr>
              ))}
              {(!devices || (devices as Device[]).length === 0) && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                    No devices configured. <Link to="/devices" style={{ color: 'var(--primary)' }}>Add your first device</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
