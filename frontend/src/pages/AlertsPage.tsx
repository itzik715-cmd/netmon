import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '../services/api'
import { AlertEvent, AlertRule } from '../types'
import { CheckCircle, XCircle, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddAlertRuleModal from '../components/forms/AddAlertRuleModal'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>Alerts</h1>
          <p>Monitor and manage alert events and rules</p>
        </div>
        {isOperator && tab === 'rules' && (
          <button onClick={() => setShowAddRule(true)} className="btn btn-primary btn-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 13, height: 13 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
                      <td style={{ maxWidth: 280 }}><p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{event.message}</p></td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{event.metric_value?.toFixed(2)} / {event.threshold_value?.toFixed(2)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-light)' }}>{formatDistanceToNow(new Date(event.triggered_at), { addSuffix: true })}</td>
                      <td>
                        {isOperator && event.status === 'open' && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => ackMutation.mutate(event.id)} style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-orange)', display: 'flex' }} title="Acknowledge"><CheckCircle size={13} /></button>
                            <button onClick={() => resolveMutation.mutate(event.id)} style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-green)', display: 'flex' }} title="Resolve"><XCircle size={13} /></button>
                          </div>
                        )}
                        {isOperator && event.status === 'acknowledged' && (
                          <button onClick={() => resolveMutation.mutate(event.id)} style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-green)', display: 'flex' }} title="Resolve"><XCircle size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(!events || events.length === 0) && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>No alerts found</td></tr>
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
                <tr><th>Name</th><th>Metric</th><th>Condition</th><th>Threshold</th><th>Severity</th><th>Active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {(rules || []).map((rule) => (
                  <tr key={rule.id}>
                    <td style={{ fontWeight: 600 }}>{rule.name}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>{rule.metric}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{rule.condition}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{rule.threshold}</td>
                    <td>{severityTag(rule.severity)}</td>
                    <td>
                      {isOperator ? (
                        <button onClick={() => toggleRuleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                          style={{ position: 'relative', display: 'inline-flex', height: 20, width: 36, borderRadius: 10, cursor: 'pointer', border: 'none', background: rule.is_active ? 'var(--primary)' : '#cbd5e1', transition: 'background 0.2s' }}>
                          <span style={{ position: 'absolute', top: 2, left: rule.is_active ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                        </button>
                      ) : (
                        <span className={rule.is_active ? 'tag-green' : 'tag-gray'}>{rule.is_active ? 'Active' : 'Off'}</span>
                      )}
                    </td>
                    <td>
                      {user?.role === 'admin' && (
                        <button onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteRuleMutation.mutate(rule.id) }}
                          style={{ padding: '4px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent-red)', display: 'flex' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(!rules || rules.length === 0) && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>No alert rules configured</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddRule && <AddAlertRuleModal onClose={() => setShowAddRule(false)} />}
    </div>
  )
}
