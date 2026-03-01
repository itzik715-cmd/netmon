import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { blocksApi, devicesApi, settingsApi } from '../services/api'
import { DeviceBlock, Device } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { Ban, Plus, Trash2, RefreshCw, Loader2, Shield, ShieldOff, ShieldAlert, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

function blockTypeBadge(type: string) {
  if (type === 'null_route') return <span className="tag-blue">Null Route</span>
  if (type === 'flowspec')   return <span className="tag-orange">FlowSpec</span>
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
      <div className="modal-content">
        <div className="modal-header">
          <h3>Apply Block</h3>
          <button onClick={onClose} className="modal-close">&#10005;</button>
        </div>
        <div className="modal-body">
          <div className="form-field">
            <label className="form-label">Device *</label>
            <select className="form-select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required>
              <option value="">Select device...</option>
              {eligible.map((d) => (
                <option key={d.id} value={d.id}>{d.hostname} ({d.ip_address})</option>
              ))}
            </select>
            {eligible.length === 0 && (
              <p className="tag-orange">No devices with eAPI credentials. Add credentials in device settings.</p>
            )}
          </div>
          <div className="form-field">
            <label className="form-label">Prefix *</label>
            <input
              className="form-input"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="10.0.0.0/24"
              required
            />
          </div>
          <div className="form-field">
            <label className="form-label">Block Type *</label>
            <select className="form-select" value={blockType} onChange={(e) => setBlockType(e.target.value)}>
              <option value="null_route">Null Route</option>
              <option value="flowspec">FlowSpec (record only)</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Description</label>
            <input
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional reason..."
            />
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
  const navigate = useNavigate()
  const [showAdd, setShowAdd] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [syncingDevice, setSyncingDevice] = useState<number | null>(null)

  // FastNetMon config
  const { data: fnmConfig } = useQuery({
    queryKey: ['fnm-config'],
    queryFn: () => settingsApi.getFastnetmon().then((r) => r.data),
  })
  const fnmEnabled = fnmConfig?.fnm_enabled === 'true'

  // FastNetMon blackholes
  const { data: fnmData, isLoading: fnmLoading } = useQuery({
    queryKey: ['fnm-blackholes'],
    queryFn: () => blocksApi.getFnmBlackholes().then((r) => r.data),
    refetchInterval: 30_000,
    enabled: fnmEnabled,
  })

  const fnmUnblockMutation = useMutation({
    mutationFn: (ip: string) => blocksApi.fnmUnblock(ip),
    onSuccess: () => {
      toast.success('Blackhole removed')
      qc.invalidateQueries({ queryKey: ['fnm-blackholes'] })
    },
  })

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
    <div className="content">
      <div className="page-header">
        <div>
          <h1><Ban size={20} /> Active Blocks</h1>
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
            <div className="stat-sub">ip route ... Null0</div>
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

      {/* FastNetMon disabled banner */}
      {fnmConfig && !fnmEnabled && (
        <div className="card" style={{ borderLeft: '3px solid var(--warning-500, #f59e0b)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
            <ShieldOff size={24} style={{ color: 'var(--warning-500, #f59e0b)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>FastNetMon Integration is Disabled</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Configure FastNetMon to enable DDoS detection and automated BGP blackhole mitigation
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/settings')}>
              Configure FastNetMon <ExternalLink size={11} />
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card__header">
          <Shield size={16} />
          <h3>Active Blocks</h3>
          <div className="card__actions">
            <select
              className="form-select btn-sm"
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
                  <td colSpan={8}>
                    <div className="empty-state">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && blocks.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-state__icon"><Ban /></div>
                      <div className="empty-state__title">No active blocks</div>
                      <div className="empty-state__description">Click "Apply Block" to add one.</div>
                    </div>
                  </td>
                </tr>
              )}
              {blocks.map((block) => (
                <tr key={block.id}>
                  <td><strong className="mono">{block.prefix}</strong></td>
                  <td>{blockTypeBadge(block.block_type)}</td>
                  <td>
                    {deviceMap[block.device_id]?.hostname || `#${block.device_id}`}
                    <div className="mono">{deviceMap[block.device_id]?.ip_address}</div>
                  </td>
                  <td>{block.description || '—'}</td>
                  <td>{block.created_by || '—'}</td>
                  <td>
                    {block.created_at
                      ? formatDistanceToNow(new Date(block.created_at), { addSuffix: true })
                      : '—'}
                  </td>
                  <td>
                    {block.synced_at
                      ? formatDistanceToNow(new Date(block.synced_at), { addSuffix: true })
                      : '—'}
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn--icon btn-sm"
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

      {/* FastNetMon Active Blackholes */}
      {fnmEnabled && (
        <div className="card">
          <div className="card__header">
            <ShieldAlert size={16} />
            <h3>FastNetMon — Active Blackholes</h3>
            <div className="card__actions">
              {fnmLoading ? (
                <span className="tag-blue"><Loader2 size={10} className="animate-spin" /> Loading</span>
              ) : fnmData?.enabled ? (
                <span className="tag-green">Live{fnmData.node ? ` · ${fnmData.node}` : ''}</span>
              ) : (
                <span className="tag-orange">Error</span>
              )}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>Node</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!fnmData?.blocks?.length && !fnmLoading && (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty-state">
                        <div className="empty-state__icon"><Shield /></div>
                        <div className="empty-state__title">No active blackholes</div>
                        <div className="empty-state__description">FastNetMon has no IPs currently blackholed</div>
                      </div>
                    </td>
                  </tr>
                )}
                {fnmData?.blocks?.map((ip: string, idx: number) => (
                  <tr key={idx}>
                    <td><strong className="mono">{ip}</strong></td>
                    <td className="mono">{fnmData.node || '—'}</td>
                    <td>
                      <button
                        className="btn btn-danger btn--icon btn-sm"
                        onClick={() => {
                          if (confirm(`Remove blackhole for ${ip}?`)) {
                            fnmUnblockMutation.mutate(ip)
                          }
                        }}
                        disabled={fnmUnblockMutation.isPending}
                        title="Remove blackhole"
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
      )}

      {showAdd && <AddBlockModal devices={devices as Device[]} onClose={() => setShowAdd(false)} />}
    </div>
  )
}
