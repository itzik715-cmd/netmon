import { useState, FormEvent } from 'react'
import { X, Loader2, Wifi, CheckCircle } from 'lucide-react'
import { devicesApi } from '../../services/api'
import { SubnetScanResult } from '../../types'

export default function ScanSubnetModal({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [form, setForm] = useState({
    subnet: '',
    snmp_community: 'public',
    snmp_version: '2c',
    snmp_port: '161',
    device_type: '',
    layer: '',
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SubnetScanResult | null>(null)
  const [error, setError] = useState('')

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const response = await devicesApi.scanSubnet({
        ...form,
        snmp_port: parseInt(form.snmp_port),
        device_type: form.device_type || undefined,
        layer: form.layer || undefined,
      })
      setResult(response.data)
      onDone?.()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Scan Subnet</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit}>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">Subnet (CIDR) *</label>
                <input
                  className="input"
                  placeholder="192.168.1.0/24"
                  value={form.subnet}
                  onChange={set('subnet')}
                  required
                  pattern="\d+\.\d+\.\d+\.\d+\/\d+"
                />
                <p style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
                  e.g. 192.168.1.0/24 — scans all hosts in the range
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label className="label">SNMP Version</label>
                  <select className="select" value={form.snmp_version} onChange={set('snmp_version')}>
                    <option value="1">v1</option>
                    <option value="2c">v2c</option>
                  </select>
                </div>
                <div>
                  <label className="label">Community</label>
                  <input className="input" value={form.snmp_community} onChange={set('snmp_community')} />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" type="number" value={form.snmp_port} onChange={set('snmp_port')} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="label">Device Type (optional)</label>
                  <select className="select" value={form.device_type} onChange={set('device_type')}>
                    <option value="">Auto-detect</option>
                    {['router', 'switch', 'firewall', 'spine', 'leaf', 'tor', 'server', 'other'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Layer (optional)</label>
                  <select className="select" value={form.layer} onChange={set('layer')}>
                    <option value="">Unknown</option>
                    <option value="L2">L2</option>
                    <option value="L3">L3</option>
                    <option value="L2/L3">L2/L3</option>
                  </select>
                </div>
              </div>

              {error && <div className="alert-error">{error}</div>}

              <div style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text-main)' }}>What happens:</strong> Each IP in the subnet is probed via SNMP (1s timeout). Responsive devices are automatically added to the inventory. Device name, vendor, and interfaces are discovered in the background.
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
              <button type="submit" disabled={loading} className="btn btn-primary">
                {loading ? <><Loader2 size={13} className="animate-spin" /> Scanning...</> : <><Wifi size={13} /> Start Scan</>}
              </button>
            </div>
          </form>
        ) : (
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-green)' }}>
              <CheckCircle size={20} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Scan Complete</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Subnet', value: result.subnet },
                { label: 'Total Hosts', value: result.total_hosts },
                { label: 'Responsive', value: result.responsive, color: result.responsive > 0 ? 'var(--primary)' : 'var(--text-muted)' },
                { label: 'New Devices Added', value: result.new_devices, color: result.new_devices > 0 ? 'var(--accent-green)' : 'var(--text-muted)' },
                { label: 'Already in Inventory', value: result.existing_devices },
              ].map((item) => (
                <div key={item.label} className="info-card" style={{ padding: '10px 14px' }}>
                  <div className="stat-label">{item.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: (item as any).color || 'var(--text-main)', marginTop: 4 }}>{item.value}</div>
                </div>
              ))}
            </div>

            {result.ips_found.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Discovered IPs</div>
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', maxHeight: 160, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {result.ips_found.map((ip) => (
                    <span key={ip} className="tag-blue" style={{ fontFamily: 'DM Mono, monospace' }}>{ip}</span>
                  ))}
                </div>
              </div>
            )}

            {result.new_devices > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                New devices are being enriched (name, vendor, interfaces) in the background.
              </div>
            )}

            <div className="modal-footer" style={{ paddingTop: 0, borderTop: 'none' }}>
              <button onClick={onClose} className="btn btn-primary">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
