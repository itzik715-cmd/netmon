import { useParams, Link, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesApi, interfacesApi, topologyApi } from '../services/api'
import { Interface, DeviceRoute } from '../types'
import { Activity, ArrowLeft, Filter, RefreshCw, Search, Map, BarChart2, Settings } from 'lucide-react'
import EditDeviceModal from '../components/forms/EditDeviceModal'
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns'
import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

type Tab = 'interfaces' | 'routes' | 'metrics'
type StatusVal = '' | 'up' | 'down'

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

// Column header with an Excel-style filter dropdown
function FilterTh({
  label, filterKey, openFilter, setOpenFilter, active, children,
}: {
  label: string
  filterKey: string
  openFilter: string | null
  setOpenFilter: (k: string | null) => void
  active: boolean
  children: React.ReactNode
}) {
  const isOpen = openFilter === filterKey
  const thRef = useRef<HTMLTableCellElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (thRef.current && !thRef.current.contains(e.target as Node)) {
        setOpenFilter(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, setOpenFilter])

  return (
    <th ref={thRef} className="filter-th">
      <div className="flex-row-gap-sm">
        {label}
        <button
          onClick={() => setOpenFilter(isOpen ? null : filterKey)}
          title={`Filter ${label}`}
          className={`filter-th__trigger ${active ? 'filter-th__trigger--active' : ''}`}
        >
          <Filter size={11} />
        </button>
      </div>
      {isOpen && (
        <div className="filter-th__dropdown">
          {children}
        </div>
      )}
    </th>
  )
}

// Status filter panel (All / Up / Down)
function StatusFilterPanel({
  value, onChange, onClose,
}: { value: StatusVal; onChange: (v: StatusVal) => void; onClose: () => void }) {
  const opts: { val: StatusVal; label: string; cls: string }[] = [
    { val: '', label: 'All', cls: 'tag-gray' },
    { val: 'up', label: 'Up', cls: 'tag-green' },
    { val: 'down', label: 'Down', cls: 'tag-red' },
  ]
  return (
    <div className="filter-panel">
      {opts.map((o) => (
        <button
          key={o.val}
          onClick={() => { onChange(o.val); onClose() }}
          className={`filter-panel__btn ${value === o.val ? 'filter-panel__btn--active' : ''}`}
        >
          <span className={o.cls}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

// Text filter panel
function TextFilterPanel({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Filter\u2026'}
        className="filter-input"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="filter-clear"
        >
          \u2715 Clear
        </button>
      )}
    </div>
  )
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const deviceId = parseInt(id || '', 10)
  if (isNaN(deviceId)) return <Navigate to="/devices" replace />
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('interfaces')
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [showEdit, setShowEdit] = useState(false)

  // Per-column filters
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [filterAdmin, setFilterAdmin] = useState<StatusVal>('')
  const [filterOper, setFilterOper] = useState<StatusVal>('')
  const [filterAlias, setFilterAlias] = useState('')
  const [filterSpeed, setFilterSpeed] = useState<'' | 'with' | 'without'>('')

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

  const { data: utilization } = useQuery({
    queryKey: ['interfaces-utilization', deviceId],
    queryFn: () => interfacesApi.utilization(deviceId).then((r) => r.data as Record<number, { utilization_in: number; utilization_out: number; in_bps: number; out_bps: number }>),
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

  // Apply all filters then sort by utilization (highest first)
  const filteredIfs = (interfaces || []).filter((i) => {
    if (search) {
      const q = search.toLowerCase()
      const hit = i.name.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.alias || '').toLowerCase().includes(q)
      if (!hit) return false
    }
    if (filterAlias) {
      const q = filterAlias.toLowerCase()
      if (!(i.alias || i.description || '').toLowerCase().includes(q)) return false
    }
    if (filterAdmin && i.admin_status !== filterAdmin) return false
    if (filterOper && i.oper_status !== filterOper) return false
    if (filterSpeed === 'with' && !i.speed) return false
    if (filterSpeed === 'without' && i.speed) return false
    return true
  }).sort((a, b) => {
    const uA = utilization?.[a.id]
    const uB = utilization?.[b.id]
    const pctA = uA ? Math.max(uA.utilization_in, uA.utilization_out) : -1
    const pctB = uB ? Math.max(uB.utilization_in, uB.utilization_out) : -1
    return pctB - pctA
  })

  const activeFilterCount = [filterAdmin, filterOper, filterAlias, filterSpeed].filter(Boolean).length

  const totalPages = Math.max(1, Math.ceil(filteredIfs.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedIfs = filteredIfs.slice((safePage - 1) * pageSize, safePage * pageSize)

  const isL3 = device.layer === 'L3' || device.layer === 'L2/L3' ||
    device.device_type === 'router' || device.device_type === 'spine' || device.device_type === 'leaf'

  return (
    <>
    <div className="flex-col-gap">
      {/* Header */}
      <div className="detail-header">
        <Link to="/devices" className="back-btn">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <div className="flex-row-gap">
            <h1>{device.hostname}</h1>
            {statusTag(device.status)}
          </div>
          <div className="mono">{device.ip_address}</div>
        </div>
        <div className="flex-row-gap">
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
      <div className="stats-grid">
        {[
          { label: 'Vendor / Model', value: [device.vendor, device.model].filter(Boolean).join(' ') || '—' },
          { label: 'OS Version', value: device.os_version ? device.os_version.substring(0, 60) + (device.os_version.length > 60 ? '\u2026' : '') : '—' },
          { label: 'Uptime', value: device.uptime ? formatUptime(device.uptime) : '—' },
          { label: 'Location', value: device.location?.name || '—' },
          ...(device.cpu_usage != null ? [{ label: 'CPU Usage', value: `${device.cpu_usage.toFixed(1)}%`, color: device.cpu_usage > 80 ? 'danger' : 'success' }] : []),
          ...(device.memory_usage != null ? [{ label: 'Memory Usage', value: `${device.memory_usage.toFixed(1)}%`, color: device.memory_usage > 80 ? 'danger' : 'success' }] : []),
          { label: 'Device Type', value: device.device_type || '—' },
          { label: 'Last Seen', value: device.last_seen ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true }) : 'Never' },
        ].map((item: any, i) => (
          <div key={i} className="info-card">
            <div className="stat-label">{item.label}</div>
            <div className={`stat-value-sm ${item.color === 'danger' ? 'stat-value-sm--danger' : item.color === 'success' ? 'stat-value-sm--success' : ''}`}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'interfaces' ? ' active' : ''}`} onClick={() => setTab('interfaces')}>
          Interfaces ({interfaces?.length || 0})
        </button>
        <button className={`tab-btn${tab === 'routes' ? ' active' : ''}`} onClick={() => setTab('routes')}>
          <Map size={13} />
          Routing Table {routes ? `(${routes.length})` : ''}
          {!isL3 && <span className="tag-gray ml-2 text-xs">L3 only</span>}
        </button>
        <button className={`tab-btn${tab === 'metrics' ? ' active' : ''}`} onClick={() => setTab('metrics')}>
          <BarChart2 size={13} />
          Performance
        </button>
      </div>

      {/* Interfaces tab */}
      {tab === 'interfaces' && (
        <div className="card">
          <div className="card-header">
            <Activity size={15} />
            <h3>Interfaces</h3>
            {activeFilterCount > 0 && (
              <span className="tag-blue text-xs">
                {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
              </span>
            )}
            <div className="card__actions">
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setFilterAdmin(''); setFilterOper(''); setFilterAlias(''); setFilterSpeed('') }}
                  className="btn btn-outline btn-sm"
                >
                  \u2715 Clear filters
                </button>
              )}
              {/* Text search */}
              <div className="search-bar">
                <Search size={13} />
                <input
                  placeholder="Search name / alias\u2026"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
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
                  <tr>
                    <th>Interface</th>

                    {/* Alias / Description — with text filter */}
                    <FilterTh
                      label="Alias / Description"
                      filterKey="alias"
                      openFilter={openFilter}
                      setOpenFilter={(k) => { setOpenFilter(k); setPage(1) }}
                      active={!!filterAlias}
                    >
                      <TextFilterPanel
                        value={filterAlias}
                        onChange={(v) => { setFilterAlias(v); setPage(1) }}
                        placeholder="Search description\u2026"
                      />
                    </FilterTh>

                    {/* Speed — with has/hasn't filter */}
                    <FilterTh
                      label="Speed"
                      filterKey="speed"
                      openFilter={openFilter}
                      setOpenFilter={(k) => { setOpenFilter(k); setPage(1) }}
                      active={!!filterSpeed}
                    >
                      <div className="filter-panel">
                        {([
                          { val: '', label: 'All' },
                          { val: 'with', label: 'Has speed' },
                          { val: 'without', label: 'No speed' },
                        ] as const).map((o) => (
                          <button
                            key={o.val}
                            onClick={() => { setFilterSpeed(o.val); setOpenFilter(null); setPage(1) }}
                            className={`filter-panel__btn ${filterSpeed === o.val ? 'filter-panel__btn--active' : ''}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </FilterTh>

                    {/* Admin — status filter */}
                    <FilterTh
                      label="Admin"
                      filterKey="admin"
                      openFilter={openFilter}
                      setOpenFilter={(k) => { setOpenFilter(k); setPage(1) }}
                      active={!!filterAdmin}
                    >
                      <StatusFilterPanel
                        value={filterAdmin}
                        onChange={(v) => { setFilterAdmin(v); setPage(1) }}
                        onClose={() => setOpenFilter(null)}
                      />
                    </FilterTh>

                    {/* Oper — status filter */}
                    <FilterTh
                      label="Oper"
                      filterKey="oper"
                      openFilter={openFilter}
                      setOpenFilter={(k) => { setOpenFilter(k); setPage(1) }}
                      active={!!filterOper}
                    >
                      <StatusFilterPanel
                        value={filterOper}
                        onChange={(v) => { setFilterOper(v); setPage(1) }}
                        onClose={() => setOpenFilter(null)}
                      />
                    </FilterTh>

                    <th>Utilization</th>
                    <th>IP Address</th>
                    <th>VLAN</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedIfs.map((iface) => {
                    const u = utilization?.[iface.id]
                    const pct = u ? Math.max(u.utilization_in, u.utilization_out) : null
                    const utilColor = pct != null ? (pct >= 85 ? 'red' : pct >= 75 ? 'orange' : 'green') : null
                    return (
                      <tr key={iface.id}>
                        <td>
                          <div className="flex-row-gap">
                            <Link to={`/interfaces/${iface.id}`} className="mono text-sm link-primary font-semibold">
                              {iface.name}
                            </Link>
                            {iface.is_uplink && <span className="tag-orange text-xs">uplink</span>}
                          </div>
                        </td>
                        <td className="text-muted text-sm">{iface.alias || iface.description || '—'}</td>
                        <td className="text-muted text-sm">{iface.speed ? formatBps(iface.speed) : '—'}</td>
                        <td>
                          {iface.admin_status
                            ? <span className={iface.admin_status === 'up' ? 'tag-green' : 'tag-red'}>{iface.admin_status}</span>
                            : <span className="tag-gray">—</span>}
                        </td>
                        <td>
                          {iface.oper_status
                            ? <span className={iface.oper_status === 'up' ? 'tag-green' : 'tag-red'}>{iface.oper_status}</span>
                            : <span className="tag-gray">—</span>}
                        </td>
                        <td>
                          {pct != null && utilColor != null ? (
                            <div className="util-bar">
                              <div className="util-bar__track">
                                <div
                                  className={`util-bar__fill util-bar__fill--${utilColor}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className={`util-bar__value ${utilColor === 'red' ? 'metric-value--danger' : utilColor === 'orange' ? 'metric-value--warning' : 'metric-value--success'}`}>
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                          ) : <span className="text-light text-sm">—</span>}
                        </td>
                        <td className="mono text-sm text-muted">{iface.ip_address || '—'}</td>
                        <td className="text-muted">{iface.vlan_id || '—'}</td>
                        <td>
                          <Link to={`/interfaces/${iface.id}`} className="btn btn-outline btn-sm">Graphs \u2192</Link>
                        </td>
                      </tr>
                    )
                  })}
                  {pagedIfs.length === 0 && (
                    <tr><td colSpan={9} className="empty-table-cell">
                      {interfaces?.length === 0
                        ? 'No interfaces discovered. Click "Discover Interfaces" to scan.'
                        : 'No interfaces match the active filters'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination footer */}
          {!ifLoading && filteredIfs.length > 0 && (
            <div className="pagination-footer">
              <div className="flex-row-gap">
                <span className="pagination-info">
                  Showing {Math.min((safePage - 1) * pageSize + 1, filteredIfs.length)}–{Math.min(safePage * pageSize, filteredIfs.length)} of {filteredIfs.length}
                </span>
                <div className="flex-row-gap-sm">
                  {[25, 50, 100, 200].map((n) => (
                    <button
                      key={n}
                      onClick={() => { setPageSize(n); setPage(1) }}
                      className={`btn btn-sm ${pageSize === n ? 'btn-primary' : 'btn-outline'}`}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="per-page-label">per page</span>
                </div>
              </div>
              <div className="pagination-controls">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="btn btn-outline btn-sm"
                >
                  \u2039 Prev
                </button>
                <span className="pagination-page-info">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="btn btn-outline btn-sm"
                >
                  Next \u203a
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
              <span className="text-xs text-muted ml-2">
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
                      <td className="mono text-sm font-semibold">
                        {route.destination}
                      </td>
                      <td className="mono text-sm text-muted">
                        {route.prefix_len != null ? `/${route.prefix_len}` : route.mask || '—'}
                      </td>
                      <td className="mono text-sm text-muted">
                        {route.next_hop || '—'}
                      </td>
                      <td>{protoBadge(route.protocol)}</td>
                      <td className="text-muted text-sm">{route.metric ?? '—'}</td>
                    </tr>
                  ))}
                  {(!routes || routes.length === 0) && (
                    <tr>
                      <td colSpan={5} className="empty-table-cell">
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
        <div className="flex-col-gap">
          <div className="flex-row-gap">
            <span className="text-sm text-muted">Time range:</span>
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
              <div className="empty-state__icon"><BarChart2 size={32} /></div>
              <p className="empty-state__title">No performance data yet.</p>
              <p className="empty-state__description">
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
                      <span className="card-header__sub">
                        Current: {device.cpu_usage != null ? `${device.cpu_usage.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <div className="card-body">
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
                      <span className="card-header__sub">
                        Current: {device.memory_usage != null ? `${device.memory_usage.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <div className="card-body">
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
                            <td className="mono text-sm text-muted">
                              {new Date(m.timestamp).toLocaleString()}
                            </td>
                            <td>
                              {m.cpu_usage != null ? (
                                <span className={`metric-value ${m.cpu_usage > 80 ? 'metric-value--danger' : m.cpu_usage > 60 ? 'metric-value--warning' : 'metric-value--success'}`}>
                                  {m.cpu_usage.toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td>
                              {m.memory_usage != null ? (
                                <span className={`metric-value ${m.memory_usage > 80 ? 'metric-value--danger' : m.memory_usage > 60 ? 'metric-value--warning' : 'metric-value--success'}`}>
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
