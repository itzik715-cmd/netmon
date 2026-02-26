import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { alertsApi, devicesApi } from '../../services/api'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import AlertRuleForm, { buildPayload } from './AlertRuleForm'

export default function AddAlertRuleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()

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
    onError: () => toast.error('Failed to create rule'),
  })

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content modal-content--md">
        <div className="modal-header">
          <h3>Create Alert Rule</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>
        <AlertRuleForm
          devices={devices || []}
          onSubmit={(data) => mutation.mutate(buildPayload(data))}
          isPending={mutation.isPending}
          submitLabel="Create Rule"
          onCancel={onClose}
        />
      </div>
    </div>
  )
}
