import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { devicesApi, interfacesApi } from '../services/api'
import { Interface } from '../types'
import { ArrowLeft, RefreshCw, Search } from 'lucide-react'
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

function statusTag(status: string) {
  const map: Record<string, string> = { up: 'tag-green', down: 'tag-red', unknown: 'tag-gray', degraded: 'tag-orange' }
  const dotMap: Record<string, string> = { up: 'dot-green', down: 'dot-red', unknown: 'dot-orange', degraded: 'dot-orange' }
  return <span className={map[status] || 'tag-gray'}><span className={`status-dot ${dotMap[status] || 'dot-orange'}`} />{status}</span>
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

  if (deviceLoading) return <div className="empty-state"><p>Loading device...</p></div>
  if (!device) return <div className="empty-state"><p>Device not found</p></div>

  const filteredIfs = (interfaces || []).filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (i.alias || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/devices" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', textDecoration: 'none' }}>
          <ArrowLeft size={16} />
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>{device.hostname}</h1>
            {statusTag(device.status)}
          </div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{device.ip_address}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => discoverMutation.mutate()} className="btn btn-outline btn-sm">
            <Search size={13} /> Discover Interfaces
          </button>
          <button onClick={() => pollMutation.mutate()} className="btn btn-primary btn-sm">
            <RefreshCw size={13} /> Poll Now
          </button>
        </div>
      </div>

      {/* Info grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'Vendor / Model', value: [device.vendor, device.model].filter(Boolean).join(' ') || '—' },
          { label: 'OS Version', value: device.os_version || '—' },
          { label: 'Uptime', value: device.uptime ? formatUptime(device.uptime) : '—' },
          { label: 'Location', value: device.location?.name || '—' },
          ...(device.cpu_usage != null ? [{ label: 'CPU Usage', value: `${device.cpu_usage.toFixed(1)}%`, color: device.cpu_usage > 80 ? 'var(--accent-red)' : 'var(--accent-green)' }] : []),
          ...(device.memory_usage != null ? [{ label: 'Memory Usage', value: `${device.memory_usage.toFixed(1)}%`, color: device.memory_usage > 80 ? 'var(--accent-red)' : 'var(--accent-green)' }] : []),
          { label: 'Device Type', value: device.device_type || '—' },
          { label: 'Last Seen', value: device.last_seen ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true }) : 'Never' },
        ].map((item: any, i) => (
          <div key={i} className="info-card">
            <div className="stat-label">{item.label}</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: item.color || 'var(--text-main)', marginTop: 4 }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Interfaces */}
      <div className="card">
        <div className="card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <h3>Interfaces ({interfaces?.length || 0})</h3>
          <div className="search-bar" style={{ marginLeft: 'auto', height: 30 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input placeholder="Search interfaces..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 160 }} />
          </div>
        </div>
        {ifLoading ? (
          <div className="empty-state card-body"><p>Loading interfaces...</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Interface</th><th>Alias / Description</th><th>Speed</th><th>Admin</th><th>Oper</th><th>IP Address</th><th>VLAN</th><th></th></tr>
              </thead>
              <tbody>
                {filteredIfs.map((iface) => (
                  <tr key={iface.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Link to={`/interfaces/${iface.id}`} style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
                          {iface.name}
                        </Link>
                        {iface.is_uplink && <span className="tag-orange" style={{ fontSize: 10 }}>uplink</span>}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{iface.alias || iface.description || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{iface.speed ? formatBps(iface.speed) : '—'}</td>
                    <td><span className={iface.admin_status === 'up' ? 'tag-green' : 'tag-gray'}>{iface.admin_status || '—'}</span></td>
                    <td><span className={iface.oper_status === 'up' ? 'tag-green' : 'tag-red'}>{iface.oper_status || '—'}</span></td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{iface.ip_address || '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{iface.vlan_id || '—'}</td>
                    <td>
                      <Link to={`/interfaces/${iface.id}`} className="btn btn-outline btn-sm">Graphs →</Link>
                    </td>
                  </tr>
                ))}
                {filteredIfs.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                    {interfaces?.length === 0 ? 'No interfaces discovered. Click "Discover Interfaces" to scan.' : 'No interfaces match your search'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
