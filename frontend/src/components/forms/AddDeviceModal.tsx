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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3>Add Device</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
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

            <div className="border-t border-gray-200 pt-4">
              <div className="text-sm font-semibold text-gray-600 mb-3">SNMP Configuration</div>
              <div className="grid grid-cols-3 gap-4">
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
                className="input h-20 resize-none"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Device
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
