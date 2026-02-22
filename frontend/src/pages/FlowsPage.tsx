import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi } from '../services/api'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

const COLORS = ['#1a9dc8', '#27ae60', '#f39c12', '#e74c3c', '#a78bfa', '#06b6d4', '#84cc16', '#f97316']

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

const TIME_RANGES = [{ label: '1h', hours: 1 }, { label: '6h', hours: 6 }, { label: '24h', hours: 24 }, { label: '7d', hours: 168 }]

const TOOLTIP_STYLE = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }

export default function FlowsPage() {
  const [hours, setHours] = useState(1)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['flow-stats', hours],
    queryFn: () => flowsApi.stats({ hours }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: conversations } = useQuery({
    queryKey: ['flow-conversations', hours],
    queryFn: () => flowsApi.conversations({ hours, limit: 50 }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>Flow Analysis</h1>
          <p>NetFlow &amp; sFlow traffic analysis</p>
        </div>
        <div className="time-range-bar">
          {TIME_RANGES.map((r) => (
            <button key={r.hours} onClick={() => setHours(r.hours)} className={`time-btn${hours === r.hours ? ' active' : ''}`}>{r.label}</button>
          ))}
        </div>
      </div>

      {stats && (
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

      {isLoading ? (
        <div className="empty-state card"><p>Loading flow data...</p></div>
      ) : !stats || stats.total_flows === 0 ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state" style={{ padding: '48px 0' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48 }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <p>No flow data available</p>
              <p className="sub">Configure your network devices to export NetFlow to this server on UDP port 2055</p>
            </div>
          </div>
        </div>
      ) : (
        <>
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
                    <YAxis type="category" dataKey="ip" tick={{ fill: '#1e293b', fontSize: 11 }} tickLine={false} width={80} />
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
                    <YAxis type="category" dataKey="ip" tick={{ fill: '#1e293b', fontSize: 11 }} tickLine={false} width={80} />
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
                    <Pie data={stats.protocol_distribution} dataKey="bytes" nameKey="protocol" cx="50%" cy="50%" outerRadius={80} label={({ protocol, percent }: any) => `${protocol} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
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

          <div className="card">
            <div className="card-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <h3>Top Conversations</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Source IP</th><th>Destination IP</th><th>Protocol</th><th>Dst Port</th><th>Application</th><th>Bytes</th><th>Packets</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {(conversations || []).map((flow: any) => (
                    <tr key={flow.id}>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{flow.src_ip}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{flow.dst_ip}</td>
                      <td><span className="tag-blue">{flow.protocol}</span></td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{flow.dst_port}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{flow.application || '—'}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{formatBytes(flow.bytes)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{flow.packets?.toLocaleString()}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-light)' }}>{flow.timestamp ? new Date(flow.timestamp).toLocaleTimeString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
