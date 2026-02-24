import { useQuery } from '@tanstack/react-query'
import { devicesApi, alertsApi, blocksApi } from '../services/api'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { AlertEvent, Device } from '../types'
import { Server, CheckCircle, ShieldAlert, Ban, AlertTriangle, XCircle } from 'lucide-react'

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

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <XCircle size={15} />
  if (severity === 'warning') return <AlertTriangle size={15} />
  return <ShieldAlert size={15} />
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

  const { data: blocksSummary } = useQuery({
    queryKey: ['blocks-summary'],
    queryFn: () => blocksApi.summary().then((r) => r.data),
    refetchInterval: 60_000,
  })

  const downDevices = (devices as Device[] | undefined)?.filter((d) => d.status === 'down') || []
  const totalDevices = summary?.total_devices ?? 0
  const devicesUp = summary?.devices_up ?? 0
  const onlinePercent = totalDevices > 0 ? Math.round((devicesUp / totalDevices) * 100) : 0

  const deviceMap = new Map<number, Device>()
  if (devices) {
    for (const d of devices as Device[]) {
      deviceMap.set(d.id, d)
    }
  }

  return (
    <div className="content">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Network overview at a glance</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <Link to="/devices" className="stat-card">
          <div className="stat-icon blue">
            <Server size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Total Devices</div>
            <div className="stat-value">{summary?.total_devices ?? '\u2014'}</div>
            <div className="stat-sub">configured</div>
          </div>
        </Link>

        <div className="stat-card">
          <div className="stat-icon green">
            <CheckCircle size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Online</div>
            <div className="stat-value">{totalDevices > 0 ? `${onlinePercent}%` : '\u2014'}</div>
            <div className="stat-sub"><span className="stat-up">{devicesUp} reachable</span></div>
          </div>
        </div>

        <Link to="/alerts" className="stat-card">
          <div className="stat-icon orange">
            <ShieldAlert size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Active Alerts</div>
            <div className="stat-value">{alertSummary?.open ?? '\u2014'}</div>
            {alertSummary && (
              <div className="stat-sub"><span className="stat-down">{alertSummary.critical} critical</span></div>
            )}
          </div>
        </Link>

        <Link to="/blocks" className="stat-card">
          <div className="stat-icon red">
            <Ban size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Active Blocks</div>
            <div className="stat-value">{blocksSummary?.total ?? '\u2014'}</div>
            <div className="stat-sub">
              {blocksSummary ? `${blocksSummary.null_route} null-route, ${blocksSummary.flowspec} flowspec` : 'null-route + flowspec'}
            </div>
          </div>
        </Link>
      </div>

      {/* Two-column row */}
      <div className="grid-3-1">
        {/* Down Devices */}
        <div className="card">
          <div className="card-header">
            <XCircle size={15} />
            <h3>Down Devices</h3>
          </div>
          <div className="card-body">
            {downDevices.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">
                  <CheckCircle size={48} />
                </div>
                <div className="empty-state__title">All devices online</div>
                <div className="empty-state__description">Every monitored device is currently reachable.</div>
              </div>
            ) : (
              downDevices.slice(0, 6).map((device) => (
                <Link
                  key={device.id}
                  to={`/devices/${device.id}`}
                  className="alert-item"
                >
                  <div className="alert-icon crit">
                    <XCircle size={15} />
                  </div>
                  <div className="alert-text">
                    <div className="alert-title">{device.hostname}</div>
                    <div className="alert-desc mono">{device.ip_address}</div>
                  </div>
                  <div className="alert-time">
                    {device.last_seen
                      ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                      : 'Never seen'}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Active Alerts */}
        <div className="card">
          <div className="card-header">
            <AlertTriangle size={15} />
            <h3>Active Alerts</h3>
          </div>
          <div className="card-body">
            {!alertEvents || alertEvents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">
                  <CheckCircle size={48} />
                </div>
                <div className="empty-state__title">No active alerts</div>
                <div className="empty-state__description">All systems are operating normally.</div>
              </div>
            ) : (
              alertEvents.slice(0, 5).map((event: AlertEvent) => (
                <div key={event.id} className="alert-item">
                  <div className={`alert-icon ${severityIconClass(event.severity)}`}>
                    <SeverityIcon severity={event.severity} />
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
            {alertEvents && alertEvents.length > 0 && (
              <div className="card__footer">
                <Link to="/alerts" className="btn btn-outline btn-sm">
                  View all alerts
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active Blocks */}
      {blocksSummary && blocksSummary.total > 0 && (
        <div className="card">
          <div className="card-header">
            <Ban size={15} />
            <h3>Active Blocks</h3>
            <span className="tag-red">{blocksSummary.total} Active</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Prefix</th>
                  <th>Type</th>
                  <th>Device</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {blocksSummary.recent.map((b: any) => {
                  const dev = deviceMap.get(b.device_id)
                  return (
                    <tr key={b.id}>
                      <td className="mono">{b.prefix}</td>
                      <td>
                        {b.block_type === 'null_route'
                          ? <span className="tag-orange">Null Route</span>
                          : <span className="tag-blue">FlowSpec</span>}
                      </td>
                      <td>{dev ? dev.hostname : `Device #${b.device_id}`}</td>
                      <td className="alert-time">
                        {b.created_at ? formatDistanceToNow(new Date(b.created_at), { addSuffix: true }) : '\u2014'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
