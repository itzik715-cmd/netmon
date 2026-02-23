import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { interfacesApi } from '../services/api'
import { ArrowLeft } from 'lucide-react'
import { InterfaceMetric } from '../types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format } from 'date-fns'
import { useState } from 'react'
import toast from 'react-hot-toast'

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const TIME_RANGES = [
  { label: '1h', hours: 1 }, { label: '6h', hours: 6 }, { label: '24h', hours: 24 },
  { label: '7d', hours: 168 }, { label: '30d', hours: 720 },
]

const TOOLTIP_STYLE = {
  background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b',
}

export default function InterfaceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const ifId = parseInt(id!)
  const [hours, setHours] = useState(24)
  const queryClient = useQueryClient()

  const { data: iface } = useQuery({
    queryKey: ['interface', ifId],
    queryFn: () => interfacesApi.get(ifId).then((r) => r.data),
  })

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['interface-metrics', ifId, hours],
    queryFn: () => interfacesApi.metrics(ifId, hours).then((r) => r.data as InterfaceMetric[]),
    refetchInterval: 60_000,
  })

  const { data: latest } = useQuery({
    queryKey: ['interface-latest', ifId],
    queryFn: () => interfacesApi.latest(ifId).then((r) => r.data),
    refetchInterval: 30_000,
  })

  const chartData = (metrics || []).map((m) => ({
    time: format(new Date(m.timestamp), 'HH:mm'),
    'In (Mbps)': (m.in_bps / 1_000_000).toFixed(3),
    'Out (Mbps)': (m.out_bps / 1_000_000).toFixed(3),
    'In %': m.utilization_in.toFixed(2),
    'Out %': m.utilization_out.toFixed(2),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {iface && (
          <Link to={`/devices/${iface.device_id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', textDecoration: 'none' }}>
            <ArrowLeft size={16} />
          </Link>
        )}
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{iface?.name || `Interface ${ifId}`}</h1>
          {iface?.alias && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{iface.alias}</p>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={iface?.is_wan || false}
            onChange={async () => {
              try {
                await interfacesApi.toggleWan(ifId)
                queryClient.invalidateQueries({ queryKey: ['interface', ifId] })
                toast.success(iface?.is_wan ? 'Removed from WAN' : 'Marked as WAN')
              } catch { /* toast from interceptor */ }
            }}
            style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
          />
          WAN
        </label>
        <div className="time-range-bar">
          {TIME_RANGES.map((r) => (
            <button key={r.hours} onClick={() => setHours(r.hours)} className={`time-btn${hours === r.hours ? ' active' : ''}`}>{r.label}</button>
          ))}
        </div>
      </div>

      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {[
            { label: 'In Throughput', value: formatBps(latest.in_bps), color: 'var(--primary)' },
            { label: 'Out Throughput', value: formatBps(latest.out_bps), color: '#a78bfa' },
            { label: 'In Utilization', value: `${latest.utilization_in.toFixed(1)}%`, color: latest.utilization_in > 80 ? 'var(--accent-red)' : 'var(--accent-green)' },
            { label: 'Out Utilization', value: `${latest.utilization_out.toFixed(1)}%`, color: latest.utilization_out > 80 ? 'var(--accent-red)' : 'var(--accent-green)' },
            { label: 'Oper Status', value: latest.oper_status, isTag: true, tagClass: latest.oper_status === 'up' ? 'tag-green' : 'tag-red' },
            { label: 'In Errors', value: `${latest.in_errors}`, color: latest.in_errors > 0 ? 'var(--accent-red)' : 'var(--text-muted)' },
            { label: 'Out Errors', value: `${latest.out_errors}`, color: latest.out_errors > 0 ? 'var(--accent-red)' : 'var(--text-muted)' },
          ].map((item: any, i) => (
            <div key={i} className="info-card">
              <div className="stat-label">{item.label}</div>
              {item.isTag
                ? <span className={item.tagClass} style={{ marginTop: 6, display: 'inline-flex' }}>{item.value}</span>
                : <div style={{ fontWeight: 700, fontSize: 18, color: item.color || 'var(--text-main)', marginTop: 4 }}>{item.value}</div>
              }
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <h3>Throughput — Last {hours}h</h3>
        </div>
        <div className="card-body">
          {isLoading ? (
            <div className="empty-state" style={{ height: 200 }}><p>Loading...</p></div>
          ) : chartData.length === 0 ? (
            <div className="empty-state" style={{ height: 200 }}><p>No data available for this period</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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

      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <h3>Utilization %</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={45} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="In %" stroke="#27ae60" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Out %" stroke="#f39c12" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
