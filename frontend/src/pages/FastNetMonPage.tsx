import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fastnetmonApi, settingsApi, flowsApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import {
  ShieldAlert, ShieldOff, Activity, Network, Shield, Ban,
  Trash2, Plus, Loader2, Server, AlertTriangle, ExternalLink,
  ArrowDownLeft, ArrowUpRight, Wifi, Key, Search,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'overview' | 'traffic' | 'mitigations' | 'bgp' | 'detection' | 'config'

function fmtPps(v: number): string {
  if (!v) return '0'
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
  return String(Math.round(v))
}

function fmtMbps(v: number): string {
  if (!v) return '0'
  if (v >= 1_000) return (v / 1_000).toFixed(2) + ' Gbps'
  return v.toFixed(1) + ' Mbps'
}

function fmtBytes(b: number): string {
  if (!b) return '0 B'
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + ' GB'
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + ' MB'
  if (b >= 1_024) return (b / 1_024).toFixed(1) + ' KB'
  return b + ' B'
}

// ── Overview Panel ─────────────────────────────────────────────────────────

function OverviewPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['fnm-dashboard'],
    queryFn: () => fastnetmonApi.dashboard().then((r) => r.data),
    refetchInterval: 15_000,
  })

  if (isLoading) return <div className="empty-state"><Loader2 size={24} className="animate-spin" /></div>
  if (!data?.enabled) return null

  const lic = data.license || {}
  const traffic = data.traffic || []
  const incoming = traffic.find?.((t: any) => t.direction === 'incoming') || {}
  const outgoing = traffic.find?.((t: any) => t.direction === 'outgoing') || {}

  const daysLeft = lic.expiration_date
    ? Math.ceil((new Date(lic.expiration_date).getTime() - Date.now()) / 86_400_000)
    : null

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Key size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">License</div>
            <div className="stat-value">{lic.licensed_bandwidth ? `${(lic.licensed_bandwidth / 1000).toFixed(0)} Gbps` : '—'}</div>
            <div className="stat-sub">
              {lic.expiration_date ? (
                <span className={daysLeft! < 7 ? 'tag-red' : daysLeft! < 30 ? 'tag-orange' : 'tag-green'}>
                  Expires {lic.expiration_date} ({daysLeft}d)
                </span>
              ) : '—'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><ArrowDownLeft size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Incoming Traffic</div>
            <div className="stat-value">{fmtPps(incoming.total_pps || 0)}</div>
            <div className="stat-sub">{fmtMbps(incoming.total_mbps || 0)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><ArrowUpRight size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Outgoing Traffic</div>
            <div className="stat-value">{fmtPps(outgoing.total_pps || 0)}</div>
            <div className="stat-sub">{fmtMbps(outgoing.total_mbps || 0)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><Ban size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Active Mitigations</div>
            <div className="stat-value">{data.blackhole_count ?? 0}</div>
            <div className="stat-sub">blackholed IPs</div>
          </div>
        </div>
      </div>

      {/* BGP Peers */}
      <div className="card">
        <div className="card__header">
          <Network size={16} />
          <h3>BGP Peers</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Remote IP</th>
                <th>Remote ASN</th>
                <th>IPv4 Unicast</th>
                <th>IPv4 FlowSpec</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(!data.bgp_peers || data.bgp_peers.length === 0) && (
                <tr><td colSpan={6}><div className="empty-state">No BGP peers configured</div></td></tr>
              )}
              {data.bgp_peers?.map((p: any) => (
                <tr key={p.name}>
                  <td><strong>{p.name}</strong></td>
                  <td className="mono">{p.remote_address}</td>
                  <td>{p.remote_asn}</td>
                  <td>{p.ipv4_unicast ? <span className="tag-green">Yes</span> : <span className="tag-gray">No</span>}</td>
                  <td>{p.ipv4_flowspec ? <span className="tag-blue">Yes</span> : <span className="tag-gray">No</span>}</td>
                  <td>{p.active ? <span className="tag-green">Active</span> : <span className="tag-red">Down</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* License Details */}
      {lic.cpu_model && (
        <div className="card">
          <div className="card__header"><Server size={16} /><h3>System Info</h3></div>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><td><strong>CPU</strong></td><td>{lic.cpu_model}</td></tr>
                <tr><td><strong>Logical CPUs</strong></td><td>{lic.logical_cpus_number}</td></tr>
                <tr><td><strong>Memory</strong></td><td>{lic.total_memory_size} MB</td></tr>
                <tr><td><strong>IP Address</strong></td><td className="mono">{lic.address_ipv4}</td></tr>
                <tr><td><strong>License Type</strong></td><td>{lic.business_type} / {lic.issuer_type}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Traffic Panel ──────────────────────────────────────────────────────────

function TrafficPanel() {
  const [netFilter, setNetFilter] = useState('')

  const { data: traffic, isLoading: tLoading } = useQuery({
    queryKey: ['fnm-traffic'],
    queryFn: () => fastnetmonApi.traffic().then((r) => r.data),
    refetchInterval: 10_000,
  })

  const { data: hosts, isLoading: hLoading } = useQuery({
    queryKey: ['fnm-host-counters'],
    queryFn: () => fastnetmonApi.hostCounters().then((r) => r.data),
    refetchInterval: 15_000,
  })

  const { data: networks, isLoading: nLoading } = useQuery({
    queryKey: ['fnm-network-counters'],
    queryFn: () => fastnetmonApi.networkCounters().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const trafficArr = Array.isArray(traffic) ? traffic : []
  const hostsArr = Array.isArray(hosts) ? hosts : []
  const netsArr = Array.isArray(networks) ? networks : []
  const filteredNets = netFilter
    ? netsArr.filter((n: any) => n.network_name?.includes(netFilter))
    : netsArr

  return (
    <>
      {/* Total Traffic */}
      <div className="card">
        <div className="card__header">
          <Activity size={16} />
          <h3>Total Traffic Counters</h3>
          <div className="card__actions">
            {tLoading && <Loader2 size={14} className="animate-spin" />}
            <span className="tag-blue">Live · 10s</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Direction</th>
                <th>Total PPS</th>
                <th>Total Mbps</th>
                <th>TCP PPS</th>
                <th>UDP PPS</th>
                <th>ICMP PPS</th>
                <th>TCP SYN PPS</th>
              </tr>
            </thead>
            <tbody>
              {trafficArr.length === 0 && !tLoading && (
                <tr><td colSpan={7}><div className="empty-state">No traffic data</div></td></tr>
              )}
              {trafficArr.map((t: any) => (
                <tr key={t.direction}>
                  <td><strong style={{ textTransform: 'capitalize' }}>{t.direction}</strong></td>
                  <td className="mono">{fmtPps(t.total_pps || 0)}</td>
                  <td className="mono">{fmtMbps(t.total_mbps || 0)}</td>
                  <td className="mono">{fmtPps(t.tcp_pps || 0)}</td>
                  <td className="mono">{fmtPps(t.udp_pps || 0)}</td>
                  <td className="mono">{fmtPps(t.icmp_pps || 0)}</td>
                  <td className="mono">{fmtPps(t.tcp_syn_pps || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Talkers */}
      <div className="card">
        <div className="card__header">
          <Wifi size={16} />
          <h3>Top Talkers</h3>
          <div className="card__actions">
            {hLoading && <Loader2 size={14} className="animate-spin" />}
            <span className="tag-blue">Live · 15s</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>IP Address</th>
                <th>In PPS</th>
                <th>In Bytes</th>
                <th>TCP In</th>
                <th>UDP In</th>
                <th>ICMP In</th>
                <th>SYN In</th>
                <th>Flows</th>
              </tr>
            </thead>
            <tbody>
              {hostsArr.length === 0 && !hLoading && (
                <tr><td colSpan={8}><div className="empty-state">No host data</div></td></tr>
              )}
              {hostsArr.map((h: any) => (
                <tr key={h.host}>
                  <td><strong className="mono">{h.host}</strong></td>
                  <td className="mono">{fmtPps(h.incoming_packets || 0)}</td>
                  <td className="mono">{fmtBytes(h.incoming_bytes || 0)}</td>
                  <td className="mono">{fmtPps(h.tcp_incoming_packets || 0)}</td>
                  <td className="mono">{fmtPps(h.udp_incoming_packets || 0)}</td>
                  <td className="mono">{fmtPps(h.icmp_incoming_packets || 0)}</td>
                  <td className="mono">{fmtPps(h.tcp_syn_incoming_packets || 0)}</td>
                  <td className="mono">{h.incoming_flows || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Network Counters */}
      <div className="card">
        <div className="card__header">
          <Network size={16} />
          <h3>Network Counters</h3>
          <div className="card__actions">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)' }} />
              <input
                className="form-input btn-sm"
                style={{ paddingLeft: 26, width: 180 }}
                placeholder="Filter subnet..."
                value={netFilter}
                onChange={(e) => setNetFilter(e.target.value)}
              />
            </div>
            {nLoading && <Loader2 size={14} className="animate-spin" />}
            <span className="tag-gray">{filteredNets.length} networks</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subnet</th>
                <th>In PPS</th>
                <th>In Bytes</th>
                <th>Out PPS</th>
                <th>Out Bytes</th>
                <th>TCP In</th>
                <th>UDP In</th>
              </tr>
            </thead>
            <tbody>
              {filteredNets.length === 0 && !nLoading && (
                <tr><td colSpan={7}><div className="empty-state">No matching networks</div></td></tr>
              )}
              {filteredNets.map((n: any) => (
                <tr key={n.network_name}>
                  <td><strong className="mono">{n.network_name}</strong></td>
                  <td className="mono">{fmtPps(n.incoming_packets || 0)}</td>
                  <td className="mono">{fmtBytes(n.incoming_bytes || 0)}</td>
                  <td className="mono">{fmtPps(n.outgoing_packets || 0)}</td>
                  <td className="mono">{fmtBytes(n.outgoing_bytes || 0)}</td>
                  <td className="mono">{fmtPps(n.tcp_incoming_packets || 0)}</td>
                  <td className="mono">{fmtPps(n.udp_incoming_packets || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Mitigations Panel ──────────────────────────────────────────────────────

function MitigationsPanel() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [newIp, setNewIp] = useState('')

  const { data: blackholes, isLoading: bLoading } = useQuery({
    queryKey: ['fnm-blackholes'],
    queryFn: () => fastnetmonApi.blackholes().then((r) => r.data),
    refetchInterval: 10_000,
  })

  const { data: flowspec, isLoading: fLoading } = useQuery({
    queryKey: ['fnm-flowspec'],
    queryFn: () => fastnetmonApi.flowspec().then((r) => r.data),
    refetchInterval: 15_000,
  })

  const removeMutation = useMutation({
    mutationFn: (uuid: string) => fastnetmonApi.removeBlackhole(uuid),
    onSuccess: () => {
      toast.success('Blackhole removed')
      qc.invalidateQueries({ queryKey: ['fnm-blackholes'] })
      qc.invalidateQueries({ queryKey: ['fnm-dashboard'] })
    },
  })

  const addMutation = useMutation({
    mutationFn: (ip: string) => fastnetmonApi.addBlackhole(ip),
    onSuccess: () => {
      toast.success('Blackhole added')
      qc.invalidateQueries({ queryKey: ['fnm-blackholes'] })
      qc.invalidateQueries({ queryKey: ['fnm-dashboard'] })
      setShowAdd(false)
      setNewIp('')
    },
  })

  const bhList = Array.isArray(blackholes) ? blackholes : []
  const fsList = Array.isArray(flowspec) ? flowspec : []

  return (
    <>
      {/* Active Blackholes */}
      <div className="card">
        <div className="card__header">
          <Ban size={16} />
          <h3>Active Blackholes</h3>
          <div className="card__actions">
            {bLoading && <Loader2 size={14} className="animate-spin" />}
            <span className={bhList.length > 0 ? 'tag-red' : 'tag-green'}>
              {bhList.length} active
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Add Blackhole
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>IP Address</th>
                <th>UUID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bhList.length === 0 && !bLoading && (
                <tr>
                  <td colSpan={3}>
                    <div className="empty-state">
                      <div className="empty-state__icon"><Shield /></div>
                      <div className="empty-state__title">No active blackholes</div>
                    </div>
                  </td>
                </tr>
              )}
              {bhList.map((entry: any) => (
                <tr key={entry.uuid}>
                  <td><strong className="mono">{entry.ip}</strong></td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.uuid}</td>
                  <td>
                    <button
                      className="btn btn-danger btn--icon btn-sm"
                      onClick={() => {
                        if (confirm(`Remove blackhole for ${entry.ip}?`))
                          removeMutation.mutate(entry.uuid)
                      }}
                      disabled={removeMutation.isPending}
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

      {/* Active FlowSpec */}
      <div className="card">
        <div className="card__header">
          <Shield size={16} />
          <h3>Active FlowSpec Rules</h3>
          <div className="card__actions">
            {fLoading && <Loader2 size={14} className="animate-spin" />}
            <span className="tag-blue">{fsList.length} active</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {fsList.length === 0 && !fLoading && (
                <tr>
                  <td colSpan={2}>
                    <div className="empty-state">
                      <div className="empty-state__title">No active FlowSpec rules</div>
                    </div>
                  </td>
                </tr>
              )}
              {fsList.map((rule: any, idx: number) => (
                <tr key={idx}>
                  <td className="mono">{typeof rule === 'string' ? rule : JSON.stringify(rule)}</td>
                  <td>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Blackhole Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Add Manual Blackhole</h3>
              <button onClick={() => setShowAdd(false)} className="modal-close">&#10005;</button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">IP Address to Blackhole</label>
                <input
                  className="form-input"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  placeholder="192.168.1.100"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAdd(false)} className="btn btn-outline">Cancel</button>
              <button
                onClick={() => addMutation.mutate(newIp)}
                disabled={!newIp || addMutation.isPending}
                className="btn btn-danger"
              >
                {addMutation.isPending && <Loader2 size={13} className="animate-spin" />}
                Blackhole IP
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── BGP Panel ──────────────────────────────────────────────────────────────

function BgpPanel() {
  const { data: peers, isLoading } = useQuery({
    queryKey: ['fnm-bgp-peers'],
    queryFn: () => fastnetmonApi.bgpPeers().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const peerList = Array.isArray(peers) ? peers : []

  return (
    <div className="card">
      <div className="card__header">
        <Network size={16} />
        <h3>BGP Peers</h3>
        <div className="card__actions">
          {isLoading && <Loader2 size={14} className="animate-spin" />}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Peer Name</th>
              <th>Local Address</th>
              <th>Local ASN</th>
              <th>Remote Address</th>
              <th>Remote ASN</th>
              <th>IPv4 Unicast</th>
              <th>IPv4 FlowSpec</th>
              <th>MD5 Auth</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {peerList.length === 0 && !isLoading && (
              <tr><td colSpan={9}><div className="empty-state">No BGP peers configured</div></td></tr>
            )}
            {peerList.map((p: any) => (
              <tr key={p.name}>
                <td><strong>{p.name}</strong></td>
                <td className="mono">{p.local_address}</td>
                <td>{p.local_asn}</td>
                <td className="mono">{p.remote_address}</td>
                <td>{p.remote_asn}</td>
                <td>{p.ipv4_unicast ? <span className="tag-green">Yes</span> : <span className="tag-gray">No</span>}</td>
                <td>{p.ipv4_flowspec ? <span className="tag-blue">Yes</span> : <span className="tag-gray">No</span>}</td>
                <td>{p.md5_auth ? <span className="tag-orange">Yes</span> : <span className="tag-gray">No</span>}</td>
                <td>{p.active ? <span className="tag-green">Active</span> : <span className="tag-red">Down</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Editable Setting Helpers ──────────────────────────────────────────────

function EditableToggle({ label, configKey, value, onSave, desc }: {
  label: string; configKey: string; value: boolean
  onSave: (key: string, value: string) => void; desc?: string
}) {
  return (
    <tr>
      <td>
        <strong>{label}</strong>
        {desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>{desc}</div>}
      </td>
      <td>
        <button
          className={`toggle toggle--sm ${value ? 'toggle--active' : ''}`}
          onClick={() => onSave(configKey, value ? 'false' : 'true')}
        >
          <span className="toggle__knob" />
        </button>
      </td>
    </tr>
  )
}

function EditableField({ label, configKey, value, onSave, suffix, desc }: {
  label: string; configKey: string; value: string | number
  onSave: (key: string, value: string) => void; suffix?: string; desc?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? ''))

  const handleSave = () => {
    onSave(configKey, draft)
    setEditing(false)
  }

  return (
    <tr>
      <td>
        <strong>{label}</strong>
        {desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>{desc}</div>}
      </td>
      <td>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="form-input btn-sm"
              style={{ width: 200 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-outline btn-sm" onClick={() => { setDraft(String(value ?? '')); setEditing(false) }}>Cancel</button>
          </div>
        ) : (
          <span className="mono" style={{ cursor: 'pointer' }} onClick={() => { setDraft(String(value ?? '')); setEditing(true) }}>
            {value != null ? `${value}${suffix || ''}` : '—'}
            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>&#9998;</span>
          </span>
        )}
      </td>
    </tr>
  )
}

// ── Detection Panel ────────────────────────────────────────────────────────

function DetectionPanel() {
  const qc = useQueryClient()
  const { data: hostgroups, isLoading } = useQuery({
    queryKey: ['fnm-hostgroups'],
    queryFn: () => fastnetmonApi.hostgroups().then((r) => r.data),
    refetchInterval: 60_000,
  })

  const saveMut = useMutation({
    mutationFn: ({ name, key, value }: { name: string; key: string; value: string }) =>
      fastnetmonApi.updateHostgroup(name, key, value),
    onSuccess: () => {
      toast.success('Threshold updated')
      qc.invalidateQueries({ queryKey: ['fnm-hostgroups'] })
    },
  })

  const groups = Array.isArray(hostgroups) ? hostgroups : []

  const thresholdRows = (g: any) => [
    { metric: 'Total PPS', enableKey: 'ban_for_pps', thresholdKey: 'threshold_pps', enabled: g.ban_for_pps, value: g.threshold_pps },
    { metric: 'Total Bandwidth (Mbps)', enableKey: 'ban_for_bandwidth', thresholdKey: 'threshold_mbps', enabled: g.ban_for_bandwidth, value: g.threshold_mbps },
    { metric: 'Total Flows', enableKey: 'ban_for_flows', thresholdKey: 'threshold_flows', enabled: g.ban_for_flows, value: g.threshold_flows },
    { metric: 'TCP PPS', enableKey: 'ban_for_tcp_pps', thresholdKey: 'threshold_tcp_pps', enabled: g.ban_for_tcp_pps, value: g.threshold_tcp_pps },
    { metric: 'TCP Bandwidth (Mbps)', enableKey: 'ban_for_tcp_bandwidth', thresholdKey: 'threshold_tcp_mbps', enabled: g.ban_for_tcp_bandwidth, value: g.threshold_tcp_mbps },
    { metric: 'UDP PPS', enableKey: 'ban_for_udp_pps', thresholdKey: 'threshold_udp_pps', enabled: g.ban_for_udp_pps, value: g.threshold_udp_pps },
    { metric: 'UDP Bandwidth (Mbps)', enableKey: 'ban_for_udp_bandwidth', thresholdKey: 'threshold_udp_mbps', enabled: g.ban_for_udp_bandwidth, value: g.threshold_udp_mbps },
    { metric: 'ICMP PPS', enableKey: 'ban_for_icmp_pps', thresholdKey: 'threshold_icmp_pps', enabled: g.ban_for_icmp_pps, value: g.threshold_icmp_pps },
    { metric: 'ICMP Bandwidth (Mbps)', enableKey: 'ban_for_icmp_bandwidth', thresholdKey: 'threshold_icmp_mbps', enabled: g.ban_for_icmp_bandwidth, value: g.threshold_icmp_mbps },
    { metric: 'TCP SYN PPS', enableKey: 'ban_for_tcp_syn_pps', thresholdKey: 'threshold_tcp_syn_pps', enabled: g.ban_for_tcp_syn_pps, value: g.threshold_tcp_syn_pps },
    { metric: 'TCP SYN Bandwidth (Mbps)', enableKey: 'ban_for_tcp_syn_bandwidth', thresholdKey: 'threshold_tcp_syn_mbps', enabled: g.ban_for_tcp_syn_bandwidth, value: g.threshold_tcp_syn_mbps },
    { metric: 'IP Fragments PPS', enableKey: 'ban_for_ip_fragments_pps', thresholdKey: 'threshold_ip_fragments_pps', enabled: g.ban_for_ip_fragments_pps, value: g.threshold_ip_fragments_pps },
  ]

  const handleSave = (name: string, key: string, value: string) => {
    saveMut.mutate({ name, key, value })
  }

  return (
    <>
      {isLoading && <div className="empty-state"><Loader2 size={24} className="animate-spin" /></div>}
      {groups.map((g: any) => (
        <div className="card" key={g.name}>
          <div className="card__header">
            <AlertTriangle size={16} />
            <h3>Host Group: {g.name}</h3>
            <div className="card__actions">
              {g.enable_ban ? <span className="tag-green">Ban Enabled</span> : <span className="tag-red">Ban Disabled</span>}
              {g.enable_bgp_flow_spec && <span className="tag-blue">FlowSpec</span>}
              <span className="tag-gray">{g.calculation_method}</span>
            </div>
          </div>
          {g.description && (
            <div style={{ padding: '0 20px 8px', fontSize: 12, color: 'var(--text-muted)' }}>{g.description}</div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Enabled</th>
                  <th>Threshold</th>
                </tr>
              </thead>
              <tbody>
                {thresholdRows(g).map((row) => (
                  <ThresholdRow key={row.metric} row={row} groupName={g.name} onSave={handleSave} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  )
}

function ThresholdRow({ row, groupName, onSave }: {
  row: { metric: string; enableKey: string; thresholdKey: string; enabled: boolean; value: number }
  groupName: string; onSave: (name: string, key: string, value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(row.value ?? ''))

  const handleSave = () => {
    onSave(groupName, row.thresholdKey, draft)
    setEditing(false)
  }

  return (
    <tr>
      <td><strong>{row.metric}</strong></td>
      <td>
        <button
          className={`toggle toggle--sm ${row.enabled ? 'toggle--active' : ''}`}
          onClick={() => onSave(groupName, row.enableKey, row.enabled ? 'false' : 'true')}
        >
          <span className="toggle__knob" />
        </button>
      </td>
      <td>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="form-input btn-sm"
              style={{ width: 140 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-outline btn-sm" onClick={() => { setDraft(String(row.value ?? '')); setEditing(false) }}>Cancel</button>
          </div>
        ) : (
          <span className="mono" style={{ cursor: 'pointer' }} onClick={() => { setDraft(String(row.value ?? '')); setEditing(true) }}>
            {row.value != null ? String(row.value) : '—'}
            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>&#9998;</span>
          </span>
        )}
      </td>
    </tr>
  )
}

// ── Config Panel ───────────────────────────────────────────────────────────

function ConfigPanel() {
  const qc = useQueryClient()
  const [showNets, setShowNets] = useState(false)
  const [showWhitelist, setShowWhitelist] = useState(false)
  const [showRemoteWl, setShowRemoteWl] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [newNet, setNewNet] = useState('')
  const [newWl, setNewWl] = useState('')

  const { data: config, isLoading } = useQuery({
    queryKey: ['fnm-internal-config'],
    queryFn: () => fastnetmonApi.config().then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: ownedSubnets } = useQuery({
    queryKey: ['owned-subnets'],
    queryFn: () => flowsApi.ownedSubnets().then((r) => r.data),
  })

  const saveMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      fastnetmonApi.updateConfig(key, value),
    onSuccess: () => {
      toast.success('Setting updated')
      qc.invalidateQueries({ queryKey: ['fnm-internal-config'] })
      qc.invalidateQueries({ queryKey: ['fnm-dashboard'] })
    },
  })

  const addNetMut = useMutation({
    mutationFn: ({ list, cidr }: { list: string; cidr: string }) =>
      fastnetmonApi.addNetwork(list, cidr),
    onSuccess: () => {
      toast.success('Network added')
      qc.invalidateQueries({ queryKey: ['fnm-internal-config'] })
      setNewNet('')
      setNewWl('')
    },
  })

  const removeNetMut = useMutation({
    mutationFn: ({ list, cidr }: { list: string; cidr: string }) =>
      fastnetmonApi.removeNetwork(list, cidr),
    onSuccess: () => {
      toast.success('Network removed')
      qc.invalidateQueries({ queryKey: ['fnm-internal-config'] })
    },
  })

  if (isLoading) return <div className="empty-state"><Loader2 size={24} className="animate-spin" /></div>
  if (!config) return null

  const c = config
  const nets: string[] = c.networks_list || []
  const wl: string[] = c.networks_whitelist || []
  const wlRemote: string[] = c.networks_whitelist_remote || []

  const handleSave = (key: string, value: string) => {
    saveMut.mutate({ key, value })
  }

  // Diff: FNM networks vs NetMon owned subnets
  const ownedList: string[] = (ownedSubnets || [])
    .filter((s: any) => s.is_active)
    .map((s: any) => s.subnet)
  const fnmSet = new Set(nets)
  const ownedSet = new Set(ownedList)
  const inFnmNotOwned = nets.filter((n) => !ownedSet.has(n))
  const inOwnedNotFnm = ownedList.filter((n) => !fnmSet.has(n))

  return (
    <>
      {/* General */}
      <div className="card">
        <div className="card__header"><Shield size={16} /><h3>General Settings</h3></div>
        <div className="table-wrap">
          <table><tbody>
            <EditableToggle label="Enable Ban" configKey="enable_ban" value={!!c.enable_ban} onSave={handleSave} desc="Master switch: block IPs that exceed detection thresholds" />
            <EditableField label="Ban Time" configKey="ban_time" value={c.ban_time} onSave={handleSave} suffix="s" desc="How long (seconds) an attacked IP stays blocked" />
            <EditableToggle label="Unban Enabled" configKey="unban_enabled" value={!!c.unban_enabled} onSave={handleSave} desc="Automatically unblock IPs after ban_time expires" />
            <EditableToggle label="Unban Only If Attack Finished" configKey="unban_only_if_attack_finished" value={!!c.unban_only_if_attack_finished} onSave={handleSave} desc="Wait for traffic to drop below thresholds before unblocking" />
            <EditableToggle label="Keep Blocked Hosts On Restart" configKey="keep_blocked_hosts_during_restart" value={!!c.keep_blocked_hosts_during_restart} onSave={handleSave} desc="Persist active blocks across FastNetMon service restarts" />
            <EditableToggle label="Process Incoming Traffic" configKey="process_incoming_traffic" value={!!c.process_incoming_traffic} onSave={handleSave} desc="Analyze inbound traffic for DDoS detection" />
            <EditableToggle label="Process Outgoing Traffic" configKey="process_outgoing_traffic" value={!!c.process_outgoing_traffic} onSave={handleSave} desc="Analyze outbound traffic (detect compromised hosts)" />
            <EditableToggle label="Process IPv6 Traffic" configKey="process_ipv6_traffic" value={!!c.process_ipv6_traffic} onSave={handleSave} desc="Include IPv6 packets in traffic analysis" />
          </tbody></table>
        </div>
      </div>

      {/* Collection */}
      <div className="card">
        <div className="card__header"><Wifi size={16} /><h3>Traffic Collection</h3></div>
        <div className="table-wrap">
          <table><tbody>
            <EditableToggle label="sFlow" configKey="sflow" value={!!c.sflow} onSave={handleSave} desc="Receive sFlow samples from switches/routers" />
            <EditableField label="sFlow Host" configKey="sflow_host" value={c.sflow_host} onSave={handleSave} desc="IP address to listen for sFlow datagrams (0.0.0.0 = all)" />
            <EditableToggle label="NetFlow" configKey="netflow" value={!!c.netflow} onSave={handleSave} desc="Receive NetFlow v5/v9/IPFIX flow records" />
            <EditableField label="Speed Calculation Delay" configKey="speed_calculation_delay" value={c.speed_calculation_delay} onSave={handleSave} suffix="s" desc="Interval between speed recalculations (lower = more CPU)" />
            <EditableField label="Average Calculation Time" configKey="average_calculation_time" value={c.average_calculation_time} onSave={handleSave} suffix="s" desc="Window size for averaging traffic counters" />
            <EditableField label="AF Packet Sampling Rate" configKey="mirror_af_packet_sampling_rate" value={c.mirror_af_packet_sampling_rate} onSave={handleSave} desc="Sampling ratio for AF_PACKET mirror (1 in N packets)" />
          </tbody></table>
        </div>
      </div>

      {/* BGP */}
      <div className="card">
        <div className="card__header"><Network size={16} /><h3>BGP Settings</h3></div>
        <div className="table-wrap">
          <table><tbody>
            <EditableToggle label="GoBGP Enabled" configKey="gobgp" value={!!c.gobgp} onSave={handleSave} desc="Use GoBGP daemon for BGP blackhole/FlowSpec announcements" />
            <EditableToggle label="FlowSpec Announces" configKey="gobgp_flow_spec_announces" value={!!c.gobgp_flow_spec_announces} onSave={handleSave} desc="Send BGP FlowSpec rules to peers during attacks" />
            <EditableField label="FlowSpec Default Action" configKey="gobgp_flow_spec_default_action" value={c.gobgp_flow_spec_default_action} onSave={handleSave} desc="Action for FlowSpec rules: discard, rate-limit, redirect" />
            <EditableField label="FlowSpec Ban Time" configKey="flow_spec_ban_time" value={c.flow_spec_ban_time} onSave={handleSave} suffix="s" desc="Duration of FlowSpec rules before withdrawal" />
            <EditableField label="Next Hop (Host)" configKey="gobgp_next_hop" value={c.gobgp_next_hop} onSave={handleSave} desc="BGP next-hop for blackhole routes (0.0.0.0 = self)" />
            <EditableToggle label="Announce Host" configKey="gobgp_announce_host" value={!!c.gobgp_announce_host} onSave={handleSave} desc="Announce /32 blackhole route for attacked IPs" />
            <EditableToggle label="Announce Whole Subnet" configKey="gobgp_announce_whole_subnet" value={!!c.gobgp_announce_whole_subnet} onSave={handleSave} desc="Announce entire subnet instead of single /32 host" />
            <EditableField label="Community (Host)" configKey="gobgp_community_host" value={c.gobgp_community_host} onSave={handleSave} desc="BGP community attached to per-host blackhole routes" />
            <EditableField label="Community (Subnet)" configKey="gobgp_community_subnet" value={c.gobgp_community_subnet} onSave={handleSave} desc="BGP community attached to per-subnet blackhole routes" />
            <EditableField label="Community (Remote)" configKey="gobgp_community_remote_host" value={c.gobgp_community_remote_host} onSave={handleSave} desc="BGP community for remote-triggered blackhole (RTBH)" />
          </tbody></table>
        </div>
      </div>

      {/* Notifications */}
      <div className="card">
        <div className="card__header"><AlertTriangle size={16} /><h3>Notifications</h3></div>
        <div className="table-wrap">
          <table><tbody>
            <EditableToggle label="Email Enabled" configKey="email_notifications_enabled" value={!!c.email_notifications_enabled} onSave={handleSave} desc="Send email alerts when attacks are detected/mitigated" />
            <EditableField label="SMTP Host" configKey="email_notifications_host" value={c.email_notifications_host} onSave={handleSave} desc="SMTP relay server IP or hostname" />
            <EditableField label="SMTP Port" configKey="email_notifications_port" value={c.email_notifications_port} onSave={handleSave} desc="SMTP port (25 = plain, 587 = STARTTLS, 465 = SSL)" />
            <EditableField label="From Address" configKey="email_notifications_from" value={c.email_notifications_from} onSave={handleSave} desc="Sender address for alert emails" />
            <tr>
              <td>
                <strong>Recipients</strong>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>Email addresses that receive attack alerts</div>
              </td>
              <td className="mono">{c.email_notifications_recipients?.join(', ') || '—'}</td>
            </tr>
            <EditableToggle label="Telegram Enabled" configKey="telegram_notifications_enabled" value={!!c.telegram_notifications_enabled} onSave={handleSave} desc="Send attack notifications via Telegram bot" />
            <EditableToggle label="Slack Enabled" configKey="slack_notifications_enabled" value={!!c.slack_notifications_enabled} onSave={handleSave} desc="Send attack notifications to a Slack webhook" />
          </tbody></table>
        </div>
      </div>

      {/* Monitored Networks */}
      <div className="card">
        <div className="card__header"><Network size={16} /><h3>Monitored Networks ({nets.length})</h3>
          <div className="card__actions">
            <button className="btn btn-outline btn-sm" onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? 'Hide' : 'Show'} Diff vs Owned Subnets
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setShowNets(!showNets)}>
              {showNets ? 'Hide' : 'Manage'} List
            </button>
          </div>
        </div>

        {/* Diff panel */}
        {showDiff && (
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Comparing FastNetMon <strong>networks_list</strong> ({nets.length}) with NetMon <strong>Owned Subnets</strong> ({ownedList.length} active)
            </div>

            {inFnmNotOwned.length === 0 && inOwnedNotFnm.length === 0 ? (
              <div className="tag-green" style={{ padding: '8px 14px' }}>All synced — both lists match</div>
            ) : (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {inOwnedNotFnm.length > 0 && (
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--warning-500, #f59e0b)' }}>
                      In Owned Subnets but NOT in FastNetMon ({inOwnedNotFnm.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {inOwnedNotFnm.map((n) => (
                        <span key={n} className="tag-orange" style={{ cursor: 'pointer' }} title="Click to add to FastNetMon"
                          onClick={() => { if (confirm(`Add ${n} to FastNetMon monitored networks?`)) addNetMut.mutate({ list: 'networks_list', cidr: n }) }}>
                          + {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {inFnmNotOwned.length > 0 && (
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
                      In FastNetMon but NOT in Owned Subnets ({inFnmNotOwned.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {inFnmNotOwned.map((n) => (
                        <span key={n} className="tag-gray">{n}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Editable network list */}
        {showNets && (
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                className="form-input btn-sm"
                style={{ width: 200 }}
                value={newNet}
                onChange={(e) => setNewNet(e.target.value)}
                placeholder="10.0.0.0/24"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newNet) addNetMut.mutate({ list: 'networks_list', cidr: newNet })
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={!newNet || addNetMut.isPending}
                onClick={() => addNetMut.mutate({ list: 'networks_list', cidr: newNet })}
              >
                <Plus size={12} /> Add Network
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {nets.map((n) => (
                <span key={n} className="tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {n}
                  <Trash2 size={10} style={{ cursor: 'pointer', opacity: 0.6 }}
                    onClick={() => { if (confirm(`Remove ${n} from monitored networks?`)) removeNetMut.mutate({ list: 'networks_list', cidr: n }) }} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Whitelists */}
      <div className="card">
        <div className="card__header"><Shield size={16} /><h3>Whitelists</h3>
          <div className="card__actions">
            <button className="btn btn-outline btn-sm" onClick={() => setShowWhitelist(!showWhitelist)}>
              Local ({wl.length})
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setShowRemoteWl(!showRemoteWl)}>
              Remote ({wlRemote.length})
            </button>
          </div>
        </div>
        {showWhitelist && (
          <div style={{ padding: '0 20px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Local Whitelist — IPs excluded from detection</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                className="form-input btn-sm"
                style={{ width: 200 }}
                value={newWl}
                onChange={(e) => setNewWl(e.target.value)}
                placeholder="192.168.1.0/24"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newWl) addNetMut.mutate({ list: 'networks_whitelist', cidr: newWl })
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={!newWl || addNetMut.isPending}
                onClick={() => { addNetMut.mutate({ list: 'networks_whitelist', cidr: newWl }); setNewWl('') }}
              >
                <Plus size={12} /> Add
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {wl.map((ip) => (
                <span key={ip} className="tag-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {ip}
                  <Trash2 size={10} style={{ cursor: 'pointer', opacity: 0.6 }}
                    onClick={() => { if (confirm(`Remove ${ip} from whitelist?`)) removeNetMut.mutate({ list: 'networks_whitelist', cidr: ip }) }} />
                </span>
              ))}
            </div>
          </div>
        )}
        {showRemoteWl && (
          <div style={{ padding: '0 20px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Remote Whitelist — externally managed exclusions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {wlRemote.map((ip) => <span key={ip} className="tag-orange">{ip}</span>)}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function FastNetMonPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const navigate = useNavigate()

  const { data: fnmConfig } = useQuery({
    queryKey: ['fnm-config'],
    queryFn: () => settingsApi.getFastnetmon().then((r) => r.data),
  })
  const fnmEnabled = String(fnmConfig?.fnm_enabled).toLowerCase() === 'true'

  if (fnmConfig && !fnmEnabled) {
    return (
      <div className="content">
        <div className="page-header">
          <div>
            <h1><ShieldAlert size={20} /> FastNetMon</h1>
            <p>DDoS Detection and Mitigation</p>
          </div>
        </div>
        <div className="card" style={{ borderLeft: '3px solid var(--warning-500, #f59e0b)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
            <ShieldOff size={24} style={{ color: 'var(--warning-500, #f59e0b)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>FastNetMon Integration is Disabled</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Configure FastNetMon to enable DDoS detection and automated BGP blackhole mitigation
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
              Configure FastNetMon <ExternalLink size={11} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="content">
      <div className="page-header">
        <div>
          <h1><ShieldAlert size={20} /> FastNetMon</h1>
          <p>DDoS Detection and Mitigation Management</p>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>
          <Activity size={13} /> Overview
        </button>
        <button className={`tab-btn${tab === 'traffic' ? ' active' : ''}`} onClick={() => setTab('traffic')}>
          <Wifi size={13} /> Traffic
        </button>
        <button className={`tab-btn${tab === 'mitigations' ? ' active' : ''}`} onClick={() => setTab('mitigations')}>
          <Ban size={13} /> Mitigations
        </button>
        <button className={`tab-btn${tab === 'bgp' ? ' active' : ''}`} onClick={() => setTab('bgp')}>
          <Network size={13} /> BGP Peers
        </button>
        <button className={`tab-btn${tab === 'detection' ? ' active' : ''}`} onClick={() => setTab('detection')}>
          <AlertTriangle size={13} /> Detection
        </button>
        <button className={`tab-btn${tab === 'config' ? ' active' : ''}`} onClick={() => setTab('config')}>
          <Server size={13} /> Configuration
        </button>
      </div>

      {tab === 'overview' && <OverviewPanel />}
      {tab === 'traffic' && <TrafficPanel />}
      {tab === 'mitigations' && <MitigationsPanel />}
      {tab === 'bgp' && <BgpPanel />}
      {tab === 'detection' && <DetectionPanel />}
      {tab === 'config' && <ConfigPanel />}
    </div>
  )
}
