import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { devicesApi, pduApi } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns'
import { format } from 'date-fns'
import {
  ArrowLeft, RefreshCw, Settings, Zap, Thermometer, Droplets,
  Power, Activity, ToggleLeft, ToggleRight,
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import EditDeviceModal from '../components/forms/EditDeviceModal'
import toast from 'react-hot-toast'
import { useChartTheme } from '../hooks/useChartTheme'

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

function formatUptime(seconds: number): string {
  const dur = intervalToDuration({ start: 0, end: seconds * 1000 })
  return formatDuration(dur, { format: ['days', 'hours', 'minutes'] }) || '< 1 minute'
}

function statusTag(status: string) {
  const map: Record<string, string> = { up: 'tag-green', down: 'tag-red', unknown: 'tag-gray', degraded: 'tag-orange' }
  const dotMap: Record<string, string> = { up: 'dot-green', down: 'dot-red', unknown: 'dot-orange', degraded: 'dot-orange' }
  return <span className={map[status] || 'tag-gray'}><span className={`status-dot ${dotMap[status] || 'dot-orange'}`} />{status}</span>
}

function LoadBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' }) {
  const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e'
  const bg = pct >= 90 ? '#fef2f2' : pct >= 75 ? '#fffbeb' : '#f0fdf4'
  const h = size === 'sm' ? '14px' : '22px'
  return (
    <div style={{
      width: '100%', height: h, background: bg, borderRadius: '4px',
      overflow: 'hidden', position: 'relative', border: `1px solid ${color}22`,
    }}>
      <div style={{
        width: `${Math.min(pct, 100)}%`, height: '100%', background: color,
        borderRadius: '3px', transition: 'width 0.3s ease',
      }} />
      <span style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', fontSize: size === 'sm' ? '9px' : '12px',
        fontWeight: 700, color: pct > 50 ? '#fff' : color,
        textShadow: pct > 50 ? '0 0 2px rgba(0,0,0,0.3)' : 'none',
      }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function OutletGrid({
  outlets,
  deviceId,
  isAdmin,
}: {
  outlets: any[]
  deviceId: number
  isAdmin: boolean
}) {
  const queryClient = useQueryClient()
  const toggleMutation = useMutation({
    mutationFn: ({ num }: { num: number }) =>
      pduApi.toggleOutlet(deviceId, num),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdu-outlets', deviceId] })
      queryClient.invalidateQueries({ queryKey: ['pdu-device-metrics', deviceId] })
      toast.success('Outlet toggled')
    },
    onError: () => toast.error('Failed to toggle outlet'),
  })

  if (!outlets || outlets.length === 0) {
    return <div className="text-muted text-sm" style={{ padding: '8px 0' }}>No outlets discovered yet</div>
  }

  const bankGroups: Record<string, any[]> = {}
  outlets.forEach((o: any) => {
    const key = o.bank_number != null ? `Bank ${o.bank_number}` : 'Unassigned'
    ;(bankGroups[key] = bankGroups[key] || []).push(o)
  })
  const bankKeys = Object.keys(bankGroups).sort()

  const onCount = outlets.filter((o: any) => o.state === 'on').length
  const offCount = outlets.filter((o: any) => o.state === 'off').length

  return (
    <div>
      <div className="text-muted text-sm" style={{ marginBottom: '8px' }}>
        {outlets.length} outlets — <span style={{ color: '#22c55e' }}>{onCount} on</span>
        {offCount > 0 && <>, <span style={{ color: '#ef4444' }}>{offCount} off</span></>}
      </div>
      {bankKeys.map(bankLabel => (
        <div key={bankLabel} style={{ marginBottom: '16px' }}>
          {bankKeys.length > 1 && (
            <div className="text-muted text-xs font-semibold" style={{ marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{bankLabel}</div>
          )}
          <div className="power-outlet-grid">
            {bankGroups[bankLabel].map((o: any) => (
              <div
                key={o.outlet_number}
                className={`power-outlet ${o.state === 'on' ? 'power-outlet--on' : 'power-outlet--off'}`}
              >
                <div className="power-outlet__header">
                  <span className="power-outlet__num">#{o.outlet_number}</span>
                  <span className={`power-outlet__state ${o.state === 'on' ? 'tag-green' : 'tag-red'}`}>
                    {o.state}
                  </span>
                </div>
                <div className="power-outlet__name" title={o.name}>{o.name || '—'}</div>
                <div className="power-outlet__metrics">
                  {o.current_amps != null && <span>{o.current_amps.toFixed(1)}A</span>}
                  {o.power_watts != null && <span>{o.power_watts.toFixed(0)}W</span>}
                </div>
                {isAdmin && (
                  <button
                    className="btn btn-outline btn-sm power-outlet__toggle"
                    disabled={toggleMutation.isPending}
                    onClick={() => {
                      if (confirm(`Toggle outlet #${o.outlet_number} (${o.name || 'unnamed'}) ${o.state === 'on' ? 'OFF' : 'ON'}?`))
                        toggleMutation.mutate({ num: o.outlet_number })
                    }}
                  >
                    {o.state === 'on' ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    {o.state === 'on' ? 'Turn Off' : 'Turn On'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PduDetailPage({ device }: { device: any }) {
  const chartTheme = useChartTheme()
  const [hours, setHours] = useState(24)
  const [showEdit, setShowEdit] = useState(false)
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  const { data: freshDevice } = useQuery({
    queryKey: ['device', device.id],
    queryFn: () => devicesApi.get(device.id).then(r => r.data),
    initialData: device,
    refetchInterval: 30_000,
  })

  const dev = freshDevice || device

  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['pdu-device-metrics', device.id, hours],
    queryFn: () => pduApi.deviceMetrics(device.id, hours).then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: outletsData } = useQuery({
    queryKey: ['pdu-outlets', device.id],
    queryFn: () => pduApi.deviceOutlets(device.id).then(r => r.data),
    refetchInterval: 60_000,
  })

  const pollMutation = useMutation({
    mutationFn: () => devicesApi.poll(device.id),
    onSuccess: () => {
      toast.success('Poll scheduled')
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['pdu-device-metrics', device.id] })
        qc.invalidateQueries({ queryKey: ['pdu-outlets', device.id] })
        qc.invalidateQueries({ queryKey: ['device', device.id] })
      }, 5000)
    },
  })

  const latest = metricsData?.latest
  const banks = metricsData?.banks || []
  const timeseries = metricsData?.timeseries || []
  const outlets = outletsData?.outlets || []

  const timeLabel = hours <= 24 ? `${hours}h` : `${hours / 24}d`

  const chartData = timeseries.map((m: any) => ({
    time: format(new Date(m.timestamp), hours <= 6 ? 'HH:mm' : hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
    'Power (W)': m.power_watts,
    'Load %': m.load_pct,
  }))

  return (
    <>
    <div className="flex-col-gap">
      {/* Header */}
      <div className="detail-header">
        <Link to="/devices" className="back-btn">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <div className="flex-row-gap">
            <h1><Zap size={20} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px', color: '#f59e0b' }} />{dev.hostname}</h1>
            {statusTag(dev.status)}
            <span className="tag-blue">PDU</span>
          </div>
          <div className="mono">{dev.ip_address}</div>
        </div>
        <div className="flex-row-gap">
          <button onClick={() => setShowEdit(true)} className="btn btn-outline btn-sm">
            <Settings size={13} /> Settings
          </button>
          <button onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending} className="btn btn-primary btn-sm">
            <RefreshCw size={13} /> Poll Now
          </button>
        </div>
      </div>

      {/* Device info cards */}
      <div className="stats-grid">
        {[
          { label: 'Vendor / Model', value: [dev.vendor, dev.model].filter(Boolean).join(' ') || '—' },
          { label: 'Uptime', value: dev.uptime ? formatUptime(dev.uptime) : '—' },
          { label: 'Location', value: dev.location?.name || '—' },
          { label: 'Firmware', value: dev.os_version ? dev.os_version.substring(0, 60) + (dev.os_version.length > 60 ? '\u2026' : '') : '—' },
          { label: 'Last Seen', value: dev.last_seen ? formatDistanceToNow(new Date(dev.last_seen), { addSuffix: true }) : 'Never' },
        ].map((item, i) => (
          <div key={i} className="info-card">
            <div className="stat-label">{item.label}</div>
            <div className="stat-value-sm">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Power stat cards + load bar */}
      {latest ? (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon blue"><Zap size={20} /></div>
              <div className="stat-body">
                <div className="stat-label">Total Power</div>
                <div className="stat-value">{(latest.power_watts / 1000).toFixed(2)} kW</div>
                <div className="stat-sub">{latest.power_watts?.toFixed(0)} W</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon green"><Power size={20} /></div>
              <div className="stat-body">
                <div className="stat-label">Energy</div>
                <div className="stat-value">{latest.energy_kwh?.toFixed(1) ?? '—'} kWh</div>
                <div className="stat-sub">cumulative</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon orange"><Activity size={20} /></div>
              <div className="stat-body">
                <div className="stat-label">Load</div>
                <div className="stat-value">{latest.load_pct?.toFixed(1) ?? '—'}%</div>
                <div className="stat-sub">
                  Rated: {latest.rated_power_watts?.toFixed(0) ?? '—'}W
                  {latest.near_overload_watts != null && <> · Near OL: {latest.near_overload_watts}W</>}
                </div>
              </div>
            </div>
            {latest.temperature_c != null && (
              <div className="stat-card">
                <div className="stat-icon red"><Thermometer size={20} /></div>
                <div className="stat-body">
                  <div className="stat-label">Temperature</div>
                  <div className="stat-value">{latest.temperature_c.toFixed(1)}°C</div>
                  <div className="stat-sub">{(latest.temperature_c * 9/5 + 32).toFixed(1)}°F</div>
                </div>
              </div>
            )}
            {latest.humidity_pct != null && (
              <div className="stat-card">
                <div className="stat-icon blue"><Droplets size={20} /></div>
                <div className="stat-body">
                  <div className="stat-label">Humidity</div>
                  <div className="stat-value">{latest.humidity_pct.toFixed(1)}%</div>
                  <div className="stat-sub">relative humidity</div>
                </div>
              </div>
            )}
          </div>
          {latest.load_pct != null && (
            <div style={{ marginBottom: '4px' }}>
              <LoadBar pct={latest.load_pct} />
            </div>
          )}
        </>
      ) : metricsLoading ? (
        <div className="empty-state"><p>Loading power data...</p></div>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon"><Zap size={48} /></div>
          <div className="empty-state__title">No power data yet</div>
          <div className="empty-state__description">Click Poll Now to collect metrics from this PDU.</div>
        </div>
      )}

      {/* Power timeseries chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Zap size={15} />
            <h3>Power Consumption — {timeLabel}</h3>
            <div className="time-range-bar" style={{ marginLeft: 'auto' }}>
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
          <div className="card-body">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} axisLine={false} unit=" W" width={65} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} axisLine={false} unit="%" width={45} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
                <Area yAxisId="left" type="monotone" dataKey="Power (W)" stroke="#f59e0b" fill="#fef3c7" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="Load %" stroke="#8b5cf6" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Phase breakdown */}
      {latest && latest.phase1_current_amps != null && (
        <div className="card">
          <div className="card-header">
            <Activity size={15} />
            <h3>Phase Breakdown</h3>
          </div>
          <div className="card-body">
            <div className="pdu-phase-grid">
              {[1, 2, 3].map((ph) => {
                const current = latest[`phase${ph}_current_amps`]
                const voltage = latest[`phase${ph}_voltage_v`]
                const power = latest[`phase${ph}_power_watts`]
                if (current == null) return null
                return (
                  <div key={ph} className="pdu-phase-item">
                    <div className="pdu-phase-item__label">L{ph}</div>
                    <div className="pdu-phase-item__metrics">
                      <div className="pdu-phase-item__metric">
                        <span className="pdu-phase-item__val">{current.toFixed(1)}</span>
                        <span className="pdu-phase-item__unit">A</span>
                      </div>
                      <div className="pdu-phase-item__metric">
                        <span className="pdu-phase-item__val">{voltage?.toFixed(0) ?? '—'}</span>
                        <span className="pdu-phase-item__unit">V</span>
                      </div>
                      {power != null && (
                        <div className="pdu-phase-item__metric">
                          <span className="pdu-phase-item__val">{power.toFixed(0)}</span>
                          <span className="pdu-phase-item__unit">W</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {latest.apparent_power_va != null && (
              <div className="text-muted text-sm" style={{ marginTop: '12px', textAlign: 'center' }}>
                Apparent Power: {latest.apparent_power_va.toFixed(0)} VA
                {latest.power_factor != null && <> · Power Factor: {latest.power_factor.toFixed(2)}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bank breakdown */}
      {banks.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Zap size={15} />
            <h3>Banks / Breaker Groups ({banks.length})</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {banks.map((bank: any) => {
              const loadPct = bank.overload_amps && bank.overload_amps > 0
                ? (bank.current_amps / bank.overload_amps) * 100
                : null
              const bankChart = (bank.timeseries || []).map((t: any) => ({
                time: format(new Date(t.timestamp), hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
                'Current (A)': t.current_amps,
                'Power (W)': t.power_watts,
              }))
              return (
                <div key={bank.bank_number} className="pdu-bank-card">
                  <div className="pdu-bank-card__header">
                    <span className="pdu-bank-card__name">{bank.name || `Bank ${bank.bank_number}`}</span>
                    <div className="pdu-bank-card__stats">
                      <span className="pdu-bank-card__stat">
                        <strong>{bank.current_amps?.toFixed(1) ?? '—'}</strong> A
                      </span>
                      <span className="pdu-bank-card__stat">
                        <strong>{bank.power_watts?.toFixed(0) ?? '—'}</strong> W
                      </span>
                      <span className="pdu-bank-card__stat">
                        <strong>{((bank.power_watts ?? 0) / 1000).toFixed(2)}</strong> kW
                      </span>
                      {bank.near_overload_amps != null && (
                        <span className="pdu-bank-card__stat text-muted">
                          Near OL: {bank.near_overload_amps.toFixed(1)}A
                        </span>
                      )}
                      {bank.overload_amps != null && (
                        <span className="pdu-bank-card__stat text-muted">
                          OL: {bank.overload_amps.toFixed(1)}A
                        </span>
                      )}
                    </div>
                  </div>
                  {loadPct != null && <LoadBar pct={loadPct} size="sm" />}
                  {bankChart.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <ResponsiveContainer width="100%" height={140}>
                        <LineChart data={bankChart} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                          <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                          <YAxis tick={{ fill: chartTheme.tick, fontSize: 10 }} tickLine={false} axisLine={false} width={45} />
                          <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
                          <Line type="monotone" dataKey="Current (A)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="Power (W)" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Outlets */}
      <div className="card">
        <div className="card-header">
          <Power size={15} />
          <h3>Outlets ({outlets.length})</h3>
        </div>
        <div className="card-body">
          <OutletGrid outlets={outlets} deviceId={device.id} isAdmin={isAdmin} />
        </div>
      </div>
    </div>

    {showEdit && (
      <EditDeviceModal
        device={dev}
        onClose={() => {
          setShowEdit(false)
          qc.invalidateQueries({ queryKey: ['device', device.id] })
        }}
      />
    )}
    </>
  )
}
