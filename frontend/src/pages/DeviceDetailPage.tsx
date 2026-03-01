import { useParams, Link, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesApi, interfacesApi, topologyApi, switchesApi } from '../services/api'
import { Interface, DeviceRoute } from '../types'
import { Activity, ArrowLeft, Filter, RefreshCw, Search, Map, BarChart2, Settings, AlertTriangle, Database, Download, Thermometer, Fan, Zap } from 'lucide-react'
import EditDeviceModal from '../components/forms/EditDeviceModal'
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns'
import { useState, useRef, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

type Tab = 'interfaces' | 'routes' | 'metrics' | 'mac' | 'environment' | 'vlans' | 'mlag'

const SWITCH_TYPES = ['spine', 'leaf', 'tor', 'switch', 'access', 'distribution', 'core', 'router']

interface PortSummary {
  interface_id: number
  name: string
  alias: string | null
  if_index: number | null
  speed: number | null
  admin_status: string | null
  oper_status: string | null
  duplex: string | null
  vlan_id: number | null
  ip_address: string | null
  mac_address: string | null
  is_uplink: boolean
  is_monitored: boolean
  last_change: string | null
  in_bps: number
  out_bps: number
  utilization_in: number
  utilization_out: number
  in_errors_delta: number
  out_errors_delta: number
  in_discards_delta: number
  out_discards_delta: number
  in_errors_total: number
  out_errors_total: number
  in_discards_total: number
  out_discards_total: number
  in_broadcast_pps: number
  in_multicast_pps: number
  flap_count: number
  is_flapping: boolean
}
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

  const isSwitch = device ? SWITCH_TYPES.includes(device.device_type?.toLowerCase() || '') : false

  const { data: portSummary } = useQuery({
    queryKey: ['port-summary', deviceId],
    queryFn: () => switchesApi.portSummary(deviceId).then(r => r.data as PortSummary[]),
    refetchInterval: 60_000,
    enabled: isSwitch && tab === 'interfaces',
  })

  // Index port summary by interface_id for quick lookup
  const portMap = useMemo(() => {
    const m: Record<number, PortSummary> = {}
    if (portSummary) {
      for (const p of portSummary) m[p.interface_id] = p
    }
    return m
  }, [portSummary])

  // MAC table state
  const [macSearch, setMacSearch] = useState('')
  const [macPage, setMacPage] = useState(0)
  const macLimit = 50

  const { data: macData, isLoading: macLoading } = useQuery({
    queryKey: ['mac-table', deviceId, macSearch, macPage],
    queryFn: () => switchesApi.macTable(deviceId, {
      q: macSearch || undefined,
      limit: macLimit,
      offset: macPage * macLimit,
    }).then(r => r.data),
    enabled: isSwitch && tab === 'mac',
    refetchInterval: tab === 'mac' ? 60_000 : false,
  })

  const macDiscoverMutation = useMutation({
    mutationFn: () => switchesApi.discoverMac(deviceId),
    onSuccess: () => {
      toast.success('MAC discovery started — results will appear shortly')
      ;[5000, 10000, 20000].forEach(delay =>
        setTimeout(() => qc.invalidateQueries({ queryKey: ['mac-table', deviceId] }), delay)
      )
    },
  })

  // MLAG data
  const { data: mlagData, isLoading: mlagLoading } = useQuery({
    queryKey: ['device-mlag', deviceId],
    queryFn: () => switchesApi.mlag(deviceId).then(r => r.data),
    enabled: isSwitch && (tab === 'mlag' || tab === 'interfaces'),
  })

  // VLANs data
  const { data: vlansData, isLoading: vlansLoading } = useQuery({
    queryKey: ['device-vlans', deviceId],
    queryFn: () => switchesApi.vlans(deviceId).then(r => r.data),
    enabled: isSwitch && tab === 'vlans',
  })

  // Environment data (temperature, fan, PSU)
  const [envHours, setEnvHours] = useState(24)

  // VLAN tab state
  const [vlanFilter, setVlanFilter] = useState('')
  const [vlanStatusFilter, setVlanStatusFilter] = useState('')
  const [vlanSortKey, setVlanSortKey] = useState('mac_count')
  const [vlanSortDir, setVlanSortDir] = useState<'asc' | 'desc'>('desc')
  const [vlanPageSize, setVlanPageSize] = useState(25)
  const [vlanPage, setVlanPage] = useState(0)
  const { data: envData, isLoading: envLoading } = useQuery({
    queryKey: ['device-environment', deviceId, envHours],
    queryFn: () => switchesApi.environment(deviceId, envHours).then(r => r.data),
    enabled: isSwitch && tab === 'environment',
    refetchInterval: tab === 'environment' ? 60_000 : false,
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
          {tab === 'mac' && (
            <button onClick={() => macDiscoverMutation.mutate()} disabled={macDiscoverMutation.isPending} className="btn btn-outline btn-sm">
              <Database size={13} /> {macDiscoverMutation.isPending ? 'Discovering...' : 'Discover MAC Table'}
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

      {/* Port status grid for switch types */}
      {isSwitch && interfaces && interfaces.length > 0 && (() => {
        const ethPorts = interfaces.filter(i =>
          i.name && !i.name.toLowerCase().startsWith('vlan') &&
          !i.name.toLowerCase().startsWith('loopback') &&
          !i.name.toLowerCase().startsWith('lo') &&
          !i.name.toLowerCase().startsWith('null') &&
          !i.name.toLowerCase().startsWith('mgmt')
        )
        const portsUp = ethPorts.filter(i => i.oper_status === 'up').length
        const portsDown = ethPorts.filter(i => i.oper_status === 'down' && i.admin_status === 'up').length
        const portsAdminDown = ethPorts.filter(i => i.admin_status === 'down').length
        const errorPorts = ethPorts.filter(i => {
          const ps = portMap[i.id]
          return ps && (ps.in_errors_delta > 0 || ps.out_errors_delta > 0)
        }).length

        return (
          <div className="card">
            <div className="card-header">
              <Activity size={14} />
              <h3>Port Status</h3>
              <span className="card-header__sub">
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{portsUp} up</span>
                {portsDown > 0 && <>{' / '}<span style={{ color: '#ef4444', fontWeight: 600 }}>{portsDown} down</span></>}
                {portsAdminDown > 0 && <>{' / '}<span style={{ color: 'var(--text-muted)' }}>{portsAdminDown} admin-down</span></>}
                {' of '}{ethPorts.length}{' ports'}
                {errorPorts > 0 && <>{' · '}<span style={{ color: '#ef4444' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {errorPorts} with errors</span></>}
              </span>
            </div>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {ethPorts.map(port => {
                  const ps = portMap[port.id]
                  const hasErr = ps && (ps.in_errors_delta > 0 || ps.out_errors_delta > 0)
                  let bg = '#6b7280' // gray — admin-down
                  if (port.admin_status === 'up' || port.admin_status === null) {
                    if (port.oper_status === 'up') {
                      bg = hasErr ? '#ef4444' : '#22c55e'
                    } else {
                      bg = '#ef4444'
                    }
                  }
                  const shortName = port.name.replace(/^(Ethernet|GigabitEthernet|TenGigabitEthernet|HundredGigE|FortyGigE|TwentyFiveGigE)/, '')
                    .replace(/^(Eth|Gi|Te|Hu|Fo|Twe)/, '')

                  const u = utilization?.[port.id]
                  const traffic = u ? formatBps(Math.max(u.in_bps || 0, u.out_bps || 0)) : null

                  return (
                    <Link
                      key={port.id}
                      to={`/interfaces/${port.id}`}
                      title={`${port.name}\nStatus: ${port.oper_status || 'unknown'}${port.admin_status === 'down' ? ' (admin-down)' : ''}${traffic ? `\nTraffic: ${traffic}` : ''}${hasErr ? `\nErrors: ${ps.in_errors_delta} in / ${ps.out_errors_delta} out` : ''}`}
                      style={{
                        width: 22, height: 18, borderRadius: 3,
                        background: bg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, color: '#fff', fontWeight: 600,
                        textDecoration: 'none',
                        border: hasErr ? '2px solid #fbbf24' : '1px solid rgba(0,0,0,0.1)',
                      }}
                    >
                      {shortName.length <= 4 ? shortName : ''}
                    </Link>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#22c55e', verticalAlign: -1 }} /> Up</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ef4444', verticalAlign: -1 }} /> Down</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#6b7280', verticalAlign: -1 }} /> Admin-Down</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ef4444', border: '2px solid #fbbf24', verticalAlign: -1 }} /> Errors</span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Tab bar */}
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'interfaces' ? ' active' : ''}`} onClick={() => setTab('interfaces')}>
          {isSwitch ? 'Ports' : 'Interfaces'} ({interfaces?.length || 0})
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
        {isSwitch && (
          <button className={`tab-btn${tab === 'mac' ? ' active' : ''}`} onClick={() => setTab('mac')}>
            <Database size={13} />
            MAC Table {macData ? `(${macData.total})` : ''}
          </button>
        )}
        {isSwitch && (
          <button className={`tab-btn${tab === 'vlans' ? ' active' : ''}`} onClick={() => setTab('vlans')}>
            VLANs {vlansData ? `(${vlansData.length})` : ''}
          </button>
        )}
        {isSwitch && mlagData?.domain && (
          <button className={`tab-btn${tab === 'mlag' ? ' active' : ''}`} onClick={() => setTab('mlag')}>
            MLAG
          </button>
        )}
        {isSwitch && (
          <button className={`tab-btn${tab === 'environment' ? ' active' : ''}`} onClick={() => setTab('environment')}>
            <Thermometer size={13} />
            Environment
          </button>
        )}
      </div>

      {/* Interfaces tab */}
      {tab === 'interfaces' && (
        <div className="card">
          <div className="card-header">
            <Activity size={15} />
            <h3>{isSwitch ? 'Ports' : 'Interfaces'}</h3>
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

                    {isSwitch && <th>Duplex</th>}
                    <th>Utilization</th>
                    {isSwitch && <th>In Errors</th>}
                    {isSwitch && <th>Out Errors</th>}
                    {isSwitch && <th>Discards</th>}
                    {isSwitch && <th>Bcast</th>}
                    {isSwitch && <th>Flaps</th>}
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
                    const ps = portMap[iface.id]
                    const hasErrors = ps && (ps.in_errors_delta > 0 || ps.out_errors_delta > 0 || ps.in_discards_delta > 0 || ps.out_discards_delta > 0)
                    return (
                      <tr key={iface.id} style={isSwitch && hasErrors ? { background: 'rgba(239,68,68,0.04)' } : undefined}>
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
                        {isSwitch && (
                          <td>
                            {ps?.duplex ? (
                              <span className={ps.duplex === 'half' ? 'tag-red' : ps.duplex === 'full' ? 'tag-green' : 'tag-gray'}>
                                {ps.duplex}
                              </span>
                            ) : <span className="text-light text-sm">—</span>}
                          </td>
                        )}
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
                        {isSwitch && (
                          <td>
                            {ps && ps.in_errors_delta > 0
                              ? <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 12 }}>{ps.in_errors_delta}</span>
                              : <span className="text-light text-sm">{ps ? ps.in_errors_total.toLocaleString() : '—'}</span>}
                          </td>
                        )}
                        {isSwitch && (
                          <td>
                            {ps && ps.out_errors_delta > 0
                              ? <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 12 }}>{ps.out_errors_delta}</span>
                              : <span className="text-light text-sm">{ps ? ps.out_errors_total.toLocaleString() : '—'}</span>}
                          </td>
                        )}
                        {isSwitch && (
                          <td>
                            {ps && (ps.in_discards_delta > 0 || ps.out_discards_delta > 0)
                              ? <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 12 }}>{ps.in_discards_delta + ps.out_discards_delta}</span>
                              : <span className="text-light text-sm">{ps ? (ps.in_discards_total + ps.out_discards_total).toLocaleString() : '—'}</span>}
                          </td>
                        )}
                        {isSwitch && (
                          <td>
                            {ps && ps.in_broadcast_pps > 0 ? (
                              <span style={{
                                color: ps.in_broadcast_pps > 1000 ? '#ef4444' : 'var(--text-muted)',
                                fontWeight: ps.in_broadcast_pps > 1000 ? 600 : 400,
                                fontSize: 12,
                              }}>
                                {ps.in_broadcast_pps > 1000 ? `${Math.round(ps.in_broadcast_pps)} pps` : `${Math.round(ps.in_broadcast_pps)}`}
                              </span>
                            ) : <span className="text-light text-sm">0</span>}
                          </td>
                        )}
                        {isSwitch && (
                          <td>
                            {ps && ps.flap_count > 0 ? (
                              <span style={{
                                color: ps.is_flapping ? '#ef4444' : '#f59e0b',
                                fontWeight: 600, fontSize: 12,
                              }}>
                                {ps.flap_count}{ps.is_flapping ? ' !!!' : ''}
                              </span>
                            ) : <span className="text-light text-sm">0</span>}
                          </td>
                        )}
                        <td className="mono text-sm text-muted">{iface.ip_address || '—'}</td>
                        <td className="text-muted">{iface.vlan_id || '—'}</td>
                        <td>
                          <Link to={`/interfaces/${iface.id}`} className="btn btn-outline btn-sm">Graphs \u2192</Link>
                        </td>
                      </tr>
                    )
                  })}
                  {pagedIfs.length === 0 && (
                    <tr><td colSpan={isSwitch ? 15 : 9} className="empty-table-cell">
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

      {/* MAC Table tab */}
      {tab === 'mac' && isSwitch && (
        <div className="card">
          <div className="card-header">
            <Database size={15} />
            <h3>MAC Address Table</h3>
            <div className="card__actions">
              <div className="search-bar">
                <Search size={13} />
                <input
                  placeholder="Search MAC, IP, hostname..."
                  value={macSearch}
                  onChange={e => { setMacSearch(e.target.value); setMacPage(0) }}
                />
              </div>
            </div>
          </div>
          {macLoading ? (
            <div className="empty-state card-body"><p>Loading MAC table...</p></div>
          ) : !macData || macData.entries.length === 0 ? (
            <div className="empty-state card-body">
              <p>{macSearch ? 'No MAC entries match your search.' : 'No MAC entries discovered yet.'}</p>
              <p className="text-xs text-muted">Click "Discover MAC Table" to scan this switch via SNMP.</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>MAC Address</th>
                      <th>IP Address</th>
                      <th>Hostname</th>
                      <th>Vendor (OUI)</th>
                      <th>Port</th>
                      <th>VLAN</th>
                      <th>Type</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macData.entries.map((entry: any) => (
                      <tr key={entry.id}>
                        <td className="mono text-sm font-semibold">{entry.mac_address}</td>
                        <td className="mono text-sm text-muted">{entry.ip_address || '—'}</td>
                        <td className="text-sm">{entry.hostname || '—'}</td>
                        <td className="text-sm text-muted">{entry.vendor || '—'}</td>
                        <td>
                          {entry.interface_id ? (
                            <Link to={`/interfaces/${entry.interface_id}`} className="link-primary text-sm mono">
                              {entry.interface_name || `#${entry.interface_id}`}
                            </Link>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td className="text-sm">{entry.vlan_id ?? '—'}</td>
                        <td>
                          <span className={entry.entry_type === 'static' ? 'tag-blue' : entry.entry_type === 'self' ? 'tag-green' : 'tag-gray'}>
                            {entry.entry_type}
                          </span>
                        </td>
                        <td className="text-sm text-muted">
                          {entry.last_seen ? formatDistanceToNow(new Date(entry.last_seen), { addSuffix: true }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {macData.total > macLimit && (
                <div className="pagination-footer">
                  <span className="pagination-info">
                    Showing {macPage * macLimit + 1}–{Math.min((macPage + 1) * macLimit, macData.total)} of {macData.total}
                  </span>
                  <div className="pagination-controls">
                    <button
                      onClick={() => setMacPage(p => Math.max(0, p - 1))}
                      disabled={macPage === 0}
                      className="btn btn-outline btn-sm"
                    >
                      ‹ Prev
                    </button>
                    <span className="pagination-page-info">
                      Page {macPage + 1} / {Math.ceil(macData.total / macLimit)}
                    </span>
                    <button
                      onClick={() => setMacPage(p => p + 1)}
                      disabled={(macPage + 1) * macLimit >= macData.total}
                      className="btn btn-outline btn-sm"
                    >
                      Next ›
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* MLAG tab */}
      {tab === 'mlag' && isSwitch && mlagData?.domain && (
        <div className="flex-col-gap">
          {/* Peer status card */}
          <div className="card">
            <div className="card-header"><h3>MLAG Domain</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
                <div>
                  <div className="text-xs text-muted">Domain ID</div>
                  <div style={{ fontWeight: 600 }}>{mlagData.domain.domain_id || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Protocol</div>
                  <div style={{ fontWeight: 600, textTransform: 'uppercase' }}>{mlagData.domain.vendor_protocol}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Local Role</div>
                  <div style={{ fontWeight: 600 }}>{mlagData.domain.local_role || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Peer Status</div>
                  <span className={mlagData.domain.peer_status === 'active' ? 'tag-green' : 'tag-red'}>
                    {mlagData.domain.peer_status}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-muted">Config Sanity</div>
                  <span className={mlagData.domain.config_sanity === 'consistent' ? 'tag-green' : 'tag-red'}>
                    {mlagData.domain.config_sanity}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-muted">Peer Link</div>
                  <div className="mono text-sm">{mlagData.domain.peer_link || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Peer Address</div>
                  <div className="mono text-sm">{mlagData.domain.peer_address || '-'}</div>
                </div>
              </div>

              {/* Port summary */}
              <div style={{ display: 'flex', gap: 24, marginTop: 20 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>{mlagData.domain.ports_configured}</div>
                  <div className="text-xs text-muted">Configured</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{mlagData.domain.ports_active}</div>
                  <div className="text-xs text-muted">Active</div>
                </div>
                {mlagData.domain.ports_errdisabled > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{mlagData.domain.ports_errdisabled}</div>
                    <div className="text-xs text-muted">Err-Disabled</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MLAG Interfaces table */}
          {mlagData.interfaces.length > 0 && (
            <div className="card">
              <div className="card-header"><h3>MLAG Interfaces ({mlagData.interfaces.length})</h3></div>
              <div className="card-body" style={{ padding: 0, overflow: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>MLAG ID</th>
                      <th>Interface</th>
                      <th>Local Status</th>
                      <th>Remote Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mlagData.interfaces.map((i: any) => {
                      const localOk = i.local_status?.includes('active')
                      const remoteOk = i.remote_status?.includes('active')
                      return (
                        <tr key={i.id}>
                          <td style={{ fontWeight: 600 }}>{i.mlag_id}</td>
                          <td className="mono text-sm">{i.interface_name}</td>
                          <td>
                            <span className={localOk ? 'tag-green' : 'tag-red'}>{i.local_status}</span>
                          </td>
                          <td>
                            <span className={remoteOk ? 'tag-green' : i.remote_status === 'n/a' ? 'tag-gray' : 'tag-red'}>
                              {i.remote_status}
                            </span>
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
      )}

      {/* VLANs tab */}
      {tab === 'vlans' && isSwitch && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ flex: '0 0 auto' }}>VLANs</h3>
            <input
              type="text"
              placeholder="Filter by ID or Name..."
              value={vlanFilter}
              onChange={e => { setVlanFilter(e.target.value); setVlanPage(0) }}
              style={{ flex: '1 1 180px', maxWidth: 240, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
            />
            <select
              value={vlanStatusFilter}
              onChange={e => { setVlanStatusFilter(e.target.value); setVlanPage(0) }}
              style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="suspend">Suspend</option>
            </select>
            <select
              value={vlanPageSize}
              onChange={e => { setVlanPageSize(Number(e.target.value)); setVlanPage(0) }}
              style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
            >
              {[25, 50, 100, 250].map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
          {vlansLoading ? (
            <div className="empty-state card-body"><p>Loading VLANs...</p></div>
          ) : !vlansData || vlansData.length === 0 ? (
            <div className="empty-state card-body"><p>No VLANs discovered yet.</p></div>
          ) : (() => {
            const filtered = vlansData
              .filter((v: any) => {
                if (vlanStatusFilter && v.status !== vlanStatusFilter) return false
                if (vlanFilter) {
                  const q = vlanFilter.toLowerCase()
                  return String(v.vlan_id).includes(q) || (v.vlan_name || '').toLowerCase().includes(q)
                }
                return true
              })
              .sort((a: any, b: any) => {
                const dir = vlanSortDir === 'asc' ? 1 : -1
                if (vlanSortKey === 'mac_count') return ((a.mac_count || 0) - (b.mac_count || 0)) * dir
                if (vlanSortKey === 'vlan_id') return (a.vlan_id - b.vlan_id) * dir
                if (vlanSortKey === 'vlan_name') return (a.vlan_name || '').localeCompare(b.vlan_name || '') * dir
                return 0
              })
            const totalPages = Math.ceil(filtered.length / vlanPageSize)
            const paged = filtered.slice(vlanPage * vlanPageSize, (vlanPage + 1) * vlanPageSize)
            const sortHeader = (key: string, label: string) => (
              <th
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => {
                  if (vlanSortKey === key) setVlanSortDir(d => d === 'asc' ? 'desc' : 'asc')
                  else { setVlanSortKey(key); setVlanSortDir(key === 'mac_count' ? 'desc' : 'asc') }
                }}
              >
                {label} {vlanSortKey === key ? (vlanSortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
            )
            return (
              <>
                <div className="card-body" style={{ padding: 0, overflow: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        {sortHeader('vlan_id', 'VLAN ID')}
                        {sortHeader('vlan_name', 'Name')}
                        <th>Status</th>
                        <th>Untagged Ports</th>
                        {sortHeader('mac_count', 'MAC Count')}
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((v: any) => (
                        <tr key={v.id}>
                          <td style={{ fontWeight: 600 }}>{v.vlan_id}</td>
                          <td>{v.vlan_name || '-'}</td>
                          <td>
                            <span className={v.status === 'active' ? 'tag-green' : 'tag-gray'}>{v.status}</span>
                          </td>
                          <td>
                            {v.untagged_ports?.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {v.untagged_ports.slice(0, 10).map((p: string) => (
                                  <span key={p} className="tag-gray" style={{ fontSize: 11 }}>{p}</span>
                                ))}
                                {v.untagged_ports.length > 10 && (
                                  <span className="text-muted text-xs">+{v.untagged_ports.length - 10} more</span>
                                )}
                              </div>
                            ) : <span className="text-light">-</span>}
                          </td>
                          <td style={{ fontWeight: v.mac_count > 0 ? 600 : 400 }}>{v.mac_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                    <span>Showing {vlanPage * vlanPageSize + 1}-{Math.min((vlanPage + 1) * vlanPageSize, filtered.length)} of {filtered.length} VLANs</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-outline btn-sm" disabled={vlanPage === 0} onClick={() => setVlanPage(p => p - 1)} style={{ fontSize: 11, padding: '2px 8px' }}>Prev</button>
                      <button className="btn btn-outline btn-sm" disabled={vlanPage >= totalPages - 1} onClick={() => setVlanPage(p => p + 1)} style={{ fontSize: 11, padding: '2px 8px' }}>Next</button>
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Environment tab */}
      {tab === 'environment' && isSwitch && (
        <div className="flex-col-gap">
          {/* Temperature chart */}
          <div className="card">
            <div className="card-header">
              <Thermometer size={15} />
              <h3>Temperature History</h3>
              <div className="card__actions">
                {[6, 12, 24, 48, 72, 168].map(h => (
                  <button
                    key={h}
                    className={`btn btn-sm ${envHours === h ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setEnvHours(h)}
                  >
                    {h <= 24 ? `${h}h` : `${h / 24}d`}
                  </button>
                ))}
              </div>
            </div>
            <div className="card-body">
              {envLoading ? (
                <div className="empty-state"><p>Loading...</p></div>
              ) : !envData?.metrics?.length ? (
                <div className="empty-state"><p>No temperature data available yet.</p></div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={(() => {
                    // Group metrics by sensor name
                    const sensorNames = [...new Set(envData.metrics.map((m: any) => m.sensor_name))]
                    const timeMap: Record<string, any> = {}
                    for (const m of envData.metrics) {
                      const t = m.timestamp
                      if (!timeMap[t]) timeMap[t] = { time: new Date(t).toLocaleString() }
                      timeMap[t][m.sensor_name] = m.value
                    }
                    return Object.values(timeMap)
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis unit="\u00b0C" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    {[...new Set(envData.metrics.map((m: any) => m.sensor_name))].map((name: any, i: number) => {
                      const colors = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#ec4899']
                      return <Line key={name} type="monotone" dataKey={name} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />
                    })}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Sensor status grids */}
          {envData && envData.sensors && envData.sensors.length > 0 && (() => {
            const temps = envData.sensors.filter((s: any) => s.sensor_type === 'temperature')
            const fans = envData.sensors.filter((s: any) => s.sensor_type === 'fan')
            const psus = envData.sensors.filter((s: any) => s.sensor_type === 'psu')
            return (
              <>
                {/* Temperature sensors */}
                {temps.length > 0 && (
                  <div className="card">
                    <div className="card-header"><Thermometer size={14} /><h3>Temperature Sensors ({temps.length})</h3></div>
                    <div className="card-body">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                        {temps.map((s: any) => {
                          const color = s.status === 'critical' ? '#ef4444' : s.status === 'warning' ? '#f59e0b' : '#22c55e'
                          return (
                            <div key={s.id} style={{
                              padding: '12px 16px', borderRadius: 8,
                              border: `1px solid ${color}33`, background: `${color}08`,
                            }}>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{s.sensor_name}</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color }}>
                                {s.value != null ? `${s.value.toFixed(1)}\u00b0C` : 'N/A'}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.status || 'unknown'}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Fan status */}
                {fans.length > 0 && (
                  <div className="card">
                    <div className="card-header"><Fan size={14} /><h3>Fan Status ({fans.length})</h3></div>
                    <div className="card-body">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                        {fans.map((s: any) => {
                          const color = s.status === 'ok' ? '#22c55e' : s.status === 'warning' ? '#f59e0b' : '#ef4444'
                          return (
                            <div key={s.id} style={{
                              padding: '12px 16px', borderRadius: 8,
                              border: `1px solid ${color}33`, background: `${color}08`,
                              display: 'flex', alignItems: 'center', gap: 12,
                            }}>
                              <Fan size={20} style={{ color }} />
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>{s.sensor_name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {s.value != null ? `${s.value} ${s.unit || 'RPM'}` : s.status || 'unknown'}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* PSU status */}
                {psus.length > 0 && (
                  <div className="card">
                    <div className="card-header"><Zap size={14} /><h3>Power Supplies ({psus.length})</h3></div>
                    <div className="card-body">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                        {psus.map((s: any) => {
                          const color = s.status === 'ok' ? '#22c55e' : s.status === 'warning' ? '#f59e0b' : '#ef4444'
                          return (
                            <div key={s.id} style={{
                              padding: '12px 16px', borderRadius: 8,
                              border: `1px solid ${color}33`, background: `${color}08`,
                              display: 'flex', alignItems: 'center', gap: 12,
                            }}>
                              <Zap size={20} style={{ color }} />
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>{s.sensor_name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {s.value != null ? `${s.value} ${s.unit || 'W'}` : ''} {s.status || 'unknown'}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
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
