import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '../services/api'
import { AlertEvent, AlertRule } from '../types'
import { Bell, Plus, CheckCircle, XCircle, Settings, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddAlertRuleModal from '../components/forms/AddAlertRuleModal'

type Tab = 'events' | 'rules'

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    critical: 'badge-danger', warning: 'badge-warning', info: 'badge-info',
  }
  return <span className={map[severity] || 'badge-gray'}>{severity}</span>
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    open: 'badge-danger', acknowledged: 'badge-warning', resolved: 'badge-success',
  }
  return <span className={map[status] || 'badge-gray'}>{status}</span>
}

export default function AlertsPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('events')
  const [statusFilter, setStatusFilter] = useState('open')
  const [showAddRule, setShowAddRule] = useState(false)
  const isOperator = user?.role === 'admin' || user?.role === 'operator'

  const { data: events } = useQuery({
    queryKey: ['alert-events', statusFilter],
    queryFn: () => alertsApi.listEvents({ status: statusFilter || undefined, limit: 100 }).then((r) => r.data as AlertEvent[]),
    refetchInterval: 30_000,
  })

  const { data: rules } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => alertsApi.listRules().then((r) => r.data as AlertRule[]),
  })

  const ackMutation = useMutation({
    mutationFn: (id: number) => alertsApi.acknowledge(id),
    onSuccess: () => {
      toast.success('Alert acknowledged')
      qc.invalidateQueries({ queryKey: ['alert-events'] })
    },
  })

  const resolveMutation = useMutation({
    mutationFn: (id: number) => alertsApi.resolve(id),
    onSuccess: () => {
      toast.success('Alert resolved')
      qc.invalidateQueries({ queryKey: ['alert-events'] })
    },
  })

  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => alertsApi.deleteRule(id),
    onSuccess: () => {
      toast.success('Rule deleted')
      qc.invalidateQueries({ queryKey: ['alert-rules'] })
    },
  })

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      alertsApi.updateRule(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitor and manage alerts</p>
        </div>
        {isOperator && tab === 'rules' && (
          <button
            onClick={() => setShowAddRule(true)}
            className="btn-primary btn-sm flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Rule
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {(['events', 'rules'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'events' ? 'Alert Events' : 'Alert Rules'}
          </button>
        ))}
      </div>

      {tab === 'events' && (
        <>
          <div className="flex gap-2">
            {['open', 'acknowledged', 'resolved', ''].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === s ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Message</th>
                  <th>Metric Value</th>
                  <th>Triggered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(events || []).map((event) => (
                  <tr key={event.id}>
                    <td>{severityBadge(event.severity)}</td>
                    <td>{statusBadge(event.status)}</td>
                    <td className="max-w-xs">
                      <p className="truncate text-sm">{event.message}</p>
                    </td>
                    <td className="font-mono text-sm">
                      {event.metric_value?.toFixed(2)} / {event.threshold_value?.toFixed(2)}
                    </td>
                    <td className="text-gray-400 text-xs">
                      {formatDistanceToNow(new Date(event.triggered_at), { addSuffix: true })}
                    </td>
                    <td>
                      {isOperator && event.status === 'open' && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => ackMutation.mutate(event.id)}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                            title="Acknowledge"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => resolveMutation.mutate(event.id)}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Resolve"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      {isOperator && event.status === 'acknowledged' && (
                        <button
                          onClick={() => resolveMutation.mutate(event.id)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Resolve"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!events || events.length === 0) && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">
                      No alerts found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'rules' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Metric</th>
                <th>Condition</th>
                <th>Threshold</th>
                <th>Severity</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(rules || []).map((rule) => (
                <tr key={rule.id}>
                  <td className="font-medium">{rule.name}</td>
                  <td className="font-mono text-sm text-gray-500">{rule.metric}</td>
                  <td className="font-mono text-sm">{rule.condition}</td>
                  <td className="font-mono text-sm">{rule.threshold}</td>
                  <td>{severityBadge(rule.severity)}</td>
                  <td>
                    {isOperator ? (
                      <button
                        onClick={() => toggleRuleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${rule.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow mt-0.5 transition-transform ${rule.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    ) : (
                      <span className={rule.is_active ? 'badge-success' : 'badge-gray'}>
                        {rule.is_active ? 'Yes' : 'No'}
                      </span>
                    )}
                  </td>
                  <td>
                    {user?.role === 'admin' && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete rule "${rule.name}"?`)) {
                            deleteRuleMutation.mutate(rule.id)
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(!rules || rules.length === 0) && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No alert rules configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAddRule && <AddAlertRuleModal onClose={() => setShowAddRule(false)} />}
    </div>
  )
}
