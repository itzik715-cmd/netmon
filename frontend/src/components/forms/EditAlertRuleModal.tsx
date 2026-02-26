import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { alertsApi, devicesApi } from '../../services/api'
import { AlertRule } from '../../types'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import AlertRuleForm, { AlertRuleFormState, buildPayload } from './AlertRuleForm'

export default function EditAlertRuleModal({ rule, onClose }: { rule: AlertRule; onClose: () => void }) {
  const qc = useQueryClient()

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  })

  const mutation = useMutation({
    mutationFn: (data: object) => alertsApi.updateRule(rule.id, data),
    onSuccess: () => {
      toast.success('Alert rule updated')
      qc.invalidateQueries({ queryKey: ['alert-rules'] })
      onClose()
    },
    onError: () => toast.error('Failed to update rule'),
  })

  const initialValues: Partial<AlertRuleFormState> = {
    name: rule.name,
    description: rule.description || '',
    device_id: rule.device_id ? String(rule.device_id) : '',
    metric: rule.metric,
    condition: rule.condition,
    threshold: rule.threshold != null ? String(rule.threshold) : '',
    severity: rule.severity,
    warning_threshold: rule.warning_threshold != null ? String(rule.warning_threshold) : '',
    critical_threshold: rule.critical_threshold != null ? String(rule.critical_threshold) : '',
    cooldown_minutes: String(rule.cooldown_minutes ?? 15),
    duration_seconds: String(rule.duration_seconds ?? 0),
    notification_email: rule.notification_email || '',
    notification_webhook: rule.notification_webhook || '',
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content modal-content--md">
        <div className="modal-header">
          <h3>Edit Alert Rule — {rule.name}</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>
        <AlertRuleForm
          devices={devices || []}
          onSubmit={(data) => mutation.mutate(buildPayload(data))}
          isPending={mutation.isPending}
          submitLabel="Save Changes"
          onCancel={onClose}
          initialValues={initialValues}
        />
      </div>
    </div>
  )
}
