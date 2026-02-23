import { useRef, useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { topologyApi } from '../services/api'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Search, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
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

interface NodePos { x: number; y: number }

// ─── Layout: assign positions by device type tier ────────────────────────────
function computeLayout(nodes: TopoNode[], width: number, height: number): Record<number, NodePos> {
  const tierOrder = ['spine', 'core', 'router', 'firewall', 'leaf', 'distribution', 'switch', 'tor', 'access', 'server', 'unknown', 'other']
  const tiers: Record<string, TopoNode[]> = {}
  nodes.forEach(n => {
    const tier = tierOrder.find(t => (n.device_type || '').toLowerCase().includes(t)) || 'unknown'
    ;(tiers[tier] = tiers[tier] || []).push(n)
  })
  const orderedTiers = tierOrder.filter(t => tiers[t]?.length)
  const pos: Record<number, NodePos> = {}
  orderedTiers.forEach((tier, ti) => {
    const rows = tiers[tier]
    const y = 80 + ti * (height - 120) / Math.max(orderedTiers.length - 1, 1)
    rows.forEach((n, ni) => {
      const x = 80 + ni * (width - 160) / Math.max(rows.length - 1, 1)
      pos[n.id] = { x: isNaN(x) ? width / 2 : x, y }
    })
  })
  return pos
}

// ─── Device type icon ─────────────────────────────────────────────────────────
function nodeShape(type: string): string {
  if (['spine', 'core', 'router'].includes(type)) return 'diamond'
  if (['firewall'].includes(type)) return 'pentagon'
  if (['server'].includes(type)) return 'rect'
  return 'circle'
}

function statusColor(status: string) {
  if (status === 'up') return '#27ae60'
  if (status === 'down') return '#e74c3c'
  if (status === 'degraded') return '#f39c12'
  return '#94a3b8'
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function TopologyPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const [dims, setDims] = useState({ w: 1200, h: 700 })
  const [positions, setPositions] = useState<Record<number, NodePos>>({})
  const [dragging, setDragging] = useState<{ id: number; ox: number; oy: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panDragging, setPanDragging] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['topology'],
    queryFn: () => topologyApi.get().then(r => r.data as { nodes: TopoNode[]; edges: TopoEdge[] }),
    refetchInterval: 60_000,
  })

  const discoverMutation = useMutation({
    mutationFn: () => topologyApi.discover(),
    onSuccess: () => {
      toast.success('LLDP discovery started')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['topology'] }), 5000)
    },
  })

  // Measure container
  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width || 1200, h: Math.max(height, 500) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Init positions when data arrives
  useEffect(() => {
    if (!data?.nodes?.length) return
    setPositions(prev => {
      const computed = computeLayout(data.nodes, dims.w, dims.h)
      // Keep manually repositioned nodes
      const merged: Record<number, NodePos> = {}
      data.nodes.forEach(n => {
        merged[n.id] = prev[n.id] || computed[n.id]
      })
      return merged
    })
  }, [data, dims])

  // Drag node
  const onNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: number) => {
    e.stopPropagation()
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    const cur = positions[nodeId] || { x: 0, y: 0 }
    setDragging({ id: nodeId, ox: svgP.x - cur.x, oy: svgP.y - cur.y })
  }, [positions])

  const onSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      const svg = svgRef.current!
      const pt = svg.createSVGPoint()
      pt.x = e.clientX; pt.y = e.clientY
      const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse())
      setPositions(prev => ({
        ...prev,
        [dragging.id]: { x: svgP.x - dragging.ox, y: svgP.y - dragging.oy },
      }))
    } else if (panDragging) {
      setPan({ x: panDragging.px + e.clientX - panDragging.sx, y: panDragging.py + e.clientY - panDragging.sy })
    }
  }, [dragging, panDragging])

  const onSvgMouseUp = useCallback(() => {
    setDragging(null)
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

  const nodes = data?.nodes || []
  const edges = data?.edges || []
  const filtered = search
    ? nodes.filter(n => n.hostname.toLowerCase().includes(search.toLowerCase()) || n.ip_address.includes(search))
    : nodes

  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const NODE_R = 26
  const LABEL_Y = NODE_R + 16

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Network Topology</h1>
          <p>Live view of device connectivity — drag nodes to rearrange</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="search-bar">
            <Search size={13} />
            <input placeholder="Search devices..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button
            className="btn btn-outline"
            onClick={() => setZoom(z => Math.min(3, z + 0.2))}
            title="Zoom in"
          ><ZoomIn size={14} /></button>
          <button
            className="btn btn-outline"
            onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}
            title="Zoom out"
          ><ZoomOut size={14} /></button>
          <button
            className="btn btn-outline"
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
            title="Reset view"
          ><Maximize2 size={14} /></button>
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
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
        {[['up', '#27ae60', 'Online'], ['down', '#e74c3c', 'Offline'], ['degraded', '#f39c12', 'Degraded'], ['unknown', '#94a3b8', 'Unknown']].map(([s, c, l]) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c as string, display: 'inline-block' }} />
            {l}
          </span>
        ))}
        <span style={{ marginLeft: 12 }}>— LLDP link</span>
        <span style={{ color: '#a78bfa' }}>— Manual link</span>
        <span style={{ marginLeft: 12, color: 'var(--text-light)' }}>{nodes.length} devices · {edges.length} links</span>
      </div>

      {/* SVG Topology */}
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
            <p>No devices found. <a href="/devices" style={{ color: 'var(--primary)' }}>Add devices</a> and run LLDP discovery.</p>
          </div>
        )}
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ display: 'block', cursor: dragging ? 'grabbing' : panDragging ? 'grabbing' : 'grab', minHeight: 480 }}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseDown={onSvgMouseDown}
          onWheel={onWheel}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {edges.map(edge => {
              const s = positions[edge.source]
              const t = positions[edge.target]
              if (!s || !t) return null
              const isFaded = search && !filtered.find(n => n.id === edge.source || n.id === edge.target)
              return (
                <g key={edge.id}>
                  <line
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    stroke={edge.link_type === 'manual' ? '#a78bfa' : '#94a3b8'}
                    strokeWidth={1.5}
                    strokeDasharray={edge.link_type === 'manual' ? '6,3' : undefined}
                    opacity={isFaded ? 0.15 : 0.6}
                  />
                  {/* Port labels at midpoint */}
                  {(edge.source_if || edge.target_if) && !isFaded && (
                    <text
                      x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 4}
                      textAnchor="middle" fontSize={9} fill="#94a3b8"
                    >
                      {[edge.source_if, edge.target_if].filter(Boolean).join(' ↔ ')}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const pos = positions[node.id]
              if (!pos) return null
              const color = statusColor(node.status)
              const isFaded = search && !filtered.find(n => n.id === node.id)
              const isHovered = hoveredNode === node.id
              const shape = nodeShape(node.device_type)
              const r = isHovered ? NODE_R + 3 : NODE_R

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  opacity={isFaded ? 0.2 : 1}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={e => onNodeMouseDown(e, node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={e => { if (!dragging) { e.stopPropagation(); navigate(`/devices/${node.id}`) } }}
                >
                  {/* Shadow */}
                  {isHovered && (
                    <circle r={r + 6} fill="none" stroke={color} strokeWidth={2} opacity={0.3} />
                  )}

                  {/* Shape */}
                  {shape === 'diamond' ? (
                    <polygon
                      points={`0,${-r} ${r},0 0,${r} ${-r},0`}
                      fill={color}
                      stroke="white"
                      strokeWidth={2}
                    />
                  ) : shape === 'rect' ? (
                    <rect
                      x={-r} y={-r * 0.75}
                      width={r * 2} height={r * 1.5}
                      rx={4}
                      fill={color}
                      stroke="white"
                      strokeWidth={2}
                    />
                  ) : (
                    <circle r={r} fill={color} stroke="white" strokeWidth={2} />
                  )}

                  {/* Icon letter */}
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill="white"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {(node.device_type || 'U')[0].toUpperCase()}
                  </text>

                  {/* Hostname label */}
                  <text
                    y={LABEL_Y}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="var(--text-main)"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.hostname.length > 18 ? node.hostname.slice(0, 16) + '…' : node.hostname}
                  </text>
                  <text
                    y={LABEL_Y + 13}
                    textAnchor="middle"
                    fontSize={9}
                    fill="var(--text-muted)"
                    fontFamily="DM Mono, monospace"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {node.ip_address}
                  </text>

                  {/* CPU/Mem badge */}
                  {isHovered && node.cpu_usage != null && (
                    <g transform={`translate(${r - 4}, ${-r + 4})`}>
                      <rect x={-24} y={-10} width={48} height={14} rx={4} fill="#1e293b" opacity={0.88} />
                      <text textAnchor="middle" y={1} fontSize={8} fill="white">
                        CPU {node.cpu_usage.toFixed(0)}% · MEM {node.memory_usage?.toFixed(0) ?? '?'}%
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {/* Node list when searching */}
      {search && filtered.length > 0 && (
        <div className="card">
          <div className="card-header">
            <Search size={14} />
            <h3>Search Results ({filtered.length})</h3>
          </div>
          <div style={{ padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {filtered.map(n => (
              <a
                key={n.id}
                href={`/devices/${n.id}`}
                style={{
                  padding: '4px 10px', background: 'var(--primary-light)',
                  color: 'var(--primary)', borderRadius: 6, fontSize: 12,
                  fontWeight: 600, textDecoration: 'none',
                }}
              >
                {n.hostname}
                <span style={{ marginLeft: 6, opacity: 0.6, fontFamily: 'DM Mono, monospace', fontSize: 10 }}>
                  {n.ip_address}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
