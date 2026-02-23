import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

const COLORS = ['#1a9dc8', '#27ae60', '#f39c12', '#e74c3c', '#a78bfa', '#06b6d4', '#84cc16', '#f97316']

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
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

// ── IP Profile card ───────────────────────────────────────────────────────────
function IpProfile({
  ip, hours, onPeerClick,
}: { ip: string; hours: number; onPeerClick: (peer: string) => void }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['ip-profile', ip, hours],
    queryFn: () => flowsApi.ipProfile(ip, hours).then((r) => r.data),
    enabled: !!ip,
  })

  if (isLoading) return <div className="card" style={{ padding: 20 }}>Loading profile for {ip}…</div>
  if (!profile) return null

  const totalFlows = profile.flows_as_src + profile.flows_as_dst

  return (
    <div className="card">
      <div className="card-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
        </svg>
        <h3>IP Profile — <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent-blue)' }}>{ip}</span></h3>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* stat row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Sent', value: formatBytes(profile.bytes_sent), icon: '↑', color: 'var(--accent-blue)' },
            { label: 'Received', value: formatBytes(profile.bytes_received), icon: '↓', color: 'var(--accent-green)' },
            { label: 'As Source', value: profile.flows_as_src.toLocaleString() + ' flows', icon: '→', color: 'var(--accent-blue)' },
            { label: 'As Destination', value: profile.flows_as_dst.toLocaleString() + ' flows', icon: '←', color: 'var(--accent-green)' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} style={{ background: 'var(--bg-page)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span style={{ color, marginRight: 4 }}>{icon}</span>{label}
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-main)', fontFamily: 'DM Mono, monospace' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* top peers + protocol distribution */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* top peers */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Top Peers</div>
            {profile.top_peers.length === 0 ? (
              <div style={{ color: 'var(--text-light)', fontSize: 12 }}>No peers found</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {profile.top_peers.map((peer: { ip: string; bytes: number }) => {
                  const maxBytes = profile.top_peers[0]?.bytes || 1
                  const pct = Math.round((peer.bytes / maxBytes) * 100)
                  return (
                    <div key={peer.ip} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        className="btn-link"
                        style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, minWidth: 110, textAlign: 'left', cursor: 'pointer', color: 'var(--accent-blue)' }}
                        onClick={() => onPeerClick(peer.ip)}
                      >
                        {peer.ip}
                      </button>
                      <div style={{ flex: 1, background: 'var(--bg-secondary, #f1f5f9)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, background: 'var(--accent-blue)', height: '100%', borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 60, textAlign: 'right' }}>{formatBytes(peer.bytes)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* protocol pie */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Protocols</div>
            {profile.protocol_distribution.length === 0 ? (
              <div style={{ color: 'var(--text-light)', fontSize: 12 }}>No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={profile.protocol_distribution}
                    dataKey="bytes"
                    nameKey="protocol"
                    cx="50%" cy="50%"
                    outerRadius={60}
                  >
                    {profile.protocol_distribution.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                  <Legend formatter={(v) => <span style={{ color: '#64748b', fontSize: 11 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {totalFlows === 0 && (
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
  const [hours, setHours] = useState(1)
  const [searchIp, setSearchIp] = useState('')   // active IP filter

  const { data: stats, isLoading } = useQuery({
    queryKey: ['flow-stats', hours],
    queryFn: () => flowsApi.stats({ hours }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: conversations } = useQuery({
    queryKey: ['flow-conversations', hours, searchIp],
    queryFn: () =>
      flowsApi.conversations({
        hours,
        limit: 100,
        ...(searchIp ? { ip: searchIp } : {}),
      }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Flow Analysis</h1>
          <p>NetFlow &amp; sFlow traffic analysis</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <IpSearchBar value={searchIp} onChange={setSearchIp} onClear={() => setSearchIp('')} />
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

      {/* IP Profile — only shown when searching */}
      {searchIp && (
        <IpProfile ip={searchIp} hours={hours} onPeerClick={setSearchIp} />
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
                              onClick={() => setSearchIp(payload.value)}
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
                              onClick={() => setSearchIp(payload.value)}
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
                {searchIp
                  ? <>Flows involving <span style={{ fontFamily: 'DM Mono, monospace', color: 'var(--accent-blue)' }}>{searchIp}</span></>
                  : 'Top Conversations'}
              </h3>
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
                  {(conversations || []).map((flow: any) => {
                    const isOutgoing = flow.src_ip === searchIp
                    const peer = isOutgoing ? flow.dst_ip : flow.src_ip
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
                                onClick={() => setSearchIp(flow.src_ip)}>
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
                                onClick={() => setSearchIp(flow.dst_ip)}>
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
                  {(conversations || []).length === 0 && (
                    <tr>
                      <td colSpan={searchIp ? 9 : 8} style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-light)' }}>
                        {searchIp ? `No flows found for ${searchIp}` : 'No conversations'}
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
