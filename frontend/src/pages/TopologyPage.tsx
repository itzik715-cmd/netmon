import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { topologyApi, pduApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Search, ZoomIn, ZoomOut, Maximize2, RotateCcw, Focus, Package, X, Trash2 } from 'lucide-react'
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

interface RackItemData {
  id: number
  rack_location: string
  item_type: string
  label: string
  u_slot: number
  u_size: number
  color: string | null
}

interface StoreCatalogEntry {
  type: string
  label: string
  uSize: number
  color: string
}

const STORE_CATALOG: StoreCatalogEntry[] = [
  { type: 'ats', label: 'ATS', uSize: 2, color: '#8b5cf6' },
  { type: 'ats', label: 'ATS', uSize: 3, color: '#8b5cf6' },
  { type: 'ats', label: 'ATS', uSize: 4, color: '#8b5cf6' },
  { type: 'shelf', label: 'Shelf', uSize: 1, color: '#64748b' },
  { type: 'modem', label: 'Modem', uSize: 1, color: '#0ea5e9' },
  { type: 'oob_switch', label: 'OOB Switch', uSize: 1, color: '#f59e0b' },
  { type: 'server', label: 'Server', uSize: 2, color: '#6366f1' },
  { type: 'blank', label: 'Blank Panel', uSize: 1, color: '#475569' },
  { type: 'blank', label: 'Blank Panel', uSize: 2, color: '#475569' },
]

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
  const [storeOpen, setStoreOpen] = useState(false)
  const [placingItem, setPlacingItem] = useState<StoreCatalogEntry | null>(null)
  const [hoveredSlot, setHoveredSlot] = useState<{ rackKey: string; u: number } | null>(null)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null)

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

  const { data: rackItemsData } = useQuery({
    queryKey: ['rack-items'],
    queryFn: () => topologyApi.rackItems().then(r => r.data as RackItemData[]),
    refetchInterval: 60_000,
  })
  const rackItems = rackItemsData || []

  const rackItemsByLocation = useMemo(() => {
    const map: Record<string, RackItemData[]> = {}
    rackItems.forEach(i => {
      ;(map[i.rack_location] = map[i.rack_location] || []).push(i)
    })
    return map
  }, [rackItems])

  const createItemMut = useMutation({
    mutationFn: (data: { rack_location: string; item_type: string; label: string; u_slot: number; u_size: number; color?: string }) =>
      topologyApi.createRackItem(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rack-items'] }),
  })

  const updateItemMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; label?: string; u_slot?: number; color?: string }) =>
      topologyApi.updateRackItem(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rack-items'] }),
  })

  const deleteItemMut = useMutation({
    mutationFn: (id: number) => topologyApi.deleteRackItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rack-items'] }),
  })

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
    if (unitDragging) {
      // If dragging a store item, persist the new U position via API
      const match = unitDragging.unitKey.match(/^item-(\d+)$/)
      if (match) {
        const itemId = parseInt(match[1])
        const newU = unitPositions[unitDragging.rackKey]?.[unitDragging.unitKey]
        if (newU != null && newU !== unitDragging.startU) {
          updateItemMut.mutate({ id: itemId, u_slot: newU })
        }
      }
    }
    setUnitDragging(null)
    setRackDragging(null)
    setPanDragging(null)
  }, [unitDragging, unitPositions, updateItemMut])

  const onSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.target as SVGElement).tagName === 'svg') {
      e.preventDefault()
      setPanDragging({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
    }
  }, [pan])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.shiftKey) {
      // Shift+scroll = horizontal pan
      setPan(p => ({ x: p.x - e.deltaY, y: p.y }))
      return
    }
    // Scroll = zoom toward cursor
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const direction = e.deltaY < 0 ? 1 : -1
    const factor = 1.12
    setZoom(prev => {
      const nz = Math.max(0.15, Math.min(4, prev * (direction > 0 ? factor : 1 / factor)))
      const scale = nz / prev
      setPan(p => ({
        x: mx - scale * (mx - p.x),
        y: my - scale * (my - p.y),
      }))
      return nz
    })
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
      if (e.key === 'Escape') { setPlacingItem(null); setEditingItemId(null) }
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
    const RAIL_W = 6
    const RAIL_X_L = 10
    const RAIL_X_R = RACK_W - 10 - RAIL_W
    const EQUIP_X = RAIL_X_L + RAIL_W + 4
    const EQUIP_W = RAIL_X_R - EQUIP_X - 4

    // Mounting holes on rails (one per U)
    const mountingHoles: JSX.Element[] = []
    for (let u = 1; u <= RACK_UNITS; u++) {
      const y = uToY(u) + U_HEIGHT / 2
      mountingHoles.push(
        <circle key={`ml-${u}`} cx={RAIL_X_L + RAIL_W / 2} cy={y} r={1.2} className="topo-mount-hole" />,
        <circle key={`mr-${u}`} cx={RAIL_X_R + RAIL_W / 2} cy={y} r={1.2} className="topo-mount-hole" />,
      )
    }

    // U-slot horizontal lines
    const slotLines: JSX.Element[] = []
    for (let u = 1; u <= RACK_UNITS; u++) {
      const y = uToY(u) + U_HEIGHT
      slotLines.push(<line key={u} x1={EQUIP_X} y1={y} x2={EQUIP_X + EQUIP_W} y2={y} className="topo-rack-slot" />)
    }

    // U-number labels every 5U
    const uLabels: JSX.Element[] = []
    for (let u = 5; u <= RACK_UNITS; u += 5) {
      const y = uToY(u) + U_HEIGHT / 2
      uLabels.push(
        <text key={`u-${u}`} x={RAIL_X_L - 1} y={y + 1} textAnchor="end" dominantBaseline="middle" className="topo-u-label">{u}</text>
      )
    }

    // Render switch units (1U each)
    const switchElements = rack.switchNodes.map((node, i) => {
      const unitKey = `sw-${node.id}`
      const savedU = unitPositions[rack.key]?.[unitKey]
      const uSlot = savedU != null ? savedU : (RACK_UNITS - i)
      const y = uToY(uSlot)
      const color = statusColor(node.status)
      const isFaded = search.length > 0 && !filteredIds.has(node.id)
      const isHovered = hoveredNode === node.id
      const isDragging = unitDragging?.rackKey === rack.key && unitDragging?.unitKey === unitKey

      // Port indicators (small rects simulating front panel)
      const portCount = 8
      const portStartX = EQUIP_X + EQUIP_W - portCount * 5 - 4
      const ports: JSX.Element[] = []
      for (let p = 0; p < portCount; p++) {
        ports.push(
          <rect key={p} x={portStartX + p * 5} y={4} width={3.5} height={SWITCH_H - 8} rx={0.5}
            fill="rgba(255,255,255,0.3)" />
        )
      }

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
            <rect x={EQUIP_X - 2} y={-1} width={EQUIP_W + 4} height={SWITCH_H + 2} rx={2}
              fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
          )}
          {/* Main faceplate */}
          <rect x={EQUIP_X} y={0} width={EQUIP_W} height={SWITCH_H} rx={1}
            fill={color} opacity={0.85} />
          {/* Status accent */}
          <rect x={EQUIP_X} y={0} width={3} height={SWITCH_H} rx={0.5} fill={color} />
          {/* LED indicators */}
          <circle cx={EQUIP_X + 8} cy={SWITCH_H / 2 - 3} r={1.2} fill="#fff" opacity={0.8} />
          <circle cx={EQUIP_X + 8} cy={SWITCH_H / 2 + 3} r={1.2} fill="#22c55e" opacity={0.7} />
          {/* Label */}
          <text x={EQUIP_X + 14} y={SWITCH_H / 2 + 1} dominantBaseline="middle" fontSize={7}
            fill="#fff" fontWeight={700} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {deviceLabel(node.device_type)}
          </text>
          {/* Hostname */}
          <text x={EQUIP_X + 30} y={SWITCH_H / 2 + 1} dominantBaseline="middle" fontSize={6.5}
            fill="rgba(255,255,255,0.9)" fontWeight={500} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {node.hostname.length > 16 ? node.hostname.slice(0, 14) + '\u2026' : node.hostname}
          </text>
          {/* Port indicators */}
          {ports}
        </g>
      )
    })

    // Render server units (2U each)
    const serverElements = rack.servers.map((srv, i) => {
      const unitKey = `srv-${srv.name}`
      const savedU = unitPositions[rack.key]?.[unitKey]
      const uSlot = savedU != null ? savedU : (1 + i * 2)
      const y = uToY(uSlot + 1)
      const isDragging = unitDragging?.rackKey === rack.key && unitDragging?.unitKey === unitKey

      // Drive bays
      const bayCount = 6
      const bays: JSX.Element[] = []
      for (let b = 0; b < bayCount; b++) {
        bays.push(
          <rect key={b} x={EQUIP_X + 18 + b * 10} y={4} width={8} height={SERVER_H - 8} rx={1}
            className="topo-server-bay" />
        )
      }

      return (
        <g
          key={unitKey}
          transform={`translate(0,${y})`}
          opacity={isDragging ? 0.6 : 1}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={e => onUnitMouseDown(e, rack.key, unitKey, uSlot)}
        >
          {/* Server body */}
          <rect x={EQUIP_X} y={0} width={EQUIP_W} height={SERVER_H} rx={1}
            className="topo-server-unit-2u" />
          {/* Left handle */}
          <line x1={EQUIP_X + 4} y1={6} x2={EQUIP_X + 4} y2={SERVER_H - 6} className="topo-server-handle" />
          <line x1={EQUIP_X + 7} y1={6} x2={EQUIP_X + 7} y2={SERVER_H - 6} className="topo-server-handle" />
          {/* Drive bays */}
          {bays}
          {/* Power LED */}
          <circle cx={EQUIP_X + EQUIP_W - 8} cy={SERVER_H / 2} r={2.5}
            className={srv.pduCount >= 2 ? 'topo-server-led' : 'topo-server-led--warning'} />
          {/* Server name */}
          <text x={EQUIP_X + EQUIP_W / 2} y={SERVER_H / 2 + 1} textAnchor="middle" dominantBaseline="middle"
            className="topo-server-text" style={{ fontSize: '7px' }}>
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
        {/* Drop shadow filter */}
        <defs>
          <filter id={`shadow-${rack.key}`} x="-5%" y="-2%" width="112%" height="106%">
            <feDropShadow dx="3" dy="3" stdDeviation="4" floodOpacity="0.15" />
          </filter>
          <linearGradient id={`rack-grad-${rack.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={topoColors.gradTop} />
            <stop offset="100%" stopColor={topoColors.gradBottom} />
          </linearGradient>
        </defs>

        {/* Outer cabinet shell */}
        <rect x={0} y={0} width={RACK_W} height={RACK_TOTAL_H} rx={2} className="topo-rack-body"
          filter={`url(#shadow-${rack.key})`} />

        {/* Inner equipment area */}
        <rect x={RAIL_X_L + RAIL_W + 1} y={RACK_HEADER_H + 1}
          width={RACK_W - 2 * (RAIL_X_L + RAIL_W) - 2} height={RACK_CONTENT_H - 2}
          fill={`url(#rack-grad-${rack.key})`} rx={1} />

        {/* Left mounting rail */}
        <rect x={RAIL_X_L} y={RACK_HEADER_H} width={RAIL_W} height={RACK_CONTENT_H} className="topo-rack-rail-strip" />
        {/* Right mounting rail */}
        <rect x={RAIL_X_R} y={RACK_HEADER_H} width={RAIL_W} height={RACK_CONTENT_H} className="topo-rack-rail-strip" />

        {/* Mounting holes */}
        {mountingHoles}

        {/* U-slot lines */}
        {slotLines}

        {/* U-number labels */}
        {uLabels}

        {/* Header nameplate */}
        <rect x={0} y={0} width={RACK_W} height={RACK_HEADER_H} rx={2} className="topo-rack-header" style={{ cursor: 'grab' }} />
        <rect x={0} y={RACK_HEADER_H - 4} width={RACK_W} height={4} className="topo-rack-header" style={{ cursor: 'grab' }} />
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
        <rect x={0} y={RACK_TOTAL_H - RACK_FOOTER_H} width={RACK_W} height={RACK_FOOTER_H} rx={2} className="topo-rack-footer" />

        {/* Placement hover preview (ghost item) */}
        {placingItem && hoveredSlot?.rackKey === rack.key && (() => {
          const ghostY = uToY(hoveredSlot.u + placingItem.uSize - 1)
          const ghostH = placingItem.uSize * U_HEIGHT
          return (
            <rect x={EQUIP_X} y={ghostY} width={EQUIP_W} height={ghostH} rx={2}
              fill={placingItem.color} opacity={0.35} stroke={placingItem.color} strokeWidth={1.5}
              strokeDasharray="4,2" style={{ pointerEvents: 'none' }} />
          )
        })()}

        {/* Clickable U-slot zones for placement mode */}
        {placingItem && Array.from({ length: RACK_UNITS }, (_, i) => {
          const u = i + 1
          const slotY = uToY(u)
          return (
            <rect
              key={`place-${u}`}
              x={EQUIP_X} y={slotY} width={EQUIP_W} height={U_HEIGHT}
              fill="transparent"
              style={{ cursor: 'copy' }}
              onMouseEnter={() => setHoveredSlot({ rackKey: rack.key, u })}
              onMouseLeave={() => setHoveredSlot(null)}
              onClick={e => {
                e.stopPropagation()
                createItemMut.mutate({
                  rack_location: rack.key,
                  item_type: placingItem.type,
                  label: placingItem.label,
                  u_slot: u,
                  u_size: placingItem.uSize,
                  color: placingItem.color,
                })
                setPlacingItem(null)
                setHoveredSlot(null)
              }}
            />
          )
        })}

        {/* Store items (manually placed) */}
        {(rackItemsByLocation[rack.key] || []).map(item => {
          const unitKey = `item-${item.id}`
          const savedU = unitPositions[rack.key]?.[unitKey]
          const uSlot = savedU != null ? savedU : item.u_slot
          const itemY = uToY(uSlot + item.u_size - 1)
          const itemH = item.u_size * U_HEIGHT
          const itemColor = item.color || '#64748b'
          const isDragging = unitDragging?.rackKey === rack.key && unitDragging?.unitKey === unitKey
          const isHovered = hoveredItemId === item.id
          const isEditing = editingItemId === item.id

          return (
            <g
              key={unitKey}
              transform={`translate(0,${itemY})`}
              opacity={isDragging ? 0.6 : 1}
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              onMouseDown={e => { if (!isEditing) onUnitMouseDown(e, rack.key, unitKey, uSlot) }}
              onMouseEnter={() => setHoveredItemId(item.id)}
              onMouseLeave={() => setHoveredItemId(null)}
              onDoubleClick={e => {
                e.stopPropagation()
                setEditingItemId(item.id)
                setEditLabel(item.label)
              }}
            >
              {/* Item body */}
              <rect x={EQUIP_X} y={0} width={EQUIP_W} height={itemH} rx={2}
                fill={itemColor} opacity={0.85} />
              {/* Left accent bar */}
              <rect x={EQUIP_X} y={0} width={3} height={itemH} rx={0.5} fill={itemColor} />

              {/* Type-specific visuals */}
              {item.item_type === 'ats' && <>
                {/* Power symbol */}
                <text x={EQUIP_X + 10} y={itemH / 2 + 1} dominantBaseline="middle" fontSize={10}
                  fill="rgba(255,255,255,0.7)" style={{ pointerEvents: 'none' }}>⚡</text>
                {/* Transfer switch indicators */}
                <circle cx={EQUIP_X + EQUIP_W - 20} cy={itemH / 2 - 4} r={2} fill="rgba(255,255,255,0.5)" />
                <circle cx={EQUIP_X + EQUIP_W - 20} cy={itemH / 2 + 4} r={2} fill="rgba(255,255,255,0.5)" />
                <line x1={EQUIP_X + EQUIP_W - 22} y1={itemH / 2} x2={EQUIP_X + EQUIP_W - 18} y2={itemH / 2}
                  stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
              </>}
              {item.item_type === 'shelf' && <>
                {/* Horizontal line pattern */}
                <line x1={EQUIP_X + 8} y1={itemH / 2} x2={EQUIP_X + EQUIP_W - 8} y2={itemH / 2}
                  stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
              </>}
              {item.item_type === 'modem' && <>
                {/* Signal bars */}
                {[0, 1, 2, 3].map(b => (
                  <rect key={b} x={EQUIP_X + EQUIP_W - 24 + b * 4} y={itemH - 4 - (b + 1) * 2.5}
                    width={2.5} height={(b + 1) * 2.5} rx={0.5} fill="rgba(255,255,255,0.5)" />
                ))}
              </>}
              {item.item_type === 'oob_switch' && <>
                {/* Small port indicators */}
                {[0, 1, 2, 3].map(p => (
                  <rect key={p} x={EQUIP_X + EQUIP_W - 28 + p * 5} y={4} width={3.5} height={itemH - 8}
                    rx={0.5} fill="rgba(255,255,255,0.3)" />
                ))}
              </>}
              {item.item_type === 'server' && <>
                {/* Drive bays */}
                {[0, 1, 2, 3].map(b => (
                  <rect key={b} x={EQUIP_X + 22 + b * 10} y={4} width={8} height={itemH - 8}
                    rx={1} fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />
                ))}
              </>}
              {item.item_type === 'blank' && <>
                {/* Subtle ventilation pattern */}
                {Array.from({ length: Math.min(item.u_size * 3, 8) }, (_, i) => (
                  <line key={i} x1={EQUIP_X + 20 + i * 14} y1={3} x2={EQUIP_X + 20 + i * 14} y2={itemH - 3}
                    stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />
                ))}
              </>}

              {/* Label */}
              {isEditing ? (
                <foreignObject x={EQUIP_X + 18} y={itemH / 2 - 8} width={EQUIP_W - 36} height={16}>
                  <input
                    type="text"
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    onBlur={() => {
                      if (editLabel.trim() && editLabel !== item.label) {
                        updateItemMut.mutate({ id: item.id, label: editLabel.trim() })
                      }
                      setEditingItemId(null)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingItemId(null)
                    }}
                    autoFocus
                    style={{
                      width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', color: '#fff',
                      border: '1px solid rgba(255,255,255,0.4)', borderRadius: 2, fontSize: 7,
                      padding: '0 3px', outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                </foreignObject>
              ) : (
                <text x={EQUIP_X + 18} y={itemH / 2 + 1} dominantBaseline="middle" fontSize={7}
                  fill="#fff" fontWeight={600} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {item.label}{item.u_size > 1 ? ` ${item.u_size}U` : ''}
                </text>
              )}

              {/* Delete button on hover */}
              {isHovered && !isEditing && (
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={e => {
                    e.stopPropagation()
                    deleteItemMut.mutate(item.id)
                  }}
                >
                  <circle cx={EQUIP_X + EQUIP_W - 7} cy={7} r={5} fill="rgba(239,68,68,0.9)" />
                  <text x={EQUIP_X + EQUIP_W - 7} y={8} textAnchor="middle" dominantBaseline="middle"
                    fontSize={7} fill="#fff" fontWeight={700} style={{ pointerEvents: 'none' }}>×</text>
                </g>
              )}
            </g>
          )
        })}

        {/* Switch units */}
        {switchElements}

        {/* Server units */}
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
          const loadH = (loadPct / 100) * (stripH - 40)
          const pduLabel = pIdx === 0 ? 'PDU-A' : 'PDU-B'

          // Outlet indicators
          const outletCount = Math.floor((stripH - 50) / 14)
          const outlets: JSX.Element[] = []
          for (let o = 0; o < outletCount; o++) {
            outlets.push(
              <circle key={o} cx={stripW / 2} cy={36 + o * 14} r={2.5} className="topo-pdu-outlet" />
            )
          }

          return (
            <g
              key={pduNode.id}
              transform={`translate(${stripX},${stripY})`}
              style={{ cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); navigate(`/devices/${pduNode.id}`) }}
            >
              <rect x={0} y={0} width={stripW} height={stripH} rx={2}
                fill={topoColors.pduStripBg} stroke={topoColors.pduStripBorder} strokeWidth={1} />
              {/* Outlet indicators */}
              {outlets}
              {/* Load bar */}
              <rect x={stripW - 6} y={stripH - loadH - 18} width={4} height={loadH} rx={1}
                fill={loadColor} opacity={0.85} />
              <text x={stripW / 2} y={12} textAnchor="middle" fontSize={6} fill={topoColors.pduText} fontWeight={700}>
                {pduLabel}
              </text>
              <text x={stripW / 2} y={stripH - 4} textAnchor="middle" fontSize={6} fill={topoColors.pduMeta}>
                {powerKw}kW
              </text>
              <circle cx={stripW / 2} cy={22} r={3}
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
          <button className="btn btn-outline btn--icon" onClick={() => setZoom(z => Math.max(0.15, z / 1.25))} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, minWidth: 42, textAlign: 'center', color: 'var(--text-muted)' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="btn btn-outline btn--icon" onClick={() => setZoom(z => Math.min(4, z * 1.25))} title="Zoom in">
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
            className={`btn ${storeOpen ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setStoreOpen(s => !s); setPlacingItem(null) }}
            title="Rack store — add passive equipment"
          >
            <Package size={13} />
            Store
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
          style={{ display: 'block', cursor: unitDragging ? 'grabbing' : rackDragging ? 'grabbing' : panDragging ? 'grabbing' : placingItem ? 'crosshair' : 'grab' }}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseDown={onSvgMouseDown}
          onWheel={onWheel}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}
            style={{ transition: panDragging || rackDragging || unitDragging ? 'none' : 'transform 0.12s ease-out' }}>
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
            Scroll to zoom &middot; Shift+Scroll to pan &middot; Drag headers to move racks &middot; F to fit all
          </div>
        )}
      </div>

      {/* Store Panel */}
      {storeOpen && (
        <div className="topo-store-panel">
          <div className="topo-store-header">
            <h3>Rack Store</h3>
            <button className="btn btn-ghost btn--icon" onClick={() => { setStoreOpen(false); setPlacingItem(null) }}>
              <X size={14} />
            </button>
          </div>
          {placingItem && (
            <div className="topo-store-placing">
              Placing: <strong>{placingItem.label} {placingItem.uSize}U</strong>
              <span style={{ fontSize: 10, opacity: 0.7 }}> — click a U slot in any rack</span>
              <button className="btn btn-ghost btn--icon" style={{ marginLeft: 'auto' }}
                onClick={() => setPlacingItem(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          <div className="topo-store-grid">
            {STORE_CATALOG.map((entry, i) => (
              <button
                key={i}
                className={`topo-store-card${placingItem === entry ? ' topo-store-card--active' : ''}`}
                onClick={() => setPlacingItem(placingItem === entry ? null : entry)}
              >
                <div className="topo-store-card__preview" style={{ background: entry.color, height: Math.max(entry.uSize * 10, 16) }}>
                  {entry.type === 'ats' && <span>⚡</span>}
                  {entry.type === 'shelf' && <span style={{ fontSize: 10 }}>━</span>}
                  {entry.type === 'modem' && <span style={{ fontSize: 9 }}>📡</span>}
                  {entry.type === 'oob_switch' && <span style={{ fontSize: 9 }}>🔌</span>}
                  {entry.type === 'server' && <span style={{ fontSize: 9 }}>🖥</span>}
                  {entry.type === 'blank' && <span style={{ fontSize: 8, opacity: 0.5 }}>—</span>}
                </div>
                <div className="topo-store-card__info">
                  <span className="topo-store-card__name">{entry.label}</span>
                  <span className="topo-store-card__size">{entry.uSize}U</span>
                </div>
              </button>
            ))}
          </div>
          {rackItems.length > 0 && (
            <div className="topo-store-placed">
              <div className="topo-store-placed__header">Placed Items ({rackItems.length})</div>
              {rackItems.map(item => (
                <div key={item.id} className="topo-store-placed__item">
                  <div className="topo-store-placed__color" style={{ background: item.color || '#64748b' }} />
                  <span className="topo-store-placed__label">{item.label} {item.u_size}U</span>
                  <span className="topo-store-placed__loc">{item.rack_location} U{item.u_slot}</span>
                  <button className="btn btn-ghost btn--icon" onClick={() => deleteItemMut.mutate(item.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
