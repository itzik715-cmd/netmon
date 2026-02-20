import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowsApi } from '../services/api'
import { Activity, TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#84cc16', '#f97316']

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

export default function FlowsPage() {
  const [hours, setHours] = useState(1)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['flow-stats', hours],
    queryFn: () => flowsApi.stats({ hours }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: conversations } = useQuery({
    queryKey: ['flow-conversations', hours],
    queryFn: () => flowsApi.conversations({ hours, limit: 50 }).then((r) => r.data),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Flow Analysis</h1>
          <p className="text-sm text-slate-400 mt-0.5">NetFlow & sFlow traffic analysis</p>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                hours === r.hours ? 'bg-blue-600 text-white' : 'bg-dark-100 text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card">
            <div className="text-sm text-slate-400">Total Flows</div>
            <div className="text-3xl font-bold text-slate-100 mt-1">
              {stats.total_flows.toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-slate-400">Total Traffic</div>
            <div className="text-3xl font-bold text-slate-100 mt-1">
              {formatBytes(stats.total_bytes)}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading flow data...</div>
      ) : !stats || stats.total_flows === 0 ? (
        <div className="card text-center py-16">
          <Activity className="h-12 w-12 mx-auto mb-4 text-slate-600" />
          <p className="text-slate-400 font-medium">No flow data available</p>
          <p className="text-slate-500 text-sm mt-2">
            Configure your network devices to export NetFlow to this server on UDP port 2055
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Talkers */}
            <div className="card">
              <h3 className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                Top Talkers (by bytes)
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.top_talkers} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false}
                    tickFormatter={(v) => formatBytes(v)} />
                  <YAxis type="category" dataKey="ip" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#1e2333', border: '1px solid #2d3748', borderRadius: '8px' }}
                    formatter={(v: number) => [formatBytes(v), 'Traffic']}
                  />
                  <Bar dataKey="bytes" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Top Destinations */}
            <div className="card">
              <h3 className="mb-4">Top Destinations</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.top_destinations} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false}
                    tickFormatter={(v) => formatBytes(v)} />
                  <YAxis type="category" dataKey="ip" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#1e2333', border: '1px solid #2d3748', borderRadius: '8px' }}
                    formatter={(v: number) => [formatBytes(v), 'Traffic']}
                  />
                  <Bar dataKey="bytes" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Protocol Distribution */}
            <div className="card">
              <h3 className="mb-4">Protocol Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={stats.protocol_distribution}
                    dataKey="bytes"
                    nameKey="protocol"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ protocol, percent }: any) =>
                      `${protocol} ${(percent * 100).toFixed(1)}%`
                    }
                    labelLine={false}
                  >
                    {stats.protocol_distribution.map((_: any, idx: number) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e2333', border: '1px solid #2d3748', borderRadius: '8px' }}
                    formatter={(v: number) => formatBytes(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Application Distribution */}
            <div className="card">
              <h3 className="mb-4">Applications</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={stats.application_distribution}
                    dataKey="bytes"
                    nameKey="app"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                  >
                    {stats.application_distribution.map((_: any, idx: number) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e2333', border: '1px solid #2d3748', borderRadius: '8px' }}
                    formatter={(v: number) => formatBytes(v)}
                  />
                  <Legend formatter={(v) => <span className="text-slate-300 text-xs">{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Conversations Table */}
          <div className="card">
            <h3 className="mb-4">Top Conversations</h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
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
                  {(conversations || []).map((flow: any) => (
                    <tr key={flow.id}>
                      <td className="font-mono text-sm">{flow.src_ip}</td>
                      <td className="font-mono text-sm">{flow.dst_ip}</td>
                      <td>
                        <span className="badge-info">{flow.protocol}</span>
                      </td>
                      <td className="font-mono text-sm text-slate-400">{flow.dst_port}</td>
                      <td className="text-slate-400 text-sm">{flow.application || '—'}</td>
                      <td className="font-mono text-sm">{formatBytes(flow.bytes)}</td>
                      <td className="text-slate-400">{flow.packets?.toLocaleString()}</td>
                      <td className="text-slate-500 text-xs">
                        {flow.timestamp ? new Date(flow.timestamp).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
