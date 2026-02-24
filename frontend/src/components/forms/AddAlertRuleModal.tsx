import { useState, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { alertsApi, devicesApi } from '../../services/api'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const METRICS = [
  { value: 'device_status', label: 'Device Status (1=down, 0=up)' },
  { value: 'cpu_usage', label: 'CPU Usage (%)' },
  { value: 'memory_usage', label: 'Memory Usage (%)' },
  { value: 'if_utilization_in', label: 'Interface Utilization In (%)' },
  { value: 'if_utilization_out', label: 'Interface Utilization Out (%)' },
  { value: 'if_status', label: 'Interface Status (1=down, 0=up)' },
  { value: 'if_errors', label: 'Interface Errors (count)' },
]

const CONDITIONS = [
  { value: 'gt', label: '> Greater than' },
  { value: 'gte', label: '>= Greater or equal' },
  { value: 'lt', label: '< Less than' },
  { value: 'lte', label: '<= Less or equal' },
  { value: 'eq', label: '= Equal' },
  { value: 'ne', label: '!= Not equal' },
]

export default function AddAlertRuleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '',
    description: '',
    device_id: '',
    metric: '',
    condition: 'gt',
    threshold: '',
    severity: 'warning',
    duration_seconds: '0',
    cooldown_minutes: '15',
    notification_email: '',
    notification_webhook: '',
  })

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  })

  const mutation = useMutation({
    mutationFn: (data: object) => alertsApi.createRule(data),
    onSuccess: () => {
      toast.success('Alert rule created')
      qc.invalidateQueries({ queryKey: ['alert-rules'] })
      onClose()
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      ...form,
      device_id: form.device_id ? parseInt(form.device_id) : undefined,
      threshold: parseFloat(form.threshold),
      duration_seconds: parseInt(form.duration_seconds),
      cooldown_minutes: parseInt(form.cooldown_minutes),
    })
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content modal-content--md">
        <div className="modal-header">
          <h3>Create Alert Rule</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body--scroll">
            <div className="form-stack">
              <div className="form-field">
                <label className="form-label">Rule Name *</label>
                <input className="form-input" value={form.name} onChange={set('name')} required placeholder="High CPU Alert" />
              </div>

              <div className="form-grid-2">
                <div className="form-field">
                  <label className="form-label">Device (optional)</label>
                  <select className="form-select" value={form.device_id} onChange={set('device_id')}>
                    <option value="">All devices</option>
                    {(devices || []).map((d: any) => (
                      <option key={d.id} value={d.id}>{d.hostname}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Metric *</label>
                  <select className="form-select" value={form.metric} onChange={set('metric')} required>
                    <option value="">Select metric...</option>
                    {METRICS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="form-field">
                  <label className="form-label">Condition *</label>
                  <select className="form-select" value={form.condition} onChange={set('condition')}>
                    {CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Threshold *</label>
                  <input className="form-input" type="number" step="any" value={form.threshold} onChange={set('threshold')} required placeholder="80" />
                </div>
                <div className="form-field">
                  <label className="form-label">Severity</label>
                  <select className="form-select" value={form.severity} onChange={set('severity')}>
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-field">
                  <label className="form-label">Duration (seconds)</label>
                  <input className="form-input" type="number" min="0" value={form.duration_seconds} onChange={set('duration_seconds')} />
                  <p className="form-help">Trigger only if sustained for this long</p>
                </div>
                <div className="form-field">
                  <label className="form-label">Cooldown (minutes)</label>
                  <input className="form-input" type="number" min="1" value={form.cooldown_minutes} onChange={set('cooldown_minutes')} />
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Notification Email</label>
                <input className="form-input" type="email" value={form.notification_email} onChange={set('notification_email')} placeholder="alerts@company.com" />
              </div>

              <div className="form-field">
                <label className="form-label">Webhook URL</label>
                <input className="form-input" value={form.notification_webhook} onChange={set('notification_webhook')} placeholder="https://..." />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary">
              {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Create Rule
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
