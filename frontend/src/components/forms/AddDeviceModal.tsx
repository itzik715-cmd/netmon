import { useState, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../../services/api'
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

type TestResult = { success: boolean; sys_name?: string; sys_descr?: string }

export default function AddDeviceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    hostname: '',
    ip_address: '',
    device_type: '',
    layer: '',
    vendor: '',
    model: '',
    location_id: '',
    snmp_community: 'public',
    snmp_version: '2c',
    snmp_port: '161',
    poll_interval: '60',
    description: '',
    api_username: '',
    api_password: '',
    api_port: '443',
    api_protocol: 'https',
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => devicesApi.locations().then((r) => r.data),
  })

  const mutation = useMutation({
    mutationFn: (data: object) => devicesApi.create(data),
    onSuccess: () => {
      toast.success('Device added successfully')
      qc.invalidateQueries({ queryKey: ['devices'] })
      onClose()
    },
  })

  const handleTest = async () => {
    if (!form.ip_address) {
      toast.error('Enter an IP address first')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await devicesApi.testSnmp({
        hostname: form.ip_address,
        ip_address: form.ip_address,
        snmp_community: form.snmp_community,
        snmp_version: form.snmp_version,
        snmp_port: parseInt(form.snmp_port) || 161,
      })
      const result: TestResult = r.data
      setTestResult(result)
      if (result.success) {
        toast.success('SNMP reachable!')
        // Auto-fill hostname from sysName if still empty or same as IP
        if (result.sys_name && (!form.hostname || form.hostname === form.ip_address)) {
          setForm((p) => ({ ...p, hostname: result.sys_name! }))
        }
        // Auto-detect vendor from sysDescr
        if (result.sys_descr && !form.vendor) {
          const descr = result.sys_descr.toLowerCase()
          const vendorMap: [string, string][] = [
            ['arista', 'Arista'], ['cisco', 'Cisco'], ['juniper', 'Juniper'],
            ['junos', 'Juniper'], ['mikrotik', 'MikroTik'], ['huawei', 'Huawei'],
            ['fortinet', 'Fortinet'], ['palo alto', 'Palo Alto'], ['aruba', 'HP/Aruba'],
          ]
          const matched = vendorMap.find(([k]) => descr.includes(k))
          if (matched) setForm((p) => ({ ...p, vendor: matched[1] }))
        }
      }
    } catch (err: any) {
      setTestResult({ success: false })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      ...form,
      location_id: form.location_id ? parseInt(form.location_id) : undefined,
      snmp_port: parseInt(form.snmp_port),
      poll_interval: parseInt(form.poll_interval),
      api_port: parseInt(form.api_port),
      api_username: form.api_username || undefined,
      api_password: form.api_password || undefined,
    })
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [key]: e.target.value }))
    if (['ip_address', 'snmp_community', 'snmp_version', 'snmp_port'].includes(key)) {
      setTestResult(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <h3>Add Device</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

              {/* SNMP Section */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div className="form-section-title">SNMP Configuration</div>
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing || !form.ip_address}
                    className="btn btn-outline btn-sm"
                  >
                    {testing
                      ? <><Loader2 size={12} className="animate-spin" /> Testing...</>
                      : 'Test Connection'}
                  </button>
                </div>

                {testResult && (
                  <div style={{
                    marginBottom: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
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
                          SNMP unreachable — check IP, community string, and that the device allows SNMP from this host
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
                    <input className="input" value={form.snmp_community} onChange={set('snmp_community')} />
                  </div>
                  <div>
                    <label className="label">SNMP Port</label>
                    <input className="input" type="number" value={form.snmp_port} onChange={set('snmp_port')} />
                  </div>
                </div>
              </div>

              {/* Arista eAPI Section */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="form-section-title" style={{ marginBottom: 10 }}>
                  Arista eAPI Credentials{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 11 }}>(optional)</span>
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
                    <input className="input" type="password" value={form.api_password} onChange={set('api_password')} />
                  </div>
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  style={{ height: 72, resize: 'none' }}
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary">
              {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Add Device
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
