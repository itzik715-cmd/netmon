import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { switchesApi } from '../services/api'
import { Link } from 'react-router-dom'
import {
  Network, Search, Cpu, HardDrive, AlertTriangle, ArrowUpDown,
  ChevronUp, ChevronDown, Database, Thermometer, Radio,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bps`
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function statusDot(status: string) {
  const cls = status === 'up' ? 'dot-green' : status === 'down' ? 'dot-red' : 'dot-orange'
  return <span className={`status-dot ${cls}`} />
}

type SortKey = 'hostname' | 'status' | 'cpu_usage' | 'memory_usage' | 'ports_up' | 'error_ports' | 'total_traffic_bps' | 'uptime' | 'max_temperature' | 'rtt_ms'

interface SwitchRow {
  id: number
  hostname: string
  ip_address: string
  device_type: string
  vendor: string | null
  model: string | null
  status: string
  location: string | null
  uptime: number | null
  cpu_usage: number | null
  memory_usage: number | null
  ports_total: number
  ports_up: number
  ports_admin_down: number
  error_ports: number
  total_traffic_bps: number
  max_temperature: number | null
  rtt_ms: number | null
  packet_loss_pct: number | null
}

export default function SwitchesDashboardPage() {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('hostname')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Global MAC search
  const [macQuery, setMacQuery] = useState('')
  const [macOpen, setMacOpen] = useState(false)
  const macRef = useRef<HTMLDivElement>(null)

  const { data: macResults } = useQuery({
    queryKey: ['mac-search', macQuery],
    queryFn: () => switchesApi.macSearch(macQuery).then(r => r.data),
    enabled: macQuery.length >= 2,
  })

  useEffect(() => {
    if (!macOpen) return
    const handler = (e: MouseEvent) => {
      if (macRef.current && !macRef.current.contains(e.target as Node)) {
        setMacOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [macOpen])

  const { data, isLoading } = useQuery({
    queryKey: ['switches-dashboard'],
    queryFn: () => switchesApi.dashboard().then(r => r.data),
    refetchInterval: 60_000,
  })

  const switches: SwitchRow[] = data?.switches || []

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = switches
    if (q) {
      list = list.filter(s =>
        s.hostname.toLowerCase().includes(q) ||
        s.ip_address.includes(q) ||
        (s.vendor || '').toLowerCase().includes(q) ||
        (s.location || '').toLowerCase().includes(q)
      )
    }
    list = [...list].sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return list
  }, [switches, search, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
  }

  const ThSort = ({ col, label, style }: { col: SortKey; label: string; style?: React.CSSProperties }) => (
    <th onClick={() => toggleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
      <div className="flex-row-gap-sm">
        {label} <SortIcon col={col} />
      </div>
    </th>
  )

  return (
    <div className="flex-col-gap" style={{ height: '100%' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1><Network size={22} style={{ marginRight: 8, verticalAlign: -3 }} />Switch Monitor</h1>
          <p>Fleet-wide switch health, port status, and error tracking</p>
        </div>
        <div className="flex-row-gap">
          {/* Global MAC search */}
          <div ref={macRef} style={{ position: 'relative' }}>
            <div className="search-bar">
              <Database size={13} />
              <input
                placeholder="Find MAC / IP..."
                value={macQuery}
                onChange={e => { setMacQuery(e.target.value); setMacOpen(true) }}
                onFocus={() => macQuery.length >= 2 && setMacOpen(true)}
              />
            </div>
            {macOpen && macQuery.length >= 2 && macResults && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                width: 520, maxHeight: 380, overflow: 'auto',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.15)', zIndex: 100,
              }}>
                {macResults.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No results found for "{macQuery}"
                  </div>
                ) : (
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr><th>MAC</th><th>IP</th><th>Switch</th><th>Port</th><th>VLAN</th><th>Seen</th></tr>
                    </thead>
                    <tbody>
                      {macResults.map((r: any, i: number) => (
                        <tr key={i}>
                          <td className="mono" style={{ fontSize: 11 }}>{r.mac_address}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.ip_address || '—'}</td>
                          <td>
                            <Link to={`/devices/${r.switch_id}`} className="link-primary" onClick={() => setMacOpen(false)}>
                              {r.switch_hostname}
                            </Link>
                          </td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.interface_name || '—'}</td>
                          <td>{r.vlan_id ?? '—'}</td>
                          <td className="text-muted" style={{ fontSize: 10 }}>
                            {r.last_seen ? formatDistanceToNow(new Date(r.last_seen), { addSuffix: true }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
          <div className="search-bar">
            <Search size={13} />
            <input placeholder="Search switches..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        <div className="stat-card">
          <div className="stat-card__icon blue"><Network size={18} /></div>
          <div>
            <div className="stat-card__label">Total Switches</div>
            <div className="stat-card__value">{data?.total ?? '-'}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon green"><Network size={18} /></div>
          <div>
            <div className="stat-card__label">Online / Offline</div>
            <div className="stat-card__value">
              <span style={{ color: '#22c55e' }}>{data?.up ?? 0}</span>
              {' / '}
              <span style={{ color: '#ef4444' }}>{data?.down ?? 0}</span>
              {(data?.degraded ?? 0) > 0 && <span style={{ color: '#f59e0b' }}> / {data.degraded}</span>}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon purple"><Network size={18} /></div>
          <div>
            <div className="stat-card__label">Total Ports</div>
            <div className="stat-card__value">{data?.total_ports?.toLocaleString() ?? '-'}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon" style={{ background: (data?.error_ports ?? 0) > 0 ? 'var(--bg-danger)' : undefined }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="stat-card__label">Error Ports</div>
            <div className="stat-card__value" style={{ color: (data?.error_ports ?? 0) > 0 ? '#ef4444' : undefined }}>
              {data?.error_ports ?? 0}
            </div>
          </div>
        </div>
        {(data?.broadcast_storm_ports ?? 0) > 0 && (
          <div className="stat-card">
            <div className="stat-card__icon" style={{ background: 'var(--bg-danger)' }}><Radio size={18} /></div>
            <div>
              <div className="stat-card__label">Bcast Storms</div>
              <div className="stat-card__value" style={{ color: '#ef4444' }}>{data.broadcast_storm_ports}</div>
            </div>
          </div>
        )}
        <div className="stat-card">
          <div className="stat-card__icon orange"><Cpu size={18} /></div>
          <div>
            <div className="stat-card__label">Avg CPU</div>
            <div className="stat-card__value">{data?.avg_cpu ?? 0}%</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card__icon cyan"><HardDrive size={18} /></div>
          <div>
            <div className="stat-card__label">Avg Memory</div>
            <div className="stat-card__value">{data?.avg_memory ?? 0}%</div>
          </div>
        </div>
      </div>

      {/* Switch table */}
      <div className="card">
        <div className="card-header">
          <Network size={14} />
          <h3>Switches ({filtered.length})</h3>
        </div>
        <div className="card-body" style={{ padding: 0, overflow: 'auto' }}>
          {isLoading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><p>No switches found.</p></div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <ThSort col="status" label="Status" />
                  <ThSort col="hostname" label="Hostname" />
                  <th>IP Address</th>
                  <th>Vendor / Model</th>
                  <th>Location</th>
                  <ThSort col="uptime" label="Uptime" />
                  <ThSort col="cpu_usage" label="CPU" />
                  <ThSort col="memory_usage" label="Memory" />
                  <ThSort col="ports_up" label="Ports" />
                  <ThSort col="error_ports" label="Errors" />
                  <ThSort col="max_temperature" label="Temp" />
                  <ThSort col="rtt_ms" label="RTT" />
                  <ThSort col="total_traffic_bps" label="Traffic" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(sw => {
                  const cpuColor = (sw.cpu_usage ?? 0) > 80 ? '#ef4444' : (sw.cpu_usage ?? 0) > 60 ? '#f59e0b' : '#22c55e'
                  const memColor = (sw.memory_usage ?? 0) > 80 ? '#ef4444' : (sw.memory_usage ?? 0) > 60 ? '#f59e0b' : '#22c55e'
                  const hasErrors = sw.error_ports > 0

                  return (
                    <tr key={sw.id} style={hasErrors ? { background: 'rgba(239,68,68,0.04)' } : undefined}>
                      <td>{statusDot(sw.status)}</td>
                      <td>
                        <Link to={`/devices/${sw.id}`} className="link-primary" style={{ fontWeight: 600 }}>
                          {sw.hostname}
                        </Link>
                        <div className="text-xs text-light">{sw.device_type}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{sw.ip_address}</td>
                      <td>
                        <span>{sw.vendor || '-'}</span>
                        {sw.model && <span className="text-light" style={{ fontSize: 11 }}> / {sw.model}</span>}
                      </td>
                      <td>{sw.location || '-'}</td>
                      <td>{formatUptime(sw.uptime)}</td>
                      <td>
                        {sw.cpu_usage != null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 40, height: 6, background: 'var(--bg-subtle)', borderRadius: 3 }}>
                              <div style={{ width: `${Math.min(sw.cpu_usage, 100)}%`, height: '100%', background: cpuColor, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11 }}>{sw.cpu_usage}%</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td>
                        {sw.memory_usage != null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 40, height: 6, background: 'var(--bg-subtle)', borderRadius: 3 }}>
                              <div style={{ width: `${Math.min(sw.memory_usage, 100)}%`, height: '100%', background: memColor, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11 }}>{sw.memory_usage}%</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td>
                        <span style={{ color: '#22c55e', fontWeight: 600 }}>{sw.ports_up}</span>
                        <span className="text-light"> / {sw.ports_total}</span>
                      </td>
                      <td>
                        {hasErrors ? (
                          <span style={{ color: '#ef4444', fontWeight: 600 }}>{sw.error_ports}</span>
                        ) : (
                          <span className="text-light">0</span>
                        )}
                      </td>
                      <td>
                        {sw.max_temperature != null ? (
                          <span style={{
                            fontSize: 11, fontWeight: 600,
                            color: sw.max_temperature > 70 ? '#ef4444' : sw.max_temperature > 55 ? '#f59e0b' : '#22c55e',
                          }}>
                            {sw.max_temperature}&deg;C
                          </span>
                        ) : <span className="text-light">-</span>}
                      </td>
                      <td>
                        {sw.rtt_ms != null ? (
                          <span style={{
                            fontSize: 11,
                            color: sw.rtt_ms > 100 ? '#ef4444' : sw.rtt_ms > 20 ? '#f59e0b' : '#22c55e',
                            fontWeight: sw.rtt_ms > 100 ? 600 : 400,
                          }}>
                            {sw.rtt_ms}ms
                            {sw.packet_loss_pct != null && sw.packet_loss_pct > 0 && (
                              <span style={{ color: '#ef4444', marginLeft: 4 }}>({sw.packet_loss_pct}%)</span>
                            )}
                          </span>
                        ) : <span className="text-light">-</span>}
                      </td>
                      <td style={{ fontSize: 11 }}>{formatBps(sw.total_traffic_bps)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
