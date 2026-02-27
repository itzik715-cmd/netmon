import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { topologyApi, pduApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Search, ZoomIn, ZoomOut, Maximize2, RotateCcw, Focus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useThemeStore } from '../store/themeStore'
import NocViewButton from '../components/NocViewButton'

// ─── Types ────────────────────────────────────────────────────────────────────
interface TopoNode {
  id: number
  hostname: string
  ip_address: string
  device_type: string
  layer?: string
  vendor?: string
  status: string
  location_id?: number
  location_name?: string
  datacenter?: string
  rack?: string
  cpu_usage?: number
  memory_usage?: number
  interface_count: number
  last_seen?: string
}

interface TopoEdge {
  id: number
  source: number
  target: number
  source_if?: string
  target_if?: string
  link_type: string
}

interface RackServerInfo {
  name: string
  pduCount: number  // 1 = single PDU (red warning), 2+ = dual (normal)
}

// ─── Constants ────────────────────────────────────────────────────────────────
const RACK_W = 200
const RACK_HEADER_H = 32
const RACK_FOOTER_H = 8
const RACK_GAP = 32
const RACKS_PER_ROW = 4

const U_HEIGHT = 18
const RACK_UNITS = 45
const RACK_CONTENT_H = RACK_UNITS * U_HEIGHT  // 810px
const RACK_TOTAL_H = RACK_HEADER_H + RACK_CONTENT_H + RACK_FOOTER_H  // 850px

const SERVER_H = 2 * U_HEIGHT    // 2U = 36px
const SWITCH_H = U_HEIGHT        // 1U = 18px
const UNIT_MARGIN_X = 12

const TIER_SPINE = ['spine', 'core', 'router']
const TIER_FW = ['firewall']
const TIER_LEAF = ['leaf', 'switch', 'tor', 'access', 'distribution']

const STORAGE_KEY = 'netmon-rack-positions'
const UNIT_POS_KEY = 'netmon-unit-positions'

const SERVER_PREFIXES = /^(kv|vm|nas|esx|hv|srv|node|pm)/i

// ─── Helpers ──────────────────────────────────────────────────────────────────
function statusColor(status: string): string {
  if (status === 'up') return '#22c55e'
  if (status === 'down') return '#ef4444'
  if (status === 'degraded') return '#f59e0b'
  return '#94a3b8'
}

function deviceTier(type: string): 'spine' | 'firewall' | 'leaf' | 'pdu' | 'other' {
  const t = (type || '').toLowerCase()
  if (t === 'pdu') return 'pdu'
  if (TIER_SPINE.some(k => t.includes(k))) return 'spine'
  if (TIER_FW.some(k => t.includes(k))) return 'firewall'
  if (TIER_LEAF.some(k => t.includes(k))) return 'leaf'
  return 'other'
}

function deviceLabel(type: string): string {
  const t = (type || '').toLowerCase()
  if (t.includes('spine')) return 'S'
  if (t.includes('core')) return 'C'
  if (t.includes('router')) return 'R'
  if (t.includes('firewall')) return 'FW'
  if (t.includes('leaf')) return 'L'
  if (t.includes('switch')) return 'SW'
  if (t.includes('tor')) return 'T'
  return t.charAt(0).toUpperCase() || 'U'
}

// ─── Rack layout computation ──────────────────────────────────────────────────
interface RackDef {
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
  switchNodes: TopoNode[]   // spine + firewall + leaf — placed at top
  servers: RackServerInfo[] // derived from PDU outlets — placed from bottom
  pduNodes: TopoNode[]
}

function computeRacks(
  nodes: TopoNode[],
  savedPositions: Record<string, { x: number; y: number }>,
  rackServers: Record<string, RackServerInfo[]>,
): RackDef[] {
  const groups: Record<string, TopoNode[]> = {}
  nodes.forEach(n => {
    const key = n.location_name || '__unassigned__'
    ;(groups[key] = groups[key] || []).push(n)
  })

  const keys = Object.keys(groups).sort((a, b) => {
    if (a === '__unassigned__') return 1
    if (b === '__unassigned__') return -1
    return a.localeCompare(b)
  })

  const racks: RackDef[] = []

  keys.forEach((key, idx) => {
    const gNodes = groups[key]
    const pduNodes = gNodes.filter(n => deviceTier(n.device_type) === 'pdu')
    const switchNodes = gNodes.filter(n => {
      const tier = deviceTier(n.device_type)
      return tier === 'spine' || tier === 'firewall' || tier === 'leaf' || tier === 'other'
    })

    const servers = rackServers[key] || []

    const col = idx % RACKS_PER_ROW
    const row = Math.floor(idx / RACKS_PER_ROW)
    const defaultX = RACK_GAP + col * (RACK_W + RACK_GAP)
    const defaultY = RACK_GAP + row * (RACK_TOTAL_H + RACK_GAP)
    const pos = savedPositions[key] || { x: defaultX, y: defaultY }

    racks.push({
      key,
      label: key === '__unassigned__' ? 'Unassigned' : key,
      x: pos.x,
      y: pos.y,
      width: RACK_W,
      height: RACK_TOTAL_H,
      switchNodes,
      servers,
      pduNodes,
    })
  })

  return racks
}

// Get absolute position of a network device (switch) within its rack — for edge drawing
function getDevicePos(
  nodeId: number,
  racks: RackDef[],
  unitPositions: Record<string, Record<string, number>>,
): { x: number; y: number } | null {
  for (const rack of racks) {
    const sIdx = rack.switchNodes.findIndex(n => n.id === nodeId)
    if (sIdx >= 0) {
      const node = rack.switchNodes[sIdx]
      const savedU = unitPositions[rack.key]?.[`sw-${node.id}`]
      const uSlot = savedU != null ? savedU : (RACK_UNITS - sIdx)
      const yInRack = RACK_HEADER_H + (RACK_UNITS - uSlot) * U_HEIGHT + SWITCH_H / 2
      return { x: rack.x + RACK_W / 2, y: rack.y + yInRack }
    }
  }
  return null
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TopologyPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const { theme } = useThemeStore()

  useEffect(() => {
    const el = document.getElementById('noc-page-title')
    if (el) el.textContent = 'Datacenter Topology'
  }, [])
  const topoColors = useMemo(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      gradTop: cs.getPropertyValue('--topo-rack-grad-top').trim() || '#f8fafc',
      gradBottom: cs.getPropertyValue('--topo-rack-grad-bottom').trim() || '#f1f5f9',
      pduStripBg: cs.getPropertyValue('--topo-pdu-strip-bg').trim() || '#334155',
      pduStripBorder: cs.getPropertyValue('--topo-pdu-strip-border').trim() || '#475569',
      pduText: cs.getPropertyValue('--topo-pdu-text').trim() || '#fff',
      pduMeta: cs.getPropertyValue('--topo-pdu-meta').trim() || '#94a3b8',
      linkLldp: cs.getPropertyValue('--topo-link-lldp').trim() || '#94a3b8',
      serverFill: cs.getPropertyValue('--topo-server-fill').trim() || '#e2e8f0',
      serverStroke: cs.getPropertyValue('--topo-server-stroke').trim() || '#cbd5e1',
    }
  }, [theme])

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panDragging, setPanDragging] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [rackPositions, setRackPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    } catch { return {} }
  })
  const [unitPositions, setUnitPositions] = useState<Record<string, Record<string, number>>>(() => {
    try {
      return JSON.parse(localStorage.getItem(UNIT_POS_KEY) || '{}')
    } catch { return {} }
  })
  const [rackDragging, setRackDragging] = useState<{ key: string; ox: number; oy: number } | null>(null)
  const [unitDragging, setUnitDragging] = useState<{ rackKey: string; unitKey: string; startY: number; startU: number } | null>(null)
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['topology'],
    queryFn: () => topologyApi.get().then(r => r.data as { nodes: TopoNode[]; edges: TopoEdge[] }),
    refetchInterval: 60_000,
  })

  const { data: pduData } = useQuery({
    queryKey: ['pdu-dashboard-topo'],
    queryFn: () => pduApi.dashboard(1).then(r => r.data),
    refetchInterval: 60_000,
  })

  const pduByLocation = useMemo(() => {
    if (!pduData?.racks) return {} as Record<string, any>
    const map: Record<string, any> = {}
    pduData.racks.forEach((r: any) => { map[r.location_name] = r })
    return map
  }, [pduData])

  // Derive real servers from PDU outlet names with power redundancy count
  const rackServers = useMemo(() => {
    const result: Record<string, RackServerInfo[]> = {}
    if (!pduData?.racks) return result
    for (const rack of pduData.racks) {
      // Map: server name → Set of PDU device_ids that feed it
      const serverPduMap: Record<string, Set<number>> = {}
      for (const pdu of rack.pdus) {
        if (!pdu.outlets) continue
        for (const outlet of pdu.outlets) {
          if (outlet.name && SERVER_PREFIXES.test(outlet.name)) {
            if (!serverPduMap[outlet.name]) serverPduMap[outlet.name] = new Set()
            serverPduMap[outlet.name].add(pdu.device_id)
          }
        }
      }
      const servers: RackServerInfo[] = Object.entries(serverPduMap)
        .map(([name, pduIds]) => ({ name, pduCount: pduIds.size }))
        .sort((a, b) => a.name.localeCompare(b.name))
      if (servers.length > 0) {
        result[rack.location_name] = servers
      }
    }
    return result
  }, [pduData])

  const discoverMutation = useMutation({
    mutationFn: () => topologyApi.discover(),
    onSuccess: () => {
      toast.success('LLDP discovery started')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['topology'] }), 5000)
    },
  })

  const nodes = data?.nodes || []
  const edges = data?.edges || []

  const racks = useMemo(
    () => computeRacks(nodes, rackPositions, rackServers),
    [nodes, rackPositions, rackServers]
  )

  const filtered = search
    ? nodes.filter(n => n.hostname.toLowerCase().includes(search.toLowerCase()) || n.ip_address.includes(search))
    : nodes
  const filteredIds = new Set(filtered.map(n => n.id))

  const hoveredEdgeIds = useMemo(() => {
    if (hoveredNode === null) return new Set<number>()
    return new Set(
      edges.filter(e => e.source === hoveredNode || e.target === hoveredNode).map(e => e.id)
    )
  }, [hoveredNode, edges])

  // Persist positions
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rackPositions))
  }, [rackPositions])
  useEffect(() => {
    localStorage.setItem(UNIT_POS_KEY, JSON.stringify(unitPositions))
  }, [unitPositions])

  // ─── SVG mouse handlers ──────────────────────────────────────────────────
  const svgPoint = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    return pt.matrixTransform(svg.getScreenCTM()!.inverse())
  }, [])

  const onRackMouseDown = useCallback((e: React.MouseEvent, rackKey: string) => {
    e.stopPropagation()
    const p = svgPoint(e)
    const rack = racks.find(r => r.key === rackKey)
    if (!rack) return
    setRackDragging({ key: rackKey, ox: p.x - rack.x, oy: p.y - rack.y })
  }, [svgPoint, racks])

  const onUnitMouseDown = useCallback((e: React.MouseEvent, rackKey: string, unitKey: string, currentU: number) => {
    e.stopPropagation()
    const p = svgPoint(e)
    setUnitDragging({ rackKey, unitKey, startY: p.y, startU: currentU })
  }, [svgPoint])

  const onSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (unitDragging) {
      const p = svgPoint(e)
      const deltaY = p.y - unitDragging.startY
      const deltaU = -Math.round(deltaY / U_HEIGHT) // negative Y = higher U
      const newU = Math.max(1, Math.min(RACK_UNITS, unitDragging.startU + deltaU))
      setUnitPositions(prev => ({
        ...prev,
        [unitDragging.rackKey]: {
          ...prev[unitDragging.rackKey],
          [unitDragging.unitKey]: newU,
        },
      }))
    } else if (rackDragging) {
      const p = svgPoint(e)
      setRackPositions(prev => ({
        ...prev,
        [rackDragging.key]: { x: p.x - rackDragging.ox, y: p.y - rackDragging.oy },
      }))
    } else if (panDragging) {
      setPan({
        x: panDragging.px + e.clientX - panDragging.sx,
        y: panDragging.py + e.clientY - panDragging.sy,
      })
    }
  }, [unitDragging, rackDragging, panDragging, svgPoint])

  const onSvgMouseUp = useCallback(() => {
    setUnitDragging(null)
    setRackDragging(null)
    setPanDragging(null)
  }, [])

  const onSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName === 'svg') {
      setPanDragging({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
    }
  }, [pan])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      setZoom(z => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)))
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
  }, [])

  const resetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(UNIT_POS_KEY)
    setRackPositions({})
    setUnitPositions({})
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const fitAll = useCallback(() => {
    if (racks.length === 0) return
    const svgEl = svgRef.current
    if (!svgEl) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const rack of racks) {
      const hasPdu = rack.pduNodes.length > 0
      const rx = hasPdu ? rack.x - 26 : rack.x
      const rw = rack.pduNodes.length > 1 ? rack.width + 52 : hasPdu ? rack.width + 26 : rack.width
      minX = Math.min(minX, rx)
      minY = Math.min(minY, rack.y)
      maxX = Math.max(maxX, rx + rw)
      maxY = Math.max(maxY, rack.y + rack.height)
    }

    const contentW = maxX - minX
    const contentH = maxY - minY
    const svgRect = svgEl.getBoundingClientRect()
    const pad = 0.9

    const scaleX = (svgRect.width * pad) / contentW
    const scaleY = (svgRect.height * pad) / contentH
    const newZoom = Math.min(scaleX, scaleY, 1.5)

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const newPanX = svgRect.width / 2 - centerX * newZoom
    const newPanY = svgRect.height / 2 - centerY * newZoom

    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }, [racks])

  // Keyboard shortcut: F = Fit All
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'f' || e.key === 'F') fitAll()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [fitAll])

  // First-visit hint
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('topology-hint-shown'))
  useEffect(() => {
    if (!showHint) return
    localStorage.setItem('topology-hint-shown', '1')
    const timer = setTimeout(() => setShowHint(false), 5500)
    return () => clearTimeout(timer)
  }, [showHint])

  // ─── Render helpers ──────────────────────────────────────────────────────

  // Convert U slot to Y coordinate within rack content area
  // U=45 is top of rack, U=1 is bottom
  const uToY = (uSlot: number) => RACK_HEADER_H + (RACK_UNITS - uSlot) * U_HEIGHT

  const renderRack = (rack: RackDef) => {
    const rackBodyH = RACK_CONTENT_H

    // U-slot ticks
    const slotTicks: JSX.Element[] = []
    for (let u = 1; u <= RACK_UNITS; u++) {
      const y = uToY(u) + U_HEIGHT
      slotTicks.push(<line key={u} x1={8} y1={y} x2={16} y2={y} className="topo-rack-slot" />)
    }

    const unitW = RACK_W - UNIT_MARGIN_X * 2

    // Render switch units (1U each) — placed from top down
    const switchElements = rack.switchNodes.map((node, i) => {
      const unitKey = `sw-${node.id}`
      const savedU = unitPositions[rack.key]?.[unitKey]
      const uSlot = savedU != null ? savedU : (RACK_UNITS - i) // default: top down from U45
      const y = uToY(uSlot)
      const color = statusColor(node.status)
      const isFaded = search.length > 0 && !filteredIds.has(node.id)
      const isHovered = hoveredNode === node.id
      const isDragging = unitDragging?.rackKey === rack.key && unitDragging?.unitKey === unitKey

      return (
        <g
          key={unitKey}
          transform={`translate(0,${y})`}
          opacity={isFaded ? 0.2 : isDragging ? 0.6 : 1}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={e => onUnitMouseDown(e, rack.key, unitKey, uSlot)}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          onClick={e => { e.stopPropagation(); if (!unitDragging) navigate(`/devices/${node.id}`) }}
        >
          {isHovered && (
            <rect x={UNIT_MARGIN_X - 2} y={-1} width={unitW + 4} height={SWITCH_H + 2} rx={3}
              fill="none" stroke={color} strokeWidth={2} opacity={0.4} />
          )}
          <rect x={UNIT_MARGIN_X} y={0} width={unitW} height={SWITCH_H} rx={2}
            fill={color} opacity={0.9} />
          {/* Status bar on left */}
          <rect x={UNIT_MARGIN_X} y={0} width={4} height={SWITCH_H} rx={1} fill={color} />
          {/* Label */}
          <text x={UNIT_MARGIN_X + 10} y={SWITCH_H / 2 + 1} dominantBaseline="middle" fontSize={8}
            fill="#fff" fontWeight={700} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {deviceLabel(node.device_type)}
          </text>
          {/* Hostname */}
          <text x={UNIT_MARGIN_X + 28} y={SWITCH_H / 2 + 1} dominantBaseline="middle" fontSize={7}
            fill="#fff" fontWeight={500} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {node.hostname.length > 18 ? node.hostname.slice(0, 16) + '\u2026' : node.hostname}
          </text>
        </g>
      )
    })

    // Render server units (2U each) — placed from bottom up
    const serverElements = rack.servers.map((srv, i) => {
      const unitKey = `srv-${srv.name}`
      const savedU = unitPositions[rack.key]?.[unitKey]
      const uSlot = savedU != null ? savedU : (1 + i * 2) // default: bottom up, 2U each starting at U1
      const y = uToY(uSlot + 1)  // +1 because 2U occupies uSlot and uSlot+1
      const isDragging = unitDragging?.rackKey === rack.key && unitDragging?.unitKey === unitKey

      return (
        <g
          key={unitKey}
          transform={`translate(0,${y})`}
          opacity={isDragging ? 0.6 : 1}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={e => onUnitMouseDown(e, rack.key, unitKey, uSlot)}
        >
          <rect x={UNIT_MARGIN_X} y={0} width={unitW} height={SERVER_H} rx={2}
            className="topo-server-unit-2u" />
          {/* Drive bay dots */}
          {[0, 1, 2, 3].map(d => (
            <circle key={d} cx={UNIT_MARGIN_X + 10 + d * 7} cy={SERVER_H / 2} r={2.5}
              className="topo-server-dot" />
          ))}
          {/* Power LED — red pulse if single PDU, green if dual */}
          <circle cx={UNIT_MARGIN_X + unitW - 10} cy={SERVER_H / 2} r={3}
            className={srv.pduCount >= 2 ? 'topo-server-led' : 'topo-server-led--warning'} />
          {/* Server name */}
          <text x={RACK_W / 2} y={SERVER_H / 2 + 1} textAnchor="middle" dominantBaseline="middle"
            className="topo-server-text" style={{ fontSize: '8px' }}>
            {srv.name}
          </text>
        </g>
      )
    })

    return (
      <g
        key={rack.key}
        transform={`translate(${rack.x},${rack.y})`}
        className="topo-rack"
        onMouseDown={e => {
          // Only drag rack from header area or empty space
          const svg = svgRef.current!
          const pt = svg.createSVGPoint()
          pt.x = e.clientX; pt.y = e.clientY
          const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse())
          const localY = svgPt.y - rack.y
          if (localY < RACK_HEADER_H) {
            onRackMouseDown(e, rack.key)
          }
        }}
      >
        {/* Rack body */}
        <rect x={0} y={0} width={RACK_W} height={RACK_TOTAL_H} rx={8} className="topo-rack-body" />

        {/* Gradient overlay */}
        <defs>
          <linearGradient id={`rack-grad-${rack.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={topoColors.gradTop} />
            <stop offset="100%" stopColor={topoColors.gradBottom} />
          </linearGradient>
        </defs>
        <rect x={1} y={RACK_HEADER_H} width={RACK_W - 2} height={rackBodyH} fill={`url(#rack-grad-${rack.key})`} />

        {/* Side rails */}
        <line x1={8} y1={RACK_HEADER_H} x2={8} y2={RACK_TOTAL_H - RACK_FOOTER_H} className="topo-rack-rail" />
        <line x1={RACK_W - 8} y1={RACK_HEADER_H} x2={RACK_W - 8} y2={RACK_TOTAL_H - RACK_FOOTER_H} className="topo-rack-rail" />

        {/* U-slot ticks */}
        {slotTicks}

        {/* Header */}
        <rect x={0} y={0} width={RACK_W} height={RACK_HEADER_H} rx={8} className="topo-rack-header" style={{ cursor: 'grab' }} />
        <rect x={0} y={RACK_HEADER_H - 8} width={RACK_W} height={8} className="topo-rack-header" style={{ cursor: 'grab' }} />
        <text x={RACK_W / 2} y={RACK_HEADER_H / 2} textAnchor="middle" dominantBaseline="middle" className="topo-rack-header-text">
          {rack.label}
          {(() => {
            const rackPower = pduByLocation[rack.label]
            if (!rackPower) return null
            const loadPct = rackPower.avg_load_pct || 0
            const color = loadPct > 80 ? '#ef4444' : loadPct > 60 ? '#f59e0b' : '#22c55e'
            return (
              <tspan fill={color} fontSize={9}> — {rackPower.total_kw} kW ({loadPct}%)</tspan>
            )
          })()}
        </text>

        {/* Footer */}
        <rect x={0} y={RACK_TOTAL_H - RACK_FOOTER_H} width={RACK_W} height={RACK_FOOTER_H} rx={4} className="topo-rack-footer" />
        <rect x={0} y={RACK_TOTAL_H - RACK_FOOTER_H} width={RACK_W} height={4} className="topo-rack-footer" />

        {/* Switch units (at top) */}
        {switchElements}

        {/* Server units (from bottom) */}
        {serverElements}

        {/* PDU strips on sides */}
        {rack.pduNodes.map((pduNode, pIdx) => {
          const stripW = 22
          const stripH = Math.max(RACK_CONTENT_H - 40, 60)
          const stripY = RACK_HEADER_H + 20
          const stripX = pIdx === 0 ? -stripW - 4 : RACK_W + 4

          const rackPower = pduByLocation[rack.label]
          const pduInfo = rackPower?.pdus?.find((p: any) => p.device_id === pduNode.id)
          const loadPct = pduInfo?.load_pct || 0
          const powerKw = pduInfo ? ((pduInfo.power_watts || 0) / 1000).toFixed(1) : '?'
          const loadColor = loadPct > 80 ? '#ef4444' : loadPct > 60 ? '#f59e0b' : '#22c55e'
          const loadH = (loadPct / 100) * (stripH - 30)
          const pduLabel = pIdx === 0 ? 'PDU-A' : 'PDU-B'

          return (
            <g
              key={pduNode.id}
              transform={`translate(${stripX},${stripY})`}
              style={{ cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); navigate(`/devices/${pduNode.id}`) }}
            >
              <rect x={0} y={0} width={stripW} height={stripH} rx={3}
                fill={topoColors.pduStripBg} stroke={topoColors.pduStripBorder} strokeWidth={1} />
              <rect x={6} y={stripH - loadH - 14} width={10} height={loadH} rx={2}
                fill={loadColor} opacity={0.8} />
              <text x={stripW / 2} y={14} textAnchor="middle" fontSize={7} fill={topoColors.pduText} fontWeight={700}>
                {pduLabel}
              </text>
              <text x={stripW / 2} y={stripH - 4} textAnchor="middle" fontSize={7} fill={topoColors.pduMeta}>
                {powerKw}kW
              </text>
              <circle cx={stripW / 2} cy={24} r={3}
                fill={pduNode.status === 'up' ? '#22c55e' : pduNode.status === 'down' ? '#ef4444' : '#94a3b8'} />
            </g>
          )
        })}
      </g>
    )
  }

  // ─── Tooltip ─────────────────────────────────────────────────────────────
  const renderTooltip = () => {
    if (hoveredNode === null) return null
    const node = nodes.find(n => n.id === hoveredNode)
    if (!node) return null
    const pos = getDevicePos(node.id, racks, unitPositions)
    if (!pos) return null

    const tipX = pos.x + 28
    const tipY = pos.y - 60
    const tipW = 180
    const tipH = 120
    const color = statusColor(node.status)
    const statusText = node.status === 'up' ? 'Online' : node.status === 'down' ? 'Offline' : node.status === 'degraded' ? 'Degraded' : 'Unknown'

    return (
      <g className="topo-tooltip" transform={`translate(${tipX},${tipY})`}>
        <rect x={0} y={0} width={tipW} height={tipH} />
        <text x={10} y={18} fontWeight={700}>{node.hostname}</text>
        <text x={10} y={34} fontFamily="'DM Mono', monospace" fontSize={9}>{node.ip_address}</text>
        <text x={10} y={50}>Type: {node.device_type || 'unknown'}</text>
        {node.vendor && <text x={10} y={66}>Vendor: {node.vendor}</text>}
        <g transform={`translate(10, ${node.vendor ? 76 : 60})`}>
          <circle r={4} cx={4} cy={2} fill={color} />
          <text x={12} y={6}>{statusText}</text>
        </g>
        {node.cpu_usage != null && (
          <text x={10} y={node.vendor ? 96 : 80}>
            CPU: {node.cpu_usage.toFixed(0)}%{'  '}MEM: {node.memory_usage?.toFixed(0) ?? '?'}%
          </text>
        )}
        <text x={10} y={tipH - 8} fontSize={9} opacity={0.7}>Interfaces: {node.interface_count}</text>
      </g>
    )
  }

  // ─── Edges ───────────────────────────────────────────────────────────────
  const renderEdges = () => {
    return edges.map(edge => {
      const sPos = getDevicePos(edge.source, racks, unitPositions)
      const tPos = getDevicePos(edge.target, racks, unitPositions)
      if (!sPos || !tPos) return null

      const isFaded = search.length > 0 && !filteredIds.has(edge.source) && !filteredIds.has(edge.target)
      const isHighlighted = hoveredEdgeIds.has(edge.id)
      const isManual = edge.link_type === 'manual'

      const midX = (sPos.x + tPos.x) / 2
      const midY = Math.min(sPos.y, tPos.y) - 60
      const d = `M${sPos.x},${sPos.y} Q${midX},${midY} ${tPos.x},${tPos.y}`

      const linkClass = [
        'topo-link',
        isHighlighted ? 'topo-link--highlighted' : '',
        isManual ? 'topo-link--manual' : '',
        isManual ? 'topo-link--manual-color' : 'topo-link--lldp',
      ].filter(Boolean).join(' ')

      return (
        <g key={edge.id}>
          <path d={d} className={linkClass} opacity={isFaded ? 0.1 : undefined} />
          {isHighlighted && (edge.source_if || edge.target_if) && (
            <text x={midX} y={midY - 6} textAnchor="middle" fontSize={8} fill={topoColors.pduMeta}>
              {[edge.source_if, edge.target_if].filter(Boolean).join(' \u2194 ')}
            </text>
          )}
        </g>
      )
    })
  }

  return (
    <div className="flex-col-gap" style={{ height: '100%' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Datacenter Topology</h1>
          <p>Live datacenter view — 45U rack layout with PDU power & device connectivity</p>
        </div>
        <div className="flex-row-gap">
          <div className="search-bar">
            <Search size={13} />
            <input placeholder="Search devices..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-outline btn--icon" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, minWidth: 42, textAlign: 'center', color: 'var(--text-muted)' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="btn btn-outline btn--icon" onClick={() => setZoom(z => Math.min(3, z + 0.2))} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className="btn btn-outline" onClick={fitAll} title="Fit all racks in view (F)">
            <Focus size={13} />
            Fit All
          </button>
          <button className="btn btn-outline btn--icon" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="Reset view">
            <Maximize2 size={14} />
          </button>
          <button className="btn btn-outline" onClick={resetLayout} title="Reset rack & unit positions">
            <RotateCcw size={13} />
            Reset Layout
          </button>
          <button
            className="btn btn-outline"
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
          >
            <RefreshCw size={13} className={discoverMutation.isPending ? 'animate-spin' : ''} />
            Discover LLDP
          </button>
          <button
            className="btn btn-outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['topology'] })}
          >Refresh</button>
          <NocViewButton pageId="topology" />
        </div>
      </div>

      {/* Legend */}
      <div className="topo-legend">
        <span className="topo-legend__shape">
          <svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="#22c55e" /></svg>
          Online
        </span>
        <span className="topo-legend__shape">
          <svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="#ef4444" /></svg>
          Offline
        </span>
        <span className="topo-legend__shape">
          <svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="#f59e0b" /></svg>
          Degraded
        </span>
        <span className="topo-legend__shape">
          <svg width={16} height={10}><rect x={0} y={0} width={16} height={10} rx={2} fill="#22c55e" opacity={0.9} /></svg>
          Switch (1U)
        </span>
        <span className="topo-legend__shape">
          <svg width={16} height={10}><rect x={0} y={0} width={16} height={10} rx={2} fill={topoColors.serverFill} stroke={topoColors.serverStroke} /></svg>
          Server (2U)
        </span>
        <span className="topo-legend__shape">
          <svg width={12} height={12}><circle cx={6} cy={6} r={4} fill="#22c55e" /></svg>
          Dual PDU
        </span>
        <span className="topo-legend__shape">
          <svg width={12} height={12}><circle cx={6} cy={6} r={4} fill="#ef4444" className="topo-server-led--warning" /></svg>
          Single PDU
        </span>
        <span className="topo-legend__shape">
          <svg width={24} height={2}><line x1={0} y1={1} x2={24} y2={1} stroke={topoColors.linkLldp} strokeWidth={2} /></svg>
          LLDP
        </span>
        <span className="topo-legend__shape">
          <svg width={24} height={2}><line x1={0} y1={1} x2={24} y2={1} stroke="#a78bfa" strokeWidth={2} strokeDasharray="4,2" /></svg>
          Manual
        </span>
        <span style={{ marginLeft: 'auto' }} className="text-light">
          {nodes.length} devices · {edges.length} links
        </span>
      </div>

      {/* SVG Canvas */}
      <div className="card" style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        {isLoading && (
          <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
            <Loader2 size={32} className="animate-spin" />
            <p>Loading topology...</p>
          </div>
        )}
        {isError && (
          <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
            <p>Failed to load topology.</p>
          </div>
        )}
        {!isLoading && nodes.length === 0 && (
          <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
            <p>No devices found. <a href="/devices" className="link-primary">Add devices</a> and run LLDP discovery.</p>
          </div>
        )}
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ display: 'block', cursor: unitDragging ? 'grabbing' : rackDragging ? 'grabbing' : panDragging ? 'grabbing' : 'grab' }}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseDown={onSvgMouseDown}
          onWheel={onWheel}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {renderEdges()}
            {racks.map(renderRack)}
            {renderTooltip()}
          </g>
        </svg>
        {showHint && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(15,23,42,0.8)', color: 'white', padding: '8px 18px',
            borderRadius: 20, fontSize: 12, zIndex: 1000, pointerEvents: 'none',
            animation: 'topo-hint-fade 1s ease 4s forwards',
          }}>
            Scroll to pan &middot; Ctrl+Scroll to zoom &middot; F to fit all
          </div>
        )}
      </div>

      {/* Search results */}
      {search && filtered.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Search size={14} />
            <h3>Search Results ({filtered.length})</h3>
          </div>
          <div className="card-body flex-row-gap" style={{ flexWrap: 'wrap' }}>
            {filtered.map(n => (
              <a key={n.id} href={`/devices/${n.id}`} className="filter-chip active">
                {n.hostname}
                <span className="mono text-xs ml-2">{n.ip_address}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
