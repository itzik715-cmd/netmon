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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3>Create Alert Rule</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="label">Rule Name *</label>
              <input className="input" value={form.name} onChange={set('name')} required placeholder="High CPU Alert" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Device (optional)</label>
                <select className="select" value={form.device_id} onChange={set('device_id')}>
                  <option value="">All devices</option>
                  {(devices || []).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.hostname}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Metric *</label>
                <select className="select" value={form.metric} onChange={set('metric')} required>
                  <option value="">Select metric...</option>
                  {METRICS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Condition *</label>
                <select className="select" value={form.condition} onChange={set('condition')}>
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Threshold *</label>
                <input className="input" type="number" step="any" value={form.threshold} onChange={set('threshold')} required placeholder="80" />
              </div>
              <div>
                <label className="label">Severity</label>
                <select className="select" value={form.severity} onChange={set('severity')}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Duration (seconds)</label>
                <input className="input" type="number" min="0" value={form.duration_seconds} onChange={set('duration_seconds')} />
                <p className="text-xs text-gray-400 mt-1">Trigger only if sustained for this long</p>
              </div>
              <div>
                <label className="label">Cooldown (minutes)</label>
                <input className="input" type="number" min="1" value={form.cooldown_minutes} onChange={set('cooldown_minutes')} />
              </div>
            </div>

            <div>
              <label className="label">Notification Email</label>
              <input className="input" type="email" value={form.notification_email} onChange={set('notification_email')} placeholder="alerts@company.com" />
            </div>

            <div>
              <label className="label">Webhook URL</label>
              <input className="input" value={form.notification_webhook} onChange={set('notification_webhook')} placeholder="https://..." />
            </div>
          </div>

          <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Rule
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
