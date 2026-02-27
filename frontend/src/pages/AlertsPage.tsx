import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '../services/api'
import { AlertEvent, AlertRule } from '../types'
import { ShieldAlert, Plus, Check, XCircle, Trash2, Loader2, Pencil } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddAlertRuleModal from '../components/forms/AddAlertRuleModal'
import EditAlertRuleModal from '../components/forms/EditAlertRuleModal'

type Tab = 'events' | 'rules'

function severityTag(severity: string) {
  const map: Record<string, string> = { critical: 'tag-red', warning: 'tag-orange', info: 'tag-blue' }
  return <span className={map[severity] || 'tag-gray'}>{severity}</span>
}

function statusTag(status: string) {
  const map: Record<string, string> = { open: 'tag-red', acknowledged: 'tag-orange', resolved: 'tag-green' }
  return <span className={map[status] || 'tag-gray'}>{status}</span>
}

export default function AlertsPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('events')
  const [statusFilter, setStatusFilter] = useState('open')
  const [showAddRule, setShowAddRule] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
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
    onSuccess: () => { toast.success('Alert acknowledged'); qc.invalidateQueries({ queryKey: ['alert-events'] }) },
  })
  const resolveMutation = useMutation({
    mutationFn: (id: number) => alertsApi.resolve(id),
    onSuccess: () => { toast.success('Alert resolved'); qc.invalidateQueries({ queryKey: ['alert-events'] }) },
  })
  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => alertsApi.deleteRule(id),
    onSuccess: () => { toast.success('Rule deleted'); qc.invalidateQueries({ queryKey: ['alert-rules'] }) },
  })
  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => alertsApi.updateRule(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  return (
    <div className="content">
      <div className="page-header">
        <div>
          <h1><ShieldAlert size={20} /> Alerts</h1>
          <p>Monitor and manage alert events and rules</p>
        </div>
        {isOperator && tab === 'rules' && (
          <button onClick={() => setShowAddRule(true)} className="btn btn-primary btn-sm">
            <Plus size={13} />
            Add Rule
          </button>
        )}
      </div>

      <div className="tab-bar">
        <button className={`tab-btn${tab === 'events' ? ' active' : ''}`} onClick={() => setTab('events')}>Alert Events</button>
        <button className={`tab-btn${tab === 'rules' ? ' active' : ''}`} onClick={() => setTab('rules')}>Alert Rules</button>
      </div>

      {tab === 'events' && (
        <>
          <div className="filter-chips">
            {[{ val: 'open', label: 'Open' }, { val: 'acknowledged', label: 'Acknowledged' }, { val: 'resolved', label: 'Resolved' }, { val: '', label: 'All' }].map(({ val, label }) => (
              <button key={val} onClick={() => setStatusFilter(val)} className={`filter-chip${statusFilter === val ? ' active' : ''}`}>{label}</button>
            ))}
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Severity</th><th>Status</th><th>Message</th><th>Metric / Threshold</th><th>Triggered</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {(events || []).map((event) => (
                    <tr key={event.id}>
                      <td>{severityTag(event.severity)}</td>
                      <td>{statusTag(event.status)}</td>
                      <td><p className="truncate">{event.message}</p></td>
                      <td className="mono">{event.metric_value?.toFixed(2)} / {event.threshold_value?.toFixed(2)}</td>
                      <td>{formatDistanceToNow(new Date(event.triggered_at), { addSuffix: true })}</td>
                      <td>
                        {isOperator && event.status === 'open' && (
                          <div className="card__actions">
                            <button onClick={() => ackMutation.mutate(event.id)} className="btn btn-outline btn--icon btn-sm" title="Acknowledge">
                              {ackMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            </button>
                            <button onClick={() => resolveMutation.mutate(event.id)} className="btn btn-outline btn--icon btn-sm" title="Resolve">
                              {resolveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                            </button>
                          </div>
                        )}
                        {isOperator && event.status === 'acknowledged' && (
                          <button onClick={() => resolveMutation.mutate(event.id)} className="btn btn-outline btn--icon btn-sm" title="Resolve">
                            {resolveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(!events || events.length === 0) && (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <div className="empty-state__icon"><ShieldAlert /></div>
                          <div className="empty-state__title">No alerts found</div>
                          <div className="empty-state__description">No alert events match the current filter.</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'rules' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Target</th><th>Metric</th><th>Condition</th><th>Thresholds</th><th>Active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {(rules || []).map((rule) => {
                  const hasMulti = rule.warning_threshold != null || rule.critical_threshold != null
                  const target = rule.device_hostname
                    ? rule.interface_name
                      ? `${rule.device_hostname} → ${rule.interface_name}`
                      : rule.device_hostname
                    : 'All devices'
                  return (
                    <tr key={rule.id}>
                      <td><strong>{rule.name}</strong>{rule.description && <div className="text-muted text-xs">{rule.description}</div>}</td>
                      <td><span className="text-sm">{target}</span></td>
                      <td className="mono">{rule.metric}</td>
                      <td className="mono">{rule.condition}</td>
                      <td className="mono">
                        {hasMulti ? (
                          <div className="threshold-multi">
                            {rule.warning_threshold != null && <span className="tag-orange">warn: {rule.warning_threshold}</span>}
                            {rule.critical_threshold != null && <span className="tag-red">crit: {rule.critical_threshold}</span>}
                          </div>
                        ) : (
                          <>{rule.threshold} {severityTag(rule.severity)}</>
                        )}
                      </td>
                      <td>
                        {isOperator ? (
                          <button
                            onClick={() => toggleRuleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                            className={`toggle${rule.is_active ? ' toggle--active' : ''}`}
                          >
                            <span className="toggle__knob" />
                          </button>
                        ) : (
                          <span className={rule.is_active ? 'tag-green' : 'tag-gray'}>{rule.is_active ? 'Active' : 'Off'}</span>
                        )}
                      </td>
                      <td>
                        <div className="card__actions">
                          {isOperator && (
                            <button
                              onClick={() => setEditingRule(rule)}
                              className="btn btn-outline btn--icon btn-sm"
                              title="Edit rule"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteRuleMutation.mutate(rule.id) }}
                              className="btn btn-outline btn--icon btn-sm btn-danger"
                              title="Delete rule"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {(!rules || rules.length === 0) && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <div className="empty-state__icon"><ShieldAlert /></div>
                        <div className="empty-state__title">No alert rules configured</div>
                        <div className="empty-state__description">Create a rule to start monitoring.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddRule && <AddAlertRuleModal onClose={() => setShowAddRule(false)} />}
      {editingRule && <EditAlertRuleModal rule={editingRule} onClose={() => setEditingRule(null)} />}
    </div>
  )
}
