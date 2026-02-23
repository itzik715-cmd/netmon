import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { blocksApi, devicesApi } from '../services/api'
import { DeviceBlock, Device } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { Shield, RefreshCw, Trash2, Plus, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

function blockTypeBadge(type: string) {
  if (type === 'null_route') return <span className="tag-orange">Null Route</span>
  if (type === 'flowspec')   return <span className="tag-blue">FlowSpec</span>
  return <span className="tag-gray">{type}</span>
}

function AddBlockModal({
  devices,
  onClose,
}: {
  devices: Device[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [deviceId, setDeviceId] = useState('')
  const [prefix, setPrefix]     = useState('')
  const [blockType, setBlockType] = useState('null_route')
  const [description, setDescription] = useState('')

  const aristaDevices = devices.filter(
    (d) => d.api_username && (d.vendor?.toLowerCase().includes('arista') || d.vendor?.toLowerCase().includes('eos'))
  )
  // If no arista-tagged devices, show all with api credentials
  const eligible = aristaDevices.length > 0 ? aristaDevices : devices.filter((d) => d.api_username)

  const mutation = useMutation({
    mutationFn: () =>
      blocksApi.create(parseInt(deviceId), { prefix, block_type: blockType, description: description || undefined }),
    onSuccess: () => {
      toast.success('Block applied successfully')
      qc.invalidateQueries({ queryKey: ['blocks'] })
      qc.invalidateQueries({ queryKey: ['blocks-summary'] })
      onClose()
    },
  })

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Apply Block</h3>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Device *</label>
              <select className="select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required>
                <option value="">Select device...</option>
                {eligible.map((d) => (
                  <option key={d.id} value={d.id}>{d.hostname} ({d.ip_address})</option>
                ))}
              </select>
              {eligible.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>
                  No devices with eAPI credentials. Add credentials in device settings.
                </div>
              )}
            </div>
            <div>
              <label className="label">Prefix *</label>
              <input
                className="input"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="10.0.0.0/24"
                required
              />
            </div>
            <div>
              <label className="label">Block Type *</label>
              <select className="select" value={blockType} onChange={(e) => setBlockType(e.target.value)}>
                <option value="null_route">Null Route</option>
                <option value="flowspec">FlowSpec (record only)</option>
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional reason..."
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-outline">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!deviceId || !prefix || mutation.isPending}
            className="btn btn-primary"
          >
            {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
            Apply Block
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BlocksPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [syncingDevice, setSyncingDevice] = useState<number | null>(null)

  const { data: blocks = [], isLoading } = useQuery<DeviceBlock[]>({
    queryKey: ['blocks', filterType],
    queryFn: () =>
      blocksApi.list({ block_type: filterType || undefined }).then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  })

  const { data: summary } = useQuery({
    queryKey: ['blocks-summary'],
    queryFn: () => blocksApi.summary().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => blocksApi.delete(id),
    onSuccess: () => {
      toast.success('Block removed')
      qc.invalidateQueries({ queryKey: ['blocks'] })
      qc.invalidateQueries({ queryKey: ['blocks-summary'] })
    },
  })

  const deviceMap = Object.fromEntries((devices as Device[]).map((d) => [d.id, d]))

  const handleSync = async (deviceId: number) => {
    setSyncingDevice(deviceId)
    try {
      const r = await blocksApi.sync(deviceId)
      toast.success(`Synced: ${r.data.total_active} active blocks`)
      qc.invalidateQueries({ queryKey: ['blocks'] })
      qc.invalidateQueries({ queryKey: ['blocks-summary'] })
    } catch {
      // Error handled by axios interceptor
    } finally {
      setSyncingDevice(null)
    }
  }

  // Unique devices that have blocks
  const devicesWithBlocks = [...new Set(blocks.map((b) => b.device_id))]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>Active Blocks</h1>
          <p>Null-route and FlowSpec blocks across all Arista devices</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">
          <Plus size={14} />
          Apply Block
        </button>
      </div>

      {/* Summary cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon red">
            <Shield size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Total Active</div>
            <div className="stat-value">{summary?.total ?? '—'}</div>
            <div className="stat-sub">across all devices</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange">
            <Shield size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">Null Routes</div>
            <div className="stat-value">{summary?.null_route ?? '—'}</div>
            <div className="stat-sub">ip route … Null0</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">
            <Shield size={20} />
          </div>
          <div className="stat-body">
            <div className="stat-label">FlowSpec</div>
            <div className="stat-value">{summary?.flowspec ?? '—'}</div>
            <div className="stat-sub">BGP flow-spec rules</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <Shield size={16} />
          <h3>Active Blocks</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <select
              className="select"
              style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">All types</option>
              <option value="null_route">Null Route</option>
              <option value="flowspec">FlowSpec</option>
            </select>
            {devicesWithBlocks.map((did) => (
              <button
                key={did}
                onClick={() => handleSync(did)}
                className="btn btn-outline btn-sm"
                disabled={syncingDevice === did}
                title={`Sync from ${deviceMap[did]?.hostname || 'device'}`}
              >
                <RefreshCw size={12} className={syncingDevice === did ? 'animate-spin' : ''} />
                {deviceMap[did]?.hostname || `Device ${did}`}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Prefix</th>
                <th>Type</th>
                <th>Device</th>
                <th>Description</th>
                <th>Applied By</th>
                <th>Created</th>
                <th>Last Synced</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 32 }}>
                    <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto' }} />
                  </td>
                </tr>
              )}
              {!isLoading && blocks.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-light)' }}>
                    No active blocks. Click "Apply Block" to add one.
                  </td>
                </tr>
              )}
              {blocks.map((block) => (
                <tr key={block.id}>
                  <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{block.prefix}</td>
                  <td>{blockTypeBadge(block.block_type)}</td>
                  <td style={{ fontSize: 12 }}>
                    {deviceMap[block.device_id]?.hostname || `#${block.device_id}`}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                      {deviceMap[block.device_id]?.ip_address}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{block.description || '—'}</td>
                  <td style={{ fontSize: 12 }}>{block.created_by || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-light)' }}>
                    {block.created_at
                      ? formatDistanceToNow(new Date(block.created_at), { addSuffix: true })
                      : '—'}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-light)' }}>
                    {block.synced_at
                      ? formatDistanceToNow(new Date(block.synced_at), { addSuffix: true })
                      : '—'}
                  </td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
                      onClick={() => {
                        if (confirm(`Remove block for ${block.prefix}?`)) {
                          deleteMutation.mutate(block.id)
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      title="Remove block"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddBlockModal devices={devices as Device[]} onClose={() => setShowAdd(false)} />}
    </div>
  )
}
