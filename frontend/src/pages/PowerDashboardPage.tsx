import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pduApi } from '../services/api'
import { useState } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { format } from 'date-fns'
import {
  Zap, Thermometer, AlertTriangle, Server, ChevronRight, ChevronLeft,
  Power, ToggleLeft, ToggleRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

const TOOLTIP_STYLE = {
  background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b',
}

function LoadBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' }) {
  const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e'
  const bg = pct >= 90 ? '#fef2f2' : pct >= 75 ? '#fffbeb' : '#f0fdf4'
  const h = size === 'sm' ? '14px' : '20px'
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
        transform: 'translate(-50%, -50%)', fontSize: size === 'sm' ? '9px' : '11px',
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
    mutationFn: ({ devId, num }: { devId: number; num: number }) =>
      pduApi.toggleOutlet(devId, num),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pdu-rack-detail'] })
      queryClient.invalidateQueries({ queryKey: ['pdu-outlets', vars.devId] })
      toast.success('Outlet toggled')
    },
    onError: () => toast.error('Failed to toggle outlet'),
  })

  if (!outlets || outlets.length === 0) {
    return <div className="text-muted text-sm" style={{ padding: '8px 0' }}>No outlets discovered</div>
  }

  // Group outlets by bank
  const bankGroups: Record<string, any[]> = {}
  outlets.forEach((o: any) => {
    const key = o.bank_number != null ? `Bank ${o.bank_number}` : 'Unassigned'
    ;(bankGroups[key] = bankGroups[key] || []).push(o)
  })
  const bankKeys = Object.keys(bankGroups).sort()

  return (
    <div>
      {bankKeys.map(bankLabel => (
        <div key={bankLabel} style={{ marginBottom: '12px' }}>
          {bankKeys.length > 1 && (
            <div className="text-muted text-xs font-semibold" style={{ marginBottom: '6px' }}>{bankLabel}</div>
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
          <div className="power-outlet__name" title={o.name}>{o.name}</div>
          <div className="power-outlet__metrics">
            {o.current_amps != null && <span>{o.current_amps.toFixed(1)}A</span>}
            {o.power_watts != null && <span>{o.power_watts.toFixed(0)}W</span>}
          </div>
          {isAdmin && (
            <button
              className="btn btn-outline btn-sm power-outlet__toggle"
              disabled={toggleMutation.isPending}
              onClick={() => {
                if (confirm(`Toggle outlet #${o.outlet_number} (${o.name}) ${o.state === 'on' ? 'OFF' : 'ON'}?`))
                  toggleMutation.mutate({ devId: deviceId, num: o.outlet_number })
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

export default function PowerDashboardPage() {
  const [hours, setHours] = useState(24)
  const [selectedRack, setSelectedRack] = useState<number | null>(null)

  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['pdu-dashboard', hours],
    queryFn: () => pduApi.dashboard(hours).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: rackDetail } = useQuery({
    queryKey: ['pdu-rack-detail', selectedRack, hours],
    queryFn: () => pduApi.rackDetail(selectedRack!, hours).then((r) => r.data),
    enabled: selectedRack !== null,
    refetchInterval: 60_000,
  })

  const timeLabel = hours <= 24 ? `${hours}h` : `${hours / 24}d`

  // Aggregate timeline chart
  const chartData = (dashboard?.timeline || []).map((t: any) => ({
    time: format(new Date(t.timestamp), hours <= 6 ? 'HH:mm' : hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
    'Total Power (W)': t.total_watts,
  }))

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <h1><Zap size={22} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '6px' }} />Power Dashboard</h1>
        <div className="time-range-bar">
          {TIME_RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => { setHours(r.hours); setSelectedRack(null) }}
              className={`time-btn${hours === r.hours ? ' active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <Zap size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Total Power</div>
            <div className="stat-value">{dashboard?.total_power_kw?.toFixed(1) ?? '—'} kW</div>
            <div className="stat-sub">{dashboard?.total_power_watts?.toFixed(0) ?? 0} W</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <Power size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Energy</div>
            <div className="stat-value">{dashboard?.total_energy_kwh?.toFixed(1) ?? '—'} kWh</div>
            <div className="stat-sub">cumulative</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">
            <Server size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Avg Load</div>
            <div className="stat-value">{dashboard?.avg_load_pct?.toFixed(1) ?? '—'}%</div>
            <div className="stat-sub">{dashboard?.pdu_count ?? 0} PDUs / {dashboard?.rack_count ?? 0} racks</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <AlertTriangle size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">PDU Alerts</div>
            <div className="stat-value">{dashboard?.alerts_active ?? 0}</div>
            <div className="stat-sub">active</div>
          </div>
        </div>
      </div>

      {/* Power timeline */}
      <div className="card">
        <div className="card-header">
          <Zap size={15} />
          <h3>Aggregate Power Consumption — {timeLabel}</h3>
        </div>
        <div className="card-body">
          {isLoading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : chartData.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon"><Zap size={48} /></div>
              <div className="empty-state__title">No power data</div>
              <div className="empty-state__description">Add PDU devices and enable polling to see power consumption data.</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} unit=" W" width={70} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="Total Power (W)" stroke="#f59e0b" fill="#fef3c7" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Rack cards grid */}
      {dashboard?.racks && dashboard.racks.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Server size={15} />
            <h3>Racks ({dashboard.racks.length})</h3>
          </div>
          <div className="power-rack-grid">
            {dashboard.racks.map((rack: any) => (
              <div
                key={rack.location_id}
                className={`power-rack-card${selectedRack === rack.location_id ? ' power-rack-card--selected' : ''}`}
                onClick={() => setSelectedRack(selectedRack === rack.location_id ? null : rack.location_id)}
              >
                <div className="power-rack-card__header">
                  <span className="power-rack-card__name">{rack.location_name}</span>
                  <ChevronRight size={14} className="power-rack-card__arrow" />
                </div>
                <div className="power-rack-card__stats">
                  <div>
                    <span className="power-rack-card__value">{rack.total_kw} kW</span>
                    <span className="power-rack-card__label">Power</span>
                  </div>
                  <div>
                    <span className="power-rack-card__value">{rack.avg_load_pct}%</span>
                    <span className="power-rack-card__label">Load</span>
                  </div>
                  {rack.temperature_c != null && (
                    <div>
                      <span className="power-rack-card__value">
                        <Thermometer size={12} style={{ display: 'inline', verticalAlign: 'text-bottom' }} />
                        {rack.temperature_c.toFixed(1)}°C
                      </span>
                      <span className="power-rack-card__label">Temp</span>
                    </div>
                  )}
                </div>
                <LoadBar pct={rack.avg_load_pct} size="sm" />
                <div className="power-rack-card__pdus">
                  {rack.pdus.map((p: any) => (
                    <div key={p.device_id} style={{ marginBottom: '4px' }}>
                      <span className={`tag-${p.status === 'up' ? 'green' : 'red'}`} style={{ fontSize: '10px' }}>
                        {p.hostname}
                      </span>
                      {p.banks && p.banks.length > 0 && (
                        <div className="bank-row">
                          {p.banks.map((b: any) => (
                            <span key={b.bank_number} className="bank-value">
                              B{b.bank_number}: {b.current_amps?.toFixed(1) ?? '—'}A · {((b.power_watts ?? 0) / 1000).toFixed(2)}kW
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rack detail */}
      {selectedRack !== null && rackDetail && (
        <div className="card">
          <div className="card-header">
            <button className="btn-icon" onClick={() => setSelectedRack(null)} title="Close rack detail">
              <ChevronLeft size={16} />
            </button>
            <h3>Rack: {rackDetail.location_name}</h3>
            <span className="text-muted text-sm" style={{ marginLeft: 'auto' }}>
              {rackDetail.total_kw} kW total
            </span>
          </div>
          <div className="card-body">
            {rackDetail.pdus?.map((pdu: any) => (
              <div key={pdu.device_id} className="power-pdu-section">
                <div className="power-pdu-section__header">
                  <Server size={14} />
                  <span className="font-semibold">{pdu.hostname}</span>
                  <span className="mono text-muted text-sm">{pdu.ip_address}</span>
                  {pdu.latest && (
                    <span className="text-sm" style={{ marginLeft: 'auto' }}>
                      {pdu.latest.power_watts?.toFixed(0) ?? 0}W | Load: {pdu.latest.load_pct?.toFixed(1) ?? 0}%
                      {pdu.latest.temperature_c != null && ` | ${pdu.latest.temperature_c.toFixed(1)}°C`}
                    </span>
                  )}
                </div>

                {/* Phase breakdown */}
                {pdu.latest && (pdu.latest.phase1_current_amps != null || pdu.latest.phase2_current_amps != null) && (
                  <div className="power-phase-grid">
                    {[1, 2, 3].map((ph) => {
                      const current = pdu.latest[`phase${ph}_current_amps`]
                      const voltage = pdu.latest[`phase${ph}_voltage_v`]
                      if (current == null) return null
                      return (
                        <div key={ph} className="power-phase-item">
                          <span className="font-semibold">L{ph}</span>
                          <span>{current?.toFixed(1)}A</span>
                          <span>{voltage?.toFixed(0)}V</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Bank breakdown */}
                {pdu.banks && pdu.banks.length > 0 && (
                  <div className="power-bank-grid">
                    {pdu.banks.map((b: any) => (
                      <div key={b.bank_number} className="power-bank-item">
                        <span className="font-semibold">{b.name || `Bank ${b.bank_number}`}</span>
                        <span className="bank-value">{b.current_amps?.toFixed(1) ?? '—'}A</span>
                        <span className="bank-value">{b.power_watts?.toFixed(0) ?? '—'}W</span>
                        {b.near_overload_amps != null && (
                          <span className="text-muted text-xs">OL: {b.overload_amps?.toFixed(0)}A</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Timeseries chart */}
                {pdu.timeseries && pdu.timeseries.length > 0 && (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart
                      data={pdu.timeseries.map((m: any) => ({
                        time: format(new Date(m.timestamp), hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
                        'Power (W)': m.power_watts,
                        'Load %': m.load_pct,
                      }))}
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={50} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Line type="monotone" dataKey="Power (W)" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Load %" stroke="#8b5cf6" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}

                {/* Outlets */}
                <OutletGrid outlets={pdu.outlets} deviceId={pdu.device_id} isAdmin={isAdmin} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
