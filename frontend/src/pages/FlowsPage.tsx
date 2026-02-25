import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi, devicesApi } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Label,
} from 'recharts'
import {
  Search, Globe, Copy, ExternalLink, X, ArrowUpRight, ArrowDownLeft, ArrowRight,
  Activity, HardDrive, BarChart3, Check, AlertTriangle, Clock,
  Filter, Loader2, Calendar,
} from 'lucide-react'

const COLORS_OUT = ['#0284c7', '#38bdf8', '#7dd3fc', '#bae6fd', '#0369a1', '#075985', '#0c4a6e', '#0ea5e9']
const COLORS_IN  = ['#15803d', '#22c55e', '#4ade80', '#86efac', '#166534', '#14532d', '#16a34a', '#a3e635']
const COLORS     = ['#1a9dc8', '#a78bfa', '#06b6d4', '#f97316', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']

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

type TimeRange =
  | { mode: 'preset'; hours: number }
  | { mode: 'custom'; start: string; end: string; label: string }

function timeParams(tr: TimeRange): Record<string, string | number> {
  return tr.mode === 'preset'
    ? { hours: tr.hours }
    : { start: tr.start, end: tr.end }
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatRangeLabel(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${fmt(s)} \u2013 ${fmt(e)}`
}

// -- Custom Range Picker -------------------------------------------------------
function CustomRangePicker({
  active,
  onApply,
  onClear,
}: {
  active: TimeRange
  onApply: (start: string, end: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const now = new Date()
  const ago24 = new Date(now.getTime() - 24 * 3600_000)
  const [from, setFrom] = useState(toLocalInput(ago24))
  const [to, setTo] = useState(toLocalInput(now))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function apply() {
    if (from && to) {
      onApply(new Date(from).toISOString(), new Date(to).toISOString())
      setOpen(false)
    }
  }

  const isCustom = active.mode === 'custom'

  return (
    <div ref={ref} className="time-range-custom">
      <button
        className={`time-btn${isCustom ? ' active' : ''}`}
        onClick={() => { if (isCustom) { onClear() } else { setOpen(!open) } }}
        title={isCustom ? 'Click to clear custom range' : 'Select custom date range'}
      >
        <Calendar size={11} />
        {isCustom ? (active as any).label : 'Custom'}
      </button>
      {open && (
        <div className="time-range-popover">
          <div className="time-range-popover__title">Custom Time Range</div>
          <div className="time-range-popover__field">
            <label className="form-label">From</label>
            <input type="datetime-local" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="time-range-popover__field">
            <label className="form-label">To</label>
            <input type="datetime-local" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="time-range-popover__actions">
            <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}

const PORT_NAMES: Record<number, string> = {
  20: 'FTP Data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
  53: 'DNS', 67: 'DHCP Server', 68: 'DHCP Client', 69: 'TFTP',
  80: 'HTTP', 110: 'POP3', 123: 'NTP', 143: 'IMAP', 161: 'SNMP',
  162: 'SNMP Trap', 389: 'LDAP', 443: 'HTTPS', 445: 'Microsoft SMB',
  465: 'SMTPS', 514: 'Syslog', 587: 'SMTP Submission', 636: 'LDAPS',
  993: 'IMAPS', 995: 'POP3S', 1433: 'Microsoft SQL', 1521: 'Oracle DB',
  3306: 'MySQL', 3389: 'Microsoft RDP', 5432: 'PostgreSQL', 5900: 'VNC',
  6379: 'Redis', 8080: 'HTTP Alt', 8443: 'HTTPS Alt', 9090: 'Prometheus',
}
function portName(port: number): string {
  return PORT_NAMES[port] || `port/${port}`
}

// -- Recent IPs ----------------------------------------------------------------
const RECENT_IPS_KEY = 'netmon-recent-ips'
function getRecentIps(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_IPS_KEY) || '[]')
  } catch { return [] }
}
function addRecentIp(ip: string) {
  const list = getRecentIps().filter((i) => i !== ip)
  list.unshift(ip)
  localStorage.setItem(RECENT_IPS_KEY, JSON.stringify(list.slice(0, 10)))
}

// -- IP search bar --------------------------------------------------------------
function IpSearchBar({
  value, onChange, onClear,
}: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(value)
  const [showRecent, setShowRecent] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const recentIps = getRecentIps()

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowRecent(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const ip = draft.trim()
    if (ip) { addRecentIp(ip); onChange(ip) }
    setShowRecent(false)
  }

  function pickRecent(ip: string) {
    setDraft(ip)
    addRecentIp(ip)
    onChange(ip)
    setShowRecent(false)
  }

  return (
    <div ref={wrapRef} className="recent-ips">
      <form onSubmit={submit} className="flex-row-gap">
        <div className="search-bar">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search by IP address..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => recentIps.length > 0 && setShowRecent(true)}
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
      {showRecent && recentIps.length > 0 && (
        <div className="recent-ips__dropdown">
          <div className="recent-ips__header">Recent Searches</div>
          {recentIps.map((ip) => (
            <button key={ip} className="recent-ips__item" onClick={() => pickRecent(ip)}>
              <Clock size={12} />
              {ip}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// -- Traffic Direction Card ----------------------------------------------------
function TrafficDirectionCard({
  title, icon, emptyLabel, emptyDesc,
  colors, totalBytes, peers, selectedPeer, onSelectPeer, onNavigateIp,
}: {
  title: string
  icon: React.ReactNode
  emptyLabel: string
  emptyDesc: string
  colors: string[]
  totalBytes: number
  peers: { ip: string; bytes: number }[]
  selectedPeer: string
  onSelectPeer: (ip: string) => void
  onNavigateIp: (ip: string) => void
}) {
  if (totalBytes === 0 || peers.length === 0) {
    return (
      <div className="traffic-card traffic-card--empty">
        <div className="traffic-card__empty-state">
          {icon}
          <div className="traffic-card__empty-title">{emptyLabel}</div>
          <div className="traffic-card__empty-desc">{emptyDesc}</div>
        </div>
      </div>
    )
  }

  const maxBytes = peers[0]?.bytes || 1

  return (
    <div className="traffic-card">
      <div className="traffic-card__header">
        {icon}
        <h3>{title}</h3>
      </div>
      <div className="traffic-card__body">
        {/* Donut */}
        <div className="traffic-card__donut">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={peers.slice(0, 8)}
                dataKey="bytes"
                nameKey="ip"
                cx="50%" cy="50%"
                innerRadius={55}
                outerRadius={80}
                strokeWidth={1}
              >
                {peers.slice(0, 8).map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
                <Label
                  value={formatBytes(totalBytes)}
                  position="center"
                  style={{ fontSize: 13, fontWeight: 700, fill: 'var(--text-main)' }}
                />
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Ranked list */}
        <div className="traffic-card__peer-list">
          {peers.slice(0, 8).map((peer, i) => {
            const pct = totalBytes > 0 ? ((peer.bytes / totalBytes) * 100).toFixed(1) : '0.0'
            const barPct = Math.round((peer.bytes / maxBytes) * 100)
            const isSelected = selectedPeer === peer.ip
            return (
              <div
                key={peer.ip}
                className={`traffic-card__peer-row${isSelected ? ' traffic-card__peer-row--selected' : ''}`}
                onClick={() => onSelectPeer(isSelected ? '' : peer.ip)}
              >
                <span className="traffic-card__peer-rank">{i + 1}</span>
                <span className="traffic-card__peer-dot" style={{ background: colors[i % colors.length] }} />
                <button
                  className="traffic-card__peer-ip flow-ip-link"
                  title="Click to investigate this IP"
                  onClick={(e) => {
                    e.stopPropagation()
                    onNavigateIp(peer.ip)
                  }}
                >
                  {peer.ip}
                </button>
                <div className="traffic-card__peer-bar">
                  <div className="traffic-card__peer-bar-fill" style={{ width: `${barPct}%`, background: colors[i % colors.length] }} />
                </div>
                <span className="traffic-card__peer-bytes">{formatBytes(peer.bytes)}</span>
                <span className="traffic-card__peer-pct">{pct}%</span>
                {isSelected && <Check size={14} className="traffic-card__peer-check" />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// -- Traffic Balance -----------------------------------------------------------
function TrafficBalance({ sent, received }: { sent: number; received: number }) {
  const total = sent + received
  const sentPct = total > 0 ? (sent / total) * 100 : 50
  const rcvPct = total > 0 ? (received / total) * 100 : 50

  let badge: { label: string; cls: string }
  if (sent === 0 && received > 0)      badge = { label: 'Download Target', cls: 'traffic-balance__badge--green' }
  else if (received === 0 && sent > 0) badge = { label: 'Upload Source', cls: 'traffic-balance__badge--blue' }
  else if (total === 0)                badge = { label: 'No Traffic', cls: 'traffic-balance__badge--gray' }
  else {
    const ratio = Math.max(sent, received) / Math.max(Math.min(sent, received), 1)
    if (ratio < 3) badge = { label: 'Balanced', cls: 'traffic-balance__badge--gray' }
    else badge = { label: `Asymmetric (${sent > received ? 'send' : 'receive'} dominant)`, cls: 'traffic-balance__badge--orange' }
  }

  return (
    <div className="traffic-balance">
      <div className="traffic-balance__title">Traffic Balance</div>
      <div className="traffic-balance__bar">
        <div className="traffic-balance__bar-sent" style={{ width: `${total > 0 ? Math.max(sentPct, 0.5) : 50}%` }} />
        <div className="traffic-balance__bar-received" style={{ width: `${total > 0 ? Math.max(rcvPct, 0.5) : 50}%` }} />
      </div>
      <div className="traffic-balance__labels">
        <span>{formatBytes(sent)} sent</span>
        <span>{formatBytes(received)} received</span>
      </div>
      <div className="traffic-balance__pct">
        {total > 0 ? `${sentPct.toFixed(1)}% sent \u2014 ${rcvPct.toFixed(1)}% received` : 'No traffic data'}
      </div>
      <div className="traffic-balance__classification">
        Ratio: {total > 0 ? `${sent > 0 ? (sent / Math.max(received, 1)).toFixed(1) : '0'} : ${received > 0 ? (received / Math.max(sent, 1)).toFixed(1) : '0'}` : '0 : 0'}
        <span className={`traffic-balance__badge ${badge.cls}`}>{badge.label}</span>
      </div>
    </div>
  )
}

// -- IP Profile card -----------------------------------------------------------
function IpProfile({
  ip, timeRangeParams, selectedPeer, onSelectPeer, onClear, onNavigateIp,
}: {
  ip: string
  timeRangeParams: Record<string, string | number>
  selectedPeer: string
  onSelectPeer: (peer: string) => void
  onClear: () => void
  onNavigateIp: (ip: string) => void
}) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['ip-profile', ip, timeRangeParams],
    queryFn: () => flowsApi.ipProfile(ip, timeRangeParams).then((r) => r.data),
    enabled: !!ip,
  })

  // Top Ports from ip-profile API response
  const topPorts = useMemo(() => {
    if (!profile?.top_ports) return []
    return profile.top_ports.map((p: any) => ({
      port: p.port, bytes: p.bytes, name: portName(p.port),
    }))
  }, [profile])

  if (isLoading) {
    return (
      <div className="card card-body flex-row-gap">
        <Loader2 size={16} className="animate-spin" />
        Loading profile for {ip}...
      </div>
    )
  }
  if (!profile) return null

  const topOut: { ip: string; bytes: number }[] = profile.top_out || []
  const topIn:  { ip: string; bytes: number }[] = profile.top_in  || []
  const totalFlows = profile.total_flows ?? (profile.flows_as_src + profile.flows_as_dst)
  const totalBytes = profile.total_bytes ?? (profile.bytes_sent + profile.bytes_received)
  const isUnidirectional = profile.unidirectional
  // For unidirectional data, use whichever peers we have
  const uniPeers = topIn.length > 0 ? topIn : topOut
  const uniBytes = Math.max(profile.bytes_sent, profile.bytes_received)

  return (
    <div className="ip-profile">
      {/* SECTION 1: Banner */}
      <div className="ip-profile__banner">
        <div className="ip-profile__banner-top">
          <div className="ip-profile__banner-icon">
            <Globe />
          </div>
          <div className="ip-profile__banner-info">
            <div className="ip-profile__banner-label">IP Profile</div>
            <div className="ip-profile__ip-address">{ip}</div>
            <div className="ip-profile__summary">
              {totalFlows.toLocaleString()} total flows &middot; {formatBytes(totalBytes)} total traffic
            </div>
          </div>
          <div className="ip-profile__actions">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => navigator.clipboard.writeText(ip)}
              title="Copy IP to clipboard"
            >
              <Copy size={12} /> Copy IP
            </button>
            <a
              href={`https://whois.domaintools.com/${ip}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-sm"
            >
              <ExternalLink size={12} /> Whois
            </a>
            <button className="btn btn-outline btn-sm" onClick={onClear}>
              <X size={12} /> Clear
            </button>
          </div>
        </div>

        {/* Stat mini-cards */}
        <div className="ip-profile__stats">
          {isUnidirectional ? (
            <>
              {/* Total Traffic */}
              <div className="ip-profile__stat-card ip-profile__stat-card--blue">
                <div className="ip-profile__stat-icon ip-profile__stat-icon--blue">
                  <Activity size={14} /> TOTAL TRAFFIC
                </div>
                <div className="ip-profile__stat-value">{formatBytes(totalBytes)}</div>
              </div>
              {/* Total Flows */}
              <div className="ip-profile__stat-card ip-profile__stat-card--green">
                <div className="ip-profile__stat-icon ip-profile__stat-icon--green">
                  <Activity size={14} /> TOTAL FLOWS
                </div>
                <div className="ip-profile__stat-value">{totalFlows.toLocaleString()}</div>
              </div>
              {/* Top Peers count */}
              <div className="ip-profile__stat-card ip-profile__stat-card--blue">
                <div className="ip-profile__stat-icon ip-profile__stat-icon--blue">
                  <Globe size={14} /> UNIQUE PEERS
                </div>
                <div className="ip-profile__stat-value">{profile.top_peers?.length ?? 0}</div>
              </div>
            </>
          ) : (
            <>
              {/* Sent */}
              <div className={`ip-profile__stat-card ip-profile__stat-card--blue${profile.bytes_sent === 0 ? ' ip-profile__stat-card--dimmed' : ''}`}>
                <div className="ip-profile__stat-icon ip-profile__stat-icon--blue">
                  <ArrowUpRight size={14} /> SENT
                </div>
                <div className="ip-profile__stat-value">{formatBytes(profile.bytes_sent)}</div>
              </div>
              {/* Received */}
              <div className={`ip-profile__stat-card ip-profile__stat-card--green${profile.bytes_received === 0 ? ' ip-profile__stat-card--dimmed' : ''}`}>
                <div className="ip-profile__stat-icon ip-profile__stat-icon--green">
                  <ArrowDownLeft size={14} /> RECEIVED
                </div>
                <div className="ip-profile__stat-value">{formatBytes(profile.bytes_received)}</div>
              </div>
              {/* As Source */}
              <div className={`ip-profile__stat-card ip-profile__stat-card--blue${profile.flows_as_src === 0 ? ' ip-profile__stat-card--dimmed' : ''}`}>
                <div className="ip-profile__stat-icon ip-profile__stat-icon--blue">
                  <ArrowUpRight size={14} /> AS SOURCE
                </div>
                <div className="ip-profile__stat-value">{profile.flows_as_src.toLocaleString()}</div>
              </div>
              {/* As Dest */}
              <div className={`ip-profile__stat-card ip-profile__stat-card--green${profile.flows_as_dst === 0 ? ' ip-profile__stat-card--dimmed' : ''}`}>
                <div className="ip-profile__stat-icon ip-profile__stat-icon--green">
                  <ArrowDownLeft size={14} /> AS DEST
                </div>
                <div className="ip-profile__stat-value">{profile.flows_as_dst.toLocaleString()}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* SECTION 2: Traffic Direction Cards */}
      {isUnidirectional ? (
        <div className="grid-1">
          <TrafficDirectionCard
            title="Top Peers (by total traffic)"
            icon={<Activity size={15} />}
            emptyLabel="No traffic"
            emptyDesc="No flow data in the selected time window"
            colors={COLORS_IN}
            totalBytes={uniBytes}
            peers={uniPeers}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
            onNavigateIp={onNavigateIp}
          />
        </div>
      ) : (
        <div className="grid-2">
          <TrafficDirectionCard
            title="Outbound Traffic (Destinations)"
            icon={<ArrowUpRight size={15} className="flow-direction-icon--out" />}
            emptyLabel="No outbound traffic"
            emptyDesc="This IP has not sent any data in the selected time window"
            colors={COLORS_OUT}
            totalBytes={profile.bytes_sent}
            peers={topOut}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
            onNavigateIp={onNavigateIp}
          />
          <TrafficDirectionCard
            title="Inbound Traffic (Sources)"
            icon={<ArrowDownLeft size={15} className="flow-direction-icon--in" />}
            emptyLabel="No inbound traffic"
            emptyDesc="This IP has not received any data in the selected time window"
            colors={COLORS_IN}
            totalBytes={profile.bytes_received}
            peers={topIn}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
            onNavigateIp={onNavigateIp}
          />
        </div>
      )}

      {/* SECTION 3: Protocol & Port Analysis */}
      <div className="grid-2">
        {/* Protocol Distribution */}
        <div className="card">
          <div className="card-header">
            <BarChart3 size={15} />
            <h3>Protocol Distribution</h3>
          </div>
          <div className="card-body">
            {profile.protocol_distribution.length === 0 ? (
              <div className="empty-state"><p>No protocol data</p></div>
            ) : profile.protocol_distribution.length === 1 ? (
              <div className="protocol-single">
                <span className="protocol-single__name">{profile.protocol_distribution[0].protocol}</span>
                <div className="protocol-single__bar" />
                <span className="protocol-single__stat">
                  {profile.protocol_distribution[0].count.toLocaleString()} flows &middot; {formatBytes(profile.protocol_distribution[0].bytes)}
                </span>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={40}>
                  <BarChart data={[profile.protocol_distribution.reduce((acc: any, p: any) => { acc[p.protocol] = p.bytes; return acc }, {})]} layout="horizontal" barSize={28}>
                    {profile.protocol_distribution.map((p: any, i: number) => (
                      <Bar key={p.protocol} dataKey={p.protocol} stackId="a" fill={COLORS[i % COLORS.length]} radius={i === 0 ? [4, 0, 0, 4] : i === profile.protocol_distribution.length - 1 ? [0, 4, 4, 0] : 0} />
                    ))}
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="protocol-legend">
                  {profile.protocol_distribution.map((p: any, i: number) => (
                    <div key={p.protocol} className="protocol-legend__item">
                      <span className="protocol-legend__dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span>{p.protocol}</span>
                      <span className="mono">{p.count.toLocaleString()}</span>
                      <span className="mono">{formatBytes(p.bytes)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Top Ports */}
        <div className="card">
          <div className="card-header">
            <BarChart3 size={15} />
            <h3>Top Ports</h3>
          </div>
          <div className="card-body">
            {topPorts.length === 0 ? (
              <div className="empty-state"><p>No port data available</p></div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(topPorts.length * 28 + 20, 100)}>
                <BarChart data={topPorts} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatBytes(v)} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatBytes(v), 'Traffic']} />
                  <Bar dataKey="bytes" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 4: Traffic Balance (only when bidirectional data available) */}
      {!isUnidirectional && (
        <TrafficBalance sent={profile.bytes_sent} received={profile.bytes_received} />
      )}

      {/* No flows state */}
      {totalFlows === 0 && (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-state__icon"><Activity size={48} /></div>
              <p className="empty-state__title">No flows found</p>
              <p className="empty-state__description">No flows found for {ip} in the selected time window</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// -- main page -----------------------------------------------------------------
export default function FlowsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>({ mode: 'preset', hours: 1 })
  const [searchIp, setSearchIp]     = useState('')
  const [selectedPeer, setSelectedPeer] = useState('')
  // null = "all selected" (no filter sent); otherwise a Set of selected device IDs
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<number> | null>(null)

  const trParams = timeParams(timeRange)

  function handleSearchChange(ip: string) {
    addRecentIp(ip)
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
  }, [timeRange])

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
    queryKey: ['flow-stats', trParams, deviceIdsParam],
    queryFn: () => flowsApi.stats({ ...trParams, ...(deviceIdsParam ? { device_ids: deviceIdsParam } : {}) }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: conversations } = useQuery({
    queryKey: ['flow-conversations', trParams, searchIp, deviceIdsParam],
    queryFn: () =>
      flowsApi.conversations({
        ...trParams,
        limit: 100,
        ...(searchIp ? { ip: searchIp } : {}),
        ...(deviceIdsParam ? { device_ids: deviceIdsParam } : {}),
      }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  // When IP is searched, conversations are aggregated by peer.
  // When a peer is selected from the traffic cards, filter to that peer.
  const isAggregated = searchIp && conversations?.[0]?.aggregated
  const displayedConversations = selectedPeer
    ? (conversations || []).filter((f: any) =>
        isAggregated
          ? f.peer_ip === selectedPeer
          : (f.src_ip === searchIp && f.dst_ip === selectedPeer) ||
            (f.src_ip === selectedPeer && f.dst_ip === searchIp)
      )
    : (conversations || [])

  const maxBytesInView = useMemo(() => {
    return Math.max(...displayedConversations.map((f: any) => f.bytes || 0), 1)
  }, [displayedConversations])

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
                onClick={() => setTimeRange({ mode: 'preset', hours: r.hours })}
                className={`time-btn${timeRange.mode === 'preset' && timeRange.hours === r.hours ? ' active' : ''}`}
              >
                {r.label}
              </button>
            ))}
            <CustomRangePicker
              active={timeRange}
              onApply={(start, end) => setTimeRange({ mode: 'custom', start, end, label: formatRangeLabel(start, end) })}
              onClear={() => setTimeRange({ mode: 'preset', hours: 1 })}
            />
          </div>
        </div>
      </div>

      {/* Device filter */}
      {flowDevices.length > 0 && (
        <div className="card device-filter-bar">
          <div className="flex-row-gap device-filter-inner">
            <span className="stat-label device-filter-label">
              <Filter size={11} /> Devices
            </span>
            {flowDevices.map((d) => {
              const isSelected = selectedDeviceIds === null || selectedDeviceIds.has(d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => toggleDevice(d.id)}
                  className={`device-chip${isSelected ? ' device-chip--active' : ''}`}
                >
                  <span className="device-chip__dot" />
                  <span className="device-chip__name">{d.hostname}</span>
                  <span className="device-chip__ip">{d.ip_address}</span>
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
          timeRangeParams={trParams}
          selectedPeer={selectedPeer}
          onSelectPeer={setSelectedPeer}
          onClear={() => { setSearchIp(''); setSelectedPeer('') }}
          onNavigateIp={handleSearchChange}
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
              <HardDrive size={20} />
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
                  <BarChart3 size={15} />
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
                  <BarChart3 size={15} />
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
                  <BarChart3 size={15} />
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
                  <BarChart3 size={15} />
                  <h3>Applications</h3>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={stats.application_distribution} dataKey="bytes" nameKey="app" cx="50%" cy="50%" outerRadius={80}>
                        {stats.application_distribution.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5: Conversations table */}
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
                  <>Top Conversations with <span className="mono link-primary">{searchIp}</span></>
                ) : (
                  'Top Conversations'
                )}
              </h3>
              <span className="card-header__sub">
                Showing {displayedConversations.length}{conversations ? ` of ${conversations.length}` : ''} {isAggregated ? 'peers' : 'flows'}
              </span>
              {selectedPeer && (
                <button
                  className="btn btn-outline btn-sm ml-auto"
                  onClick={() => setSelectedPeer('')}
                >
                  Show all flows
                </button>
              )}
            </div>

            {/* Filter banner */}
            {selectedPeer && (
              <div className="flow-filter-banner">
                <Filter size={12} />
                Filtered: showing only flows between <strong className="mono">{searchIp}</strong> and <strong className="mono">{selectedPeer}</strong>
                <button className="btn btn-outline btn-sm ml-auto" onClick={() => setSelectedPeer('')}>
                  <X size={10} /> Clear filter
                </button>
              </div>
            )}

            <div className="table-wrap">
              <table className="flow-table">
                <thead>
                  <tr>
                    {isAggregated ? (
                      <>
                        <th>#</th>
                        <th>Peer IP</th>
                        <th>Total Bytes</th>
                        <th>Packets</th>
                        <th>Flows</th>
                      </>
                    ) : (
                      <>
                        {searchIp && <th className="flow-dir-col"></th>}
                        <th>Source IP</th>
                        <th></th>
                        <th>Port / Service</th>
                        <th></th>
                        <th>Destination IP</th>
                        <th>Protocol</th>
                        <th>Bytes</th>
                        <th>Packets</th>
                        <th>Time</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {isAggregated ? (
                    displayedConversations.map((flow: any, idx: number) => {
                      const bytesPct = Math.round(((flow.bytes || 0) / maxBytesInView) * 100)
                      return (
                        <tr key={flow.peer_ip}>
                          <td className="text-muted text-sm">{idx + 1}</td>
                          <td>
                            <button className="flow-ip-link" title="Click to investigate this IP"
                              onClick={() => handleSearchChange(flow.peer_ip)}>
                              {flow.peer_ip}
                            </button>
                          </td>
                          <td className="mono text-sm">
                            {formatBytes(flow.bytes)}
                            <div className="flow-bytes-bar" style={{ width: `${bytesPct}%` }} />
                          </td>
                          <td className="text-muted">{flow.packets?.toLocaleString()}</td>
                          <td className="text-muted">{flow.flow_count?.toLocaleString()}</td>
                        </tr>
                      )
                    })
                  ) : (
                    displayedConversations.map((flow: any) => {
                      const isOutgoing = flow.src_ip === searchIp
                      const bytesPct = Math.round(((flow.bytes || 0) / maxBytesInView) * 100)
                      return (
                        <tr key={flow.id}>
                          {searchIp && (
                            <td title={isOutgoing ? 'Outgoing' : 'Incoming'} className="text-center">
                              {isOutgoing
                                ? <ArrowUpRight size={14} className="flow-direction-icon flow-direction-icon--out" />
                                : <ArrowDownLeft size={14} className="flow-direction-icon flow-direction-icon--in" />
                              }
                            </td>
                          )}
                          <td>
                            {flow.src_ip === searchIp
                              ? <span className="mono text-sm font-semibold link-primary">{flow.src_ip}</span>
                              : (
                                <button className="flow-ip-link" title="Click to investigate this IP"
                                  onClick={() => handleSearchChange(flow.src_ip)}>
                                  {flow.src_ip}
                                </button>
                              )
                            }
                          </td>
                          <td className="text-center text-muted" style={{ padding: '0 2px', width: '20px' }}>
                            <ArrowRight size={14} />
                          </td>
                          <td className="mono text-sm text-center">
                            {flow.dst_port != null ? (
                              <>
                                <span className="font-semibold">{flow.dst_port}</span>
                                {' '}
                                <span className="text-muted">[{PORT_NAMES[flow.dst_port] || flow.application || 'Unknown'}]</span>
                              </>
                            ) : '\u2014'}
                          </td>
                          <td className="text-center text-muted" style={{ padding: '0 2px', width: '20px' }}>
                            <ArrowRight size={14} />
                          </td>
                          <td>
                            {flow.dst_ip === searchIp
                              ? <span className="mono text-sm font-semibold text-success">{flow.dst_ip}</span>
                              : (
                                <button className="flow-ip-link" title="Click to investigate this IP"
                                  onClick={() => handleSearchChange(flow.dst_ip)}>
                                  {flow.dst_ip}
                                </button>
                              )
                            }
                          </td>
                          <td><span className="tag-blue">{flow.protocol}</span></td>
                          <td className="mono text-sm">
                            {formatBytes(flow.bytes)}
                            <div className="flow-bytes-bar" style={{ width: `${bytesPct}%` }} />
                          </td>
                          <td className="text-muted">{flow.packets?.toLocaleString()}</td>
                          <td className="text-xs text-light">
                            {flow.timestamp ? new Date(flow.timestamp).toLocaleTimeString() : '\u2014'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                  {displayedConversations.length === 0 && (
                    <tr>
                      <td colSpan={isAggregated ? 5 : (searchIp ? 9 : 8)} className="empty-table-cell">
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

            {/* Load more hint */}
            {conversations && conversations.length === 100 && (
              <div className="table-footer">
                <span className="table-info">Showing first 100 flows. Narrow your search for more specific results.</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
