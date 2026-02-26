import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { interfacesApi, flowsApi } from '../services/api'
import { OwnedSubnet } from '../types'
import { Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea,
} from 'recharts'
import { format } from 'date-fns'
import { Globe, Activity, Calendar, Network, Plus, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useChartTheme } from '../hooks/useChartTheme'
import NocViewButton from '../components/NocViewButton'

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
  const chartTheme = useChartTheme()
  const [timeRange, setTimeRange] = useState<TimeRange>({ mode: 'preset', hours: 24 })
  const queryClient = useQueryClient()

  useEffect(() => {
    const el = document.getElementById('noc-page-title')
    if (el) el.textContent = 'WAN Dashboard'
  }, [])

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

  // Owned subnets
  const { data: ownedSubnets = [], isLoading: subnetsLoading } = useQuery<OwnedSubnet[]>({
    queryKey: ['owned-subnets'],
    queryFn: () => flowsApi.ownedSubnets().then((r) => r.data),
  })

  const [showAddForm, setShowAddForm] = useState(false)
  const [newSubnet, setNewSubnet] = useState('')
  const [newNote, setNewNote] = useState('')

  const toggleMutation = useMutation({
    mutationFn: (data: { subnet: string; is_active: boolean }) => flowsApi.toggleOwnedSubnet(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owned-subnets'] }); toast.success('Subnet updated') },
    onError: () => toast.error('Failed to update subnet'),
  })
  const createMutation = useMutation({
    mutationFn: (data: { subnet: string; note?: string }) => flowsApi.createOwnedSubnet(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owned-subnets'] })
      toast.success('Subnet added')
      setNewSubnet(''); setNewNote(''); setShowAddForm(false)
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to add subnet'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => flowsApi.deleteOwnedSubnet(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['owned-subnets'] }); toast.success('Subnet deleted') },
    onError: () => toast.error('Failed to delete subnet'),
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

  const p95InChart = +(p95In / divisor).toFixed(3)
  const p95OutChart = +(p95Out / divisor).toFixed(3)
  const p95MaxChart = Math.max(p95InChart, p95OutChart)

  // Zoom state
  const [refLeft, setRefLeft] = useState<string | null>(null)
  const [refRight, setRefRight] = useState<string | null>(null)
  const [zoomedData, setZoomedData] = useState<any[] | null>(null)

  const displayData = zoomedData ?? chartData

  // Compute stats from visible data
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
  const inKey = `In (${unit})`
  const outKey = `Out (${unit})`
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

  const timeLabel = timeRange.mode === 'preset'
    ? (timeRange.hours <= 24 ? `${timeRange.hours}h` : `${timeRange.hours / 24}d`)
    : 'Custom Range'

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <h1>WAN Dashboard</h1>
        <div className="time-range-bar">
          <NocViewButton pageId="wan" />
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
            <div className="stat-value">{formatBps(Math.max(p95In, p95Out))}</div>
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
                  <tr><th>Interface</th><th>Device</th><th>Speed</th><th>Utilization</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {wanList.map((w: any) => {
                    const utilIn = w.utilization_in ?? 0
                    const utilOut = w.utilization_out ?? 0
                    const maxUtil = Math.max(utilIn, utilOut)
                    const utilColor = maxUtil >= 90 ? '#ef4444' : maxUtil >= 75 ? '#f59e0b' : '#22c55e'
                    const utilBg = maxUtil >= 90 ? '#fef2f2' : maxUtil >= 75 ? '#fffbeb' : '#f0fdf4'
                    return (
                      <tr key={w.id}>
                        <td>
                          <Link to={`/interfaces/${w.id}`} className="link-primary font-semibold">
                            {w.name}
                          </Link>
                          {w.alias && <span className="text-muted text-sm ml-2">{w.alias}</span>}
                        </td>
                        <td>{w.device_hostname || `Device #${w.device_id}`}</td>
                        <td>{w.speed ? formatBps(w.speed) : '-'}</td>
                        <td style={{ minWidth: '200px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              flex: 1, height: '18px', background: utilBg,
                              borderRadius: '4px', overflow: 'hidden', position: 'relative',
                              border: `1px solid ${utilColor}22`,
                            }}>
                              <div style={{
                                width: `${Math.min(maxUtil, 100)}%`, height: '100%',
                                background: utilColor, borderRadius: '3px',
                                transition: 'width 0.3s ease',
                              }} />
                              <span style={{
                                position: 'absolute', top: '50%', left: '50%',
                                transform: 'translate(-50%, -50%)',
                                fontSize: '10px', fontWeight: 700,
                                color: maxUtil > 50 ? '#fff' : utilColor,
                                textShadow: maxUtil > 50 ? '0 0 2px rgba(0,0,0,0.3)' : 'none',
                              }}>
                                {maxUtil.toFixed(1)}%
                              </span>
                            </div>
                            <span className="mono text-muted" style={{ fontSize: '10px', whiteSpace: 'nowrap' }}>
                              {w.in_bps ? formatBps(w.in_bps) : ''}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={w.oper_status === 'up' ? 'tag-green' : 'tag-red'}>
                            {w.oper_status || 'unknown'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
          )}
        </div>
      </div>

      {/* Throughput graph with 95th percentile */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={15} />
          <h3 style={{ flex: 1 }}>Aggregate WAN Throughput — {timeLabel}</h3>
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
            <div className="empty-state"><p>No data available</p></div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={displayData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} axisLine={false} unit={` ${unit}`} width={80} />
                  <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
                  <Line type="monotone" dataKey={inKey} stroke="#1a9dc8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey={outKey} stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <ReferenceLine
                    y={p95MaxChart}
                    stroke="#e74c3c"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    label={{ value: `95th: ${formatBps(Math.max(p95In, p95Out))}`, position: 'insideTopRight', fill: '#e74c3c', fontSize: 12, fontWeight: 600 }}
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
                  <span>{formatBps(p95In)}</span>
                  <span style={{ marginLeft: '16px', fontWeight: 600 }}>95th Out:</span>
                  <span>{formatBps(p95Out)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Owned Subnets management */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Network size={15} />
          <h3 style={{ flex: 1 }}>Owned Subnets</h3>
          <span className="text-muted text-sm">
            {ownedSubnets.filter((s) => s.is_active).length} active / {ownedSubnets.length} total
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={12} /> Add Subnet
          </button>
        </div>
        {showAddForm && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">CIDR</label>
              <input className="form-input" placeholder="e.g. 203.0.113.0/24" value={newSubnet} onChange={(e) => setNewSubnet(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Note (optional)</label>
              <input className="form-input" placeholder="Description" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" disabled={!newSubnet.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ subnet: newSubnet.trim(), note: newNote.trim() || undefined })}>
              {createMutation.isPending ? 'Adding...' : 'Add'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => { setShowAddForm(false); setNewSubnet(''); setNewNote('') }}>
              <X size={12} />
            </button>
          </div>
        )}
        <div className="table-wrap">
          {subnetsLoading ? (
            <div className="empty-state"><p>Loading subnets...</p></div>
          ) : ownedSubnets.length === 0 ? (
            <div className="empty-state"><p>No owned subnets found. Discover routes on your Spine devices first.</p></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Subnet</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th style={{ width: '60px' }}></th>
                </tr>
              </thead>
              <tbody>
                {ownedSubnets.map((s: OwnedSubnet) => (
                  <tr key={s.subnet} style={{ opacity: s.is_active ? 1 : 0.45 }}>
                    <td className="mono font-semibold">{s.subnet}</td>
                    <td>
                      {s.source === 'learned'
                        ? <span className="text-muted text-sm">{s.source_devices.join(', ')}</span>
                        : <span className="tag-blue">Manual</span>
                      }
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline"
                        style={{
                          fontSize: '11px', padding: '2px 10px', minWidth: '75px',
                          color: s.is_active ? 'var(--success-600)' : 'var(--text-muted)',
                          borderColor: s.is_active ? 'var(--success-400)' : 'var(--border)',
                        }}
                        onClick={() => toggleMutation.mutate({ subnet: s.subnet, is_active: !s.is_active })}
                        disabled={toggleMutation.isPending}
                      >
                        {s.is_active ? 'Active' : 'Ignored'}
                      </button>
                    </td>
                    <td className="text-muted text-sm">{s.note || '\u2014'}</td>
                    <td>
                      {s.source === 'manual' && s.id && (
                        <button className="btn-icon" title="Delete" onClick={() => { if (confirm(`Delete ${s.subnet}?`)) deleteMutation.mutate(s.id!) }}>
                          <Trash2 size={14} color="#ef4444" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
