import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Search, Settings, Trash2, Wifi, ChevronDown, ChevronUp } from 'lucide-react'
import { devicesApi } from '../services/api'
import { Device } from '../types'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import AddDeviceModal from '../components/forms/AddDeviceModal'
import ScanSubnetModal from '../components/forms/ScanSubnetModal'
import EditDeviceModal from '../components/forms/EditDeviceModal'

/* ── Category classification ── */
type Category = 'routers' | 'switches' | 'power'

const ROUTER_TYPES = new Set(['spine', 'router', 'core'])
const POWER_TYPES = new Set(['pdu', 'ats', 'ups'])

function getCategory(deviceType?: string): Category {
  const t = (deviceType || '').toLowerCase()
  if (ROUTER_TYPES.has(t)) return 'routers'
  if (POWER_TYPES.has(t)) return 'power'
  return 'switches'
}

/* ── SVG Icons ── */
function RouterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,2 22,12 12,22 2,12" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function SwitchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="10" x2="6" y2="14" />
      <line x1="10" y1="10" x2="10" y2="14" />
      <line x1="14" y1="10" x2="14" y2="14" />
      <line x1="18" y1="10" x2="18" y2="14" />
    </svg>
  )
}

function PowerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function categoryIcon(cat: Category, className?: string) {
  switch (cat) {
    case 'routers': return <RouterIcon className={className} />
    case 'switches': return <SwitchIcon className={className} />
    case 'power': return <PowerIcon className={className} />
  }
}

function deviceRowIcon(cat: Category) {
  const cls = `device-icon device-icon--${cat === 'routers' ? 'router' : cat === 'power' ? 'power' : 'switch'}`
  switch (cat) {
    case 'routers': return <RouterIcon className={cls} />
    case 'switches': return <SwitchIcon className={cls} />
    case 'power': return <PowerIcon className={cls} />
  }
}

/* ── Helpers ── */
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

function formatPower(watts: number | null | undefined): string {
  if (watts == null) return '—'
  if (watts >= 1000) return `${(watts / 1000).toFixed(1)} kW`
  return `${watts.toFixed(0)} W`
}

function formatUptime(seconds?: number): string {
  if (seconds == null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

/* ── Category config ── */
const CATEGORIES: { key: Category; label: string; cssModifier: string }[] = [
  { key: 'routers', label: 'Routers & Core', cssModifier: 'router' },
  { key: 'switches', label: 'Switches', cssModifier: 'switch' },
  { key: 'power', label: 'Power Devices', cssModifier: 'power' },
]

export default function DevicesPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [editDevice, setEditDevice] = useState<Device | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    routers: false,
    switches: false,
    power: false,
  })
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

  // Classify + sort
  const grouped: Record<Category, Device[]> = { routers: [], switches: [], power: [] }
  for (const d of filtered) {
    grouped[getCategory(d.device_type)].push(d)
  }
  grouped.routers.sort((a, b) => a.hostname.localeCompare(b.hostname))
  grouped.switches.sort((a, b) => a.hostname.localeCompare(b.hostname))
  grouped.power.sort((a, b) => {
    const locCmp = (a.location?.name || '').localeCompare(b.location?.name || '')
    return locCmp !== 0 ? locCmp : a.hostname.localeCompare(b.hostname)
  })

  const totalDevices = devices?.length || 0

  const toggleSection = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  /* ── Action buttons (shared across all categories) ── */
  const renderActions = (device: Device) => (
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
  )

  /* ── Common cells: device name, IP, type, vendor, location, status, last seen ── */
  const renderCommonCells = (device: Device, cat: Category) => (
    <>
      <td>
        <div className="device-name">
          {deviceRowIcon(cat)}
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
    </>
  )

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <div>
          <h1>Devices</h1>
          <p>
            {totalDevices} devices
            {totalDevices > 0 && ` — ${grouped.routers.length} routers, ${grouped.switches.length} switches, ${grouped.power.length} power devices`}
          </p>
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

      {isLoading ? (
        <div className="card"><div className="empty-state"><p>Loading devices...</p></div></div>
      ) : (
        <>
          {CATEGORIES.map(({ key, label, cssModifier }) => {
            const items = grouped[key]
            const isCollapsed = collapsed[key]

            return (
              <div key={key} className="device-section">
                {/* Section Header */}
                <div
                  className={`device-section-header device-section-header--${cssModifier}`}
                  onClick={() => toggleSection(key)}
                >
                  <div className="device-section-header__left">
                    {categoryIcon(key, 'device-section-header__icon')}
                    <span className="device-section-header__title">{label}</span>
                    <span className="device-section-header__count">{items.length} devices</span>
                  </div>
                  <button className="device-section-header__toggle">
                    {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </button>
                </div>

                {/* Table */}
                {!isCollapsed && (
                  <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
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
                            {key === 'power' ? (
                              <>
                                <th>Outlets</th>
                                <th>Power</th>
                                <th>Load</th>
                              </>
                            ) : (
                              <>
                                <th>Interfaces</th>
                                <th>CPU</th>
                                {key === 'routers' && <th>Memory</th>}
                                {key === 'routers' && <th>Uptime</th>}
                              </>
                            )}
                            <th>Last Seen</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((device) => (
                            <tr key={device.id}>
                              {renderCommonCells(device, key)}

                              {key === 'power' ? (
                                <>
                                  <td className="mono text-sm">{device.outlet_count ?? '—'}</td>
                                  <td className="mono text-sm">{formatPower(device.power_watts)}</td>
                                  <td>
                                    {device.load_pct != null ? (
                                      <div className="device-load-cell">
                                        <span className="device-load-value">{device.load_pct.toFixed(0)}%</span>
                                        <div className="device-load-bar">
                                          <div
                                            className={`device-load-bar__fill ${
                                              device.load_pct > 80 ? 'device-load-bar__fill--danger' :
                                              device.load_pct > 60 ? 'device-load-bar__fill--warning' :
                                              'device-load-bar__fill--ok'
                                            }`}
                                            style={{ width: `${Math.min(device.load_pct, 100)}%` }}
                                          />
                                        </div>
                                      </div>
                                    ) : '—'}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="text-muted">{device.interface_count ?? 0}</td>
                                  <td>
                                    {device.cpu_usage != null ? (
                                      <span className={`mono text-sm ${device.cpu_usage > 80 ? 'metric-value--danger' : ''}`}>
                                        {device.cpu_usage.toFixed(1)}%
                                      </span>
                                    ) : '—'}
                                  </td>
                                  {key === 'routers' && (
                                    <td>
                                      {device.memory_usage != null ? (
                                        <span className="mono text-sm">{device.memory_usage.toFixed(1)}%</span>
                                      ) : '—'}
                                    </td>
                                  )}
                                  {key === 'routers' && (
                                    <td className="text-muted text-sm">{formatUptime(device.uptime)}</td>
                                  )}
                                </>
                              )}

                              <td className="text-xs text-light">
                                {device.last_seen
                                  ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
                                  : 'Never'}
                              </td>
                              <td>{renderActions(device)}</td>
                            </tr>
                          ))}
                          {items.length === 0 && (
                            <tr>
                              <td colSpan={key === 'power' ? 11 : key === 'routers' ? 13 : 11} className="empty-table-cell">
                                {search ? 'No devices match your search' : 'No devices in this category'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <div className="table-footer">
            <div className="table-info">Showing {filtered.length} of {totalDevices} devices</div>
          </div>
        </>
      )}

      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} />}
      {showScan && <ScanSubnetModal onClose={() => setShowScan(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['devices'] }); setShowScan(false) }} />}
      {editDevice && <EditDeviceModal device={editDevice} onClose={() => setEditDevice(null)} />}
    </div>
  )
}
