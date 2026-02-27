import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pduApi, powerAlertsApi, settingsApi } from '../services/api'
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import {
  Zap, Thermometer, AlertTriangle, Server, ChevronRight, ChevronLeft,
  Power, ToggleLeft, ToggleRight, Settings, Plus, Pencil, Trash2,
  Check, X, Bell, CheckCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import { useChartTheme } from '../hooks/useChartTheme'
import NocViewButton from '../components/NocViewButton'
import { PowerAlertRule, AlertEvent } from '../types'

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

const POWER_METRICS = [
  { key: 'total_power', label: 'Total Power', unit: 'W' },
  { key: 'avg_load', label: 'Avg Load', unit: '%' },
  { key: 'max_load', label: 'Max Load', unit: '%' },
  { key: 'max_temp', label: 'Max Temp', unit: '°C' },
  { key: 'avg_temp', label: 'Avg Temp', unit: '°C' },
  { key: 'budget_pct', label: 'Budget %', unit: '%' },
]

const CONDITIONS = [
  { key: 'gt', label: '>' },
  { key: 'gte', label: '>=' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '<=' },
]

const LOOKBACK_PRESETS = [
  { label: '10 min', minutes: 10 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
]

interface PowerAlertForm {
  name: string
  metric: string
  condition: string
  warning_threshold: string
  critical_threshold: string
  lookback_minutes: number
  notification_email: string
  notification_webhook: string
}

const emptyForm: PowerAlertForm = {
  name: '', metric: 'total_power', condition: 'gt',
  warning_threshold: '', critical_threshold: '',
  lookback_minutes: 60,
  notification_email: '', notification_webhook: '',
}

function metricUnit(metric: string): string {
  const m = POWER_METRICS.find(p => p.key === metric)
  return m?.unit || ''
}

function formToPayload(f: PowerAlertForm) {
  return {
    name: f.name,
    metric: f.metric,
    condition: f.condition,
    warning_threshold: f.warning_threshold ? Number(f.warning_threshold) : null,
    critical_threshold: f.critical_threshold ? Number(f.critical_threshold) : null,
    lookback_minutes: f.lookback_minutes,
    notification_email: f.notification_email || null,
    notification_webhook: f.notification_webhook || null,
  }
}

function ruleToForm(r: PowerAlertRule): PowerAlertForm {
  return {
    name: r.name,
    metric: r.metric,
    condition: r.condition,
    warning_threshold: r.warning_threshold != null ? String(r.warning_threshold) : '',
    critical_threshold: r.critical_threshold != null ? String(r.critical_threshold) : '',
    lookback_minutes: r.lookback_minutes,
    notification_email: r.notification_email || '',
    notification_webhook: r.notification_webhook || '',
  }
}

function formatThreshold(metric: string, value: number | null | undefined): string {
  if (value == null) return '—'
  const unit = metricUnit(metric)
  if (metric === 'total_power' && value >= 1000) return `${(value / 1000).toFixed(2)} kW`
  return `${value}${unit}`
}

function formatLookback(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${minutes / 60}h`
  return `${minutes / 1440}d`
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
  const chartTheme = useChartTheme()
  const queryClient = useQueryClient()
  const [hours, setHours] = useState(24)
  const [selectedRack, setSelectedRack] = useState<number | null>(null)

  // Budget popover
  const [showBudgetPopover, setShowBudgetPopover] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')

  // Alert form state
  const [showAlertForm, setShowAlertForm] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [alertForm, setAlertForm] = useState<PowerAlertForm>(emptyForm)
  const [showNotifications, setShowNotifications] = useState(false)

  useEffect(() => {
    const el = document.getElementById('noc-page-title')
    if (el) el.textContent = 'Power Dashboard'
  }, [])

  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isOperator = user?.role === 'admin' || user?.role === 'operator'

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

  // Power alert rules & events
  const { data: powerRules = [] } = useQuery<PowerAlertRule[]>({
    queryKey: ['power-alert-rules'],
    queryFn: () => powerAlertsApi.listRules().then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: powerEvents = [] } = useQuery<AlertEvent[]>({
    queryKey: ['power-alert-events'],
    queryFn: () => powerAlertsApi.listEvents({ status: 'open' }).then(r => r.data),
    refetchInterval: 30_000,
  })

  const createRuleMut = useMutation({
    mutationFn: (data: object) => powerAlertsApi.createRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-alert-rules'] })
      setShowAlertForm(false)
      setAlertForm(emptyForm)
      toast.success('Power alert rule created')
    },
    onError: () => toast.error('Failed to create rule'),
  })

  const updateRuleMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => powerAlertsApi.updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-alert-rules'] })
      setShowAlertForm(false)
      setEditingRuleId(null)
      setAlertForm(emptyForm)
      toast.success('Power alert rule updated')
    },
    onError: () => toast.error('Failed to update rule'),
  })

  const deleteRuleMut = useMutation({
    mutationFn: (id: number) => powerAlertsApi.deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-alert-rules'] })
      toast.success('Rule deleted')
    },
    onError: () => toast.error('Failed to delete rule'),
  })

  const toggleRuleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      powerAlertsApi.updateRule(id, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['power-alert-rules'] }),
  })

  const ackEventMut = useMutation({
    mutationFn: (id: number) => powerAlertsApi.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-alert-events'] })
      toast.success('Alert acknowledged')
    },
  })

  const resolveEventMut = useMutation({
    mutationFn: (id: number) => powerAlertsApi.resolve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['power-alert-events'] })
      toast.success('Alert resolved')
    },
  })

  const budgetWatts = dashboard?.power_budget_watts
  const budgetKw = budgetWatts ? budgetWatts / 1000 : null
  const budgetPct = budgetWatts && dashboard?.total_power_watts
    ? ((dashboard.total_power_watts / budgetWatts) * 100).toFixed(1)
    : null

  const timeLabel = hours <= 24 ? `${hours}h` : `${hours / 24}d`

  // Aggregate timeline chart
  const chartData = (dashboard?.timeline || []).map((t: any) => ({
    time: format(new Date(t.timestamp), hours <= 6 ? 'HH:mm' : hours <= 24 ? 'HH:mm' : 'MM/dd HH:mm'),
    'Total Power (W)': t.total_watts,
  }))

  const openEvents = powerEvents.filter((e: AlertEvent) => e.status === 'open' || e.status === 'acknowledged')

  function handleSaveBudget() {
    const kw = parseFloat(budgetInput)
    if (isNaN(kw) || kw <= 0) { toast.error('Enter a valid kW value'); return }
    const watts = kw * 1000
    settingsApi.update('power_budget_watts', String(watts)).then(() => {
      queryClient.invalidateQueries({ queryKey: ['pdu-dashboard'] })
      setShowBudgetPopover(false)
      toast.success(`Power budget set to ${kw} kW`)
    }).catch(() => toast.error('Failed to save budget'))
  }

  function handleSubmitAlert() {
    if (!alertForm.name.trim()) { toast.error('Name is required'); return }
    if (!alertForm.warning_threshold && !alertForm.critical_threshold) {
      toast.error('At least one threshold is required'); return
    }
    const payload = formToPayload(alertForm)
    if (editingRuleId) {
      updateRuleMut.mutate({ id: editingRuleId, data: payload })
    } else {
      createRuleMut.mutate(payload)
    }
  }

  function startEdit(rule: PowerAlertRule) {
    setAlertForm(ruleToForm(rule))
    setEditingRuleId(rule.id)
    setShowAlertForm(true)
    setShowNotifications(!!(rule.notification_email || rule.notification_webhook))
  }

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <h1><Zap size={22} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '6px' }} />Power Dashboard</h1>
        <div className="time-range-bar">
          <NocViewButton pageId="power" />
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
        {/* Power Budget card */}
        <div className="stat-card" style={{ position: 'relative' }}>
          <div className="stat-icon" style={{ background: budgetKw ? '#dbeafe' : '#f3f4f6', color: budgetKw ? '#2563eb' : '#9ca3af' }}>
            <Zap size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              Power Budget
              {isOperator && (
                <button
                  className="btn-icon"
                  style={{ padding: '2px' }}
                  onClick={() => {
                    setBudgetInput(budgetKw ? String(budgetKw) : '')
                    setShowBudgetPopover(!showBudgetPopover)
                  }}
                  title="Set power budget"
                >
                  <Settings size={12} />
                </button>
              )}
            </div>
            <div className="stat-value">{budgetKw ? `${budgetKw.toFixed(1)} kW` : 'Not set'}</div>
            <div className="stat-sub">
              {budgetPct ? `${budgetPct}% used` : 'click gear to set'}
            </div>
          </div>
          {showBudgetPopover && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 50,
              background: 'var(--card-bg)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '12px', minWidth: '200px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}>
              <div className="text-sm font-semibold" style={{ marginBottom: '8px' }}>Set Power Budget (kW)</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="number"
                  className="form-input"
                  style={{ width: '120px' }}
                  value={budgetInput}
                  onChange={e => setBudgetInput(e.target.value)}
                  placeholder="e.g. 10"
                  step="0.1"
                  onKeyDown={e => e.key === 'Enter' && handleSaveBudget()}
                />
                <button className="btn btn-primary btn-sm" onClick={handleSaveBudget}>Save</button>
                <button className="btn btn-outline btn-sm" onClick={() => setShowBudgetPopover(false)}>
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
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
            <>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} tickLine={false} axisLine={false} unit=" W" width={70} />
                  <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
                  <Area type="monotone" dataKey="Total Power (W)" stroke="#f59e0b" fill="#fef3c7" strokeWidth={2} />
                  {budgetWatts && (
                    <ReferenceLine
                      y={budgetWatts}
                      stroke="#ef4444"
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      label={{ value: `Budget: ${budgetKw?.toFixed(1)} kW`, position: 'insideTopRight', fill: '#ef4444', fontSize: 11 }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
              {budgetWatts && (
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '16px', height: '2px', background: '#ef4444', display: 'inline-block', borderTop: '2px dashed #ef4444' }} />
                    Budget: {budgetKw?.toFixed(1)} kW ({budgetPct}% used)
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Power Alerts card */}
      {isOperator && (
        <div className="card">
          <div className="card-header">
            <Bell size={15} />
            <h3>Power Alerts</h3>
            <button
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                setAlertForm(emptyForm)
                setEditingRuleId(null)
                setShowAlertForm(!showAlertForm)
                setShowNotifications(false)
              }}
            >
              <Plus size={14} /> Add Alert
            </button>
          </div>
          <div className="card-body">
            {/* Open events */}
            {openEvents.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div className="text-sm font-semibold" style={{ marginBottom: '6px' }}>Active Events</div>
                {openEvents.map((evt: AlertEvent) => (
                  <div key={evt.id} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px', borderRadius: '6px', marginBottom: '4px',
                    background: evt.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                    border: `1px solid ${evt.severity === 'critical' ? '#fecaca' : '#fed7aa'}`,
                  }}>
                    <span className={`tag-${evt.severity === 'critical' ? 'red' : 'orange'}`} style={{ fontSize: '10px' }}>
                      {evt.severity}
                    </span>
                    <span className="text-sm" style={{ flex: 1 }}>{evt.message}</span>
                    <span className="text-xs text-muted">{evt.triggered_at ? format(new Date(evt.triggered_at), 'MM/dd HH:mm') : ''}</span>
                    {evt.status === 'open' && (
                      <button className="btn btn-outline btn-sm" onClick={() => ackEventMut.mutate(evt.id)} title="Acknowledge">
                        <CheckCircle size={12} />
                      </button>
                    )}
                    <button className="btn btn-outline btn-sm" onClick={() => resolveEventMut.mutate(evt.id)} title="Resolve">
                      <Check size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add/Edit form */}
            {showAlertForm && (
              <div style={{
                padding: '16px', borderRadius: '8px', marginBottom: '16px',
                border: '1px solid var(--border)', background: 'var(--bg-secondary)',
              }}>
                <div className="text-sm font-semibold" style={{ marginBottom: '12px' }}>
                  {editingRuleId ? 'Edit Power Alert' : 'New Power Alert'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Name</label>
                    <input className="form-input" value={alertForm.name}
                      onChange={e => setAlertForm({ ...alertForm, name: e.target.value })}
                      placeholder="e.g. High Power Draw" />
                  </div>
                  <div>
                    <label className="form-label">Metric</label>
                    <select className="form-input" value={alertForm.metric}
                      onChange={e => setAlertForm({ ...alertForm, metric: e.target.value })}>
                      {POWER_METRICS.map(m => (
                        <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Condition</label>
                    <select className="form-input" value={alertForm.condition}
                      onChange={e => setAlertForm({ ...alertForm, condition: e.target.value })}>
                      {CONDITIONS.map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Warning Threshold ({metricUnit(alertForm.metric)})</label>
                    <input className="form-input" type="number" value={alertForm.warning_threshold}
                      onChange={e => setAlertForm({ ...alertForm, warning_threshold: e.target.value })}
                      placeholder="optional" />
                  </div>
                  <div>
                    <label className="form-label">Critical Threshold ({metricUnit(alertForm.metric)})</label>
                    <input className="form-input" type="number" value={alertForm.critical_threshold}
                      onChange={e => setAlertForm({ ...alertForm, critical_threshold: e.target.value })}
                      placeholder="optional" />
                  </div>
                  <div>
                    <label className="form-label">Time Window</label>
                    <select className="form-input" value={alertForm.lookback_minutes}
                      onChange={e => setAlertForm({ ...alertForm, lookback_minutes: Number(e.target.value) })}>
                      {LOOKBACK_PRESETS.map(p => (
                        <option key={p.minutes} value={p.minutes}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Notifications collapsible */}
                <div style={{ marginTop: '10px' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setShowNotifications(!showNotifications)}>
                    Notifications {showNotifications ? '▲' : '▼'}
                  </button>
                  {showNotifications && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '8px' }}>
                      <div>
                        <label className="form-label">Email</label>
                        <input className="form-input" value={alertForm.notification_email}
                          onChange={e => setAlertForm({ ...alertForm, notification_email: e.target.value })}
                          placeholder="alerts@example.com" />
                      </div>
                      <div>
                        <label className="form-label">Webhook URL</label>
                        <input className="form-input" value={alertForm.notification_webhook}
                          onChange={e => setAlertForm({ ...alertForm, notification_webhook: e.target.value })}
                          placeholder="https://..." />
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSubmitAlert}
                    disabled={createRuleMut.isPending || updateRuleMut.isPending}>
                    {editingRuleId ? 'Update' : 'Create'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => {
                    setShowAlertForm(false); setEditingRuleId(null); setAlertForm(emptyForm)
                  }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Rules table */}
            {powerRules.length > 0 ? (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Metric</th>
                      <th>Window</th>
                      <th>Warning</th>
                      <th>Critical</th>
                      <th>Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powerRules.map((rule: PowerAlertRule) => (
                      <tr key={rule.id}>
                        <td className="font-semibold">{rule.name}</td>
                        <td>{POWER_METRICS.find(m => m.key === rule.metric)?.label || rule.metric}</td>
                        <td>{formatLookback(rule.lookback_minutes)}</td>
                        <td>{formatThreshold(rule.metric, rule.warning_threshold)}</td>
                        <td>{formatThreshold(rule.metric, rule.critical_threshold)}</td>
                        <td>
                          <button
                            className={`tag-${rule.is_active ? 'green' : 'red'}`}
                            style={{ cursor: 'pointer', border: 'none', fontSize: '11px' }}
                            onClick={() => toggleRuleMut.mutate({ id: rule.id, active: !rule.is_active })}
                          >
                            {rule.is_active ? 'ON' : 'OFF'}
                          </button>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="btn-icon" onClick={() => startEdit(rule)} title="Edit">
                              <Pencil size={14} />
                            </button>
                            <button className="btn-icon" onClick={() => {
                              if (confirm(`Delete rule "${rule.name}"?`)) deleteRuleMut.mutate(rule.id)
                            }} title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !showAlertForm && (
              <div className="text-muted text-sm">No power alert rules configured. Click "Add Alert" to create one.</div>
            )}
          </div>
        </div>
      )}

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
                  {/* Combined totals row */}
                  {(() => {
                    const hasBanks = rack.pdus.some((p: any) => p.banks?.length > 0)
                    const hasPhases = rack.pdus.some((p: any) => p.phases?.length > 0)
                    if (hasBanks) {
                      // Aggregate banks across PDUs
                      const bankTotals: Record<number, { current: number; power: number }> = {}
                      rack.pdus.forEach((p: any) =>
                        (p.banks || []).forEach((b: any) => {
                          if (!bankTotals[b.bank_number]) bankTotals[b.bank_number] = { current: 0, power: 0 }
                          bankTotals[b.bank_number].current += b.current_amps ?? 0
                          bankTotals[b.bank_number].power += b.power_watts ?? 0
                        })
                      )
                      const nums = Object.keys(bankTotals).map(Number).sort((a, b) => a - b)
                      if (nums.length > 0) return (
                        <div className="rack-totals-row">
                          <span className="rack-totals-label">TOTAL</span>
                          {nums.map(n => (
                            <span key={n} className="bank-value">
                              B{n}: {bankTotals[n].current.toFixed(1)}A · {(bankTotals[n].power / 1000).toFixed(2)}kW
                            </span>
                          ))}
                        </div>
                      )
                    } else if (hasPhases) {
                      // Aggregate phases across PDUs
                      const phaseTotals: Record<number, { current: number; power: number }> = {}
                      rack.pdus.forEach((p: any) =>
                        (p.phases || []).forEach((ph: any) => {
                          if (!phaseTotals[ph.phase]) phaseTotals[ph.phase] = { current: 0, power: 0 }
                          phaseTotals[ph.phase].current += ph.current_amps ?? 0
                          phaseTotals[ph.phase].power += ph.power_watts ?? 0
                        })
                      )
                      const nums = Object.keys(phaseTotals).map(Number).sort((a, b) => a - b)
                      if (nums.length > 0) return (
                        <div className="rack-totals-row">
                          <span className="rack-totals-label">TOTAL</span>
                          {nums.map(n => (
                            <span key={n} className="bank-value">
                              L{n}: {phaseTotals[n].current.toFixed(1)}A · {(phaseTotals[n].power / 1000).toFixed(2)}kW
                            </span>
                          ))}
                        </div>
                      )
                    }
                    return null
                  })()}
                  {/* Per-PDU rows */}
                  {rack.pdus.map((p: any) => (
                    <div key={p.device_id} style={{ marginBottom: '4px' }}>
                      <span className={`tag-${p.status === 'up' ? 'green' : 'red'}`} style={{ fontSize: '10px' }}>
                        {p.hostname}
                      </span>
                      {p.banks && p.banks.length > 0 ? (
                        <div className="bank-row">
                          {p.banks.map((b: any) => (
                            <span key={b.bank_number} className="bank-value">
                              B{b.bank_number}: {b.current_amps?.toFixed(1) ?? '—'}A · {((b.power_watts ?? 0) / 1000).toFixed(2)}kW
                            </span>
                          ))}
                        </div>
                      ) : p.phases && p.phases.length > 0 ? (
                        <div className="bank-row">
                          {p.phases.map((ph: any) => (
                            <span key={ph.phase} className="bank-value">
                              L{ph.phase}: {ph.current_amps?.toFixed(1) ?? '—'}A · {((ph.power_watts ?? 0) / 1000).toFixed(2)}kW
                            </span>
                          ))}
                        </div>
                      ) : null}
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
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="time" tick={{ fill: chartTheme.tick, fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: chartTheme.tick, fontSize: 10 }} tickLine={false} axisLine={false} width={50} />
                      <Tooltip contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: '8px', color: chartTheme.tooltipText }} />
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
