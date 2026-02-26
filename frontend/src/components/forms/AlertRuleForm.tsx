import { useState, FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Device } from '../../types'

const METRICS = [
  { value: 'device_status', label: 'Device Status', binary: true },
  { value: 'cpu_usage', label: 'CPU Usage (%)' },
  { value: 'memory_usage', label: 'Memory Usage (%)' },
  { value: 'if_utilization_in', label: 'Interface Utilization In (%)' },
  { value: 'if_utilization_out', label: 'Interface Utilization Out (%)' },
  { value: 'if_status', label: 'Interface Status', binary: true },
  { value: 'if_errors', label: 'Interface Errors' },
]

const CONDITIONS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
  { value: 'ne', label: '!=' },
]

export interface AlertRuleFormState {
  name: string
  description: string
  device_id: string
  metric: string
  condition: string
  threshold: string
  severity: string
  warning_threshold: string
  critical_threshold: string
  cooldown_minutes: string
  duration_seconds: string
  notification_email: string
  notification_webhook: string
}

export const EMPTY_FORM: AlertRuleFormState = {
  name: '',
  description: '',
  device_id: '',
  metric: 'cpu_usage',
  condition: 'gt',
  threshold: '',
  severity: 'warning',
  warning_threshold: '',
  critical_threshold: '',
  cooldown_minutes: '15',
  duration_seconds: '0',
  notification_email: '',
  notification_webhook: '',
}

function isBinaryMetric(metric: string) {
  return METRICS.find((m) => m.value === metric)?.binary === true
}

export function buildPayload(form: AlertRuleFormState) {
  const binary = isBinaryMetric(form.metric)
  const payload: Record<string, unknown> = {
    name: form.name,
    description: form.description || undefined,
    device_id: form.device_id ? parseInt(form.device_id) : undefined,
    metric: form.metric,
    condition: form.condition,
    cooldown_minutes: parseInt(form.cooldown_minutes) || 15,
    duration_seconds: parseInt(form.duration_seconds) || 0,
    notification_email: form.notification_email || undefined,
    notification_webhook: form.notification_webhook || undefined,
  }
  if (binary) {
    payload.threshold = parseFloat(form.threshold) || 0
    payload.severity = form.severity
    payload.warning_threshold = undefined
    payload.critical_threshold = undefined
  } else {
    payload.threshold = undefined
    payload.severity = 'warning'
    payload.warning_threshold = form.warning_threshold ? parseFloat(form.warning_threshold) : undefined
    payload.critical_threshold = form.critical_threshold ? parseFloat(form.critical_threshold) : undefined
  }
  return payload
}

interface Props {
  devices: Device[]
  onSubmit: (form: AlertRuleFormState) => void
  isPending: boolean
  submitLabel: string
  onCancel: () => void
  initialValues?: Partial<AlertRuleFormState>
}

export default function AlertRuleForm({ devices, onSubmit, isPending, submitLabel, onCancel, initialValues }: Props) {
  const [form, setForm] = useState<AlertRuleFormState>({ ...EMPTY_FORM, ...initialValues })

  const set = (key: keyof AlertRuleFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  const binary = isBinaryMetric(form.metric)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!binary && !form.warning_threshold && !form.critical_threshold) {
      return
    }
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal-body modal-body--scroll-lg">
        <div className="form-stack--lg">

          {/* General */}
          <div>
            <div className="form-section-title--mb">General</div>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">Rule Name *</label>
                <input className="form-input" value={form.name} onChange={set('name')} required placeholder="e.g. High CPU" />
              </div>
              <div className="form-field">
                <label className="form-label">Device</label>
                <select className="form-select" value={form.device_id} onChange={set('device_id')}>
                  <option value="">All devices (global)</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.hostname} ({d.ip_address})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">Description</label>
              <textarea className="form-textarea form-textarea--sm" value={form.description} onChange={set('description')} placeholder="Optional description..." />
            </div>
          </div>

          {/* Metric & Condition */}
          <div className="form-divider">
            <div className="form-section-title--mb">Metric &amp; Condition</div>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">Metric *</label>
                <select className="form-select" value={form.metric} onChange={set('metric')}>
                  {METRICS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Condition *</label>
                <select className="form-select" value={form.condition} onChange={set('condition')}>
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div className="form-divider">
            <div className="form-section-title--mb">Thresholds</div>
            {binary ? (
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="form-label">Threshold *</label>
                  <input className="form-input" type="number" step="any" value={form.threshold} onChange={set('threshold')} required placeholder="0.5" />
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
            ) : (
              <div className="form-grid-2">
                <div className="form-field">
                  <label className="form-label">Warning Threshold</label>
                  <input className="form-input" type="number" step="any" value={form.warning_threshold} onChange={set('warning_threshold')} placeholder="e.g. 80" />
                  <span className="form-hint">Triggers a warning alert</span>
                </div>
                <div className="form-field">
                  <label className="form-label">Critical Threshold</label>
                  <input className="form-input" type="number" step="any" value={form.critical_threshold} onChange={set('critical_threshold')} placeholder="e.g. 95" />
                  <span className="form-hint">Triggers a critical alert</span>
                </div>
              </div>
            )}
            {!binary && !form.warning_threshold && !form.critical_threshold && (
              <p className="form-error">Set at least one threshold (warning or critical)</p>
            )}
          </div>

          {/* Timing */}
          <div className="form-divider">
            <div className="form-section-title--mb">Timing</div>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">Cooldown (minutes)</label>
                <input className="form-input" type="number" min="0" value={form.cooldown_minutes} onChange={set('cooldown_minutes')} />
                <span className="form-hint">Min time between repeated alerts</span>
              </div>
              <div className="form-field">
                <label className="form-label">Duration (seconds)</label>
                <input className="form-input" type="number" min="0" value={form.duration_seconds} onChange={set('duration_seconds')} />
                <span className="form-hint">How long condition must persist</span>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="form-divider">
            <div className="form-section-title--mb">
              Notifications <span className="form-section-hint">(optional)</span>
            </div>
            <div className="form-grid-2">
              <div className="form-field">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.notification_email} onChange={set('notification_email')} placeholder="alerts@company.com" />
              </div>
              <div className="form-field">
                <label className="form-label">Webhook URL</label>
                <input className="form-input" value={form.notification_webhook} onChange={set('notification_webhook')} placeholder="https://hooks.slack.com/..." />
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="modal-footer">
        <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending && <Loader2 size={13} className="animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
