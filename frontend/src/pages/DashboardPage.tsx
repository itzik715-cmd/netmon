import { useQuery } from '@tanstack/react-query'
import { devicesApi, alertsApi } from '../services/api'
import { Server, Wifi, WifiOff, Bell, Activity, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { AlertEvent, Device } from '../types'

function StatCard({
  label, value, icon: Icon, color, to
}: {
  label: string; value: number | string; icon: any; color: string; to?: string
}) {
  const content = (
    <div className={`stat-card hover:shadow-md transition-shadow ${to ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        <div className={`p-2.5 rounded-lg ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="stat-value mt-2">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
  return to ? <Link to={to}>{content}</Link> : content
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    up: 'badge-success',
    down: 'badge-danger',
    unknown: 'badge-gray',
    degraded: 'badge-warning',
  }
  return <span className={map[status] || 'badge-gray'}>{status}</span>
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    critical: 'badge-danger',
    warning: 'badge-warning',
    info: 'badge-info',
  }
  return <span className={map[severity] || 'badge-gray'}>{severity}</span>
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
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Network overview at a glance</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Devices"
          value={summary?.total_devices ?? '—'}
          icon={Server}
          color="bg-blue-50 text-blue-600"
          to="/devices"
        />
        <StatCard
          label="Devices Up"
          value={summary?.devices_up ?? '—'}
          icon={Wifi}
          color="bg-green-50 text-green-600"
        />
        <StatCard
          label="Devices Down"
          value={summary?.devices_down ?? '—'}
          icon={WifiOff}
          color="bg-red-50 text-red-600"
        />
        <StatCard
          label="Open Alerts"
          value={alertSummary?.open ?? '—'}
          icon={Bell}
          color="bg-amber-50 text-amber-600"
          to="/alerts"
        />
      </div>

      {/* Alert breakdown */}
      {alertSummary && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card flex items-center gap-4">
            <div className="p-3 bg-red-50 rounded-lg">
              <Bell className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{alertSummary.critical}</div>
              <div className="text-sm text-gray-500">Critical Alerts</div>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="p-3 bg-amber-50 rounded-lg">
              <Bell className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-600">{alertSummary.warning}</div>
              <div className="text-sm text-gray-500">Warning Alerts</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Down Devices */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 text-red-500" />
              Down Devices
            </h3>
            <Link to="/devices" className="text-xs text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          {downDevices.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Wifi className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-50" />
              <p className="text-sm">All devices are up</p>
            </div>
          ) : (
            <div className="space-y-2">
              {downDevices.slice(0, 5).map((device) => (
                <Link
                  key={device.id}
                  to={`/devices/${device.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div>
                    <div className="font-medium text-gray-800 text-sm">{device.hostname}</div>
                    <div className="text-xs text-gray-500">{device.ip_address}</div>
                  </div>
                  <div className="text-right">
                    {statusBadge(device.status)}
                    {device.last_seen && (
                      <div className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Alerts */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-500" />
              Active Alerts
            </h3>
            <Link to="/alerts" className="text-xs text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          {!alertEvents || alertEvents.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No active alerts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {alertEvents.slice(0, 5).map((event: AlertEvent) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between p-3 rounded-lg bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {severityBadge(event.severity)}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{event.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDistanceToNow(new Date(event.triggered_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Device Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3>All Devices</h3>
          <Link to="/devices" className="btn-secondary btn-sm">
            Manage Devices
          </Link>
        </div>
        <div className="table-container">
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
                    <Link to={`/devices/${device.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                      {device.hostname}
                    </Link>
                    {device.vendor && (
                      <div className="text-xs text-gray-500">{device.vendor} {device.model}</div>
                    )}
                  </td>
                  <td className="font-mono text-sm">{device.ip_address}</td>
                  <td>
                    {device.device_type && (
                      <span className="badge-info">{device.device_type}</span>
                    )}
                  </td>
                  <td className="text-gray-500">{device.location?.name || '—'}</td>
                  <td>{statusBadge(device.status)}</td>
                  <td className="text-gray-500">{device.interface_count ?? 0}</td>
                  <td className="text-gray-400 text-xs">
                    {device.last_seen
                      ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                      : 'Never'}
                  </td>
                </tr>
              ))}
              {(!devices || (devices as Device[]).length === 0) && (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-8">
                    No devices configured. <Link to="/devices" className="text-blue-600">Add your first device</Link>
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
