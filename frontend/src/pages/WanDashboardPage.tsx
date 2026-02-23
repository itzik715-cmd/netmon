import { useQuery } from '@tanstack/react-query'
import { interfacesApi } from '../services/api'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

const TOOLTIP_STYLE = {
  background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b',
}

export default function WanDashboardPage() {
  const [hours, setHours] = useState(24)

  const { data: wanList } = useQuery({
    queryKey: ['wan-list'],
    queryFn: () => interfacesApi.wanList().then((r) => r.data),
  })

  const { data: wanData, isLoading } = useQuery({
    queryKey: ['wan-metrics', hours],
    queryFn: () => interfacesApi.wanMetrics(hours).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const chartData = (wanData?.timeseries || []).map((m: any) => ({
    time: format(new Date(m.timestamp), hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
    'In (Mbps)': +(m.in_bps / 1_000_000).toFixed(3),
    'Out (Mbps)': +(m.out_bps / 1_000_000).toFixed(3),
    'In %': +m.utilization_in.toFixed(2),
    'Out %': +m.utilization_out.toFixed(2),
  }))

  const p95In = wanData?.p95_in_bps || 0
  const p95Out = wanData?.p95_out_bps || 0

  const timeLabel = hours <= 24 ? `${hours}h` : `${hours / 24}d`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>WAN Dashboard</h1>
        <div className="time-range-bar">
          {TIME_RANGES.map((r) => (
            <button key={r.hours} onClick={() => setHours(r.hours)} className={`time-btn${hours === r.hours ? ' active' : ''}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <div className="info-card">
          <div className="stat-label">WAN Interfaces</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--primary)', marginTop: 4 }}>
            {wanData?.wan_count ?? 0}
          </div>
        </div>
        <div className="info-card">
          <div className="stat-label">Total WAN Capacity</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-main)', marginTop: 4 }}>
            {formatBps(wanData?.total_speed_bps ?? 0)}
          </div>
        </div>
        <div className="info-card">
          <div className="stat-label">95th %ile In ({timeLabel})</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#1a9dc8', marginTop: 4 }}>
            {formatBps(p95In)}
          </div>
        </div>
        <div className="info-card">
          <div className="stat-label">95th %ile Out ({timeLabel})</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#a78bfa', marginTop: 4 }}>
            {formatBps(p95Out)}
          </div>
        </div>
      </div>

      {/* WAN Interface list */}
      <div className="card">
        <div className="card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            <path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <h3>WAN Interfaces</h3>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {!wanList?.length ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <p>No interfaces marked as WAN. Go to an interface detail page and check the WAN checkbox.</p>
            </div>
          ) : (
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>Interface</th><th>Device</th><th>Speed</th><th>Status</th></tr>
              </thead>
              <tbody>
                {wanList.map((w: any) => (
                  <tr key={w.id}>
                    <td>
                      <Link to={`/interfaces/${w.id}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
                        {w.name}
                      </Link>
                      {w.alias && <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>{w.alias}</span>}
                    </td>
                    <td>{w.device_hostname || `Device #${w.device_id}`}</td>
                    <td>{w.speed ? formatBps(w.speed) : '-'}</td>
                    <td>
                      <span className={w.oper_status === 'up' ? 'tag-green' : 'tag-red'}>
                        {w.oper_status || 'unknown'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Throughput graph */}
      <div className="card">
        <div className="card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          <h3>Aggregate WAN Throughput — Last {hours <= 24 ? `${hours}h` : `${hours / 24}d`}</h3>
        </div>
        <div className="card-body">
          {isLoading ? (
            <div className="empty-state" style={{ height: 200 }}><p>Loading...</p></div>
          ) : chartData.length === 0 ? (
            <div className="empty-state" style={{ height: 200 }}><p>No data available</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} unit=" Mbps" width={70} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="In (Mbps)" stroke="#1a9dc8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Out (Mbps)" stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Throughput with 95th percentile */}
      <div className="card">
        <div className="card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          <h3>Throughput with 95th Percentile — Last {timeLabel}</h3>
        </div>
        <div className="card-body">
          {chartData.length === 0 ? (
            <div className="empty-state" style={{ height: 200 }}><p>No data available</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} unit=" Mbps" width={70} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="In (Mbps)" stroke="#1a9dc8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Out (Mbps)" stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <ReferenceLine
                  y={+(p95In / 1_000_000).toFixed(3)}
                  stroke="#1a9dc8"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  label={{ value: `P95 In: ${formatBps(p95In)}`, position: 'insideTopRight', fill: '#1a9dc8', fontSize: 12, fontWeight: 600 }}
                />
                <ReferenceLine
                  y={+(p95Out / 1_000_000).toFixed(3)}
                  stroke="#a78bfa"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  label={{ value: `P95 Out: ${formatBps(p95Out)}`, position: 'insideBottomRight', fill: '#a78bfa', fontSize: 12, fontWeight: 600 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
