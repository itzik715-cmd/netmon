import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { topologyApi, pduApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Search, ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'

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

// ─── Constants ────────────────────────────────────────────────────────────────
const RACK_W = 200
const RACK_HEADER_H = 32
const RACK_FOOTER_H = 8
const RACK_PAD_X = 16
const RACK_PAD_Y = 12
const RACK_MIN_H = 400
const RACK_GAP = 32
const RACKS_PER_ROW = 4

const DEVICE_SECTION_GAP = 8
const DEVICE_ROW_H = 70
const DEVICE_COL_W = 60
const MAX_PER_ROW = 3

const SERVER_H = 16
const SERVER_GAP = 2
const SERVER_MARGIN_X = 12

const DELL_MODELS = ['PE R640', 'PE R740', 'PE R650', 'PE R750', 'PE R6525', 'PE R7525', 'PE C6620', 'PE R760']

const TIER_SPINE = ['spine', 'core', 'router']
const TIER_FW = ['firewall']
const TIER_LEAF = ['leaf', 'switch', 'tor', 'access', 'distribution']

const STORAGE_KEY = 'netmon-rack-positions'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

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

function seededServers(rackName: string): string[] {
  const count = 6 + (hashCode(rackName) % 5)
  const result: string[] = []
  let h = hashCode(rackName + '_seed')
  for (let i = 0; i < count; i++) {
    h = ((h * 1103515245 + 12345) & 0x7fffffff)
    result.push(DELL_MODELS[h % DELL_MODELS.length])
  }
  return result
}

// ─── Rack layout computation ──────────────────────────────────────────────────
interface RackSection { nodes: TopoNode[]; rows: number }
interface RackDef {
  key: string
  label: string
  x: number
  y: number
  width: number
  height: number
  spines: RackSection
  firewalls: RackSection
  leaves: RackSection
  servers: string[]
  pduNodes: TopoNode[]
}

function sectionRows(count: number): number {
  return count === 0 ? 0 : Math.ceil(count / MAX_PER_ROW)
}

function computeRacks(
  nodes: TopoNode[],
  savedPositions: Record<string, { x: number; y: number }>,
  outletServerNames?: Record<string, string[]>,
): RackDef[] {
  // Group by location
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
    const spineNodes = gNodes.filter(n => deviceTier(n.device_type) === 'spine')
    const fwNodes = gNodes.filter(n => deviceTier(n.device_type) === 'firewall')
    const leafNodes = gNodes.filter(n => ['leaf', 'other'].includes(deviceTier(n.device_type)))

    // Use outlet-derived server names if available, otherwise fall back to seeded
    const servers = outletServerNames?.[key] || seededServers(key)

    // Calculate height
    const spineRows = sectionRows(spineNodes.length)
    const fwRows = sectionRows(fwNodes.length)
    const leafRows = sectionRows(leafNodes.length)

    let contentH = RACK_PAD_Y
    if (spineRows > 0) contentH += spineRows * DEVICE_ROW_H + DEVICE_SECTION_GAP
    if (fwRows > 0) contentH += fwRows * DEVICE_ROW_H + DEVICE_SECTION_GAP
    if (leafRows > 0) contentH += leafRows * DEVICE_ROW_H + DEVICE_SECTION_GAP
    contentH += servers.length * (SERVER_H + SERVER_GAP) + RACK_PAD_Y

    const height = Math.max(RACK_MIN_H, RACK_HEADER_H + contentH + RACK_FOOTER_H)

    // Default grid position
    const col = idx % RACKS_PER_ROW
    const row = Math.floor(idx / RACKS_PER_ROW)
    const defaultX = RACK_GAP + col * (RACK_W + RACK_GAP)
    const defaultY = RACK_GAP + row * (height + RACK_GAP)

    const pos = savedPositions[key] || { x: defaultX, y: defaultY }

    racks.push({
      key,
      label: key === '__unassigned__' ? 'Unassigned' : key,
      x: pos.x,
      y: pos.y,
      width: RACK_W,
      height,
      spines: { nodes: spineNodes, rows: spineRows },
      firewalls: { nodes: fwNodes, rows: fwRows },
      leaves: { nodes: leafNodes, rows: leafRows },
      servers,
      pduNodes,
    })
  })

  return racks
}

// Get absolute position of a device within its rack
function getDevicePos(
  nodeId: number,
  racks: RackDef[]
): { x: number; y: number } | null {
  for (const rack of racks) {
    let yOffset = RACK_HEADER_H + RACK_PAD_Y

    // Check spines
    const sIdx = rack.spines.nodes.findIndex(n => n.id === nodeId)
    if (sIdx >= 0) {
      const row = Math.floor(sIdx / MAX_PER_ROW)
      const col = sIdx % MAX_PER_ROW
      const colsInRow = Math.min(rack.spines.nodes.length - row * MAX_PER_ROW, MAX_PER_ROW)
      const startX = (RACK_W - colsInRow * DEVICE_COL_W) / 2 + DEVICE_COL_W / 2
      return { x: rack.x + startX + col * DEVICE_COL_W, y: rack.y + yOffset + row * DEVICE_ROW_H + 22 }
    }
    if (rack.spines.rows > 0) yOffset += rack.spines.rows * DEVICE_ROW_H + DEVICE_SECTION_GAP

    // Check firewalls
    const fIdx = rack.firewalls.nodes.findIndex(n => n.id === nodeId)
    if (fIdx >= 0) {
      const row = Math.floor(fIdx / MAX_PER_ROW)
      const col = fIdx % MAX_PER_ROW
      const colsInRow = Math.min(rack.firewalls.nodes.length - row * MAX_PER_ROW, MAX_PER_ROW)
      const startX = (RACK_W - colsInRow * DEVICE_COL_W) / 2 + DEVICE_COL_W / 2
      return { x: rack.x + startX + col * DEVICE_COL_W, y: rack.y + yOffset + row * DEVICE_ROW_H + 22 }
    }
    if (rack.firewalls.rows > 0) yOffset += rack.firewalls.rows * DEVICE_ROW_H + DEVICE_SECTION_GAP

    // Check leaves
    const lIdx = rack.leaves.nodes.findIndex(n => n.id === nodeId)
    if (lIdx >= 0) {
      const row = Math.floor(lIdx / MAX_PER_ROW)
      const col = lIdx % MAX_PER_ROW
      const colsInRow = Math.min(rack.leaves.nodes.length - row * MAX_PER_ROW, MAX_PER_ROW)
      const startX = (RACK_W - colsInRow * DEVICE_COL_W) / 2 + DEVICE_COL_W / 2
      return { x: rack.x + startX + col * DEVICE_COL_W, y: rack.y + yOffset + row * DEVICE_ROW_H + 12 }
    }
  }
  return null
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TopologyPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panDragging, setPanDragging] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [rackPositions, setRackPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    } catch { return {} }
  })
  const [rackDragging, setRackDragging] = useState<{ key: string; ox: number; oy: number } | null>(null)
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

  // Derive server names from PDU outlet names
  const outletServerNames = useMemo(() => {
    if (!pduData?.racks) return undefined
    const SERVER_PREFIXES = /^(VM|KV|NAS|ESX|HV|SRV|NODE|PM)/i
    const result: Record<string, string[]> = {}
    for (const rack of pduData.racks) {
      const names = new Set<string>()
      for (const pdu of rack.pdus) {
        if (pdu.outlets) {
          for (const outlet of pdu.outlets) {
            if (outlet.name && SERVER_PREFIXES.test(outlet.name)) {
              names.add(outlet.name)
            }
          }
        }
      }
      if (names.size > 0) {
        result[rack.location_name] = Array.from(names).sort()
      }
    }
    return Object.keys(result).length > 0 ? result : undefined
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
    () => computeRacks(nodes, rackPositions, outletServerNames),
    [nodes, rackPositions, outletServerNames]
  )

  const filtered = search
    ? nodes.filter(n => n.hostname.toLowerCase().includes(search.toLowerCase()) || n.ip_address.includes(search))
    : nodes
  const filteredIds = new Set(filtered.map(n => n.id))

  // Edges connected to hovered node
  const hoveredEdgeIds = useMemo(() => {
    if (hoveredNode === null) return new Set<number>()
    return new Set(
      edges.filter(e => e.source === hoveredNode || e.target === hoveredNode).map(e => e.id)
    )
  }, [hoveredNode, edges])

  // Save rack positions to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rackPositions))
  }, [rackPositions])

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

  const onSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (rackDragging) {
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
  }, [rackDragging, panDragging, svgPoint])

  const onSvgMouseUp = useCallback(() => {
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
    setZoom(z => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)))
  }, [])

  const resetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setRackPositions({})
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // ─── Render helpers ──────────────────────────────────────────────────────

  const renderDiamond = (node: TopoNode, cx: number, cy: number, isFaded: boolean, isHovered: boolean) => {
    const s = 19
    const color = statusColor(node.status)
    return (
      <g
        key={node.id}
        transform={`translate(${cx},${cy})`}
        opacity={isFaded ? 0.2 : 1}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
        onClick={e => { e.stopPropagation(); navigate(`/devices/${node.id}`) }}
      >
        {isHovered && <circle r={s + 8} fill="none" stroke={color} strokeWidth={2} opacity={0.3} />}
        <polygon
          points={`0,${-s} ${s},0 0,${s} ${-s},0`}
          fill={color}
          className="topo-device-spine"
        />
        <text textAnchor="middle" dominantBaseline="middle" fontSize={11} className="topo-device-label">
          {deviceLabel(node.device_type)}
        </text>
        <text y={s + 14} textAnchor="middle" className="topo-device-hostname">
          {node.hostname.length > 14 ? node.hostname.slice(0, 12) + '\u2026' : node.hostname}
        </text>
        <text y={s + 25} textAnchor="middle" className="topo-device-ip">
          {node.ip_address}
        </text>
      </g>
    )
  }

  const renderSwitch = (node: TopoNode, cx: number, cy: number, isFaded: boolean, isHovered: boolean) => {
    const w = 48, h = 20
    const color = statusColor(node.status)
    return (
      <g
        key={node.id}
        transform={`translate(${cx},${cy})`}
        opacity={isFaded ? 0.2 : 1}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
        onClick={e => { e.stopPropagation(); navigate(`/devices/${node.id}`) }}
      >
        {isHovered && <rect x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} rx={7} fill="none" stroke={color} strokeWidth={2} opacity={0.3} />}
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill={color} className="topo-device-leaf" />
        <text textAnchor="middle" dominantBaseline="middle" fontSize={10} className="topo-device-label">
          {deviceLabel(node.device_type)}
        </text>
        <text y={h / 2 + 13} textAnchor="middle" className="topo-device-hostname">
          {node.hostname.length > 14 ? node.hostname.slice(0, 12) + '\u2026' : node.hostname}
        </text>
        <text y={h / 2 + 24} textAnchor="middle" className="topo-device-ip">
          {node.ip_address}
        </text>
      </g>
    )
  }

  const renderFirewall = (node: TopoNode, cx: number, cy: number, isFaded: boolean, isHovered: boolean) => {
    const s = 18
    const color = statusColor(node.status)
    // Hexagon points
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2
      return `${Math.cos(a) * s},${Math.sin(a) * s}`
    }).join(' ')
    return (
      <g
        key={node.id}
        transform={`translate(${cx},${cy})`}
        opacity={isFaded ? 0.2 : 1}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
        onClick={e => { e.stopPropagation(); navigate(`/devices/${node.id}`) }}
      >
        {isHovered && <circle r={s + 8} fill="none" stroke={color} strokeWidth={2} opacity={0.3} />}
        <polygon points={pts} fill={color} className="topo-device-firewall" />
        <text textAnchor="middle" dominantBaseline="middle" fontSize={10} className="topo-device-label">
          FW
        </text>
        <text y={s + 14} textAnchor="middle" className="topo-device-hostname">
          {node.hostname.length > 14 ? node.hostname.slice(0, 12) + '\u2026' : node.hostname}
        </text>
        <text y={s + 25} textAnchor="middle" className="topo-device-ip">
          {node.ip_address}
        </text>
      </g>
    )
  }

  const renderDevice = (node: TopoNode, cx: number, cy: number) => {
    const isFaded = search.length > 0 && !filteredIds.has(node.id)
    const isHovered = hoveredNode === node.id
    const tier = deviceTier(node.device_type)
    if (tier === 'spine') return renderDiamond(node, cx, cy, isFaded, isHovered)
    if (tier === 'firewall') return renderFirewall(node, cx, cy, isFaded, isHovered)
    return renderSwitch(node, cx, cy, isFaded, isHovered)
  }

  const renderSection = (section: RackSection, yStart: number, renderFn: typeof renderDevice) => {
    if (section.nodes.length === 0) return null
    return section.nodes.map((node, i) => {
      const row = Math.floor(i / MAX_PER_ROW)
      const col = i % MAX_PER_ROW
      const colsInRow = Math.min(section.nodes.length - row * MAX_PER_ROW, MAX_PER_ROW)
      const startX = (RACK_W - colsInRow * DEVICE_COL_W) / 2 + DEVICE_COL_W / 2
      const cx = startX + col * DEVICE_COL_W
      const cy = yStart + row * DEVICE_ROW_H + 22
      return renderFn(node, cx, cy)
    })
  }

  const renderRack = (rack: RackDef) => {
    const rackBodyH = rack.height - RACK_HEADER_H - RACK_FOOTER_H
    let yOffset = RACK_HEADER_H + RACK_PAD_Y

    // U-slot ticks
    const slotTicks: JSX.Element[] = []
    for (let y = RACK_HEADER_H + 18; y < rack.height - RACK_FOOTER_H; y += 18) {
      slotTicks.push(<line key={y} x1={8} y1={y} x2={16} y2={y} className="topo-rack-slot" />)
    }

    // Separators
    const separators: JSX.Element[] = []
    const sectionOffsets: number[] = []

    sectionOffsets.push(yOffset)
    if (rack.spines.rows > 0) {
      yOffset += rack.spines.rows * DEVICE_ROW_H + DEVICE_SECTION_GAP
      if (rack.firewalls.rows > 0 || rack.leaves.rows > 0) {
        separators.push(<line key="sep-s" x1={20} y1={yOffset - 4} x2={RACK_W - 20} y2={yOffset - 4} className="topo-section-separator" />)
      }
    }
    sectionOffsets.push(yOffset)
    if (rack.firewalls.rows > 0) {
      yOffset += rack.firewalls.rows * DEVICE_ROW_H + DEVICE_SECTION_GAP
      if (rack.leaves.rows > 0) {
        separators.push(<line key="sep-f" x1={20} y1={yOffset - 4} x2={RACK_W - 20} y2={yOffset - 4} className="topo-section-separator" />)
      }
    }
    sectionOffsets.push(yOffset)
    if (rack.leaves.rows > 0) {
      yOffset += rack.leaves.rows * DEVICE_ROW_H + DEVICE_SECTION_GAP
    }

    // Dell servers
    const serverStartY = yOffset
    const serverElements = rack.servers.map((model, i) => {
      const sy = serverStartY + i * (SERVER_H + SERVER_GAP)
      const sw = RACK_W - SERVER_MARGIN_X * 2
      return (
        <g key={`srv-${i}`}>
          <rect x={SERVER_MARGIN_X} y={sy} width={sw} height={SERVER_H} rx={2} className="topo-server-unit" />
          {/* Drive bay dots */}
          {[0, 1, 2, 3].map(d => (
            <circle key={d} cx={SERVER_MARGIN_X + 8 + d * 6} cy={sy + SERVER_H / 2} r={2} className="topo-server-dot" />
          ))}
          {/* Power LED */}
          <circle cx={SERVER_MARGIN_X + sw - 8} cy={sy + SERVER_H / 2} r={2} className="topo-server-led" />
          {/* Model text */}
          <text x={RACK_W / 2} y={sy + SERVER_H / 2 + 2.5} textAnchor="middle" dominantBaseline="middle" className="topo-server-text">
            {model}
          </text>
        </g>
      )
    })

    return (
      <g
        key={rack.key}
        transform={`translate(${rack.x},${rack.y})`}
        className="topo-rack"
        onMouseDown={e => onRackMouseDown(e, rack.key)}
      >
        {/* Rack body */}
        <rect x={0} y={0} width={RACK_W} height={rack.height} rx={8} className="topo-rack-body" />

        {/* Gradient overlay for metallic look */}
        <defs>
          <linearGradient id={`rack-grad-${rack.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#f1f5f9" />
          </linearGradient>
        </defs>
        <rect x={1} y={RACK_HEADER_H} width={RACK_W - 2} height={rackBodyH} fill={`url(#rack-grad-${rack.key})`} />

        {/* Side rails */}
        <line x1={8} y1={RACK_HEADER_H} x2={8} y2={rack.height - RACK_FOOTER_H} className="topo-rack-rail" />
        <line x1={RACK_W - 8} y1={RACK_HEADER_H} x2={RACK_W - 8} y2={rack.height - RACK_FOOTER_H} className="topo-rack-rail" />

        {/* U-slot ticks */}
        {slotTicks}

        {/* Header */}
        <rect x={0} y={0} width={RACK_W} height={RACK_HEADER_H} rx={8} className="topo-rack-header" />
        <rect x={0} y={RACK_HEADER_H - 8} width={RACK_W} height={8} className="topo-rack-header" />
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
        <rect x={0} y={rack.height - RACK_FOOTER_H} width={RACK_W} height={RACK_FOOTER_H} rx={4} className="topo-rack-footer" />
        <rect x={0} y={rack.height - RACK_FOOTER_H} width={RACK_W} height={4} className="topo-rack-footer" />

        {/* Section separators */}
        {separators}

        {/* Devices */}
        {renderSection(rack.spines, sectionOffsets[0], renderDevice)}
        {renderSection(rack.firewalls, sectionOffsets[1], renderDevice)}
        {renderSection(rack.leaves, sectionOffsets[2], renderDevice)}

        {/* Decorative servers */}
        {serverElements}

        {/* PDU strips on sides */}
        {rack.pduNodes.map((pduNode, pIdx) => {
          const stripW = 22
          const stripH = Math.max(rack.height - RACK_HEADER_H - RACK_FOOTER_H - 40, 60)
          const stripY = RACK_HEADER_H + 20
          const stripX = pIdx === 0 ? -stripW - 4 : RACK_W + 4

          // Get power data for this PDU
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
                fill="#334155" stroke="#475569" strokeWidth={1} />
              {/* Load bar */}
              <rect x={6} y={stripH - loadH - 14} width={10} height={loadH} rx={2}
                fill={loadColor} opacity={0.8} />
              {/* Label (rotated) */}
              <text
                x={stripW / 2} y={14}
                textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700}
              >
                {pduLabel}
              </text>
              {/* Power text at bottom */}
              <text
                x={stripW / 2} y={stripH - 4}
                textAnchor="middle" fontSize={7} fill="#94a3b8"
              >
                {powerKw}kW
              </text>
              {/* Status dot */}
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
    const pos = getDevicePos(node.id, racks)
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
      const sPos = getDevicePos(edge.source, racks)
      const tPos = getDevicePos(edge.target, racks)
      if (!sPos || !tPos) return null

      const isFaded = search.length > 0 && !filteredIds.has(edge.source) && !filteredIds.has(edge.target)
      const isHighlighted = hoveredEdgeIds.has(edge.id)
      const isManual = edge.link_type === 'manual'

      // Bezier control point: arc upward
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
          <path
            d={d}
            className={linkClass}
            opacity={isFaded ? 0.1 : undefined}
          />
          {/* Port labels on hover */}
          {isHighlighted && (edge.source_if || edge.target_if) && (
            <text
              x={midX} y={midY - 6}
              textAnchor="middle" fontSize={8} fill="#94a3b8"
            >
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
          <p>Live datacenter view — rack layout with PDU power & device connectivity</p>
        </div>
        <div className="flex-row-gap">
          <div className="search-bar">
            <Search size={13} />
            <input placeholder="Search devices..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-outline btn--icon" onClick={() => setZoom(z => Math.min(3, z + 0.2))} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className="btn btn-outline btn--icon" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button className="btn btn-outline btn--icon" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="Reset view">
            <Maximize2 size={14} />
          </button>
          <button className="btn btn-outline" onClick={resetLayout} title="Reset rack positions">
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
          <svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="#94a3b8" /></svg>
          Unknown
        </span>
        <span className="topo-legend__shape">
          <svg width={16} height={16}><polygon points="8,1 15,8 8,15 1,8" fill="#64748b" /></svg>
          Spine/Router
        </span>
        <span className="topo-legend__shape">
          <svg width={20} height={12}><rect x={1} y={1} width={18} height={10} rx={3} fill="#64748b" /></svg>
          Leaf/Switch
        </span>
        <span className="topo-legend__shape">
          <svg width={24} height={2}><line x1={0} y1={1} x2={24} y2={1} stroke="#94a3b8" strokeWidth={2} /></svg>
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
      <div className="card" style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 480 }}>
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
          style={{ display: 'block', cursor: rackDragging ? 'grabbing' : panDragging ? 'grabbing' : 'grab', minHeight: 480 }}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseDown={onSvgMouseDown}
          onWheel={onWheel}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Edges (drawn first, behind racks) */}
            {renderEdges()}

            {/* Racks */}
            {racks.map(renderRack)}

            {/* Tooltip (on top of everything) */}
            {renderTooltip()}
          </g>
        </svg>
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
