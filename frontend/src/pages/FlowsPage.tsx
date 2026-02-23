import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Label,
} from 'recharts'

const COLORS     = ['#1a9dc8', '#a78bfa', '#06b6d4', '#f97316', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']
const COLORS_IN  = ['#27ae60', '#2ecc71', '#1abc9c', '#16a085', '#0d9488', '#059669', '#10b981', '#34d399']

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

const TIME_RANGES = [
  { label: '1h',  hours: 1   },
  { label: '6h',  hours: 6   },
  { label: '24h', hours: 24  },
  { label: '7d',  hours: 168 },
]

const TOOLTIP_STYLE = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }

// ── IP search bar ─────────────────────────────────────────────────────────────
function IpSearchBar({
  value, onChange, onClear,
}: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(value)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onChange(draft.trim())
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ position: 'relative' }}>
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--text-muted)' }}
        >
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          className="input"
          placeholder="Search by IP address…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ paddingLeft: 32, width: 220, fontFamily: 'DM Mono, monospace', fontSize: 13 }}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-sm">Search</button>
      {value && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => { setDraft(''); onClear(); }}
        >
          ✕ Clear
        </button>
      )}
    </form>
  )
}

// ── Donut + ranked list column ─────────────────────────────────────────────────
function TrafficColumn({
  title, accentColor, colors, totalBytes, peers, selectedPeer, onSelectPeer,
}: {
  title: string
  accentColor: string
  colors: string[]
  totalBytes: number
  peers: { ip: string; bytes: number }[]
  selectedPeer: string
  onSelectPeer: (ip: string) => void
}) {
  const maxBytes = peers[0]?.bytes || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: accentColor,
        textTransform: 'uppercase', letterSpacing: 1,
      }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 10, alignItems: 'start' }}>
        {/* Donut chart */}
        <ResponsiveContainer width="100%" height={130}>
          <PieChart>
            <Pie
              data={peers.length ? peers : [{ ip: 'none', bytes: 1 }]}
              dataKey="bytes"
              nameKey="ip"
              cx="50%" cy="50%"
              innerRadius={38}
              outerRadius={58}
              strokeWidth={1}
            >
              {(peers.length ? peers : [{ ip: 'none', bytes: 1 }]).map((_: any, i: number) => (
                <Cell
                  key={i}
                  fill={peers.length ? colors[i % colors.length] : 'var(--border)'}
                />
              ))}
              <Label
                value={formatBytes(totalBytes)}
                position="center"
                style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-main)' }}
              />
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
          </PieChart>
        </ResponsiveContainer>

        {/* Ranked list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
          {peers.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 8 }}>No data</div>
          )}
          {peers.slice(0, 8).map((peer, i) => {
            const pct = Math.round((peer.bytes / maxBytes) * 100)
            const isSelected = selectedPeer === peer.ip
            return (
              <div
                key={peer.ip}
                onClick={() => onSelectPeer(isSelected ? '' : peer.ip)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  cursor: 'pointer', borderRadius: 5, padding: '3px 5px',
                  background: isSelected ? `${accentColor}18` : 'transparent',
                  border: isSelected ? `1px solid ${accentColor}40` : '1px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{ width: 13, fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, background: colors[i % colors.length] }} />
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: accentColor, minWidth: 88, flexShrink: 0 }}>{peer.ip}</span>
                <div style={{ flex: 1, background: 'var(--bg-page)', borderRadius: 3, height: 4, minWidth: 20 }}>
                  <div style={{ width: `${pct}%`, background: colors[i % colors.length], height: '100%', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 52, textAlign: 'right', flexShrink: 0 }}>{formatBytes(peer.bytes)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── IP Profile card ───────────────────────────────────────────────────────────
function IpProfile({
  ip, hours, selectedPeer, onSelectPeer,
}: {
  ip: string
  hours: number
  selectedPeer: string
  onSelectPeer: (peer: string) => void
}) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['ip-profile', ip, hours],
    queryFn: () => flowsApi.ipProfile(ip, hours).then((r) => r.data),
    enabled: !!ip,
  })

  if (isLoading) return <div className="card" style={{ padding: 20 }}>Loading profile for {ip}…</div>
  if (!profile)  return null

  const topOut: { ip: string; bytes: number }[] = profile.top_out || []
  const topIn:  { ip: string; bytes: number }[] = profile.top_in  || []

  return (
    <div className="card">
      <div className="card-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
        </svg>
        <h3>
          IP Profile —{' '}
          <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent-blue)' }}>{ip}</span>
        </h3>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Stat row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Sent',           value: formatBytes(profile.bytes_sent),     icon: '↑', color: 'var(--accent-blue)'  },
            { label: 'Received',       value: formatBytes(profile.bytes_received), icon: '↓', color: 'var(--accent-green)' },
            { label: 'Flows as Source', value: profile.flows_as_src.toLocaleString() + ' flows', icon: '→', color: 'var(--accent-blue)'  },
            { label: 'Flows as Dest',  value: profile.flows_as_dst.toLocaleString() + ' flows', icon: '←', color: 'var(--accent-green)' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} style={{ background: 'var(--bg-page)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span style={{ color, marginRight: 4 }}>{icon}</span>{label}
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-main)', fontFamily: 'DM Mono, monospace' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* TOP OUT | TOP IN */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <TrafficColumn
            title="↑ Top Out (destinations)"
            accentColor="var(--accent-blue)"
            colors={COLORS}
            totalBytes={profile.bytes_sent}
            peers={topOut}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
          />
          <TrafficColumn
            title="↓ Top In (sources)"
            accentColor="var(--accent-green)"
            colors={COLORS_IN}
            totalBytes={profile.bytes_received}
            peers={topIn}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
          />
        </div>

        {/* Protocol distribution */}
        {profile.protocol_distribution.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Protocols
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie
                  data={profile.protocol_distribution}
                  dataKey="bytes"
                  nameKey="protocol"
                  cx="50%" cy="50%"
                  outerRadius={50}
                >
                  {profile.protocol_distribution.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                <Legend formatter={(v) => <span style={{ color: '#64748b', fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {profile.flows_as_src + profile.flows_as_dst === 0 && (
          <div style={{ color: 'var(--text-light)', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
            No flows found for {ip} in the selected time window
          </div>
        )}
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function FlowsPage() {
  const [hours, setHours]           = useState(1)
  const [searchIp, setSearchIp]     = useState('')
  const [selectedPeer, setSelectedPeer] = useState('')
  // null = "all selected" (no filter sent); otherwise a Set of selected device IDs
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<number> | null>(null)

  function handleSearchChange(ip: string) {
    setSearchIp(ip)
    setSelectedPeer('')
  }

  // Fetch devices that have flow data in this time window
  const { data: flowDevices = [] } = useQuery<{ device_id: number; hostname: string; ip_address: string; flow_count: number }[]>({
    queryKey: ['flow-devices', hours],
    queryFn: () => flowsApi.devices(hours).then((r) => r.data),
    refetchInterval: 60_000,
  })

  // When device list changes (or time range changes), reset to all selected
  useEffect(() => {
    setSelectedDeviceIds(null)
  }, [hours, flowDevices.map((d) => d.device_id).join(',')])

  function toggleDevice(id: number) {
    const allIds = new Set(flowDevices.map((d) => d.device_id))
    const current = selectedDeviceIds ?? allIds
    const next = new Set(current)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    // If all selected again, go back to null (= no filter)
    setSelectedDeviceIds(next.size === allIds.size ? null : next)
  }

  // Build device_ids param: undefined when all selected, comma-list when filtered
  const deviceIdsParam: string | undefined =
    selectedDeviceIds === null
      ? undefined
      : selectedDeviceIds.size === 0
      ? '-1'                        // nothing selected → return no results
      : [...selectedDeviceIds].join(',')

  const { data: stats, isLoading } = useQuery({
    queryKey: ['flow-stats', hours, deviceIdsParam],
    queryFn: () => flowsApi.stats({ hours, ...(deviceIdsParam ? { device_ids: deviceIdsParam } : {}) }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: conversations } = useQuery({
    queryKey: ['flow-conversations', hours, searchIp, deviceIdsParam],
    queryFn: () =>
      flowsApi.conversations({
        hours,
        limit: 100,
        ...(searchIp ? { ip: searchIp } : {}),
        ...(deviceIdsParam ? { device_ids: deviceIdsParam } : {}),
      }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  // When a peer is selected, filter conversations client-side
  const displayedConversations = selectedPeer
    ? (conversations || []).filter((f: any) =>
        (f.src_ip === searchIp && f.dst_ip === selectedPeer) ||
        (f.src_ip === selectedPeer && f.dst_ip === searchIp)
      )
    : (conversations || [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Flow Analysis</h1>
          <p>NetFlow &amp; sFlow traffic analysis</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <IpSearchBar value={searchIp} onChange={handleSearchChange} onClear={() => { setSearchIp(''); setSelectedPeer('') }} />
          <div className="time-range-bar">
            {TIME_RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={`time-btn${hours === r.hours ? ' active' : ''}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Device filter — only shown when 2+ devices are sending flows */}
      {flowDevices.length > 1 && (
        <div className="card" style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
              Devices
            </span>
            {flowDevices.map((d) => {
              const isSelected = selectedDeviceIds === null || selectedDeviceIds.has(d.device_id)
              return (
                <button
                  key={d.device_id}
                  onClick={() => toggleDevice(d.device_id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 11px', borderRadius: 20, fontSize: 12,
                    border: `1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(26,157,200,0.1)' : 'transparent',
                    color: isSelected ? 'var(--accent-blue)' : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: isSelected ? 'var(--accent-blue)' : 'var(--border)',
                  }} />
                  {d.hostname}
                  <span style={{ fontSize: 10, opacity: 0.65, fontFamily: 'DM Mono, monospace' }}>
                    {d.flow_count >= 1000 ? `${(d.flow_count / 1000).toFixed(0)}k` : d.flow_count}
                  </span>
                </button>
              )
            })}
            {selectedDeviceIds !== null && (
              <button
                className="btn btn-outline btn-sm"
                style={{ marginLeft: 'auto', fontSize: 11 }}
                onClick={() => setSelectedDeviceIds(null)}
              >
                ✕ Show all
              </button>
            )}
          </div>
        </div>
      )}

      {/* IP Profile — only shown when searching */}
      {searchIp && (
        <IpProfile
          ip={searchIp}
          hours={hours}
          selectedPeer={selectedPeer}
          onSelectPeer={setSelectedPeer}
        />
      )}

      {/* Global stats cards */}
      {!searchIp && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="stat-card">
            <div className="stat-icon blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div className="stat-body">
              <div className="stat-label">Total Flows</div>
              <div className="stat-value">{stats.total_flows.toLocaleString()}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </div>
            <div className="stat-body">
              <div className="stat-label">Total Traffic</div>
              <div className="stat-value">{formatBytes(stats.total_bytes)}</div>
            </div>
          </div>
        </div>
      )}

      {isLoading && !searchIp ? (
        <div className="empty-state card"><p>Loading flow data...</p></div>
      ) : !searchIp && (!stats || stats.total_flows === 0) ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state" style={{ padding: '48px 0' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48 }}>
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              <p>No flow data available</p>
              <p className="sub">Configure your network devices to export NetFlow to this server on UDP port 2055</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Charts — hidden while doing IP search */}
          {!searchIp && stats && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card">
                <div className="card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  <h3>Top Talkers (by bytes)</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={stats.top_talkers} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatBytes(v)} />
                      <YAxis
                        type="category" dataKey="ip"
                        tick={(props) => {
                          const { x, y, payload } = props
                          return (
                            <text x={x} y={y} dy={4} textAnchor="end" fill="#1a9dc8" fontSize={11}
                              style={{ cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => handleSearchChange(payload.value)}
                            >
                              {payload.value}
                            </text>
                          )
                        }}
                        tickLine={false} width={80}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatBytes(v), 'Traffic']} />
                      <Bar dataKey="bytes" fill="#1a9dc8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  <h3>Top Destinations</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={stats.top_destinations} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatBytes(v)} />
                      <YAxis
                        type="category" dataKey="ip"
                        tick={(props) => {
                          const { x, y, payload } = props
                          return (
                            <text x={x} y={y} dy={4} textAnchor="end" fill="#27ae60" fontSize={11}
                              style={{ cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => handleSearchChange(payload.value)}
                            >
                              {payload.value}
                            </text>
                          )
                        }}
                        tickLine={false} width={80}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatBytes(v), 'Traffic']} />
                      <Bar dataKey="bytes" fill="#27ae60" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                  <h3>Protocol Distribution</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={stats.protocol_distribution} dataKey="bytes" nameKey="protocol" cx="50%" cy="50%" outerRadius={80}
                        label={({ protocol, percent }: any) => `${protocol} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
                        {stats.protocol_distribution.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                  <h3>Applications</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={stats.application_distribution} dataKey="bytes" nameKey="app" cx="50%" cy="50%" outerRadius={80}>
                        {stats.application_distribution.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                      <Legend formatter={(v) => <span style={{ color: '#64748b', fontSize: 12 }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Conversations table */}
          <div className="card">
            <div className="card-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <h3>
                {searchIp && selectedPeer ? (
                  <>
                    Flows:{' '}
                    <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent-blue)' }}>{searchIp}</span>
                    {' ↔ '}
                    <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent-green)' }}>{selectedPeer}</span>
                  </>
                ) : searchIp ? (
                  <>Flows involving <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent-blue)' }}>{searchIp}</span></>
                ) : (
                  'Top Conversations'
                )}
              </h3>
              {selectedPeer && (
                <button
                  className="btn btn-outline btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setSelectedPeer('')}
                >
                  ✕ Show all flows
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {searchIp && <th style={{ width: 30 }}></th>}
                    <th>Source IP</th>
                    <th>Destination IP</th>
                    <th>Protocol</th>
                    <th>Dst Port</th>
                    <th>Application</th>
                    <th>Bytes</th>
                    <th>Packets</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedConversations.map((flow: any) => {
                    const isOutgoing = flow.src_ip === searchIp
                    return (
                      <tr key={flow.id}>
                        {searchIp && (
                          <td title={isOutgoing ? 'Outgoing' : 'Incoming'} style={{ fontSize: 14, textAlign: 'center' }}>
                            <span style={{ color: isOutgoing ? 'var(--accent-blue)' : 'var(--accent-green)' }}>
                              {isOutgoing ? '↑' : '↓'}
                            </span>
                          </td>
                        )}
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                          {flow.src_ip === searchIp
                            ? <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{flow.src_ip}</span>
                            : (
                              <button className="btn-link" style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--accent-blue)', cursor: 'pointer' }}
                                onClick={() => handleSearchChange(flow.src_ip)}>
                                {flow.src_ip}
                              </button>
                            )
                          }
                        </td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                          {flow.dst_ip === searchIp
                            ? <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{flow.dst_ip}</span>
                            : (
                              <button className="btn-link" style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--accent-blue)', cursor: 'pointer' }}
                                onClick={() => handleSearchChange(flow.dst_ip)}>
                                {flow.dst_ip}
                              </button>
                            )
                          }
                        </td>
                        <td><span className="tag-blue">{flow.protocol}</span></td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{flow.dst_port}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{flow.application || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{formatBytes(flow.bytes)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{flow.packets?.toLocaleString()}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-light)' }}>
                          {flow.timestamp ? new Date(flow.timestamp).toLocaleTimeString() : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {displayedConversations.length === 0 && (
                    <tr>
                      <td colSpan={searchIp ? 9 : 8} style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-light)' }}>
                        {selectedPeer
                          ? `No flows between ${searchIp} and ${selectedPeer}`
                          : searchIp
                          ? `No flows found for ${searchIp}`
                          : 'No conversations'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
