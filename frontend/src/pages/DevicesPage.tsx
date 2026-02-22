import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Search, Server, Wifi, WifiOff, Trash2, Edit2 } from 'lucide-react'
import { devicesApi } from '../services/api'
import { Device } from '../types'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddDeviceModal from '../components/forms/AddDeviceModal'

function statusBadge(status: string) {
  const map: Record<string, string> = {
    up: 'badge-success', down: 'badge-danger',
    unknown: 'badge-gray', degraded: 'badge-warning',
  }
  return <span className={map[status] || 'badge-gray'}>{status}</span>
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
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Devices</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {devices?.length || 0} devices configured
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-secondary btn-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          {isOperator && (
            <button
              onClick={() => setShowAdd(true)}
              className="btn-primary btn-sm flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Device
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          className="input pl-10"
          placeholder="Search by hostname, IP, or vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Device Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading devices...</div>
      ) : (
        <div className="table-container">
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((device) => (
                <tr key={device.id}>
                  <td>
                    <Link
                      to={`/devices/${device.id}`}
                      className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                      {device.hostname}
                    </Link>
                  </td>
                  <td className="font-mono text-sm">{device.ip_address}</td>
                  <td>
                    {device.device_type && (
                      <span className="badge-info">{device.device_type}</span>
                    )}
                  </td>
                  <td className="text-gray-500 text-sm">
                    {[device.vendor, device.model].filter(Boolean).join(' ')}
                  </td>
                  <td className="text-gray-500 text-sm">{device.location?.name || '—'}</td>
                  <td>{statusBadge(device.status)}</td>
                  <td className="text-gray-500">{device.interface_count ?? 0}</td>
                  <td>
                    {device.cpu_usage != null ? (
                      <span className={device.cpu_usage > 80 ? 'text-red-600' : 'text-gray-700'}>
                        {device.cpu_usage.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="text-gray-400 text-xs">
                    {device.last_seen
                      ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                      : 'Never'}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/devices/${device.id}`}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="View details"
                      >
                        <Server className="h-4 w-4" />
                      </Link>
                      {isOperator && (
                        <>
                          <button
                            onClick={() => pollMutation.mutate(device.id)}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Poll now"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => {
                                if (confirm(`Delete ${device.hostname}?`)) {
                                  deleteMutation.mutate(device.id)
                                }
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
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
                  <td colSpan={10} className="text-center py-12 text-gray-400">
                    {search ? 'No devices match your search' : 'No devices configured'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
