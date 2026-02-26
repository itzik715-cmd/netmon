import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pduApi } from '../services/api'
import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { format } from 'date-fns'
import {
  Zap, Thermometer, Server, ChevronDown, ChevronUp,
  ToggleLeft, ToggleRight,
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

function LoadBar({ pct }: { pct: number }) {
  const cls = pct >= 90 ? 'load-bar__fill--danger' : pct >= 75 ? 'load-bar__fill--warning' : 'load-bar__fill--ok'
  return (
    <div className="load-bar">
      <div className={`load-bar__fill ${cls}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export default function RackPowerPage() {
  const [hours, setHours] = useState(24)
  const [expandedRack, setExpandedRack] = useState<number | null>(null)
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['pdu-dashboard', hours],
    queryFn: () => pduApi.dashboard(hours).then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: rackDetail } = useQuery({
    queryKey: ['pdu-rack-detail', expandedRack, hours],
    queryFn: () => pduApi.rackDetail(expandedRack!, hours).then(r => r.data),
    enabled: expandedRack !== null,
    refetchInterval: 60_000,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ devId, num }: { devId: number; num: number }) =>
      pduApi.toggleOutlet(devId, num),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdu-rack-detail'] })
      toast.success('Outlet toggled')
    },
    onError: () => toast.error('Failed to toggle outlet'),
  })

  const racks = dashboard?.racks || []

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <div>
          <h1><Server size={22} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '6px' }} />Rack Power Detail</h1>
          <p>Per-rack power consumption and PDU breakdown</p>
        </div>
        <div className="time-range-bar">
          {TIME_RANGES.map(r => (
            <button
              key={r.hours}
              onClick={() => { setHours(r.hours); setExpandedRack(null) }}
              className={`time-btn${hours === r.hours ? ' active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="empty-state"><p>Loading...</p></div>
      ) : racks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><Server size={48} /></div>
          <div className="empty-state__title">No rack power data</div>
          <div className="empty-state__description">Add PDU devices assigned to locations to see rack power details.</div>
        </div>
      ) : (
        <div className="rack-cards-grid">
          {racks.map((rack: any) => {
            const isExpanded = expandedRack === rack.location_id
            return (
              <div key={rack.location_id} className={`rack-card${isExpanded ? ' selected' : ''}`}>
                <div
                  className="rack-card__header"
                  onClick={() => setExpandedRack(isExpanded ? null : rack.location_id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div>
                    <div className="rack-card__name">{rack.location_name}</div>
                    <div className="rack-card__kw">{rack.total_kw} kW</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {rack.max_temperature_c != null && (
                      <span className="rack-card__temp">
                        <Thermometer size={12} /> {rack.max_temperature_c.toFixed(1)}°C
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                <LoadBar pct={rack.avg_load_pct} />
                <div className="text-muted text-xs" style={{ marginTop: '4px' }}>
                  Load: {rack.avg_load_pct}% &middot; {rack.pdus.length} PDU{rack.pdus.length !== 1 ? 's' : ''}
                </div>

                {/* PDU list with bank breakdown */}
                <div style={{ marginTop: '8px' }}>
                  {rack.pdus.map((pdu: any) => (
                    <div key={pdu.device_id} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={`outlet-cell__status outlet-cell__status--${pdu.status === 'up' ? 'on' : 'off'}`} />
                        <span className="text-sm font-semibold">{pdu.hostname}</span>
                        <span className="text-muted text-xs">{pdu.power_watts?.toFixed(0)}W</span>
                      </div>
                      {pdu.banks && pdu.banks.length > 0 && (
                        <div className="bank-row">
                          {pdu.banks.map((b: any) => (
                            <span key={b.bank_number} className="bank-value">
                              B{b.bank_number}: {b.current_amps?.toFixed(1)}A · {((b.power_watts ?? 0) / 1000).toFixed(2)}kW
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Expanded detail */}
                {isExpanded && rackDetail && (
                  <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                    {rackDetail.pdus?.map((pdu: any) => (
                      <div key={pdu.device_id} style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <Zap size={14} />
                          <span className="font-semibold">{pdu.hostname}</span>
                          <span className="mono text-muted text-xs">{pdu.ip_address}</span>
                          {pdu.latest && (
                            <span className="text-xs" style={{ marginLeft: 'auto' }}>
                              {pdu.latest.power_watts?.toFixed(0)}W · {pdu.latest.load_pct?.toFixed(1)}%
                            </span>
                          )}
                        </div>

                        {/* Timeseries */}
                        {pdu.timeseries && pdu.timeseries.length > 0 && (
                          <ResponsiveContainer width="100%" height={150}>
                            <LineChart
                              data={pdu.timeseries.map((m: any) => ({
                                time: format(new Date(m.timestamp), hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
                                'Power (W)': m.power_watts,
                              }))}
                              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} axisLine={false} width={45} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                              <Line type="monotone" dataKey="Power (W)" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}

                        {/* Outlets */}
                        {pdu.outlets && pdu.outlets.length > 0 && (
                          <div className="outlet-grid" style={{ marginTop: '8px' }}>
                            {pdu.outlets.map((o: any) => (
                              <div key={o.outlet_number} className={`outlet-cell outlet-cell--${o.state === 'on' ? 'on' : 'off'}`}>
                                <div className="outlet-cell__number">#{o.outlet_number}</div>
                                <div className="outlet-cell__name" title={o.name}>{o.name}</div>
                                <div className="outlet-cell__amps">
                                  {o.current_amps != null ? `${o.current_amps.toFixed(1)}A` : ''}
                                  {o.power_watts != null ? ` ${o.power_watts.toFixed(0)}W` : ''}
                                </div>
                                <span className={`outlet-cell__status outlet-cell__status--${o.state === 'on' ? 'on' : 'off'}`} />
                                {isAdmin && (
                                  <button
                                    className="outlet-cell__toggle btn btn-outline btn-sm"
                                    disabled={toggleMutation.isPending}
                                    onClick={() => {
                                      if (confirm(`Toggle outlet #${o.outlet_number} (${o.name}) ${o.state === 'on' ? 'OFF' : 'ON'}?`))
                                        toggleMutation.mutate({ devId: pdu.device_id, num: o.outlet_number })
                                    }}
                                  >
                                    {o.state === 'on' ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
