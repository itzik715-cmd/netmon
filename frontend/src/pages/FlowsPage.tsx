import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi, devicesApi } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Label,
} from 'recharts'
import { Activity, Search, ArrowUpRight, ArrowDownRight } from 'lucide-react'

const COLORS     = ['#1a9dc8', '#a78bfa', '#06b6d4', '#f97316', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']
const COLORS_IN  = ['#27ae60', '#2ecc71', '#1abc9c', '#16a085', '#0d9488', '#059669', '#10b981', '#34d399']

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

const TIME_RANGES = [
  { label: '1h',  hours: 1   },
  { label: '6h',  hours: 6   },
  { label: '24h', hours: 24  },
  { label: '7d',  hours: 168 },
]

const TOOLTIP_STYLE = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1e293b' }

// -- IP search bar ---------------------------------------------------------------
function IpSearchBar({
  value, onChange, onClear,
}: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(value)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onChange(draft.trim())
  }

  return (
    <form onSubmit={submit} className="flex-row-gap">
      <div className="search-bar">
        <Search size={13} />
        <input
          type="text"
          placeholder="Search by IP address..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="mono"
        />
      </div>
      <button type="submit" className="btn btn-primary btn-sm">Search</button>
      {value && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => { setDraft(''); onClear(); }}
        >
          Clear
        </button>
      )}
    </form>
  )
}

// -- Donut + ranked list column ---------------------------------------------------
function TrafficColumn({
  title, accentColor, colors, totalBytes, peers, selectedPeer, onSelectPeer,
}: {
  title: string
  accentColor: string
  colors: string[]
  totalBytes: number
  peers: { ip: string; bytes: number }[]
  selectedPeer: string
  onSelectPeer: (ip: string) => void
}) {
  const maxBytes = peers[0]?.bytes || 1

  return (
    <div className="flex-col-gap">
      <div className="stat-label" style={{ color: accentColor }}>
        {title}
      </div>
      <div className="grid-traffic-column">
        {/* Donut chart */}
        <ResponsiveContainer width="100%" height={130}>
          <PieChart>
            <Pie
              data={peers.length ? peers : [{ ip: 'none', bytes: 1 }]}
              dataKey="bytes"
              nameKey="ip"
              cx="50%" cy="50%"
              innerRadius={38}
              outerRadius={58}
              strokeWidth={1}
            >
              {(peers.length ? peers : [{ ip: 'none', bytes: 1 }]).map((_: any, i: number) => (
                <Cell
                  key={i}
                  fill={peers.length ? colors[i % colors.length] : 'var(--border)'}
                />
              ))}
              <Label
                value={formatBytes(totalBytes)}
                position="center"
                style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-main)' }}
              />
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
          </PieChart>
        </ResponsiveContainer>

        {/* Ranked list */}
        <div className="peer-list">
          {peers.length === 0 && (
            <div className="text-muted text-xs">No data</div>
          )}
          {peers.slice(0, 8).map((peer, i) => {
            const pct = Math.round((peer.bytes / maxBytes) * 100)
            const isSelected = selectedPeer === peer.ip
            return (
              <div
                key={peer.ip}
                onClick={() => onSelectPeer(isSelected ? '' : peer.ip)}
                className={`peer-row${isSelected ? ' peer-row--selected' : ''}`}
                style={isSelected ? { background: `${accentColor}18`, borderColor: `${accentColor}40` } : undefined}
              >
                <span className="peer-rank">{i + 1}</span>
                <span className="peer-swatch" style={{ background: colors[i % colors.length] }} />
                <span className="mono peer-ip" style={{ color: accentColor }}>{peer.ip}</span>
                <div className="peer-bar-track">
                  <div className="peer-bar-fill" style={{ width: `${pct}%`, background: colors[i % colors.length] }} />
                </div>
                <span className="peer-bytes">{formatBytes(peer.bytes)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// -- IP Profile card --------------------------------------------------------------
function IpProfile({
  ip, hours, selectedPeer, onSelectPeer,
}: {
  ip: string
  hours: number
  selectedPeer: string
  onSelectPeer: (peer: string) => void
}) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['ip-profile', ip, hours],
    queryFn: () => flowsApi.ipProfile(ip, hours).then((r) => r.data),
    enabled: !!ip,
  })

  if (isLoading) return <div className="card card-body">Loading profile for {ip}...</div>
  if (!profile)  return null

  const topOut: { ip: string; bytes: number }[] = profile.top_out || []
  const topIn:  { ip: string; bytes: number }[] = profile.top_in  || []

  return (
    <div className="card">
      <div className="card-header">
        <Activity size={15} />
        <h3>
          IP Profile —{' '}
          <span className="mono link-primary">{ip}</span>
        </h3>
      </div>
      <div className="card-body flex-col-gap">

        {/* Stat row */}
        <div className="stats-grid">
          {[
            { label: 'Sent',           value: formatBytes(profile.bytes_sent),     icon: <ArrowUpRight size={12} />, color: 'var(--accent-blue, var(--primary))'  },
            { label: 'Received',       value: formatBytes(profile.bytes_received), icon: <ArrowDownRight size={12} />, color: 'var(--accent-green)' },
            { label: 'Flows as Source', value: profile.flows_as_src.toLocaleString() + ' flows', icon: <ArrowUpRight size={12} />, color: 'var(--accent-blue, var(--primary))'  },
            { label: 'Flows as Dest',  value: profile.flows_as_dst.toLocaleString() + ' flows', icon: <ArrowDownRight size={12} />, color: 'var(--accent-green)' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="info-card">
              <div className="stat-label">
                <span style={{ color }}>{icon}</span> {label}
              </div>
              <div className="stat-value-sm mono">{value}</div>
            </div>
          ))}
        </div>

        {/* TOP OUT | TOP IN */}
        <div className="grid-2">
          <TrafficColumn
            title="Top Out (destinations)"
            accentColor="var(--accent-blue, var(--primary))"
            colors={COLORS}
            totalBytes={profile.bytes_sent}
            peers={topOut}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
          />
          <TrafficColumn
            title="Top In (sources)"
            accentColor="var(--accent-green)"
            colors={COLORS_IN}
            totalBytes={profile.bytes_received}
            peers={topIn}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
          />
        </div>

        {/* Protocol distribution */}
        {profile.protocol_distribution.length > 0 && (
          <div>
            <div className="stat-label">
              Protocols
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie
                  data={profile.protocol_distribution}
                  dataKey="bytes"
                  nameKey="protocol"
                  cx="50%" cy="50%"
                  outerRadius={50}
                >
                  {profile.protocol_distribution.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                <Legend formatter={(v) => <span className="text-muted text-xs">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {profile.flows_as_src + profile.flows_as_dst === 0 && (
          <div className="empty-state">
            <p>No flows found for {ip} in the selected time window</p>
          </div>
        )}
      </div>
    </div>
  )
}

// -- main page --------------------------------------------------------------------
export default function FlowsPage() {
  const [hours, setHours]           = useState(1)
  const [searchIp, setSearchIp]     = useState('')
  const [selectedPeer, setSelectedPeer] = useState('')
  // null = "all selected" (no filter sent); otherwise a Set of selected device IDs
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<number> | null>(null)

  function handleSearchChange(ip: string) {
    setSearchIp(ip)
    setSelectedPeer('')
  }

  // Fetch devices that have flow collection enabled
  const { data: flowDevices = [] } = useQuery<any[]>({
    queryKey: ['flow-devices'],
    queryFn: () =>
      devicesApi.list().then((r) =>
        (r.data as any[]).filter((d) => d.flow_enabled === true)
      ),
    staleTime: 5 * 60_000,
  })

  // Reset selection when time range changes
  useEffect(() => {
    setSelectedDeviceIds(null)
  }, [hours])

  function toggleDevice(id: number) {
    const allIds = new Set(flowDevices.map((d) => d.id))
    const current = selectedDeviceIds ?? allIds
    const next = new Set(current)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedDeviceIds(next.size === allIds.size ? null : next)
  }

  // Build device_ids param: undefined when all selected, comma-list when filtered
  const deviceIdsParam: string | undefined =
    selectedDeviceIds === null
      ? undefined
      : selectedDeviceIds.size === 0
      ? '-1'                        // nothing selected -> return no results
      : [...selectedDeviceIds].join(',')

  const { data: stats, isLoading } = useQuery({
    queryKey: ['flow-stats', hours, deviceIdsParam],
    queryFn: () => flowsApi.stats({ hours, ...(deviceIdsParam ? { device_ids: deviceIdsParam } : {}) }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: conversations } = useQuery({
    queryKey: ['flow-conversations', hours, searchIp, deviceIdsParam],
    queryFn: () =>
      flowsApi.conversations({
        hours,
        limit: 100,
        ...(searchIp ? { ip: searchIp } : {}),
        ...(deviceIdsParam ? { device_ids: deviceIdsParam } : {}),
      }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  // When a peer is selected, filter conversations client-side
  const displayedConversations = selectedPeer
    ? (conversations || []).filter((f: any) =>
        (f.src_ip === searchIp && f.dst_ip === selectedPeer) ||
        (f.src_ip === selectedPeer && f.dst_ip === searchIp)
      )
    : (conversations || [])

  return (
    <div className="flex-col-gap">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Flow Analysis</h1>
          <p>NetFlow &amp; sFlow traffic analysis</p>
        </div>
        <div className="flex-row-gap">
          <IpSearchBar value={searchIp} onChange={handleSearchChange} onClear={() => { setSearchIp(''); setSelectedPeer('') }} />
          <div className="time-range-bar">
            {TIME_RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={`time-btn${hours === r.hours ? ' active' : ''}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Device filter -- shown when at least one device is sending flows */}
      {flowDevices.length > 0 && (
        <div className="card device-filter-bar">
          <div className="flex-row-gap device-filter-inner">
            <span className="stat-label device-filter-label">
              Devices
            </span>
            {flowDevices.map((d) => {
              const isSelected = selectedDeviceIds === null || selectedDeviceIds.has(d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => toggleDevice(d.id)}
                  className={`filter-chip${isSelected ? ' active' : ''}`}
                >
                  <span className={`status-dot ${isSelected ? 'dot-green' : ''}`} />
                  {d.hostname}
                  <span className="mono text-xs text-muted">{d.ip_address}</span>
                </button>
              )
            })}
            {selectedDeviceIds !== null && (
              <button
                className="btn btn-outline btn-sm ml-auto"
                onClick={() => setSelectedDeviceIds(null)}
              >
                Show all
              </button>
            )}
          </div>
        </div>
      )}

      {/* IP Profile -- only shown when searching */}
      {searchIp && (
        <IpProfile
          ip={searchIp}
          hours={hours}
          selectedPeer={selectedPeer}
          onSelectPeer={setSelectedPeer}
        />
      )}

      {/* Global stats cards */}
      {!searchIp && stats && (
        <div className="grid-2">
          <div className="stat-card">
            <div className="stat-icon blue">
              <Activity size={20} />
            </div>
            <div className="stat-body">
              <div className="stat-label">Total Flows</div>
              <div className="stat-value">{stats.total_flows.toLocaleString()}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">
              <Activity size={20} />
            </div>
            <div className="stat-body">
              <div className="stat-label">Total Traffic</div>
              <div className="stat-value">{formatBytes(stats.total_bytes)}</div>
            </div>
          </div>
        </div>
      )}

      {isLoading && !searchIp ? (
        <div className="empty-state card"><p>Loading flow data...</p></div>
      ) : !searchIp && (!stats || stats.total_flows === 0) ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-state__icon">
                <Activity size={48} />
              </div>
              <p className="empty-state__title">No flow data available</p>
              <p className="empty-state__description">Configure your network devices to export NetFlow to this server on UDP port 2055</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Charts -- hidden while doing IP search */}
          {!searchIp && stats && (
            <div className="grid-2">
              <div className="card">
                <div className="card-header">
                  <Activity size={15} />
                  <h3>Top Talkers (by bytes)</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={stats.top_talkers} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatBytes(v)} />
                      <YAxis
                        type="category" dataKey="ip"
                        tick={(props) => {
                          const { x, y, payload } = props
                          return (
                            <text x={x} y={y} dy={4} textAnchor="end" fill="#1a9dc8" fontSize={11}
                              className="chart-tick-link"
                              onClick={() => handleSearchChange(payload.value)}
                            >
                              {payload.value}
                            </text>
                          )
                        }}
                        tickLine={false} width={80}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatBytes(v), 'Traffic']} />
                      <Bar dataKey="bytes" fill="#1a9dc8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <Activity size={15} />
                  <h3>Top Destinations</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={stats.top_destinations} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatBytes(v)} />
                      <YAxis
                        type="category" dataKey="ip"
                        tick={(props) => {
                          const { x, y, payload } = props
                          return (
                            <text x={x} y={y} dy={4} textAnchor="end" fill="#27ae60" fontSize={11}
                              className="chart-tick-link"
                              onClick={() => handleSearchChange(payload.value)}
                            >
                              {payload.value}
                            </text>
                          )
                        }}
                        tickLine={false} width={80}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatBytes(v), 'Traffic']} />
                      <Bar dataKey="bytes" fill="#27ae60" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <Activity size={15} />
                  <h3>Protocol Distribution</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={stats.protocol_distribution} dataKey="bytes" nameKey="protocol" cx="50%" cy="50%" outerRadius={80}
                        label={({ protocol, percent }: any) => `${protocol} ${(percent * 100).toFixed(1)}%`} labelLine={false}>
                        {stats.protocol_distribution.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <Activity size={15} />
                  <h3>Applications</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={stats.application_distribution} dataKey="bytes" nameKey="app" cx="50%" cy="50%" outerRadius={80}>
                        {stats.application_distribution.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                      <Legend formatter={(v) => <span className="text-muted text-sm">{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Conversations table */}
          <div className="card">
            <div className="card-header">
              <Activity size={15} />
              <h3>
                {searchIp && selectedPeer ? (
                  <>
                    Flows:{' '}
                    <span className="mono link-primary">{searchIp}</span>
                    {' \u2194 '}
                    <span className="mono text-success">{selectedPeer}</span>
                  </>
                ) : searchIp ? (
                  <>Flows involving <span className="mono link-primary">{searchIp}</span></>
                ) : (
                  'Top Conversations'
                )}
              </h3>
              {selectedPeer && (
                <button
                  className="btn btn-outline btn-sm ml-auto"
                  onClick={() => setSelectedPeer('')}
                >
                  Show all flows
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {searchIp && <th className="flow-dir-col"></th>}
                    <th>Source IP</th>
                    <th>Destination IP</th>
                    <th>Protocol</th>
                    <th>Dst Port</th>
                    <th>Application</th>
                    <th>Bytes</th>
                    <th>Packets</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedConversations.map((flow: any) => {
                    const isOutgoing = flow.src_ip === searchIp
                    return (
                      <tr key={flow.id}>
                        {searchIp && (
                          <td title={isOutgoing ? 'Outgoing' : 'Incoming'} className="text-center">
                            {isOutgoing
                              ? <ArrowUpRight size={14} className="flow-dir-out" />
                              : <ArrowDownRight size={14} className="flow-dir-in" />
                            }
                          </td>
                        )}
                        <td className="mono text-sm">
                          {flow.src_ip === searchIp
                            ? <span className="font-semibold link-primary">{flow.src_ip}</span>
                            : (
                              <button className="btn--ghost mono text-sm link-primary"
                                onClick={() => handleSearchChange(flow.src_ip)}>
                                {flow.src_ip}
                              </button>
                            )
                          }
                        </td>
                        <td className="mono text-sm">
                          {flow.dst_ip === searchIp
                            ? <span className="font-semibold text-success">{flow.dst_ip}</span>
                            : (
                              <button className="btn--ghost mono text-sm link-primary"
                                onClick={() => handleSearchChange(flow.dst_ip)}>
                                {flow.dst_ip}
                              </button>
                            )
                          }
                        </td>
                        <td><span className="tag-blue">{flow.protocol}</span></td>
                        <td className="mono text-sm text-muted">{flow.dst_port}</td>
                        <td className="text-sm text-muted">{flow.application || '\u2014'}</td>
                        <td className="mono text-sm">{formatBytes(flow.bytes)}</td>
                        <td className="text-muted">{flow.packets?.toLocaleString()}</td>
                        <td className="text-xs text-light">
                          {flow.timestamp ? new Date(flow.timestamp).toLocaleTimeString() : '\u2014'}
                        </td>
                      </tr>
                    )
                  })}
                  {displayedConversations.length === 0 && (
                    <tr>
                      <td colSpan={searchIp ? 9 : 8} className="empty-table-cell">
                        {selectedPeer
                          ? `No flows between ${searchIp} and ${selectedPeer}`
                          : searchIp
                          ? `No flows found for ${searchIp}`
                          : 'No conversations'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
