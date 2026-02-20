import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { devicesApi, interfacesApi } from '../services/api'
import { Interface } from '../types'
import { ArrowLeft, RefreshCw, Server, Wifi, WifiOff, Activity, Search } from 'lucide-react'
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns'
import { useState } from 'react'
import toast from 'react-hot-toast'

function formatUptime(seconds: number): string {
  const dur = intervalToDuration({ start: 0, end: seconds * 1000 })
  return formatDuration(dur, { format: ['days', 'hours', 'minutes'] }) || '< 1 minute'
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`
  return `${bps.toFixed(0)} bps`
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const deviceId = parseInt(id!)
  const [search, setSearch] = useState('')

  const { data: device, isLoading: deviceLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => devicesApi.get(deviceId).then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: interfaces, isLoading: ifLoading } = useQuery({
    queryKey: ['interfaces', deviceId],
    queryFn: () => interfacesApi.byDevice(deviceId).then((r) => r.data as Interface[]),
    refetchInterval: 60_000,
  })

  const pollMutation = useMutation({
    mutationFn: () => devicesApi.poll(deviceId),
    onSuccess: () => toast.success('Poll scheduled'),
  })

  const discoverMutation = useMutation({
    mutationFn: () => devicesApi.discover(deviceId),
    onSuccess: () => toast.success('Interface discovery started'),
  })

  if (deviceLoading) return <div className="text-center py-12 text-slate-500">Loading...</div>
  if (!device) return <div className="text-center py-12 text-slate-500">Device not found</div>

  const filteredIfs = (interfaces || []).filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (i.alias || '').toLowerCase().includes(search.toLowerCase())
  )

  const statusColor = {
    up: 'text-emerald-400', down: 'text-red-400',
    unknown: 'text-slate-400', degraded: 'text-amber-400',
  }[device.status] || 'text-slate-400'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/devices" className="p-2 text-slate-400 hover:text-slate-100 hover:bg-dark-100 rounded-lg transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl">{device.hostname}</h1>
            <span className={`font-semibold ${statusColor}`}>● {device.status}</span>
          </div>
          <p className="text-slate-400 text-sm">{device.ip_address}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => discoverMutation.mutate()}
            className="btn-secondary btn-sm flex items-center gap-2"
          >
            <Search className="h-4 w-4" />
            Discover Interfaces
          </button>
          <button
            onClick={() => pollMutation.mutate()}
            className="btn-primary btn-sm flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Poll Now
          </button>
        </div>
      </div>

      {/* Device Info Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-xs text-slate-500 mb-1">Vendor / Model</div>
          <div className="font-medium text-slate-200">
            {[device.vendor, device.model].filter(Boolean).join(' ') || '—'}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500 mb-1">OS Version</div>
          <div className="font-medium text-slate-200">{device.os_version || '—'}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500 mb-1">Uptime</div>
          <div className="font-medium text-slate-200">
            {device.uptime ? formatUptime(device.uptime) : '—'}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500 mb-1">Location</div>
          <div className="font-medium text-slate-200">{device.location?.name || '—'}</div>
        </div>
        {device.cpu_usage != null && (
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">CPU Usage</div>
            <div className={`font-bold text-xl ${device.cpu_usage > 80 ? 'text-red-400' : 'text-emerald-400'}`}>
              {device.cpu_usage.toFixed(1)}%
            </div>
          </div>
        )}
        {device.memory_usage != null && (
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">Memory Usage</div>
            <div className={`font-bold text-xl ${device.memory_usage > 80 ? 'text-red-400' : 'text-emerald-400'}`}>
              {device.memory_usage.toFixed(1)}%
            </div>
          </div>
        )}
        <div className="card">
          <div className="text-xs text-slate-500 mb-1">Last Seen</div>
          <div className="font-medium text-slate-200 text-sm">
            {device.last_seen
              ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
              : 'Never'}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500 mb-1">Device Type</div>
          <div className="font-medium">
            {device.device_type ? (
              <span className="badge-info">{device.device_type}</span>
            ) : '—'}
          </div>
        </div>
      </div>

      {/* Interfaces */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400" />
            Interfaces ({interfaces?.length || 0})
          </h3>
          <input
            className="input w-64 text-sm py-1.5"
            placeholder="Search interfaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {ifLoading ? (
          <div className="text-center py-8 text-slate-500">Loading interfaces...</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Alias / Description</th>
                  <th>Speed</th>
                  <th>Admin</th>
                  <th>Oper</th>
                  <th>IP Address</th>
                  <th>VLAN</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIfs.map((iface) => (
                  <tr key={iface.id}>
                    <td>
                      <Link
                        to={`/interfaces/${iface.id}`}
                        className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                      >
                        {iface.name}
                      </Link>
                      {iface.is_uplink && (
                        <span className="ml-2 badge-warning text-xs">uplink</span>
                      )}
                    </td>
                    <td className="text-slate-400 text-sm">
                      {iface.alias || iface.description || '—'}
                    </td>
                    <td className="text-slate-400 text-sm">
                      {iface.speed ? formatBps(iface.speed) : '—'}
                    </td>
                    <td>
                      <span className={iface.admin_status === 'up' ? 'badge-success' : 'badge-gray'}>
                        {iface.admin_status || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={iface.oper_status === 'up' ? 'badge-success' : 'badge-danger'}>
                        {iface.oper_status || '—'}
                      </span>
                    </td>
                    <td className="font-mono text-sm text-slate-400">{iface.ip_address || '—'}</td>
                    <td className="text-slate-400">{iface.vlan_id || '—'}</td>
                    <td>
                      <Link
                        to={`/interfaces/${iface.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Graphs →
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredIfs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-500">
                      {interfaces?.length === 0
                        ? 'No interfaces discovered. Click "Discover Interfaces" to scan.'
                        : 'No interfaces match your search'}
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
