import { useState, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../../services/api'
import { Device } from '../../types'
import { X, Loader2, CheckCircle, AlertCircle, Settings, Plus } from 'lucide-react'
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
    flow_enabled: device.flow_enabled ?? false,
    is_active: device.is_active,
    description: device.description ?? '',
    api_username: device.api_username ?? '',
    api_password: '',          // never pre-filled for security
    api_port: String(device.api_port ?? 443),
    api_protocol: device.api_protocol ?? 'https',
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [showNewLocation, setShowNewLocation] = useState(false)
  const [newDc, setNewDc] = useState('')
  const [newRack, setNewRack] = useState('')
  const [creatingLoc, setCreatingLoc] = useState(false)

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => devicesApi.locations().then((r) => r.data),
  })

  const handleCreateLocation = async () => {
    if (!newDc.trim() || !newRack.trim()) { toast.error('Enter both Datacenter and Rack'); return }
    setCreatingLoc(true)
    try {
      const res = await devicesApi.createLocation({ datacenter: newDc.trim(), rack: newRack.trim() })
      qc.invalidateQueries({ queryKey: ['locations'] })
      setForm(p => ({ ...p, location_id: String(res.data.id) }))
      setShowNewLocation(false)
      setNewDc('')
      setNewRack('')
      toast.success(`Location ${res.data.name} created`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Failed to create location')
    } finally {
      setCreatingLoc(false)
    }
  }

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
      flow_enabled: form.flow_enabled,
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
      <div className="modal-content modal-content--xl">
        <div className="modal-header">
          <Settings size={16} className="modal-header__icon" />
          <h3>Device Settings — {device.hostname}</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body--scroll-lg">
            <div className="form-stack--lg">

              {/* -- General -- */}
              <div>
                <div className="form-section-title--mb">General</div>
                <div className="form-grid-2">
                  <div className="form-field">
                    <label className="form-label">Hostname *</label>
                    <input className="form-input" value={form.hostname} onChange={set('hostname')} required />
                  </div>
                  <div className="form-field">
                    <label className="form-label">IP Address *</label>
                    <input className="form-input" value={form.ip_address} onChange={set('ip_address')}
                      pattern="\d+\.\d+\.\d+\.\d+" placeholder="192.168.1.1" required />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Device Type</label>
                    <select className="form-select" value={form.device_type} onChange={set('device_type')}>
                      <option value="">Select type...</option>
                      {['spine', 'leaf', 'tor', 'router', 'switch', 'firewall', 'server', 'other'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Network Layer</label>
                    <select className="form-select" value={form.layer} onChange={set('layer')}>
                      <option value="">Select layer...</option>
                      {['L2', 'L3', 'L2/L3'].map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Vendor</label>
                    <input className="form-input" value={form.vendor} onChange={set('vendor')} placeholder="Cisco, Arista..." />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Model</label>
                    <input className="form-input" value={form.model} onChange={set('model')} placeholder="Nexus 9000..." />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Location</label>
                    <div className="form-inline-row">
                      <select className="form-select form-inline-grow" value={form.location_id} onChange={set('location_id')}>
                        <option value="">No location</option>
                        {(locations || []).map((l: any) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-outline btn-sm form-inline-fixed" title="New Location"
                        onClick={() => setShowNewLocation(v => !v)}>
                        <Plus size={14} />
                      </button>
                    </div>
                    {showNewLocation && (
                      <div className="form-inline-row--end">
                        <div className="form-inline-grow">
                          <label className="form-label--xs">Datacenter</label>
                          <input className="form-input" placeholder="IL-PT" value={newDc} onChange={e => setNewDc(e.target.value)} />
                        </div>
                        <div className="form-inline-grow">
                          <label className="form-label--xs">Rack / Cabinet</label>
                          <input className="form-input" placeholder="Z34" value={newRack} onChange={e => setNewRack(e.target.value)} />
                        </div>
                        <button type="button" className="btn btn-primary btn-sm form-inline-fixed" onClick={handleCreateLocation}
                          disabled={creatingLoc}>
                          {creatingLoc ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="form-field">
                    <label className="form-label">Poll Interval (seconds)</label>
                    <input className="form-input" type="number" min="10" value={form.poll_interval} onChange={set('poll_interval')} />
                  </div>
                </div>
                <div className="form-field">
                  <label className="form-label">Description</label>
                  <textarea className="form-textarea form-textarea--sm"
                    value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                </div>
              </div>

              {/* -- Status toggles -- */}
              <div className="form-divider">
                <div className="form-section-title--mb">Status</div>
                <div className="toggle-group">
                  <label className="checkbox-row">
                    <input type="checkbox" checked={form.polling_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, polling_enabled: e.target.checked }))} />
                    Polling enabled
                  </label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={form.flow_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, flow_enabled: e.target.checked }))} />
                    Flow collection (sFlow / NetFlow)
                  </label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={form.is_active}
                      onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
                    Device active
                  </label>
                </div>
              </div>

              {/* -- SNMP -- */}
              <div className="form-divider">
                <div className="form-section-header">
                  <div className="form-section-title">SNMP Configuration</div>
                  <button type="button" onClick={handleTest} disabled={testing || !form.ip_address}
                    className="btn btn-outline btn-sm">
                    {testing ? <><Loader2 size={12} className="animate-spin" /> Testing...</> : 'Test Connection'}
                  </button>
                </div>

                {testResult && (
                  <div className={testResult.success ? 'test-success' : 'test-error'}>
                    <div className="flex-row-gap">
                      {testResult.success
                        ? <CheckCircle size={14} className="text-success" />
                        : <AlertCircle size={14} />}
                      <div className="text-sm">
                        {testResult.success ? (
                          <>
                            <strong>SNMP OK</strong>
                            {testResult.sys_name && <> — <span className="mono">{testResult.sys_name}</span></>}
                            {testResult.sys_descr && (
                              <div className="text-muted text-xs">
                                {testResult.sys_descr.slice(0, 120)}{testResult.sys_descr.length > 120 ? '...' : ''}
                              </div>
                            )}
                          </>
                        ) : (
                          <strong>
                            SNMP unreachable — check IP, community string, and ACLs
                          </strong>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="form-grid-3">
                  <div className="form-field">
                    <label className="form-label">SNMP Version</label>
                    <select className="form-select" value={form.snmp_version} onChange={set('snmp_version')}>
                      <option value="1">v1</option>
                      <option value="2c">v2c</option>
                      <option value="3">v3</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Community / Username</label>
                    <input className="form-input" value={form.snmp_community} onChange={set('snmp_community')}
                      placeholder={form.snmp_community ? undefined : 'public'} />
                  </div>
                  <div className="form-field">
                    <label className="form-label">SNMP Port</label>
                    <input className="form-input" type="number" value={form.snmp_port} onChange={set('snmp_port')} />
                  </div>
                </div>
              </div>

              {/* -- API credentials -- */}
              <div className="form-divider">
                <div className="form-section-title--mb">
                  Arista eAPI Credentials{' '}
                  <span className="form-section-hint">(optional)</span>
                </div>
                <div className="form-grid-4">
                  <div className="form-field">
                    <label className="form-label">Protocol</label>
                    <select className="form-select" value={form.api_protocol} onChange={set('api_protocol')}>
                      <option value="https">HTTPS</option>
                      <option value="http">HTTP</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">API Port</label>
                    <input className="form-input" type="number" value={form.api_port} onChange={set('api_port')} />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Username</label>
                    <input className="form-input" value={form.api_username} onChange={set('api_username')} placeholder="admin" />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Password</label>
                    <input className="form-input" type="password" value={form.api_password} onChange={set('api_password')}
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
