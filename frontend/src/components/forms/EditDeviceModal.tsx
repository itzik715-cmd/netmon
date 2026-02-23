import { useState, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../../services/api'
import { Device } from '../../types'
import { X, Loader2, CheckCircle, AlertCircle, Settings } from 'lucide-react'
import toast from 'react-hot-toast'

type TestResult = { success: boolean; sys_name?: string; sys_descr?: string }

export default function EditDeviceModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    hostname: device.hostname ?? '',
    ip_address: device.ip_address ?? '',
    device_type: device.device_type ?? '',
    layer: device.layer ?? '',
    vendor: device.vendor ?? '',
    model: device.model ?? '',
    location_id: device.location ? String(device.location.id) : '',
    snmp_community: device.snmp_community ?? '',
    snmp_version: device.snmp_version ?? '2c',
    snmp_port: String(device.snmp_port ?? 161),
    poll_interval: String(device.poll_interval ?? 60),
    polling_enabled: device.polling_enabled,
    is_active: device.is_active,
    description: device.description ?? '',
    api_username: device.api_username ?? '',
    api_password: '',          // never pre-filled for security
    api_port: String(device.api_port ?? 443),
    api_protocol: device.api_protocol ?? 'https',
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => devicesApi.locations().then((r) => r.data),
  })

  const mutation = useMutation({
    mutationFn: (data: object) => devicesApi.update(device.id, data),
    onSuccess: () => {
      toast.success('Device updated')
      qc.invalidateQueries({ queryKey: ['device', device.id] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      onClose()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? 'Failed to update device')
    },
  })

  const handleTest = async () => {
    if (!form.ip_address) { toast.error('Enter an IP address first'); return }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await devicesApi.testSnmp({
        hostname: form.ip_address,
        ip_address: form.ip_address,
        snmp_community: form.snmp_community || 'public',
        snmp_version: form.snmp_version,
        snmp_port: parseInt(form.snmp_port) || 161,
      })
      setTestResult(r.data)
      if (r.data.success) toast.success('SNMP reachable!')
    } catch {
      setTestResult({ success: false })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      hostname: form.hostname,
      ip_address: form.ip_address,
      device_type: form.device_type || undefined,
      layer: form.layer || undefined,
      vendor: form.vendor || undefined,
      model: form.model || undefined,
      location_id: form.location_id ? parseInt(form.location_id) : null,
      snmp_community: form.snmp_community || undefined,
      snmp_version: form.snmp_version,
      snmp_port: parseInt(form.snmp_port) || 161,
      poll_interval: parseInt(form.poll_interval) || 60,
      polling_enabled: form.polling_enabled,
      is_active: form.is_active,
      description: form.description || undefined,
      api_protocol: form.api_protocol,
      api_port: parseInt(form.api_port) || 443,
      api_username: form.api_username || undefined,
    }
    // Only send password if the user typed one
    if (form.api_password) payload.api_password = form.api_password
    mutation.mutate(payload)
  }

  const set = (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((p) => ({ ...p, [key]: e.target.value }))
      if (['ip_address', 'snmp_community', 'snmp_version', 'snmp_port'].includes(key)) {
        setTestResult(null)
      }
    }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <Settings size={16} style={{ color: 'var(--text-muted)' }} />
          <h3>Device Settings — {device.hostname}</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '74vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* ── General ── */}
              <div>
                <div className="form-section-title" style={{ marginBottom: 10 }}>General</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="label">Hostname *</label>
                    <input className="input" value={form.hostname} onChange={set('hostname')} required />
                  </div>
                  <div>
                    <label className="label">IP Address *</label>
                    <input className="input" value={form.ip_address} onChange={set('ip_address')}
                      pattern="\d+\.\d+\.\d+\.\d+" placeholder="192.168.1.1" required />
                  </div>
                  <div>
                    <label className="label">Device Type</label>
                    <select className="select" value={form.device_type} onChange={set('device_type')}>
                      <option value="">Select type...</option>
                      {['spine', 'leaf', 'tor', 'router', 'switch', 'firewall', 'server', 'other'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Network Layer</label>
                    <select className="select" value={form.layer} onChange={set('layer')}>
                      <option value="">Select layer...</option>
                      {['L2', 'L3', 'L2/L3'].map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Vendor</label>
                    <input className="input" value={form.vendor} onChange={set('vendor')} placeholder="Cisco, Arista..." />
                  </div>
                  <div>
                    <label className="label">Model</label>
                    <input className="input" value={form.model} onChange={set('model')} placeholder="Nexus 9000..." />
                  </div>
                  <div>
                    <label className="label">Location</label>
                    <select className="select" value={form.location_id} onChange={set('location_id')}>
                      <option value="">No location</option>
                      {(locations || []).map((l: any) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Poll Interval (seconds)</label>
                    <input className="input" type="number" min="10" value={form.poll_interval} onChange={set('poll_interval')} />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label className="label">Description</label>
                  <textarea className="input" style={{ height: 64, resize: 'none' }}
                    value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                </div>
              </div>

              {/* ── Status toggles ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="form-section-title" style={{ marginBottom: 10 }}>Status</div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={form.polling_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, polling_enabled: e.target.checked }))} />
                    Polling enabled
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={form.is_active}
                      onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
                    Device active
                  </label>
                </div>
              </div>

              {/* ── SNMP ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div className="form-section-title">SNMP Configuration</div>
                  <button type="button" onClick={handleTest} disabled={testing || !form.ip_address}
                    className="btn btn-outline btn-sm">
                    {testing ? <><Loader2 size={12} className="animate-spin" /> Testing...</> : 'Test Connection'}
                  </button>
                </div>

                {testResult && (
                  <div style={{
                    marginBottom: 10, padding: '8px 12px', borderRadius: 6,
                    background: testResult.success ? 'var(--accent-green-bg, #f0fdf4)' : '#fff1f2',
                    border: `1px solid ${testResult.success ? 'var(--accent-green)' : 'var(--accent-red)'}`,
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                  }}>
                    {testResult.success
                      ? <CheckCircle size={14} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: 2 }} />
                      : <AlertCircle size={14} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 2 }} />}
                    <div style={{ fontSize: 12 }}>
                      {testResult.success ? (
                        <>
                          <strong>SNMP OK</strong>
                          {testResult.sys_name && <> — <span style={{ fontFamily: 'DM Mono, monospace' }}>{testResult.sys_name}</span></>}
                          {testResult.sys_descr && (
                            <div style={{ color: 'var(--text-muted)', marginTop: 2, fontSize: 11 }}>
                              {testResult.sys_descr.slice(0, 120)}{testResult.sys_descr.length > 120 ? '…' : ''}
                            </div>
                          )}
                        </>
                      ) : (
                        <strong style={{ color: 'var(--accent-red)' }}>
                          SNMP unreachable — check IP, community string, and ACLs
                        </strong>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="label">SNMP Version</label>
                    <select className="select" value={form.snmp_version} onChange={set('snmp_version')}>
                      <option value="1">v1</option>
                      <option value="2c">v2c</option>
                      <option value="3">v3</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Community / Username</label>
                    <input className="input" value={form.snmp_community} onChange={set('snmp_community')}
                      placeholder={form.snmp_community ? undefined : 'public'} />
                  </div>
                  <div>
                    <label className="label">SNMP Port</label>
                    <input className="input" type="number" value={form.snmp_port} onChange={set('snmp_port')} />
                  </div>
                </div>
              </div>

              {/* ── API credentials ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="form-section-title" style={{ marginBottom: 10 }}>
                  Arista eAPI Credentials{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="label">Protocol</label>
                    <select className="select" value={form.api_protocol} onChange={set('api_protocol')}>
                      <option value="https">HTTPS</option>
                      <option value="http">HTTP</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">API Port</label>
                    <input className="input" type="number" value={form.api_port} onChange={set('api_port')} />
                  </div>
                  <div>
                    <label className="label">Username</label>
                    <input className="input" value={form.api_username} onChange={set('api_username')} placeholder="admin" />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input className="input" type="password" value={form.api_password} onChange={set('api_password')}
                      placeholder={device.api_username ? '(unchanged)' : ''} />
                  </div>
                </div>
              </div>

            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary">
              {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
