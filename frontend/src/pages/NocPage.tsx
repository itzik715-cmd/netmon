import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Maximize, Minimize, RefreshCw, AlertTriangle, AlertCircle,
  Info, Server, Wifi, WifiOff, Clock, Zap, Thermometer,
} from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'
import { devicesApi, alertsApi, interfacesApi, flowsApi, pduApi } from '../services/api'
import { formatDistanceToNow } from 'date-fns'

const REFRESH_MS = 15_000

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }
const PROTO_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#64748b', '#ec4899']

function formatBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

function formatBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bps`
}

export default function NocPage() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [now, setNow] = useState(new Date())
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      document.body.classList.add('noc-fullscreen')
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      document.body.classList.remove('noc-fullscreen')
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement
      setIsFullscreen(fs)
      if (!fs) document.body.classList.remove('noc-fullscreen')
    }
    document.addEventListener('fullscreenchange', handler)
    return () => {
      document.removeEventListener('fullscreenchange', handler)
      document.body.classList.remove('noc-fullscreen')
    }
  }, [])

  // ── Data Queries ──
  const { data: summary } = useQuery({
    queryKey: ['noc-summary'],
    queryFn: () => devicesApi.summary().then(r => r.data),
    refetchInterval: REFRESH_MS,
  })

  const { data: devices } = useQuery({
    queryKey: ['noc-devices'],
    queryFn: () => devicesApi.list().then(r => r.data),
    refetchInterval: REFRESH_MS,
    select: (d: any[]) => {
      const order: Record<string, number> = { down: 0, degraded: 1, unknown: 2, up: 3 }
      return [...d].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
    },
  })

  const { data: alerts } = useQuery({
    queryKey: ['noc-alerts'],
    queryFn: () => alertsApi.listEvents({ status: 'open', limit: 15 }).then(r => r.data),
    refetchInterval: REFRESH_MS,
    select: (d: any[]) =>
      [...d].sort((a, b) => {
        const sd = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
        if (sd !== 0) return sd
        return new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
      }),
  })

  const { data: alertSummary } = useQuery({
    queryKey: ['noc-alert-summary'],
    queryFn: () => alertsApi.eventsSummary().then(r => r.data),
    refetchInterval: REFRESH_MS,
  })

  const { data: wanMetrics } = useQuery({
    queryKey: ['noc-wan-metrics'],
    queryFn: () => interfacesApi.wanMetrics({ hours: 1 }).then(r => r.data),
    refetchInterval: REFRESH_MS,
  })

  const { data: wanList } = useQuery({
    queryKey: ['noc-wan-list'],
    queryFn: () => interfacesApi.wanList().then(r => r.data),
    refetchInterval: REFRESH_MS,
  })

  const { data: flowStats } = useQuery({
    queryKey: ['noc-flow-stats'],
    queryFn: () => {
      setLastRefresh(new Date())
      return flowsApi.stats({ hours: 1, limit: 5 }).then(r => r.data)
    },
    refetchInterval: REFRESH_MS,
  })

  const { data: powerDashboard } = useQuery({
    queryKey: ['noc-power-dashboard'],
    queryFn: () => pduApi.dashboard(1).then(r => r.data),
    refetchInterval: REFRESH_MS,
  })

  // ── Derived data ──
  const devicesUp = summary?.devices_up ?? 0
  const devicesDown = summary?.devices_down ?? 0
  const devicesDegraded = devices?.filter((d: any) => d.status === 'degraded').length ?? 0
  const critAlerts = alertSummary?.critical ?? 0
  const warnAlerts = alertSummary?.warning ?? 0
  const openAlerts = alertSummary?.open ?? 0

  // Power derived data
  const totalPowerKw = powerDashboard?.total_power_kw ?? 0
  const avgLoadPct = powerDashboard?.avg_load_pct ?? 0
  const pduCount = powerDashboard?.pdu_count ?? 0
  const rackCount = powerDashboard?.rack_count ?? 0
  const powerAlerts = powerDashboard?.alerts_active ?? 0
  const powerRacks = powerDashboard?.racks ?? []

  const powerChartData = (powerDashboard?.timeline || []).map((t: any) => ({
    time: new Date(t.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    watts: t.total_watts,
  }))

  // WAN chart data
  const wanChartData = (wanMetrics?.timeseries || []).map((m: any) => ({
    time: new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    in: m.in_bps / 1e6,
    out: m.out_bps / 1e6,
  }))

  // Top talkers
  const topTalkers = (flowStats?.top_talkers || []).slice(0, 5)
  const maxTalkerBytes = topTalkers.length > 0 ? topTalkers[0].bytes : 1

  // Protocol dist
  const protocolData = (flowStats?.protocol_distribution || []).slice(0, 6).map((p: any) => ({
    name: p.protocol || 'Unknown',
    value: p.bytes || 0,
  }))

  const secsAgo = Math.floor((now.getTime() - lastRefresh.getTime()) / 1000)

  return (
    <div className="noc-page">
      {/* ── Status Strip ── */}
      <div className="noc-strip">
        <div className="noc-strip-left">
          <div className="noc-counter green">
            <Server size={18} />
            <span className="noc-counter-val">{devicesUp}</span>
            <span className="noc-counter-label">UP</span>
          </div>
          {devicesDown > 0 && (
            <div className="noc-counter red noc-pulse">
              <WifiOff size={18} />
              <span className="noc-counter-val">{devicesDown}</span>
              <span className="noc-counter-label">DOWN</span>
            </div>
          )}
          {devicesDegraded > 0 && (
            <div className="noc-counter orange">
              <Wifi size={18} />
              <span className="noc-counter-val">{devicesDegraded}</span>
              <span className="noc-counter-label">DEGRADED</span>
            </div>
          )}
          <div className="noc-divider" />
          {critAlerts > 0 && (
            <div className="noc-counter red noc-pulse">
              <AlertTriangle size={18} />
              <span className="noc-counter-val">{critAlerts}</span>
              <span className="noc-counter-label">CRITICAL</span>
            </div>
          )}
          {warnAlerts > 0 && (
            <div className="noc-counter orange">
              <AlertCircle size={18} />
              <span className="noc-counter-val">{warnAlerts}</span>
              <span className="noc-counter-label">WARNING</span>
            </div>
          )}
          {critAlerts === 0 && warnAlerts === 0 && (
            <div className="noc-counter green">
              <AlertCircle size={18} />
              <span className="noc-counter-val">0</span>
              <span className="noc-counter-label">ALERTS</span>
            </div>
          )}
          {pduCount > 0 && (
            <>
              <div className="noc-divider" />
              <div className="noc-counter amber">
                <Zap size={18} />
                <span className="noc-counter-val">{totalPowerKw.toFixed(1)}</span>
                <span className="noc-counter-label">kW</span>
              </div>
              <div className={`noc-counter ${avgLoadPct >= 90 ? 'red noc-pulse' : avgLoadPct >= 75 ? 'orange' : 'green'}`}>
                <span className="noc-counter-val">{avgLoadPct.toFixed(0)}%</span>
                <span className="noc-counter-label">LOAD</span>
              </div>
              {powerAlerts > 0 && (
                <div className="noc-counter red noc-pulse">
                  <Zap size={18} />
                  <span className="noc-counter-val">{powerAlerts}</span>
                  <span className="noc-counter-label">PDU ALERTS</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="noc-strip-right">
          <div className="noc-refresh">
            <RefreshCw size={14} className={secsAgo < 2 ? 'noc-spin' : ''} />
            <span>{secsAgo}s ago</span>
          </div>
          <div className="noc-clock">
            <Clock size={16} />
            <span>{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
          </div>
          <button className="noc-fs-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="noc-grid">
        {/* ── Column 1: Active Alerts ── */}
        <div className="noc-card">
          <div className="noc-card-title">
            <AlertTriangle size={14} />
            ACTIVE ALERTS
            {openAlerts > 0 && <span className="noc-badge-count">{openAlerts}</span>}
          </div>
          <div className="noc-alert-list">
            {(!alerts || alerts.length === 0) ? (
              <div className="noc-empty">
                <AlertCircle size={32} strokeWidth={1} />
                <span>No active alerts</span>
              </div>
            ) : (
              alerts.map((a: any) => (
                <div key={a.id} className={`noc-alert-row ${a.severity}`}>
                  <div className={`noc-severity-dot ${a.severity} ${a.severity === 'critical' ? 'noc-pulse' : ''}`} />
                  <div className="noc-alert-body">
                    <div className="noc-alert-msg">{a.message || 'Alert triggered'}</div>
                    <div className="noc-alert-meta">
                      {a.device_hostname || `Device #${a.device_id}`}
                      <span className="noc-alert-time">
                        {formatDistanceToNow(new Date(a.triggered_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Column 2: Device Status Grid ── */}
        <div className="noc-card">
          <div className="noc-card-title">
            <Server size={14} />
            DEVICE STATUS
            <span className="noc-badge-count">{devices?.length ?? 0}</span>
          </div>
          <div className="noc-device-grid">
            {devices?.map((d: any) => (
              <Link to={`/devices/${d.id}`} key={d.id} className={`noc-device-tile ${d.status}`}>
                <div className="noc-device-name">
                  <span className={`noc-dot ${d.status}`} />
                  {d.hostname}
                </div>
                <div className="noc-device-metrics">
                  {d.cpu_usage != null && (
                    <div className="noc-metric">
                      <span className="noc-metric-label">CPU</span>
                      <div className="noc-metric-bar">
                        <div
                          className="noc-metric-fill"
                          style={{
                            width: `${Math.min(d.cpu_usage, 100)}%`,
                            background: d.cpu_usage > 90 ? '#ef4444' : d.cpu_usage > 75 ? '#f59e0b' : '#22c55e',
                          }}
                        />
                      </div>
                      <span className="noc-metric-val">{d.cpu_usage?.toFixed(0)}%</span>
                    </div>
                  )}
                  {d.memory_usage != null && (
                    <div className="noc-metric">
                      <span className="noc-metric-label">MEM</span>
                      <div className="noc-metric-bar">
                        <div
                          className="noc-metric-fill"
                          style={{
                            width: `${Math.min(d.memory_usage, 100)}%`,
                            background: d.memory_usage > 90 ? '#ef4444' : d.memory_usage > 75 ? '#f59e0b' : '#22c55e',
                          }}
                        />
                      </div>
                      <span className="noc-metric-val">{d.memory_usage?.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Column 3: WAN Throughput ── */}
        <div className="noc-card">
          <div className="noc-card-title">
            <Wifi size={14} />
            WAN THROUGHPUT
          </div>
          <div className="noc-wan-chart">
            {wanChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={wanChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={50}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}G` : `${v.toFixed(0)}M`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8, color: '#e2e8f0' }}
                    formatter={(v: number) => [`${v.toFixed(2)} Mbps`]}
                  />
                  <Line type="monotone" dataKey="in" stroke="#3b82f6" strokeWidth={2} dot={false} name="In" />
                  <Line type="monotone" dataKey="out" stroke="#a78bfa" strokeWidth={2} dot={false} name="Out" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="noc-empty"><Wifi size={32} strokeWidth={1} /><span>No WAN data</span></div>
            )}
          </div>
          <div className="noc-wan-bars">
            {(wanList || []).map((w: any) => {
              const util = Math.max(w.utilization_in || 0, w.utilization_out || 0)
              const color = util > 90 ? '#ef4444' : util > 75 ? '#f59e0b' : '#22c55e'
              return (
                <div key={w.interface_id} className="noc-wan-row">
                  <span className="noc-wan-name">{w.device_hostname} — {w.if_name}</span>
                  <div className="noc-wan-bar-wrap">
                    <div className="noc-wan-bar-bg">
                      <div className="noc-wan-bar-fill" style={{ width: `${Math.min(util, 100)}%`, background: color }} />
                    </div>
                    <span className="noc-wan-pct" style={{ color }}>{util.toFixed(0)}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Column 4: Power Consumption ── */}
        <div className="noc-card">
          <div className="noc-card-title">
            <Zap size={14} />
            POWER CONSUMPTION (1H)
            {pduCount > 0 && <span className="noc-badge-count">{pduCount} PDUs</span>}
          </div>
          <div className="noc-power-chart">
            {powerChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={powerChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}kW` : `${v}W`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8, color: '#e2e8f0' }}
                    formatter={(v: number) => [`${v.toFixed(0)} W`, 'Total Power']}
                  />
                  <Area type="monotone" dataKey="watts" stroke="#f59e0b" fill="#f59e0b20" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="noc-empty"><Zap size={32} strokeWidth={1} /><span>No power data</span></div>
            )}
          </div>
          <div className="noc-power-summary">
            <div className="noc-power-stat">
              <span className="noc-power-stat-val">{totalPowerKw.toFixed(1)}</span>
              <span className="noc-power-stat-unit">kW</span>
            </div>
            <div className="noc-power-stat">
              <span className="noc-power-stat-val">{avgLoadPct.toFixed(0)}</span>
              <span className="noc-power-stat-unit">% Load</span>
            </div>
            <div className="noc-power-stat">
              <span className="noc-power-stat-val">{rackCount}</span>
              <span className="noc-power-stat-unit">Racks</span>
            </div>
          </div>
        </div>

        {/* ── Row 2, Column 1: Top Talkers ── */}
        <div className="noc-card noc-card-bottom">
          <div className="noc-card-title">
            <Wifi size={14} />
            TOP TALKERS (1H)
          </div>
          <div className="noc-talkers">
            {topTalkers.length === 0 ? (
              <div className="noc-empty"><span>No flow data</span></div>
            ) : (
              topTalkers.map((t: any, i: number) => (
                <div key={t.ip} className="noc-talker-row">
                  <span className="noc-talker-rank">{i + 1}</span>
                  <span className="noc-talker-ip mono">{t.ip}</span>
                  <div className="noc-talker-bar-wrap">
                    <div className="noc-talker-bar" style={{ width: `${(t.bytes / maxTalkerBytes) * 100}%` }} />
                  </div>
                  <span className="noc-talker-bytes">{formatBytes(t.bytes)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Row 2, Column 2: Traffic Overview ── */}
        <div className="noc-card noc-card-bottom">
          <div className="noc-card-title">
            <Info size={14} />
            TRAFFIC OVERVIEW (1H)
          </div>
          <div className="noc-traffic-overview">
            <div className="noc-traffic-chart">
              {protocolData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={protocolData}
                      cx="50%"
                      cy="50%"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {protocolData.map((_: any, i: number) => (
                        <Cell key={i} fill={PROTO_COLORS[i % PROTO_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8, color: '#e2e8f0' }}
                      formatter={(v: number) => [formatBytes(v)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="noc-empty"><span>No data</span></div>
              )}
            </div>
            <div className="noc-traffic-stats">
              <div className="noc-traffic-legend">
                {protocolData.map((p: any, i: number) => (
                  <div key={p.name} className="noc-legend-item">
                    <span className="noc-legend-dot" style={{ background: PROTO_COLORS[i % PROTO_COLORS.length] }} />
                    <span className="noc-legend-name">{p.name}</span>
                    <span className="noc-legend-val">{formatBytes(p.value)}</span>
                  </div>
                ))}
              </div>
              <div className="noc-traffic-totals">
                <div className="noc-total">
                  <span className="noc-total-label">Total Flows</span>
                  <span className="noc-total-val">{(flowStats?.total_flows ?? 0).toLocaleString()}</span>
                </div>
                <div className="noc-total">
                  <span className="noc-total-label">Total Bytes</span>
                  <span className="noc-total-val">{formatBytes(flowStats?.total_bytes ?? 0)}</span>
                </div>
                <div className="noc-total">
                  <span className="noc-total-label">Inbound</span>
                  <span className="noc-total-val" style={{ color: '#3b82f6' }}>{formatBytes(flowStats?.total_inbound ?? 0)}</span>
                </div>
                <div className="noc-total">
                  <span className="noc-total-label">Outbound</span>
                  <span className="noc-total-val" style={{ color: '#a78bfa' }}>{formatBytes(flowStats?.total_outbound ?? 0)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 2, Column 4: Rack Power ── */}
        <div className="noc-card noc-card-bottom">
          <div className="noc-card-title">
            <Thermometer size={14} />
            RACK POWER
            {rackCount > 0 && <span className="noc-badge-count">{rackCount}</span>}
          </div>
          <div className="noc-rack-list">
            {powerRacks.length === 0 ? (
              <div className="noc-empty"><Zap size={32} strokeWidth={1} /><span>No rack data</span></div>
            ) : (
              powerRacks.map((rack: any) => (
                <div key={rack.location_id || rack.location_name} className="noc-rack-row">
                  <div className="noc-rack-header">
                    <span className="noc-rack-name">{rack.location_name}</span>
                    <span className="noc-rack-kw">{rack.total_kw} kW</span>
                  </div>
                  <div className="noc-rack-load-bar">
                    <div
                      className="noc-rack-load-fill"
                      style={{
                        width: `${Math.min(rack.avg_load_pct, 100)}%`,
                        background: rack.avg_load_pct >= 90 ? '#ef4444'
                          : rack.avg_load_pct >= 75 ? '#f59e0b' : '#22c55e',
                      }}
                    />
                  </div>
                  <div className="noc-rack-meta">
                    <span className="noc-rack-load-pct" style={{
                      color: rack.avg_load_pct >= 90 ? '#ef4444'
                        : rack.avg_load_pct >= 75 ? '#f59e0b' : '#22c55e',
                    }}>
                      {rack.avg_load_pct}%
                    </span>
                    {rack.max_temperature_c != null && (
                      <span className={`noc-rack-temp ${rack.max_temperature_c > 40 ? 'hot' : ''}`}>
                        <Thermometer size={10} /> {rack.max_temperature_c.toFixed(1)}°C
                      </span>
                    )}
                    <span className="noc-rack-pdu-count">{rack.pdus?.length ?? 0} PDU</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
