import { useQuery } from '@tanstack/react-query'
import { interfacesApi } from '../services/api'
import { Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { Globe, Activity, Calendar } from 'lucide-react'

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

type TimeRange =
  | { mode: 'preset'; hours: number }
  | { mode: 'custom'; start: string; end: string; label: string }

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatRangeLabel(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${fmt(s)} \u2013 ${fmt(e)}`
}

function CustomRangePicker({
  active, onApply, onClear,
}: {
  active: TimeRange
  onApply: (start: string, end: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const now = new Date()
  const ago24 = new Date(now.getTime() - 24 * 3600_000)
  const [from, setFrom] = useState(toLocalInput(ago24))
  const [to, setTo] = useState(toLocalInput(now))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function apply() {
    if (from && to) {
      onApply(new Date(from).toISOString(), new Date(to).toISOString())
      setOpen(false)
    }
  }

  const isCustom = active.mode === 'custom'

  return (
    <div ref={ref} className="time-range-custom">
      <button
        className={`time-btn${isCustom ? ' active' : ''}`}
        onClick={() => { if (isCustom) { onClear() } else { setOpen(!open) } }}
        title={isCustom ? 'Click to clear custom range' : 'Select custom date range'}
      >
        <Calendar size={11} />
        {isCustom ? (active as any).label : 'Custom'}
      </button>
      {open && (
        <div className="time-range-popover">
          <div className="time-range-popover__title">Custom Time Range</div>
          <div className="time-range-popover__field">
            <label className="form-label">From</label>
            <input type="datetime-local" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="time-range-popover__field">
            <label className="form-label">To</label>
            <input type="datetime-local" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="time-range-popover__actions">
            <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WanDashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>({ mode: 'preset', hours: 24 })

  const trParams = timeRange.mode === 'preset'
    ? { hours: timeRange.hours }
    : { start: timeRange.start, end: timeRange.end }

  const { data: wanList } = useQuery({
    queryKey: ['wan-list'],
    queryFn: () => interfacesApi.wanList().then((r) => r.data),
  })

  const { data: wanData, isLoading } = useQuery({
    queryKey: ['wan-metrics', trParams],
    queryFn: () => interfacesApi.wanMetrics(trParams).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const p95In = wanData?.p95_in_bps || 0
  const p95Out = wanData?.p95_out_bps || 0

  // Determine if we should display in Gbps (when max value exceeds 1024 Mbps)
  const allInMbps = (wanData?.timeseries || []).map((m: any) => m.in_bps / 1_000_000)
  const allOutMbps = (wanData?.timeseries || []).map((m: any) => m.out_bps / 1_000_000)
  const maxMbps = Math.max(0, ...allInMbps, ...allOutMbps, p95In / 1_000_000, p95Out / 1_000_000)
  const useGbps = maxMbps > 1024
  const divisor = useGbps ? 1_000_000_000 : 1_000_000
  const unit = useGbps ? 'Gbps' : 'Mbps'

  // For time formatting: use short format for <= 24h presets, full for custom/7d
  const useShortTime = timeRange.mode === 'preset' && timeRange.hours <= 24

  const chartData = (wanData?.timeseries || []).map((m: any) => ({
    time: format(new Date(m.timestamp), useShortTime ? 'HH:mm' : 'MM/dd HH:mm'),
    [`In (${unit})`]: +(m.in_bps / divisor).toFixed(3),
    [`Out (${unit})`]: +(m.out_bps / divisor).toFixed(3),
    'In %': +m.utilization_in.toFixed(2),
    'Out %': +m.utilization_out.toFixed(2),
  }))

  const p95 = Math.max(p95In, p95Out)
  const p95Chart = +(p95 / divisor).toFixed(3)

  const timeLabel = timeRange.mode === 'preset'
    ? (timeRange.hours <= 24 ? `${timeRange.hours}h` : `${timeRange.hours / 24}d`)
    : 'Custom Range'

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <h1>WAN Dashboard</h1>
        <div className="time-range-bar">
          {TIME_RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setTimeRange({ mode: 'preset', hours: r.hours })}
              className={`time-btn${timeRange.mode === 'preset' && timeRange.hours === r.hours ? ' active' : ''}`}
            >
              {r.label}
            </button>
          ))}
          <CustomRangePicker
            active={timeRange}
            onApply={(start, end) => setTimeRange({ mode: 'custom', start, end, label: formatRangeLabel(start, end) })}
            onClear={() => setTimeRange({ mode: 'preset', hours: 24 })}
          />
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Globe size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">WAN Interfaces</div>
            <div className="stat-value">{wanData?.wan_count ?? 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <Activity size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Total WAN Capacity</div>
            <div className="stat-value">{formatBps(wanData?.total_speed_bps ?? 0)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <Activity size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">95th Percentile ({timeLabel})</div>
            <div className="stat-value">{formatBps(p95)}</div>
          </div>
        </div>
      </div>

      {/* WAN Interface list */}
      <div className="card">
        <div className="card-header">
          <Globe size={15} />
          <h3>WAN Interfaces</h3>
        </div>
        <div className="table-wrap">
          {!wanList?.length ? (
            <div className="empty-state">
              <p>No interfaces marked as WAN. Go to an interface detail page and check the WAN checkbox.</p>
            </div>
          ) : (
            <table>
                <thead>
                  <tr><th>Interface</th><th>Device</th><th>Speed</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {wanList.map((w: any) => (
                    <tr key={w.id}>
                      <td>
                        <Link to={`/interfaces/${w.id}`} className="link-primary font-semibold">
                          {w.name}
                        </Link>
                        {w.alias && <span className="text-muted text-sm ml-2">{w.alias}</span>}
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

      {/* Throughput graph with 95th percentile */}
      <div className="card">
        <div className="card-header">
          <Activity size={15} />
          <h3>Aggregate WAN Throughput — {timeLabel}</h3>
        </div>
        <div className="card-body">
          {isLoading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : chartData.length === 0 ? (
            <div className="empty-state"><p>No data available</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} unit={` ${unit}`} width={80} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey={`In (${unit})`} stroke="#1a9dc8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey={`Out (${unit})`} stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <ReferenceLine
                  y={p95Chart}
                  stroke="#e74c3c"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  label={{ value: `95th: ${formatBps(p95)}`, position: 'insideTopRight', fill: '#e74c3c', fontSize: 12, fontWeight: 600 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
