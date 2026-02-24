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
      <div className="modal-content modal-content--md">
        <div className="modal-header">
          <h3>Scan Subnet</h3>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <div className="form-stack">
                <div className="form-field">
                  <label className="form-label">Subnet (CIDR) *</label>
                  <input
                    className="form-input"
                    placeholder="192.168.1.0/24"
                    value={form.subnet}
                    onChange={set('subnet')}
                    required
                    pattern="^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)\/(3[0-2]|[12]?\d)$"
                  />
                  <p className="form-help">
                    e.g. 192.168.1.0/24 — scans all hosts in the range
                  </p>
                </div>

                <div className="form-grid-3">
                  <div className="form-field">
                    <label className="form-label">SNMP Version</label>
                    <select className="form-select" value={form.snmp_version} onChange={set('snmp_version')}>
                      <option value="1">v1</option>
                      <option value="2c">v2c</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Community</label>
                    <input className="form-input" value={form.snmp_community} onChange={set('snmp_community')} />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Port</label>
                    <input className="form-input" type="number" value={form.snmp_port} onChange={set('snmp_port')} />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="form-field">
                    <label className="form-label">Device Type (optional)</label>
                    <select className="form-select" value={form.device_type} onChange={set('device_type')}>
                      <option value="">Auto-detect</option>
                      {['router', 'switch', 'firewall', 'spine', 'leaf', 'tor', 'server', 'other'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Layer (optional)</label>
                    <select className="form-select" value={form.layer} onChange={set('layer')}>
                      <option value="">Unknown</option>
                      <option value="L2">L2</option>
                      <option value="L3">L3</option>
                      <option value="L2/L3">L2/L3</option>
                    </select>
                  </div>
                </div>

                {error && <div className="alert-error">{error}</div>}

                <div className="info-box">
                  <span className="info-box__title">What happens:</span> Each IP in the subnet is probed via SNMP (1s timeout). Responsive devices are automatically added to the inventory. Device name, vendor, and interfaces are discovered in the background.
                </div>
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
          <div className="modal-body">
            <div className="form-stack">
              <div className="scan-complete-header">
                <CheckCircle size={20} />
                <span className="scan-complete-header__text">Scan Complete</span>
              </div>

              <div className="results-grid">
                {[
                  { label: 'Subnet', value: result.subnet },
                  { label: 'Total Hosts', value: result.total_hosts },
                  { label: 'Responsive', value: result.responsive, colorClass: result.responsive > 0 ? 'text-primary' : 'text-muted' },
                  { label: 'New Devices Added', value: result.new_devices, colorClass: result.new_devices > 0 ? 'text-success' : 'text-muted' },
                  { label: 'Already in Inventory', value: result.existing_devices },
                ].map((item) => (
                  <div key={item.label} className="info-card">
                    <div className="stat-label">{item.label}</div>
                    <div className={`result-stat-value ${(item as any).colorClass || ''}`}>{item.value}</div>
                  </div>
                ))}
              </div>

              {result.ips_found.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-muted">&nbsp;Discovered IPs</div>
                  <div className="ip-list-container">
                    {result.ips_found.map((ip) => (
                      <span key={ip} className="tag-blue mono">{ip}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.new_devices > 0 && (
                <div className="text-sm text-muted">
                  New devices are being enriched (name, vendor, interfaces) in the background.
                </div>
              )}

              <div className="modal-footer--flat">
                <button onClick={onClose} className="btn btn-primary">Done</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
