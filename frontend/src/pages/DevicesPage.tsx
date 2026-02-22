import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RefreshCw, Search, Trash2 } from 'lucide-react'
import { devicesApi } from '../services/api'
import { Device } from '../types'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddDeviceModal from '../components/forms/AddDeviceModal'

function statusTag(status: string) {
  const map: Record<string, string> = {
    up: 'tag-green', down: 'tag-red', unknown: 'tag-gray', degraded: 'tag-orange',
  }
  const dotMap: Record<string, string> = {
    up: 'dot-green', down: 'dot-red', unknown: 'dot-orange', degraded: 'dot-orange',
  }
  return (
    <span className={map[status] || 'tag-gray'}>
      <span className={`status-dot ${dotMap[status] || 'dot-orange'}`} />
      {status}
    </span>
  )
}

export default function DevicesPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const isOperator = user?.role === 'admin' || user?.role === 'operator'

  const { data: devices, isLoading, refetch } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data as Device[]),
    refetchInterval: 60_000,
  })

  const pollMutation = useMutation({
    mutationFn: (id: number) => devicesApi.poll(id),
    onSuccess: () => toast.success('Poll scheduled'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => devicesApi.delete(id),
    onSuccess: () => {
      toast.success('Device deleted')
      qc.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  const filtered = (devices || []).filter(
    (d) =>
      d.hostname.toLowerCase().includes(search.toLowerCase()) ||
      d.ip_address.includes(search) ||
      (d.vendor || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>Devices</h1>
          <p>{devices?.length || 0} devices configured</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => refetch()} className="btn btn-outline btn-sm">
            <RefreshCw size={13} />
            Refresh
          </button>
          {isOperator && (
            <button onClick={() => setShowAdd(true)} className="btn btn-primary btn-sm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 13, height: 13 }}>
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Device
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="search-bar" style={{ height: 38, maxWidth: 400 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          style={{ width: '100%' }}
          placeholder="Search by hostname, IP, or vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        {isLoading ? (
          <div className="empty-state">
            <p>Loading devices...</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>IP Address</th>
                    <th>Type</th>
                    <th>Vendor / Model</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Interfaces</th>
                    <th>CPU</th>
                    <th>Last Seen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <div className="device-name">
                          <div className="device-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="2" y="3" width="20" height="14" rx="2"/>
                            </svg>
                          </div>
                          <Link to={`/devices/${device.id}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                            {device.hostname}
                          </Link>
                        </div>
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{device.ip_address}</td>
                      <td>
                        {device.device_type && <span className="tag-blue">{device.device_type}</span>}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {[device.vendor, device.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{device.location?.name || '—'}</td>
                      <td>{statusTag(device.status)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{device.interface_count ?? 0}</td>
                      <td>
                        {device.cpu_usage != null ? (
                          <span style={{
                            fontFamily: 'DM Mono, monospace', fontSize: 12,
                            color: device.cpu_usage > 80 ? 'var(--accent-red)' : 'var(--text-main)',
                          }}>
                            {device.cpu_usage.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-light)' }}>
                        {device.last_seen
                          ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                          : 'Never'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Link to={`/devices/${device.id}`} className="btn btn-outline btn-sm">View</Link>
                          {isOperator && (
                            <>
                              <button
                                onClick={() => pollMutation.mutate(device.id)}
                                style={{
                                  padding: '4px 6px', background: 'none', border: '1px solid var(--border)',
                                  borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)',
                                  display: 'flex', alignItems: 'center',
                                }}
                                title="Poll now"
                              >
                                <RefreshCw size={12} />
                              </button>
                              {user?.role === 'admin' && (
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete ${device.hostname}?`)) {
                                      deleteMutation.mutate(device.id)
                                    }
                                  }}
                                  style={{
                                    padding: '4px 6px', background: 'none', border: '1px solid var(--border)',
                                    borderRadius: 6, cursor: 'pointer', color: 'var(--accent-red)',
                                    display: 'flex', alignItems: 'center',
                                  }}
                                  title="Delete"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                        {search ? 'No devices match your search' : 'No devices configured'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <div className="table-info">Showing {filtered.length} of {devices?.length || 0} devices</div>
            </div>
          </>
        )}
      </div>

      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
