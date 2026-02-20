import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { interfacesApi } from '../services/api'
import { ArrowLeft, Activity } from 'lucide-react'
import { InterfaceMetric } from '../types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'
import { format } from 'date-fns'
import { useState } from 'react'

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`
  return `${bps.toFixed(0)} bps`
}

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

export default function InterfaceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const ifId = parseInt(id!)
  const [hours, setHours] = useState(24)

  const { data: iface } = useQuery({
    queryKey: ['interface', ifId],
    queryFn: () => interfacesApi.get(ifId).then((r) => r.data),
  })

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['interface-metrics', ifId, hours],
    queryFn: () => interfacesApi.metrics(ifId, hours).then((r) => r.data as InterfaceMetric[]),
    refetchInterval: 60_000,
  })

  const { data: latest } = useQuery({
    queryKey: ['interface-latest', ifId],
    queryFn: () => interfacesApi.latest(ifId).then((r) => r.data),
    refetchInterval: 30_000,
  })

  const chartData = (metrics || []).map((m) => ({
    time: format(new Date(m.timestamp), 'HH:mm'),
    'In (Mbps)': (m.in_bps / 1_000_000).toFixed(3),
    'Out (Mbps)': (m.out_bps / 1_000_000).toFixed(3),
    'In %': m.utilization_in.toFixed(2),
    'Out %': m.utilization_out.toFixed(2),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {iface && (
          <Link
            to={`/devices/${iface.device_id}`}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-dark-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <div>
          <h1 className="font-mono">{iface?.name || `Interface ${ifId}`}</h1>
          {iface?.alias && <p className="text-slate-400 text-sm">{iface.alias}</p>}
        </div>
        <div className="ml-auto flex gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                hours === r.hours
                  ? 'bg-blue-600 text-white'
                  : 'bg-dark-100 text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Current Stats */}
      {latest && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">In Throughput</div>
            <div className="text-2xl font-bold text-blue-400">{formatBps(latest.in_bps)}</div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">Out Throughput</div>
            <div className="text-2xl font-bold text-purple-400">{formatBps(latest.out_bps)}</div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">In Utilization</div>
            <div className={`text-2xl font-bold ${latest.utilization_in > 80 ? 'text-red-400' : 'text-emerald-400'}`}>
              {latest.utilization_in.toFixed(1)}%
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">Out Utilization</div>
            <div className={`text-2xl font-bold ${latest.utilization_out > 80 ? 'text-red-400' : 'text-emerald-400'}`}>
              {latest.utilization_out.toFixed(1)}%
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">Oper Status</div>
            <span className={latest.oper_status === 'up' ? 'badge-success' : 'badge-danger'}>
              {latest.oper_status}
            </span>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">In Errors</div>
            <div className={`text-2xl font-bold ${latest.in_errors > 0 ? 'text-red-400' : 'text-slate-400'}`}>
              {latest.in_errors}
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500 mb-1">Out Errors</div>
            <div className={`text-2xl font-bold ${latest.out_errors > 0 ? 'text-red-400' : 'text-slate-400'}`}>
              {latest.out_errors}
            </div>
          </div>
        </div>
      )}

      {/* Throughput Chart */}
      <div className="card">
        <h3 className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-blue-400" />
          Throughput — Last {hours}h
        </h3>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-slate-500">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-500">
            No data available for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                unit=" Mbps"
                width={70}
              />
              <Tooltip
                contentStyle={{ background: '#1e2333', border: '1px solid #2d3748', borderRadius: '8px' }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="In (Mbps)"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="Out (Mbps)"
                stroke="#a855f7"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Utilization Chart */}
      <div className="card">
        <h3 className="mb-4">Utilization %</h3>
        {chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                unit="%"
                domain={[0, 100]}
                width={45}
              />
              <Tooltip
                contentStyle={{ background: '#1e2333', border: '1px solid #2d3748', borderRadius: '8px' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="In %"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Out %"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
