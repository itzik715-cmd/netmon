import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesApi, interfacesApi, topologyApi } from '../services/api'
import { Interface, DeviceRoute } from '../types'
import { ArrowLeft, RefreshCw, Search, Map, BarChart2, Settings } from 'lucide-react'
import EditDeviceModal from '../components/forms/EditDeviceModal'
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns'
import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

type Tab = 'interfaces' | 'routes' | 'metrics'

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

function protoBadge(proto?: string) {
  const map: Record<string, string> = {
    bgp: 'tag-blue', ospf: 'tag-orange', eigrp: 'tag-orange', rip: 'tag-orange',
    static: 'tag-gray', local: 'tag-green', other: 'tag-gray',
  }
  const p = (proto || 'other').toLowerCase()
  return <span className={map[p] || 'tag-gray'}>{p}</span>
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const deviceId = parseInt(id!)
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('interfaces')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'up' | 'down'>('')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [showEdit, setShowEdit] = useState(false)

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

  const { data: routes, isLoading: routesLoading } = useQuery({
    queryKey: ['device-routes', deviceId],
    queryFn: () => devicesApi.routes(deviceId).then((r) => r.data as DeviceRoute[]),
    enabled: tab === 'routes',
  })

  const [metricsHours, setMetricsHours] = useState(24)
  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['device-metrics', deviceId, metricsHours],
    queryFn: () => topologyApi.deviceMetrics(deviceId, metricsHours).then((r) => r.data),
    enabled: tab === 'metrics',
    refetchInterval: tab === 'metrics' ? 60_000 : false,
  })

  const pollMutation = useMutation({
    mutationFn: () => devicesApi.poll(deviceId),
    onSuccess: () => toast.success('Poll scheduled'),
  })

  const discoverMutation = useMutation({
    mutationFn: () => devicesApi.discover(deviceId),
    onSuccess: () => {
      toast.success('Interface discovery started — results will appear in a few seconds')
      // Poll for discovered interfaces: 4 s, 8 s, 14 s, 20 s, 30 s
      ;[4000, 8000, 14000, 20000, 30000].forEach((delay) =>
        setTimeout(() => qc.invalidateQueries({ queryKey: ['interfaces', deviceId] }), delay)
      )
    },
  })

  const discoverRoutesMutation = useMutation({
    mutationFn: () => devicesApi.discoverRoutes(deviceId),
    onSuccess: () => {
      toast.success('Route discovery started')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['device-routes', deviceId] }), 3000)
    },
  })

  if (deviceLoading) return <div className="empty-state"><p>Loading device...</p></div>
  if (!device) return <div className="empty-state"><p>Device not found</p></div>

  const filteredIfs = (interfaces || []).filter((i) => {
    const matchesText =
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (i.alias || '').toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === '' || i.oper_status === statusFilter
    return matchesText && matchesStatus
  })
  const totalPages = Math.max(1, Math.ceil(filteredIfs.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedIfs = filteredIfs.slice((safePage - 1) * pageSize, safePage * pageSize)

  const isL3 = device.layer === 'L3' || device.layer === 'L2/L3' ||
    device.device_type === 'router' || device.device_type === 'spine' || device.device_type === 'leaf'

  return (
    <>
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
          {tab === 'interfaces' && (
            <button onClick={() => discoverMutation.mutate()} className="btn btn-outline btn-sm">
              <Search size={13} /> Discover Interfaces
            </button>
          )}
          {tab === 'routes' && (
            <button onClick={() => discoverRoutesMutation.mutate()} disabled={discoverRoutesMutation.isPending} className="btn btn-outline btn-sm">
              <Map size={13} /> {discoverRoutesMutation.isPending ? 'Discovering...' : 'Discover Routes'}
            </button>
          )}
          <button onClick={() => setShowEdit(true)} className="btn btn-outline btn-sm">
            <Settings size={13} /> Settings
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
          { label: 'OS Version', value: device.os_version ? device.os_version.substring(0, 60) + (device.os_version.length > 60 ? '…' : '') : '—' },
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

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'interfaces' ? ' active' : ''}`} onClick={() => setTab('interfaces')}>
          Interfaces ({interfaces?.length || 0})
        </button>
        <button className={`tab-btn${tab === 'routes' ? ' active' : ''}`} onClick={() => setTab('routes')}>
          <Map size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Routing Table {routes ? `(${routes.length})` : ''}
          {!isL3 && <span className="tag-gray" style={{ marginLeft: 6, fontSize: 10 }}>L3 only</span>}
        </button>
        <button className={`tab-btn${tab === 'metrics' ? ' active' : ''}`} onClick={() => setTab('metrics')}>
          <BarChart2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Performance
        </button>
      </div>

      {/* Interfaces tab */}
      {tab === 'interfaces' && (
        <div className="card">
          <div className="card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <h3>Interfaces</h3>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Oper-status filter */}
              <div style={{ display: 'flex', gap: 3 }}>
                {(['', 'up', 'down'] as const).map((s) => (
                  <button
                    key={s || 'all'}
                    onClick={() => { setStatusFilter(s); setPage(1) }}
                    className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-outline'}`}
                    style={{ padding: '2px 9px', fontSize: 11, minWidth: 36 }}
                  >
                    {s === '' ? 'All' : s === 'up' ? '▲ Up' : '▼ Down'}
                  </button>
                ))}
              </div>
              {/* Text search */}
              <div className="search-bar" style={{ height: 30 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  placeholder="Search name / description…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  style={{ width: 190 }}
                />
              </div>
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
                  {pagedIfs.map((iface) => (
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
                  {pagedIfs.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                      {interfaces?.length === 0 ? 'No interfaces discovered. Click "Discover Interfaces" to scan.' : 'No interfaces match your search'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination footer */}
          {!ifLoading && filteredIfs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
              {/* Count + page-size selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing {Math.min((safePage - 1) * pageSize + 1, filteredIfs.length)}–{Math.min(safePage * pageSize, filteredIfs.length)} of {filteredIfs.length}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {[25, 50, 100, 200].map((n) => (
                    <button
                      key={n}
                      onClick={() => { setPageSize(n); setPage(1) }}
                      className={`btn btn-sm ${pageSize === n ? 'btn-primary' : 'btn-outline'}`}
                      style={{ minWidth: 38, padding: '2px 8px', fontSize: 12 }}
                    >
                      {n}
                    </button>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--text-light)', marginLeft: 2 }}>per page</span>
                </div>
              </div>
              {/* Prev / page / Next */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="btn btn-outline btn-sm"
                  style={{ padding: '2px 10px' }}
                >
                  ‹ Prev
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 70, textAlign: 'center' }}>
                  Page {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="btn btn-outline btn-sm"
                  style={{ padding: '2px 10px' }}
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Routes tab */}
      {tab === 'routes' && (
        <div className="card">
          <div className="card-header">
            <Map size={15} />
            <h3>Routing Table</h3>
            {!isL3 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Set device layer to L3 or L2/L3 to enable route discovery
              </span>
            )}
          </div>
          {routesLoading ? (
            <div className="empty-state card-body"><p>Loading routes...</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Destination</th><th>Prefix</th><th>Next Hop</th><th>Protocol</th><th>Metric</th></tr>
                </thead>
                <tbody>
                  {(routes || []).map((route) => (
                    <tr key={route.id}>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600 }}>
                        {route.destination}
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                        {route.prefix_len != null ? `/${route.prefix_len}` : route.mask || '—'}
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                        {route.next_hop || '—'}
                      </td>
                      <td>{protoBadge(route.protocol)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{route.metric ?? '—'}</td>
                    </tr>
                  ))}
                  {(!routes || routes.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                        No routes discovered yet.{' '}
                        {isL3 ? 'Click "Discover Routes" to fetch the routing table via SNMP.' : 'Configure this device as L3 first.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Metrics / Performance tab */}
      {tab === 'metrics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* time range selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Time range:</span>
            {[
              { label: '1h', value: 1 },
              { label: '6h', value: 6 },
              { label: '24h', value: 24 },
              { label: '7d', value: 168 },
            ].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setMetricsHours(value)}
                className={`btn btn-sm ${metricsHours === value ? 'btn-primary' : 'btn-outline'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {metricsLoading ? (
            <div className="empty-state"><p>Loading metrics...</p></div>
          ) : !metricsData || metricsData.length === 0 ? (
            <div className="empty-state">
              <BarChart2 size={32} style={{ color: 'var(--text-light)', marginBottom: 8 }} />
              <p style={{ color: 'var(--text-muted)' }}>No performance data yet.</p>
              <p style={{ fontSize: 12, color: 'var(--text-light)' }}>
                CPU and memory metrics are collected during each poll cycle. Check that SNMP polling is active.
              </p>
            </div>
          ) : (() => {
            const chartData = metricsData.map((m: any) => ({
              time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              cpu: m.cpu_usage != null ? parseFloat(m.cpu_usage.toFixed(1)) : null,
              mem: m.memory_usage != null ? parseFloat(m.memory_usage.toFixed(1)) : null,
            }))
            const hasCpu = chartData.some((d: any) => d.cpu != null)
            const hasMem = chartData.some((d: any) => d.mem != null)
            return (
              <>
                {hasCpu && (
                  <div className="card">
                    <div className="card-header">
                      <BarChart2 size={15} />
                      <h3>CPU Utilization</h3>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                        Current: {device.cpu_usage != null ? `${device.cpu_usage.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <div className="card-body" style={{ paddingTop: 8 }}>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={40} />
                          <Tooltip
                            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                            formatter={(v: any) => [`${v}%`, 'CPU']}
                          />
                          <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {hasMem && (
                  <div className="card">
                    <div className="card-header">
                      <BarChart2 size={15} />
                      <h3>Memory Utilization</h3>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                        Current: {device.memory_usage != null ? `${device.memory_usage.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <div className="card-body" style={{ paddingTop: 8 }}>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={40} />
                          <Tooltip
                            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                            formatter={(v: any) => [`${v}%`, 'Memory']}
                          />
                          <Line type="monotone" dataKey="mem" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {/* Stats table */}
                <div className="card">
                  <div className="card-header"><h3>Recent Samples</h3></div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Time</th><th>CPU %</th><th>Memory %</th></tr>
                      </thead>
                      <tbody>
                        {metricsData.slice(0, 20).map((m: any, i: number) => (
                          <tr key={i}>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                              {new Date(m.timestamp).toLocaleString()}
                            </td>
                            <td>
                              {m.cpu_usage != null ? (
                                <span style={{ color: m.cpu_usage > 80 ? 'var(--accent-red)' : m.cpu_usage > 60 ? 'var(--accent-orange)' : 'var(--accent-green)', fontWeight: 600, fontSize: 13 }}>
                                  {m.cpu_usage.toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td>
                              {m.memory_usage != null ? (
                                <span style={{ color: m.memory_usage > 80 ? 'var(--accent-red)' : m.memory_usage > 60 ? 'var(--accent-orange)' : 'var(--accent-green)', fontWeight: 600, fontSize: 13 }}>
                                  {m.memory_usage.toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>

    {showEdit && device && (
      <EditDeviceModal device={device} onClose={() => setShowEdit(false)} />
    )}
    </>
  )
}
