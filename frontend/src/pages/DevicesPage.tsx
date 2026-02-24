import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Search, Server, Settings, Trash2, Wifi } from 'lucide-react'
import { devicesApi } from '../services/api'
import { Device } from '../types'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddDeviceModal from '../components/forms/AddDeviceModal'
import ScanSubnetModal from '../components/forms/ScanSubnetModal'
import EditDeviceModal from '../components/forms/EditDeviceModal'

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
  const [showScan, setShowScan] = useState(false)
  const [editDevice, setEditDevice] = useState<Device | null>(null)
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
    <div className="flex-col-gap">
      <div className="page-header">
        <div>
          <h1>Devices</h1>
          <p>{devices?.length || 0} devices configured</p>
        </div>
        <div className="flex-row-gap">
          <button onClick={() => refetch()} className="btn btn-outline btn-sm">
            <RefreshCw size={13} />
            Refresh
          </button>
          {isOperator && (
            <button onClick={() => setShowScan(true)} className="btn btn-outline btn-sm">
              <Wifi size={13} />
              Scan Subnet
            </button>
          )}
          {isOperator && (
            <button onClick={() => setShowAdd(true)} className="btn btn-primary btn-sm">
              <Plus size={13} />
              Add Device
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="search-bar">
        <Search size={13} />
        <input
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
                            <Server size={14} />
                          </div>
                          <Link to={`/devices/${device.id}`} className="link-primary">
                            {device.hostname}
                          </Link>
                        </div>
                      </td>
                      <td className="mono text-sm">{device.ip_address}</td>
                      <td>
                        {device.device_type && <span className="tag-blue">{device.device_type}</span>}
                      </td>
                      <td className="text-muted text-sm">
                        {[device.vendor, device.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="text-muted text-sm">{device.location?.name || '—'}</td>
                      <td>{statusTag(device.status)}</td>
                      <td className="text-muted">{device.interface_count ?? 0}</td>
                      <td>
                        {device.cpu_usage != null ? (
                          <span className={`mono text-sm ${device.cpu_usage > 80 ? 'metric-value--danger' : ''}`}>
                            {device.cpu_usage.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-xs text-light">
                        {device.last_seen
                          ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                          : 'Never'}
                      </td>
                      <td>
                        <div className="flex-row-gap-sm">
                          <Link to={`/devices/${device.id}`} className="btn btn-outline btn-sm">View</Link>
                          {isOperator && (
                            <>
                              <button
                                onClick={() => pollMutation.mutate(device.id)}
                                className="btn btn-outline btn--icon btn--sm"
                                title="Poll now"
                              >
                                <RefreshCw size={12} />
                              </button>
                              <button
                                onClick={() => setEditDevice(device)}
                                className="btn btn-outline btn--icon btn--sm"
                                title="Edit settings"
                              >
                                <Settings size={12} />
                              </button>
                              {user?.role === 'admin' && (
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete ${device.hostname}?`)) {
                                      deleteMutation.mutate(device.id)
                                    }
                                  }}
                                  className="btn btn-danger btn--icon btn--sm"
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
                      <td colSpan={10} className="empty-table-cell">
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
      {showScan && <ScanSubnetModal onClose={() => setShowScan(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['devices'] }); setShowScan(false) }} />}
      {editDevice && <EditDeviceModal device={editDevice} onClose={() => setEditDevice(null)} />}
    </div>
  )
}
