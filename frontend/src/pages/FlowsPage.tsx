import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi, devicesApi } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Label,
  AreaChart, Area,
} from 'recharts'
import {
  Search, Globe, Copy, ExternalLink, X, ArrowUpRight, ArrowDownLeft, ArrowRight,
  Activity, HardDrive, BarChart3, Check, AlertTriangle, Clock,
  Filter, Loader2, Calendar, Shield,
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

// -- Threat Score Ring ---------------------------------------------------------
function ThreatScoreRing({ score, level }: { score: number; level: string }) {
  const r = 40, stroke = 7, circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const colorMap: Record<string, string> = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' }
  const color = colorMap[level] || '#94a3b8'
  return (
    <div className="threat-ring">
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle className="threat-ring__track" cx={50} cy={50} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle className="threat-ring__arc" cx={50} cy={50} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 50 50)" />
        <text x={50} y={46} textAnchor="middle" className="threat-ring__score" fill="var(--text-main)">{score}</text>
        <text x={50} y={62} textAnchor="middle" className="threat-ring__level" fill={color}>{level.toUpperCase()}</text>
      </svg>
    </div>
  )
}

// Activity tag color mapping
const ACTIVITY_COLORS: Record<string, string> = {
  'Web Browsing': '#0284c7', 'SSH Sessions': '#059669', 'RDP Access': '#d97706',
  'BitTorrent': '#dc2626', 'Email': '#7c3aed', 'DNS': '#0891b2', 'VPN': '#4f46e5',
  'File Sharing': '#ea580c', 'Database': '#be185d', 'Proxmox Management': '#0d9488',
  'SNMP Monitoring': '#64748b', 'VoIP/STUN': '#6366f1', 'BGP Routing': '#475569',
}

// -- Peer Detail View -----------------------------------------------------------
function PeerDetailView({
  ip, peer, timeRangeParams, onBack, onNavigateIp,
}: {
  ip: string
  peer: string
  timeRangeParams: Record<string, string | number>
  onBack: () => void
  onNavigateIp: (ip: string) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['peer-detail', ip, peer, timeRangeParams],
    queryFn: () => flowsApi.peerDetail(ip, peer, timeRangeParams).then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div className="card card-body flex-row-gap">
        <Loader2 size={16} className="animate-spin" />
        Loading conversation between {ip} and {peer}...
      </div>
    )
  }
  if (!data) return null

  // Use the backend-corrected IPs (owned IP is always data.ip)
  const localIp: string = data.ip || ip
  const remoteIp: string = data.peer || peer

  const totalBytes = data.total_bytes || 0
  const sentPct = totalBytes > 0 ? (data.bytes_from_ip / totalBytes) * 100 : 50
  const rcvdPct = totalBytes > 0 ? (data.bytes_from_peer / totalBytes) * 100 : 50
  const services: any[] = data.services || []
  const timeline: any[] = data.timeline || []
  const protocols: any[] = data.protocols || []
  const recentFlows: any[] = data.recent_flows || []
  const maxSvcBytes = services.length > 0 ? services[0].bytes : 1

  const timelineData = timeline.map((t: any) => {
    const d = new Date(t.timestamp)
    const label = isNaN(d.getTime()) ? t.timestamp : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return { time: label, Inbound: t.bytes_from_peer, Outbound: t.bytes_from_ip, flows: t.flows }
  })

  const peerLabel = remoteIp + (data.peer_country ? ` (${data.peer_country})` : '')

  return (
    <div className="ip-profile">
      {/* ═══ Banner ═══ */}
      <div className="ip-profile__banner">
        <div className="ip-profile__identity-bar">
          <div className="ip-profile__banner-icon"><Activity /></div>
          <div className="ip-profile__banner-info">
            <div className="ip-profile__ip-address" style={{ fontSize: '15px' }}>
              Conversation Detail
            </div>
            <div className="ip-profile__identity-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
              <button className="flow-ip-link mono" style={{ fontSize: '14px', fontWeight: 700 }} onClick={() => onNavigateIp(localIp)}>{localIp}</button>
              <ArrowRight size={16} style={{ color: 'var(--neutral-400)' }} />
              <button className="flow-ip-link mono" style={{ fontSize: '14px', fontWeight: 700 }} onClick={() => onNavigateIp(remoteIp)}>{peerLabel}</button>
            </div>
            <div className="ip-profile__summary" style={{ marginTop: '4px' }}>
              {data.total_flows?.toLocaleString()} flows &middot; {formatBytes(totalBytes)} &middot; {data.total_packets?.toLocaleString()} packets
            </div>
          </div>
          <div className="ip-profile__actions">
            <button className="btn btn-outline btn-sm" onClick={onBack}>
              <X size={12} /> Back to Profile
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Direction Summary ═══ */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><ArrowUpRight size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Outbound</div>
            <div className="stat-value">{formatBytes(data.bytes_from_ip)}</div>
            <div className="stat-sub">{data.flows_from_ip?.toLocaleString()} flows &middot; {localIp.split('.').slice(-2).join('.')} → {remoteIp.split('.').slice(-2).join('.')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><ArrowDownLeft size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Inbound</div>
            <div className="stat-value">{formatBytes(data.bytes_from_peer)}</div>
            <div className="stat-sub">{data.flows_from_peer?.toLocaleString()} flows &middot; {remoteIp.split('.').slice(-2).join('.')} → {localIp.split('.').slice(-2).join('.')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#f3e8ff', color: '#7c3aed' }}><Activity size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Total Traffic</div>
            <div className="stat-value">{formatBytes(totalBytes)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef3c7', color: '#d97706' }}><BarChart3 size={20} /></div>
          <div className="stat-body">
            <div className="stat-label">Total Flows</div>
            <div className="stat-value">{data.total_flows?.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* ═══ Traffic Balance Bar ═══ */}
      <div className="card">
        <div className="card-header"><Activity size={15} /><h3>Traffic Direction</h3></div>
        <div className="card-body">
          <div className="traffic-balance">
            <div className="traffic-balance__bar">
              <div className="traffic-balance__bar-sent" style={{ width: `${totalBytes > 0 ? Math.max(sentPct, 0.5) : 50}%` }} />
              <div className="traffic-balance__bar-received" style={{ width: `${totalBytes > 0 ? Math.max(rcvdPct, 0.5) : 50}%` }} />
            </div>
            <div className="traffic-balance__labels">
              <span>{formatBytes(data.bytes_from_ip)} outbound</span>
              <span>{formatBytes(data.bytes_from_peer)} inbound</span>
            </div>
            <div className="traffic-balance__pct">
              {sentPct.toFixed(1)}% &mdash; {rcvdPct.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Timeline ═══ */}
      {timelineData.length > 0 && (
        <div className="card">
          <div className="card-header"><Activity size={15} /><h3>Traffic Timeline</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradPeerIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradPeerOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatBytes(v)} width={70} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                <Area type="monotone" dataKey="Inbound" stroke="#22c55e" fill="url(#gradPeerIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="Outbound" stroke="#0284c7" fill="url(#gradPeerOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ═══ Services + Protocols side by side ═══ */}
      <div className="grid-2">
        {/* Services */}
        <div className="card">
          <div className="card-header"><Shield size={15} /><h3>Services</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            {services.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px' }}><p>No service data</p></div>
            ) : (
              <table className="services-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Port</th>
                    <th>Direction</th>
                    <th></th>
                    <th>Traffic</th>
                    <th>Flows</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc: any, i: number) => {
                    const barPct = Math.round((svc.bytes / maxSvcBytes) * 100)
                    const isIn = svc.direction === 'inbound'
                    return (
                      <tr key={`${svc.port}-${svc.direction}-${i}`}>
                        <td className="services-table__name">{svc.service}</td>
                        <td className="mono text-muted">{svc.port}</td>
                        <td>
                          {isIn
                            ? <span className="tag-green" style={{ fontSize: '10px' }}><ArrowDownLeft size={9} style={{ marginRight: 2 }} />IN</span>
                            : <span className="tag-blue" style={{ fontSize: '10px' }}><ArrowUpRight size={9} style={{ marginRight: 2 }} />OUT</span>
                          }
                        </td>
                        <td className="services-table__bar-cell">
                          <div className={`services-table__bar ${isIn ? 'services-table__bar--inbound' : 'services-table__bar--outbound'}`} style={{ width: `${barPct}%` }} />
                        </td>
                        <td className="mono">{formatBytes(svc.bytes)}</td>
                        <td className="mono text-muted">{svc.flows?.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Protocols */}
        <div className="card">
          <div className="card-header"><BarChart3 size={15} /><h3>Protocol Breakdown</h3></div>
          <div className="card-body">
            {protocols.length === 0 ? (
              <div className="empty-state"><p>No protocol data</p></div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={protocols} dataKey="bytes" nameKey="protocol" cx="50%" cy="50%" innerRadius={40} outerRadius={70}>
                      {protocols.map((_: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      <Label value={formatBytes(totalBytes)} position="center" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--text-main)' }} />
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                  {protocols.map((p: any, i: number) => (
                    <div key={p.protocol} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{p.protocol}</span>
                      <span className="mono text-muted">{formatBytes(p.bytes)}</span>
                      <span className="mono text-muted">{p.flows} flows</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Recent Flows Table ═══ */}
      <div className="card">
        <div className="card-header">
          <Activity size={15} />
          <h3>Recent Flows <span className="text-muted text-sm">Top {recentFlows.length} by volume</span></h3>
        </div>
        <div className="table-wrap">
          <table className="flow-table">
            <thead>
              <tr>
                <th></th>
                <th>Source</th>
                <th>Src Service</th>
                <th></th>
                <th>Destination</th>
                <th>Dst Service</th>
                <th>Protocol</th>
                <th>Bytes</th>
                <th>Packets</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentFlows.map((f: any) => {
                const isOutbound = f.src_ip === localIp
                const maxFlowBytes = recentFlows[0]?.bytes || 1
                const barPct = Math.round((f.bytes / maxFlowBytes) * 100)
                return (
                  <tr key={f.id}>
                    <td className="text-center" title={isOutbound ? 'Outbound' : 'Inbound'}>
                      {isOutbound
                        ? <ArrowUpRight size={14} className="flow-direction-icon flow-direction-icon--out" />
                        : <ArrowDownLeft size={14} className="flow-direction-icon flow-direction-icon--in" />}
                    </td>
                    <td>
                      <span className={`mono text-sm ${isOutbound ? 'font-semibold link-primary' : ''}`}>
                        {f.src_ip}
                      </span>
                    </td>
                    <td className="mono text-sm">
                      {f.src_port ? (
                        f.src_service ? (
                          <span className="services-table__svc-badge">{f.src_service}:{f.src_port}</span>
                        ) : <span className="text-muted">:{f.src_port}</span>
                      ) : <span className="text-muted">&mdash;</span>}
                    </td>
                    <td className="text-center text-muted" style={{ padding: '0 2px', width: '20px' }}>
                      <ArrowRight size={14} />
                    </td>
                    <td>
                      <span className={`mono text-sm ${!isOutbound ? 'font-semibold text-success' : ''}`}>
                        {f.dst_ip}
                      </span>
                    </td>
                    <td className="mono text-sm">
                      {f.dst_port ? (
                        f.dst_service ? (
                          <span className="services-table__svc-badge">{f.dst_service}:{f.dst_port}</span>
                        ) : <span className="text-muted">:{f.dst_port}</span>
                      ) : <span className="text-muted">&mdash;</span>}
                    </td>
                    <td><span className="tag-blue">{f.protocol}</span></td>
                    <td className="mono text-sm">
                      {formatBytes(f.bytes)}
                      <div className="flow-bytes-bar" style={{ width: `${barPct}%` }} />
                    </td>
                    <td className="text-muted">{f.packets?.toLocaleString()}</td>
                    <td className="text-xs text-light">
                      {f.timestamp ? new Date(f.timestamp).toLocaleTimeString() : '\u2014'}
                    </td>
                  </tr>
                )
              })}
              {recentFlows.length === 0 && (
                <tr><td colSpan={10} className="empty-table-cell">No flows between these IPs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// -- IP Profile card -----------------------------------------------------------
function IpProfile({
  ip, timeRangeParams, selectedPeer, onSelectPeer, onClear, onNavigateIp, onPeerDetail,
}: {
  ip: string
  timeRangeParams: Record<string, string | number>
  selectedPeer: string
  onSelectPeer: (peer: string) => void
  onClear: () => void
  onNavigateIp: (ip: string) => void
  onPeerDetail: (peer: string) => void
}) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['ip-profile', ip, timeRangeParams],
    queryFn: () => flowsApi.ipProfile(ip, timeRangeParams).then((r) => r.data),
    enabled: !!ip,
  })

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
  const uniPeers = topIn.length > 0 ? topIn : topOut
  const uniBytes = Math.max(profile.bytes_sent, profile.bytes_received)
  const threat = profile.threat || { score: 0, level: 'low', flags: [] }
  const behavior = profile.behavior || { role: 'Unknown', activities: [] }
  const timeline: any[] = profile.timeline || []
  const topPeersDetailed: any[] = profile.top_peers_detailed || []
  const servicesAccessed: any[] = profile.services_accessed || []
  const servicesServed: any[] = profile.services_served || []

  // Timeline chart data
  const timelineData = timeline.map((t: any) => {
    const d = new Date(t.timestamp)
    const label = isNaN(d.getTime()) ? t.timestamp : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return { time: label, 'Bytes In': t.bytes_in, 'Bytes Out': t.bytes_out }
  })

  const maxPeerBytes = topPeersDetailed.length > 0 ? topPeersDetailed[0].bytes_total : 1
  const maxSvcBytes = servicesAccessed.length > 0 ? servicesAccessed[0].bytes : 1
  const maxSvcServedBytes = servicesServed.length > 0 ? servicesServed[0].bytes : 1

  // Role badge color
  const roleBadgeClass: Record<string, string> = {
    'Client': 'ip-profile__role-badge--blue',
    'Server': 'ip-profile__role-badge--green',
    'Client + Server': 'ip-profile__role-badge--purple',
    'Scanner': 'ip-profile__role-badge--red',
  }

  return (
    <div className="ip-profile">
      {/* ═══ SECTION 1: Identity Bar ═══ */}
      <div className="ip-profile__banner">
        <div className="ip-profile__identity-bar">
          <div className="ip-profile__banner-icon"><Globe /></div>
          <div className="ip-profile__banner-info">
            <div className="ip-profile__ip-address">{ip}</div>
            <div className="ip-profile__identity-row">
              <span className={`ip-profile__role-badge ${roleBadgeClass[behavior.role] || ''}`}>{behavior.role}</span>
              <span className="ip-profile__summary">
                {totalFlows.toLocaleString()} flows &middot; {formatBytes(totalBytes)}
              </span>
            </div>
            {/* Activity tags */}
            {behavior.activities.length > 0 && (
              <div className="ip-profile__activity-tags">
                {behavior.activities.map((act: string) => (
                  <span key={act} className="ip-profile__activity-tag"
                    style={{ background: (ACTIVITY_COLORS[act] || '#64748b') + '18', color: ACTIVITY_COLORS[act] || '#64748b', borderColor: (ACTIVITY_COLORS[act] || '#64748b') + '40' }}>
                    {act}
                  </span>
                ))}
              </div>
            )}
            {/* Threat flags */}
            {threat.flags.length > 0 && (
              <div className="ip-profile__threat-flags">
                {threat.flags.map((f: any) => (
                  <span key={f.id} className={`ip-profile__threat-flag ip-profile__threat-flag--${threat.level}`}>
                    <AlertTriangle size={10} /> {f.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <ThreatScoreRing score={threat.score} level={threat.level} />
          <div className="ip-profile__actions">
            <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(ip)} title="Copy IP">
              <Copy size={12} /> Copy IP
            </button>
            <a href={`https://whois.domaintools.com/${ip}`} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              <ExternalLink size={12} /> Whois
            </a>
            <button className="btn btn-outline btn-sm" onClick={onClear}>
              <X size={12} /> Clear
            </button>
          </div>
        </div>
      </div>

      {/* ═══ SECTION 2: Services Accessed / Served ═══ */}
      {servicesAccessed.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Shield size={15} />
            <h3>Services Accessed <span className="text-muted text-sm">(what this IP connects to)</span></h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="services-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Port</th>
                  <th>Proto</th>
                  <th>Peers</th>
                  <th></th>
                  <th>Traffic</th>
                  <th>%</th>
                  <th>Flows</th>
                </tr>
              </thead>
              <tbody>
                {servicesAccessed.map((svc: any) => {
                  const pct = totalBytes > 0 ? ((svc.bytes / totalBytes) * 100) : 0
                  const barPct = Math.round((svc.bytes / maxSvcBytes) * 100)
                  return (
                    <tr key={`${svc.port}-${svc.protocol}`}>
                      <td className="services-table__name">{svc.service}</td>
                      <td className="mono text-muted">{svc.port}</td>
                      <td><span className="tag-blue" style={{ fontSize: '10px' }}>{svc.protocol}</span></td>
                      <td className="mono">{svc.unique_peers}</td>
                      <td className="services-table__bar-cell">
                        <div className="services-table__bar" style={{ width: `${barPct}%` }} />
                      </td>
                      <td className="mono">{formatBytes(svc.bytes)}</td>
                      <td className="mono text-muted">{pct.toFixed(1)}%</td>
                      <td className="mono text-muted">{svc.flows.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {servicesServed.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Shield size={15} />
            <h3>Services Served <span className="text-muted text-sm">(what this IP provides)</span></h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="services-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Port</th>
                  <th>Proto</th>
                  <th>Clients</th>
                  <th></th>
                  <th>Traffic</th>
                  <th>%</th>
                  <th>Flows</th>
                </tr>
              </thead>
              <tbody>
                {servicesServed.map((svc: any) => {
                  const pct = totalBytes > 0 ? ((svc.bytes / totalBytes) * 100) : 0
                  const barPct = Math.round((svc.bytes / maxSvcServedBytes) * 100)
                  return (
                    <tr key={`${svc.port}-${svc.protocol}`}>
                      <td className="services-table__name">{svc.service}</td>
                      <td className="mono text-muted">{svc.port}</td>
                      <td><span className="tag-blue" style={{ fontSize: '10px' }}>{svc.protocol}</span></td>
                      <td className="mono">{svc.unique_peers}</td>
                      <td className="services-table__bar-cell">
                        <div className="services-table__bar services-table__bar--green" style={{ width: `${barPct}%` }} />
                      </td>
                      <td className="mono">{formatBytes(svc.bytes)}</td>
                      <td className="mono text-muted">{pct.toFixed(1)}%</td>
                      <td className="mono text-muted">{svc.flows.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ SECTION 3: Top Peers (with service labels) ═══ */}
      <div className="card">
        <div className="card-header">
          <Globe size={15} />
          <h3>Top Peers</h3>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {topPeersDetailed.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px' }}><p>No peer data</p></div>
          ) : (
            <table className="services-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Peer IP</th>
                  <th>Service</th>
                  <th>Protocol</th>
                  <th></th>
                  <th>Traffic</th>
                  <th>%</th>
                  <th>Flows</th>
                </tr>
              </thead>
              <tbody>
                {topPeersDetailed.map((peer: any, i: number) => {
                  const barPct = Math.round((peer.bytes_total / maxPeerBytes) * 100)
                  return (
                    <tr key={peer.ip}>
                      <td className="text-muted">{i + 1}</td>
                      <td>
                        <button className="flow-ip-link mono" onClick={() => onPeerDetail(peer.ip)}>{peer.ip}</button>
                        {peer.country && <span className="peer-detail-card__country" style={{ marginLeft: '6px' }}>{peer.country}</span>}
                      </td>
                      <td>
                        {peer.primary_service ? (
                          <span className="services-table__svc-badge">{peer.primary_service}:{peer.primary_port}</span>
                        ) : '\u2014'}
                      </td>
                      <td>
                        {peer.protocols?.map((p: string) => <span key={p} className="tag-blue" style={{ fontSize: '10px', marginRight: '3px' }}>{p}</span>)}
                      </td>
                      <td className="services-table__bar-cell">
                        <div className="services-table__bar" style={{ width: `${barPct}%` }} />
                      </td>
                      <td className="mono">{formatBytes(peer.bytes_total)}</td>
                      <td className="mono text-muted">{peer.pct}%</td>
                      <td className="mono text-muted">{peer.flows?.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ═══ SECTION 4: Traffic Timeline ═══ */}
      {timelineData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Activity size={15} />
            <h3>Traffic Timeline</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatBytes(v)} width={70} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatBytes(v)} />
                <Area type="monotone" dataKey="Bytes In" stroke="#22c55e" fill="url(#gradIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="Bytes Out" stroke="#0284c7" fill="url(#gradOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ═══ SECTION 5: Stats + Threat ═══ */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><Activity size={15} /><h3>At a Glance</h3></div>
          <div className="card-body">
            <div className="quick-stats">
              <div className="quick-stats__item">
                <div className="quick-stats__label">Total Traffic</div>
                <div className="quick-stats__value">{formatBytes(totalBytes)}</div>
              </div>
              <div className="quick-stats__item">
                <div className="quick-stats__label">Total Flows</div>
                <div className="quick-stats__value">{totalFlows.toLocaleString()}</div>
              </div>
              <div className="quick-stats__item">
                <div className="quick-stats__label">Unique Peers</div>
                <div className="quick-stats__value">{Math.max(profile.unique_src_ips ?? 0, profile.unique_dst_ips ?? 0).toLocaleString()}</div>
              </div>
              <div className="quick-stats__item">
                <div className="quick-stats__label">Services Used</div>
                <div className="quick-stats__value">{servicesAccessed.length + servicesServed.length}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><Shield size={15} /><h3>Threat Assessment</h3></div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <ThreatScoreRing score={threat.score} level={threat.level} />
            <div style={{ flex: 1 }}>
              {threat.flags.length === 0 ? (
                <div className="text-muted text-sm">No anomalies detected</div>
              ) : (
                <div className="ip-profile__threat-flags">
                  {threat.flags.map((f: any) => (
                    <span key={f.id} className={`ip-profile__threat-flag ip-profile__threat-flag--${threat.level}`}>
                      <AlertTriangle size={10} /> {f.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ SECTION 6: Direction Donuts + Balance ═══ */}
      {isUnidirectional ? (
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
      ) : (
        <div className="grid-2">
          <TrafficDirectionCard
            title="Outbound Traffic (Destinations)"
            icon={<ArrowUpRight size={15} className="flow-direction-icon--out" />}
            emptyLabel="No outbound traffic"
            emptyDesc="This IP has not sent any data"
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
            emptyDesc="This IP has not received any data"
            colors={COLORS_IN}
            totalBytes={profile.bytes_received}
            peers={topIn}
            selectedPeer={selectedPeer}
            onSelectPeer={onSelectPeer}
            onNavigateIp={onNavigateIp}
          />
        </div>
      )}

      {!isUnidirectional && (
        <TrafficBalance sent={profile.bytes_sent} received={profile.bytes_received} />
      )}

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
  const [peerDetailIp, setPeerDetailIp] = useState('')
  // null = "all selected" (no filter sent); otherwise a Set of selected device IDs
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<number> | null>(null)

  const trParams = timeParams(timeRange)

  function handleSearchChange(ip: string) {
    addRecentIp(ip)
    setSearchIp(ip)
    setSelectedPeer('')
    setPeerDetailIp('')
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

      {/* Peer Detail -- shown when drilling into a peer from IP Profile */}
      {searchIp && peerDetailIp && (
        <PeerDetailView
          ip={searchIp}
          peer={peerDetailIp}
          timeRangeParams={trParams}
          onBack={() => setPeerDetailIp('')}
          onNavigateIp={handleSearchChange}
        />
      )}

      {/* IP Profile -- only shown when searching and not in peer detail */}
      {searchIp && !peerDetailIp && (
        <IpProfile
          ip={searchIp}
          timeRangeParams={trParams}
          selectedPeer={selectedPeer}
          onSelectPeer={setSelectedPeer}
          onClear={() => { setSearchIp(''); setSelectedPeer(''); setPeerDetailIp('') }}
          onNavigateIp={handleSearchChange}
          onPeerDetail={(peer) => setPeerDetailIp(peer)}
        />
      )}

      {/* Global stats cards */}
      {!searchIp && stats && (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
              <ArrowDownLeft size={20} />
            </div>
            <div className="stat-body">
              <div className="stat-label">Inbound</div>
              <div className="stat-value">{formatBytes(stats.total_inbound || 0)}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
              <ArrowUpRight size={20} />
            </div>
            <div className="stat-body">
              <div className="stat-label">Outbound</div>
              <div className="stat-value">{formatBytes(stats.total_outbound || 0)}</div>
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
          {/* Inbound / Outbound traffic tables */}
          {!searchIp && stats && (
            <>
              <div className="grid-2">
                {/* ── OUTBOUND: Our network → External ── */}
                <div className="card">
                  <div className="card-header">
                    <ArrowUpRight size={15} className="flow-direction-icon--out" />
                    <h3>Outbound Traffic</h3>
                    <span className="card-header__sub" style={{ marginLeft: 'auto' }}>Our network → External</span>
                  </div>
                  <div className="card-body" style={{ padding: 0 }}>
                    {(stats.top_outbound || []).length === 0 ? (
                      <div className="empty-state" style={{ padding: '20px' }}><p>No outbound traffic data</p></div>
                    ) : (
                      <table className="services-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Destination</th>
                            <th>From (Internal)</th>
                            <th>Service</th>
                            <th></th>
                            <th>Traffic</th>
                            <th>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(stats.top_outbound || []).map((item: any, i: number) => {
                            const maxBytes = stats.top_outbound[0]?.bytes || 1
                            const barPct = Math.round((item.bytes / maxBytes) * 100)
                            return (
                              <tr key={item.ip}>
                                <td className="text-muted">{i + 1}</td>
                                <td>
                                  <button className="flow-ip-link mono" onClick={() => handleSearchChange(item.ip)}>{item.ip}</button>
                                </td>
                                <td>
                                  <div className="internal-ips">
                                    {(item.internal_ips || []).map((int_ip: any) => (
                                      <button key={int_ip.ip} className="flow-ip-link mono internal-ip-chip" onClick={() => handleSearchChange(int_ip.ip)}>
                                        {int_ip.ip} <span className="text-muted text-xs">({formatBytes(int_ip.bytes)})</span>
                                      </button>
                                    ))}
                                  </div>
                                </td>
                                <td>
                                  {item.service_name ? (
                                    <span className="services-table__svc-badge">{item.service_name}:{item.service_port}</span>
                                  ) : <span className="text-muted">{'\u2014'}</span>}
                                </td>
                                <td className="services-table__bar-cell">
                                  <div className="services-table__bar services-table__bar--outbound" style={{ width: `${barPct}%` }} />
                                </td>
                                <td className="mono">{formatBytes(item.bytes)}</td>
                                <td className="mono text-muted">{item.pct}%</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* ── INBOUND: External → Our network ── */}
                <div className="card">
                  <div className="card-header">
                    <ArrowDownLeft size={15} className="flow-direction-icon--in" />
                    <h3>Inbound Traffic</h3>
                    <span className="card-header__sub" style={{ marginLeft: 'auto' }}>External → Our network</span>
                  </div>
                  <div className="card-body" style={{ padding: 0 }}>
                    {(stats.top_inbound || []).length === 0 ? (
                      <div className="empty-state" style={{ padding: '20px' }}><p>No inbound traffic data</p></div>
                    ) : (
                      <table className="services-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Source</th>
                            <th>To (Internal)</th>
                            <th>Service</th>
                            <th></th>
                            <th>Traffic</th>
                            <th>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(stats.top_inbound || []).map((item: any, i: number) => {
                            const maxBytes = stats.top_inbound[0]?.bytes || 1
                            const barPct = Math.round((item.bytes / maxBytes) * 100)
                            return (
                              <tr key={item.ip}>
                                <td className="text-muted">{i + 1}</td>
                                <td>
                                  <button className="flow-ip-link mono" onClick={() => handleSearchChange(item.ip)}>{item.ip}</button>
                                </td>
                                <td>
                                  <div className="internal-ips">
                                    {(item.internal_ips || []).map((int_ip: any) => (
                                      <button key={int_ip.ip} className="flow-ip-link mono internal-ip-chip" onClick={() => handleSearchChange(int_ip.ip)}>
                                        {int_ip.ip} <span className="text-muted text-xs">({formatBytes(int_ip.bytes)})</span>
                                      </button>
                                    ))}
                                  </div>
                                </td>
                                <td>
                                  {item.service_name ? (
                                    <span className="services-table__svc-badge">{item.service_name}:{item.service_port}</span>
                                  ) : <span className="text-muted">{'\u2014'}</span>}
                                </td>
                                <td className="services-table__bar-cell">
                                  <div className="services-table__bar services-table__bar--inbound" style={{ width: `${barPct}%` }} />
                                </td>
                                <td className="mono">{formatBytes(item.bytes)}</td>
                                <td className="mono text-muted">{item.pct}%</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

              {/* Protocol + Application charts */}
              <div className="grid-2">
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
            </>
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
                        <th>Src Service</th>
                        <th></th>
                        <th>Destination IP</th>
                        <th>Dst Service</th>
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
                      const srcSvc = flow.src_service || PORT_NAMES[flow.src_port] || ''
                      const dstSvc = flow.dst_service || PORT_NAMES[flow.dst_port] || ''
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
                          <td className="mono text-sm">
                            {flow.src_port ? (
                              srcSvc ? (
                                <span className="services-table__svc-badge">{srcSvc}:{flow.src_port}</span>
                              ) : (
                                <span className="text-muted">:{flow.src_port}</span>
                              )
                            ) : <span className="text-muted">{'\u2014'}</span>}
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
                          <td className="mono text-sm">
                            {flow.dst_port ? (
                              dstSvc ? (
                                <span className="services-table__svc-badge">{dstSvc}:{flow.dst_port}</span>
                              ) : (
                                <span className="text-muted">:{flow.dst_port}</span>
                              )
                            ) : <span className="text-muted">{'\u2014'}</span>}
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
                      <td colSpan={isAggregated ? 5 : (searchIp ? 10 : 9)} className="empty-table-cell">
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
