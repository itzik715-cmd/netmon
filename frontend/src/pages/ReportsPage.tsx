import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi, devicesApi } from '../services/api'
import { FileText, Download, Loader2, Monitor, Wifi, Bell, Activity } from 'lucide-react'
import toast from 'react-hot-toast'

function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function ReportCard({
  icon,
  title,
  description,
  onDownload,
  loading,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onDownload: () => void
  loading: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        {icon}
        <h3>{title}</h3>
      </div>
      <div className="card-body" style={{ flex: 1 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{description}</p>
        {children}
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onDownload}
          disabled={loading}
          className="btn btn-primary btn-sm"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {loading ? 'Generating…' : 'Download CSV'}
        </button>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [loadingInterfaces, setLoadingInterfaces] = useState(false)
  const [loadingAlerts, setLoadingAlerts] = useState(false)
  const [loadingFlows, setLoadingFlows] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [alertsHours, setAlertsHours] = useState<string>('24')
  const [flowsHours, setFlowsHours] = useState<string>('24')

  const { data: summary } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => reportsApi.summary().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  })

  const handleDownload = async (
    fn: () => Promise<any>,
    filename: string,
    setLoading: (v: boolean) => void
  ) => {
    setLoading(true)
    try {
      const r = await fn()
      downloadBlob(r.data, filename)
      toast.success(`${filename} downloaded`)
    } catch {
      toast.error('Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>Reports</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Export network data as CSV for offline analysis and archiving
        </p>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="stats-grid">
          {[
            { label: 'Total Devices', value: summary.devices ?? '—', icon: <Monitor size={16} /> },
            { label: 'Total Interfaces', value: summary.interfaces ?? '—', icon: <Wifi size={16} /> },
            { label: 'Alert Events (24h)', value: summary.alert_events_24h ?? '—', icon: <Bell size={16} /> },
            { label: 'Flow Records (24h)', value: summary.flow_records_24h ?? '—', icon: <Activity size={16} /> },
          ].map((s, i) => (
            <div key={i} className="stat-card">
              <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {s.icon} {s.label}
              </div>
              <div className="stat-value">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Report cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Device Inventory */}
        <ReportCard
          icon={<Monitor size={15} />}
          title="Device Inventory"
          description="Complete list of all monitored devices including status, vendor, model, location, and SNMP configuration."
          loading={loadingDevices}
          onDownload={() =>
            handleDownload(
              () => reportsApi.devices(),
              `device-inventory-${dateStr}.csv`,
              setLoadingDevices
            )
          }
        >
          {summary && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{summary.devices}</span> devices
              {' · '}
              <span style={{ color: 'var(--accent-green)' }}>{summary.devices_up}</span> up
              {summary.devices_down > 0 && (
                <>{' · '}<span style={{ color: 'var(--accent-red)' }}>{summary.devices_down}</span> down</>
              )}
            </div>
          )}
        </ReportCard>

        {/* Interface Report */}
        <ReportCard
          icon={<Wifi size={15} />}
          title="Interface Report"
          description="All interfaces with their current status, speed, IP address, and latest traffic metrics."
          loading={loadingInterfaces}
          onDownload={() =>
            handleDownload(
              () => reportsApi.interfaces(selectedDevice ? parseInt(selectedDevice) : undefined),
              `interfaces-${dateStr}.csv`,
              setLoadingInterfaces
            )
          }
        >
          <div style={{ marginBottom: 8 }}>
            <label className="label">Filter by Device (optional)</label>
            <select
              className="select"
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
            >
              <option value="">All devices</option>
              {(devices || []).map((d: any) => (
                <option key={d.id} value={d.id}>{d.hostname} ({d.ip_address})</option>
              ))}
            </select>
          </div>
          {summary && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{summary.interfaces}</span> total interfaces
            </div>
          )}
        </ReportCard>

        {/* Alert History */}
        <ReportCard
          icon={<Bell size={15} />}
          title="Alert History"
          description="Alert events including severity, device, status, and acknowledgement details."
          loading={loadingAlerts}
          onDownload={() =>
            handleDownload(
              () => reportsApi.alerts(alertsHours ? parseInt(alertsHours) : undefined),
              `alerts-${dateStr}.csv`,
              setLoadingAlerts
            )
          }
        >
          <div style={{ marginBottom: 8 }}>
            <label className="label">Time Range</label>
            <select
              className="select"
              value={alertsHours}
              onChange={(e) => setAlertsHours(e.target.value)}
            >
              <option value="1">Last 1 hour</option>
              <option value="6">Last 6 hours</option>
              <option value="24">Last 24 hours</option>
              <option value="168">Last 7 days</option>
              <option value="720">Last 30 days</option>
            </select>
          </div>
          {summary && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{summary.alert_events_24h}</span> events in last 24h
            </div>
          )}
        </ReportCard>

        {/* Flow Records */}
        <ReportCard
          icon={<Activity size={15} />}
          title="Flow Records"
          description="NetFlow/sFlow traffic records including source/destination IPs, ports, protocol, and byte counts."
          loading={loadingFlows}
          onDownload={() =>
            handleDownload(
              () => reportsApi.flows(flowsHours ? parseInt(flowsHours) : undefined),
              `flows-${dateStr}.csv`,
              setLoadingFlows
            )
          }
        >
          <div style={{ marginBottom: 8 }}>
            <label className="label">Time Range</label>
            <select
              className="select"
              value={flowsHours}
              onChange={(e) => setFlowsHours(e.target.value)}
            >
              <option value="1">Last 1 hour</option>
              <option value="6">Last 6 hours</option>
              <option value="24">Last 24 hours</option>
              <option value="168">Last 7 days</option>
            </select>
          </div>
          {summary && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{summary.flow_records_24h?.toLocaleString()}</span> records in last 24h
            </div>
          )}
        </ReportCard>
      </div>

      {/* Instructions */}
      <div className="card">
        <div className="card-header">
          <FileText size={15} />
          <h3>About Reports</h3>
        </div>
        <div className="card-body">
          <ul style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8, paddingLeft: 20 }}>
            <li>All reports are exported as UTF-8 encoded CSV files compatible with Excel, Google Sheets, and other tools.</li>
            <li>Flow record exports are capped at 50,000 rows. For larger datasets, narrow the time range.</li>
            <li>Reports reflect live data at the time of download — no scheduling or caching.</li>
            <li>Use the filter options to scope reports to specific devices or time windows.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
