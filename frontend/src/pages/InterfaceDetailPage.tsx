import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { interfacesApi } from '../services/api'
import { ArrowLeft, Activity } from 'lucide-react'
import { InterfaceMetric } from '../types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from 'recharts'
import { format } from 'date-fns'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { useChartTheme } from '../hooks/useChartTheme'

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

export default function InterfaceDetailPage() {
  const chartTheme = useChartTheme()
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
    queryFn: () => interfacesApi.metrics(ifId, { hours }).then((r) => r.data as InterfaceMetric[]),
    refetchInterval: 60_000,
  })

  const { data: latest } = useQuery({
    queryKey: ['interface-latest', ifId],
    queryFn: () => interfacesApi.latest(ifId).then((r) => r.data),
    refetchInterval: 30_000,
  })

  // Determine if we should display in Gbps
  const allInMbps = (metrics || []).map((m) => m.in_bps / 1_000_000)
  const allOutMbps = (metrics || []).map((m) => m.out_bps / 1_000_000)
  const maxMbps = Math.max(0, ...allInMbps, ...allOutMbps)
  const useGbps = maxMbps > 1024
  const divisor = useGbps ? 1_000_000_000 : 1_000_000
  const bpsUnit = useGbps ? 'Gbps' : 'Mbps'
  const inKey = `In (${bpsUnit})`
  const outKey = `Out (${bpsUnit})`

  const chartData = (metrics || []).map((m) => ({
    time: format(new Date(m.timestamp), hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
    [inKey]: +(m.in_bps / divisor).toFixed(3),
    [outKey]: +(m.out_bps / divisor).toFixed(3),
    'In %': +m.utilization_in.toFixed(2),
    'Out %': +m.utilization_out.toFixed(2),
  }))

  // Compute 95th percentile client-side
  const percentile95 = (vals: number[]) => {
    if (vals.length === 0) return 0
    const sorted = [...vals].sort((a, b) => a - b)
    return sorted[Math.ceil(0.95 * sorted.length) - 1]
  }
  const p95InBps = percentile95((metrics || []).map((m) => m.in_bps))
  const p95OutBps = percentile95((metrics || []).map((m) => m.out_bps))
  const p95MaxChart = +(Math.max(p95InBps, p95OutBps) / divisor).toFixed(3)

  // Zoom state
  const [refLeft, setRefLeft] = useState<string | null>(null)
  const [refRight, setRefRight] = useState<string | null>(null)
  const [zoomedData, setZoomedData] = useState<any[] | null>(null)

  const displayData = zoomedData ?? chartData

  // Stats computation
  const computeStats = (data: any[], key: string) => {
    const vals = data.map((d) => +d[key]).filter((v) => !isNaN(v))
    if (vals.length === 0) return { last: 0, min: 0, avg: 0, max: 0 }
    return {
      last: vals[vals.length - 1],
      min: Math.min(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      max: Math.max(...vals),
    }
  }
  const inStats = computeStats(displayData, inKey)
  const outStats = computeStats(displayData, outKey)
  const fmtStat = (v: number) => formatBps(v * divisor)

  // Zoom handlers
  const handleMouseDown = (e: any) => {
    if (e?.activeLabel) setRefLeft(e.activeLabel)
  }
  const handleMouseMove = (e: any) => {
    if (refLeft && e?.activeLabel) setRefRight(e.activeLabel)
  }
  const handleMouseUp = () => {
    if (refLeft && refRight) {
      const leftIdx = chartData.findIndex((d: any) => d.time === refLeft)
      const rightIdx = chartData.findIndex((d: any) => d.time === refRight)
      if (leftIdx >= 0 && rightIdx >= 0) {
        const [from, to] = leftIdx <= rightIdx ? [leftIdx, rightIdx] : [rightIdx, leftIdx]
        if (to - from >= 2) {
          setZoomedData(chartData.slice(from, to + 1))
        }
      }
    }
    setRefLeft(null)
    setRefRight(null)
  }

  return (
    <div className="flex-col-gap">
      <div className="detail-header">
        {iface && (
          <Link to={`/devices/${iface.device_id}`} className="back-btn">
            <ArrowLeft size={16} />
          </Link>
        )}
        <div className="flex-1">
          <h1 className="mono">{iface?.name || `Interface ${ifId}`}</h1>
          {iface?.alias && <p className="text-muted text-sm">{iface.alias}</p>}
        </div>
        <label className="flex-row-gap text-sm text-muted" htmlFor="wan-toggle">
          <input
            id="wan-toggle"
            type="checkbox"
            checked={iface?.is_wan || false}
            onChange={async () => {
              try {
                await interfacesApi.toggleWan(ifId)
                queryClient.invalidateQueries({ queryKey: ['interface', ifId] })
                toast.success(iface?.is_wan ? 'Removed from WAN' : 'Marked as WAN')
              } catch { /* toast from interceptor */ }
            }}
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
        <div className="stats-grid">
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
                ? <span className={item.tagClass}>{item.value}</span>
                : <div className="stat-value-sm" style={{ color: item.color }}>{item.value}</div>
              }
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={15} />
          <h3 style={{ flex: 1 }}>Throughput — Last {hours}h</h3>
          {zoomedData && (
            <button className="btn btn-outline btn-sm" onClick={() => setZoomedData(null)} style={{ fontSize: '11px', padding: '2px 8px' }}>
              Reset Zoom
            </button>
          )}
        </div>
        <div className="card-body">
          {isLoading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : chartData.length === 0 ? (
            <div className="empty-state"><p>No data available for this period</p></div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={displayData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} axisLine={false} unit={` ${bpsUnit}`} width={80} />
                  <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
                  <Line type="monotone" dataKey={inKey} stroke="#1a9dc8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey={outKey} stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <ReferenceLine
                    y={p95MaxChart}
                    stroke="#e74c3c"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    label={{ value: `95th: ${formatBps(Math.max(p95InBps, p95OutBps))}`, position: 'insideTopRight', fill: '#e74c3c', fontSize: 12, fontWeight: 600 }}
                  />
                  {refLeft && refRight && (
                    <ReferenceArea x1={refLeft} x2={refRight} fill="#1a9dc8" fillOpacity={0.15} />
                  )}
                </LineChart>
              </ResponsiveContainer>
              {/* Summary stats legend */}
              <div style={{ padding: '8px 12px 4px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#1a9dc8', fontWeight: 600 }}>■</span>
                  <span style={{ minWidth: '70px', fontWeight: 600 }}>In Traffic</span>
                  <span>last: {fmtStat(inStats.last)}</span>
                  <span>min: {fmtStat(inStats.min)}</span>
                  <span>avg: {fmtStat(inStats.avg)}</span>
                  <span>max: {fmtStat(inStats.max)}</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#a78bfa', fontWeight: 600 }}>■</span>
                  <span style={{ minWidth: '70px', fontWeight: 600 }}>Out Traffic</span>
                  <span>last: {fmtStat(outStats.last)}</span>
                  <span>min: {fmtStat(outStats.min)}</span>
                  <span>avg: {fmtStat(outStats.avg)}</span>
                  <span>max: {fmtStat(outStats.max)}</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#e74c3c', fontWeight: 600 }}>▲</span>
                  <span style={{ minWidth: '70px', fontWeight: 600 }}>95th In:</span>
                  <span>{formatBps(p95InBps)}</span>
                  <span style={{ marginLeft: '16px', fontWeight: 600 }}>95th Out:</span>
                  <span>{formatBps(p95OutBps)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Activity size={15} />
            <h3>Utilization %</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={45} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
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
