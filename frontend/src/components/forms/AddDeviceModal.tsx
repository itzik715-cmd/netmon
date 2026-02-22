import { useState, FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { devicesApi } from '../../services/api'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

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
  })

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      ...form,
      location_id: form.location_id ? parseInt(form.location_id) : undefined,
      snmp_port: parseInt(form.snmp_port),
      poll_interval: parseInt(form.poll_interval),
    })
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <h3>Add Device</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
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

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="form-section-title" style={{ marginBottom: 10 }}>SNMP Configuration</div>
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
