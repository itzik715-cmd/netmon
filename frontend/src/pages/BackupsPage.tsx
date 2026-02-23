import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { backupsApi, devicesApi } from '../services/api'
import {
  ConfigBackup, ConfigBackupDetail, BackupSchedule, DiffResult,
} from '../types'
import {
  Archive, RefreshCw, Download, Trash2, GitCompare, Loader2,
  Clock, CheckCircle, XCircle, AlertTriangle, X, ChevronDown, ChevronUp,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import toast from 'react-hot-toast'

// ─── Inline diff viewer ───────────────────────────────────────────────────────

function DiffLine({ line }: { line: string }) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return (
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-muted)', padding: '0 8px' }}>
        {line}
      </div>
    )
  }
  if (line.startsWith('@@')) {
    return (
      <div style={{
        fontFamily: 'DM Mono, monospace', fontSize: 11,
        background: 'rgba(59,130,246,0.08)', color: '#3b82f6',
        padding: '2px 8px', userSelect: 'none',
      }}>
        {line}
      </div>
    )
  }
  if (line.startsWith('+')) {
    return (
      <div style={{
        fontFamily: 'DM Mono, monospace', fontSize: 11,
        background: 'rgba(16,185,129,0.12)', color: '#10b981',
        padding: '0 8px', whiteSpace: 'pre-wrap',
      }}>
        {line}
      </div>
    )
  }
  if (line.startsWith('-')) {
    return (
      <div style={{
        fontFamily: 'DM Mono, monospace', fontSize: 11,
        background: 'rgba(239,68,68,0.1)', color: '#ef4444',
        padding: '0 8px', whiteSpace: 'pre-wrap',
      }}>
        {line}
      </div>
    )
  }
  return (
    <div style={{
      fontFamily: 'DM Mono, monospace', fontSize: 11,
      color: 'var(--text-muted)', padding: '0 8px', whiteSpace: 'pre-wrap',
    }}>
      {line}
    </div>
  )
}

function DiffViewer({ diff, onClose }: { diff: DiffResult; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 1000,
        border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <GitCompare size={16} style={{ color: 'var(--primary)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-main)' }}>Config Diff</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {diff.label_a} → {diff.label_b}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {diff.identical ? (
              <span style={{ fontSize: 12, color: 'var(--accent-green)', fontWeight: 600 }}>
                ✓ Identical
              </span>
            ) : (
              <>
                <span style={{ fontSize: 12, color: '#10b981' }}>+{diff.additions} added</span>
                <span style={{ fontSize: 12, color: '#ef4444' }}>−{diff.deletions} removed</span>
              </>
            )}
            <button onClick={onClose} className="btn btn-outline btn-sm">
              <X size={13} /> Close
            </button>
          </div>
        </div>

        {/* Diff content */}
        <div style={{
          background: 'var(--bg)', borderRadius: '0 0 12px 12px',
          maxHeight: '70vh', overflowY: 'auto',
          padding: '8px 0',
        }}>
          {diff.identical ? (
            <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-muted)' }}>
              <CheckCircle size={28} style={{ color: 'var(--accent-green)', marginBottom: 8 }} />
              <p>The two configurations are identical.</p>
            </div>
          ) : diff.diff_lines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-muted)' }}>
              No diff data available.
            </div>
          ) : (
            diff.diff_lines.map((line, i) => <DiffLine key={i} line={line} />)
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Schedule settings panel ──────────────────────────────────────────────────

function SchedulePanel() {
  const qc = useQueryClient()
  const { data: schedules } = useQuery<BackupSchedule[]>({
    queryKey: ['backup-schedule'],
    queryFn: () => backupsApi.schedules().then((r) => r.data),
  })
  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  })

  // New schedule form state
  const [newDeviceId, setNewDeviceId] = useState<string>('')
  const [newHour, setNewHour] = useState(2)
  const [newMinute, setNewMinute] = useState(0)
  const [newRetention, setNewRetention] = useState(90)

  const apiDevices = (devices || []).filter((d: any) => d.api_username)

  const saveMutation = useMutation({
    mutationFn: (data: object) => backupsApi.updateSchedule(data),
    onSuccess: () => {
      toast.success('Schedule saved')
      qc.invalidateQueries({ queryKey: ['backup-schedule'] })
      setNewDeviceId('')
      setNewHour(2)
      setNewMinute(0)
      setNewRetention(90)
    },
    onError: () => toast.error('Failed to save schedule'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => backupsApi.deleteSchedule(id),
    onSuccess: () => {
      toast.success('Schedule deleted')
      qc.invalidateQueries({ queryKey: ['backup-schedule'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (sched: BackupSchedule) => backupsApi.updateSchedule({
      device_id: sched.device_id,
      hour: sched.hour,
      minute: sched.minute,
      retention_days: sched.retention_days,
      is_active: !sched.is_active,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-schedule'] })
    },
  })

  return (
    <div className="card">
      <div className="card-header">
        <Clock size={15} />
        <h3>Backup Schedules</h3>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {/* Existing schedules table */}
        {(schedules || []).length > 0 && (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Device</th>
                <th>Time (UTC)</th>
                <th>Retention</th>
                <th>Enabled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(schedules || []).map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>
                    {s.device_id ? (s.device_hostname || `Device #${s.device_id}`) : 'All API Devices'}
                  </td>
                  <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>
                    {String(s.hour).padStart(2, '0')}:{String(s.minute).padStart(2, '0')}
                  </td>
                  <td style={{ fontSize: 13 }}>{s.retention_days} days</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={s.is_active}
                      onChange={() => toggleMutation.mutate(s)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => { if (s.id && confirm('Delete this schedule?')) deleteMutation.mutate(s.id) }}
                      className="btn btn-outline btn-sm"
                      style={{ color: 'var(--accent-red)' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add schedule form */}
        <div style={{ padding: 16, borderTop: (schedules || []).length > 0 ? '1px solid var(--border)' : 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-main)' }}>Add Schedule</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label className="label" style={{ fontSize: 11 }}>Device</label>
              <select
                className="select"
                value={newDeviceId}
                onChange={(e) => setNewDeviceId(e.target.value)}
                style={{ minWidth: 180, height: 32, fontSize: 12 }}
              >
                <option value="">All API Devices</option>
                {apiDevices.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.hostname}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" style={{ fontSize: 11 }}>Time (UTC)</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <select className="select" value={newHour} onChange={(e) => setNewHour(parseInt(e.target.value))} style={{ width: 65, height: 32, fontSize: 12 }}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{h.toString().padStart(2, '0')}h</option>
                  ))}
                </select>
                <select className="select" value={newMinute} onChange={(e) => setNewMinute(parseInt(e.target.value))} style={{ width: 65, height: 32, fontSize: 12 }}>
                  {[0, 15, 30, 45].map((m) => (
                    <option key={m} value={m}>{m.toString().padStart(2, '0')}m</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label" style={{ fontSize: 11 }}>Retention (days)</label>
              <input
                type="number"
                className="input"
                value={newRetention}
                min={1}
                max={3650}
                onChange={(e) => setNewRetention(parseInt(e.target.value))}
                style={{ width: 80, height: 32, fontSize: 12 }}
              />
            </div>
            <button
              onClick={() => saveMutation.mutate({
                device_id: newDeviceId ? parseInt(newDeviceId) : null,
                hour: newHour,
                minute: newMinute,
                retention_days: newRetention,
                is_active: true,
              })}
              disabled={saveMutation.isPending}
              className="btn btn-primary btn-sm"
              style={{ height: 32 }}
            >
              {saveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BackupsPage() {
  const qc = useQueryClient()
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState<number | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareA, setCompareA] = useState<number | null>(null)
  const [compareB, setCompareB] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [backupDetail, setBackupDetail] = useState<ConfigBackupDetail | null>(null)

  const { data: summary } = useQuery({
    queryKey: ['backups-summary'],
    queryFn: () => backupsApi.summary().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list().then((r) => r.data),
  })

  const { data: backups, isLoading } = useQuery<ConfigBackup[]>({
    queryKey: ['backups', selectedDevice],
    queryFn: () => backupsApi.list(selectedDevice ? { device_id: selectedDevice } : {}).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const manualMutation = useMutation({
    mutationFn: (deviceId: number) => backupsApi.manualBackup(deviceId),
    onSuccess: () => {
      toast.success('Backup started')
      qc.invalidateQueries({ queryKey: ['backups'] })
      qc.invalidateQueries({ queryKey: ['backups-summary'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Backup failed'),
  })

  const apiDevices = (devices || []).filter((d: any) => d.api_username) as any[]

  const backupAllMutation = useMutation({
    mutationFn: async () => {
      await Promise.allSettled(apiDevices.map((d: any) => backupsApi.manualBackup(d.id)))
    },
    onSuccess: () => {
      toast.success('Backup triggered for all devices')
      qc.invalidateQueries({ queryKey: ['backups'] })
      qc.invalidateQueries({ queryKey: ['backups-summary'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => backupsApi.delete(id),
    onSuccess: () => {
      toast.success('Backup deleted')
      qc.invalidateQueries({ queryKey: ['backups'] })
      qc.invalidateQueries({ queryKey: ['backups-summary'] })
    },
  })

  const handleDiffLive = async (id: number) => {
    setDiffLoading(id)
    try {
      const r = await backupsApi.diffLive(id)
      setDiff(r.data)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Diff failed')
    } finally {
      setDiffLoading(null)
    }
  }

  const handleDiffStartup = async (id: number) => {
    setDiffLoading(id)
    try {
      const r = await backupsApi.diffStartup(id)
      setDiff(r.data)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Diff failed')
    } finally {
      setDiffLoading(null)
    }
  }

  const handleDiffTwo = async () => {
    if (!compareA || !compareB) return
    setDiffLoading(-1)
    try {
      const r = await backupsApi.diffTwo(compareA, compareB)
      setDiff(r.data)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Diff failed')
    } finally {
      setDiffLoading(null)
    }
  }

  const handleDownload = async (id: number, hostname?: string) => {
    try {
      const r = await backupsApi.downloadRaw(id)
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${hostname || 'device'}-backup-${id}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    }
  }

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      setBackupDetail(null)
      return
    }
    setExpandedId(id)
    try {
      const r = await backupsApi.get(id)
      setBackupDetail(r.data)
    } catch {
      toast.error('Failed to load backup detail')
    }
  }

  const toggleCompare = (id: number) => {
    if (compareA === id) { setCompareA(null); return }
    if (compareB === id) { setCompareB(null); return }
    if (!compareA) { setCompareA(id); return }
    if (!compareB) { setCompareB(id); return }
    // Replace B
    setCompareB(id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {diff && <DiffViewer diff={diff} onClose={() => setDiff(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>Config Backups</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Running-config snapshots with unsaved-changes detection and version comparison
          </p>
        </div>
        <button
          onClick={() => setCompareMode((v) => !v)}
          className={`btn ${compareMode ? 'btn-primary' : 'btn-outline'} btn-sm`}
        >
          <GitCompare size={13} />
          {compareMode ? 'Exit Compare' : 'Compare Versions'}
        </button>
        <button
          onClick={() => backupAllMutation.mutate()}
          disabled={backupAllMutation.isPending || !apiDevices.length}
          className="btn btn-primary btn-sm"
        >
          {backupAllMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
          Backup All Now
        </button>
      </div>

      {/* Summary stats */}
      <div className="stats-grid">
        {[
          {
            label: 'Total Backups', value: summary?.total ?? '—',
            icon: <Archive size={16} />, color: '',
          },
          {
            label: 'Unsaved Changes', value: summary?.unsaved_changes ?? '—',
            icon: <AlertTriangle size={16} />,
            color: (summary?.unsaved_changes || 0) > 0 ? 'var(--accent-orange)' : '',
          },
          {
            label: 'Failed Backups', value: summary?.failed ?? '—',
            icon: <XCircle size={16} />,
            color: (summary?.failed || 0) > 0 ? 'var(--accent-red)' : '',
          },
          {
            label: 'Devices Backed Up', value: summary?.devices_backed_up ?? '—',
            icon: <CheckCircle size={16} />, color: '',
          },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.icon} {s.label}
            </div>
            <div className="stat-value" style={{ color: s.color || 'var(--text-main)' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Schedule settings */}
      <SchedulePanel />

      {/* Compare panel */}
      {compareMode && (
        <div className="card">
          <div className="card-header">
            <GitCompare size={15} />
            <h3>Compare Versions</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
              Click rows below to select version A and B, then click Compare
            </span>
          </div>
          <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap' }}>
              <div style={{
                flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${compareA ? 'var(--primary)' : 'var(--border)'}`,
                background: compareA ? 'rgba(99,102,241,0.06)' : 'var(--bg)',
                fontSize: 12, color: compareA ? 'var(--primary)' : 'var(--text-muted)',
              }}>
                {compareA
                  ? `Version A: Backup #${compareA} — ${backups?.find((b) => b.id === compareA)?.device_hostname || ''}`
                  : 'Version A: (click a row to select)'}
              </div>
              <div style={{
                flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${compareB ? '#10b981' : 'var(--border)'}`,
                background: compareB ? 'rgba(16,185,129,0.06)' : 'var(--bg)',
                fontSize: 12, color: compareB ? '#10b981' : 'var(--text-muted)',
              }}>
                {compareB
                  ? `Version B: Backup #${compareB} — ${backups?.find((b) => b.id === compareB)?.device_hostname || ''}`
                  : 'Version B: (click another row to select)'}
              </div>
            </div>
            <button
              onClick={handleDiffTwo}
              disabled={!compareA || !compareB || diffLoading === -1}
              className="btn btn-primary btn-sm"
            >
              {diffLoading === -1 ? <Loader2 size={13} className="animate-spin" /> : <GitCompare size={13} />}
              Compare
            </button>
            <button
              onClick={() => { setCompareA(null); setCompareB(null) }}
              className="btn btn-outline btn-sm"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Backups table */}
      <div className="card">
        <div className="card-header">
          <Archive size={15} />
          <h3>Backup History</h3>
          <div style={{ marginLeft: 'auto' }}>
            <select
              className="select"
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              style={{ height: 30, fontSize: 12 }}
            >
              <option value="">All devices</option>
              {(devices || []).map((d: any) => (
                <option key={d.id} value={d.id}>{d.hostname}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="empty-state card-body"><p>Loading backups...</p></div>
        ) : !backups || backups.length === 0 ? (
          <div className="empty-state">
            <Archive size={32} style={{ color: 'var(--text-light)', marginBottom: 8 }} />
            <p style={{ color: 'var(--text-muted)' }}>No backups yet.</p>
            <p style={{ fontSize: 12, color: 'var(--text-light)' }}>
              Click "Backup All Now" to start, or configure a device and click the backup button.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {compareMode && <th style={{ width: 40 }}>Select</th>}
                  <th>Device</th>
                  <th>Date / Time</th>
                  <th>Type</th>
                  <th>Running = Startup</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => {
                  const isSelected = compareA === backup.id || compareB === backup.id
                  const isExpanded = expandedId === backup.id

                  return (
                    <>
                      <tr
                        key={backup.id}
                        style={{
                          cursor: compareMode ? 'pointer' : 'default',
                          background: isSelected
                            ? compareA === backup.id ? 'rgba(99,102,241,0.06)' : 'rgba(16,185,129,0.06)'
                            : 'transparent',
                        }}
                        onClick={compareMode ? () => toggleCompare(backup.id) : undefined}
                      >
                        {compareMode && (
                          <td>
                            <input
                              type="checkbox"
                              readOnly
                              checked={isSelected}
                            />
                          </td>
                        )}
                        <td style={{ fontWeight: 600, fontSize: 13 }}>
                          {backup.device_hostname || `Device #${backup.device_id}`}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                          {backup.created_at ? (
                            <span title={new Date(backup.created_at).toLocaleString()}>
                              {formatDistanceToNow(new Date(backup.created_at), { addSuffix: true })}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <span className={backup.backup_type === 'scheduled' ? 'tag-blue' : 'tag-gray'}>
                            {backup.backup_type}
                          </span>
                        </td>
                        <td>
                          {backup.configs_match === null || backup.configs_match === undefined ? (
                            <span className="tag-gray">—</span>
                          ) : backup.configs_match ? (
                            <span className="tag-green">
                              <CheckCircle size={11} style={{ display: 'inline', marginRight: 4 }} />
                              Saved
                            </span>
                          ) : (
                            <span className="tag-orange">
                              <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />
                              Unsaved changes!
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {backup.size_bytes ? `${(backup.size_bytes / 1024).toFixed(1)} KB` : '—'}
                        </td>
                        <td>
                          {backup.error ? (
                            <span className="tag-red" title={backup.error}>Failed</span>
                          ) : (
                            <span className="tag-green">OK</span>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {/* Expand/view config */}
                            <button
                              onClick={() => handleExpand(backup.id)}
                              className="btn btn-outline btn-sm"
                              title="View config"
                            >
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                            {/* Download */}
                            {!backup.error && (
                              <button
                                onClick={() => handleDownload(backup.id, backup.device_hostname)}
                                className="btn btn-outline btn-sm"
                                title="Download config"
                              >
                                <Download size={11} />
                              </button>
                            )}
                            {/* Diff vs live */}
                            {!backup.error && (
                              <button
                                onClick={() => handleDiffLive(backup.id)}
                                disabled={diffLoading === backup.id}
                                className="btn btn-outline btn-sm"
                                title="Diff vs live config"
                              >
                                {diffLoading === backup.id
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <GitCompare size={11} />}
                              </button>
                            )}
                            {/* Diff running vs startup */}
                            {!backup.error && backup.configs_match === false && (
                              <button
                                onClick={() => handleDiffStartup(backup.id)}
                                disabled={diffLoading === backup.id}
                                className="btn btn-outline btn-sm"
                                title="Diff running vs startup config"
                                style={{ borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}
                              >
                                <AlertTriangle size={11} />
                              </button>
                            )}
                            {/* Manual backup for device */}
                            <button
                              onClick={() => manualMutation.mutate(backup.device_id)}
                              disabled={manualMutation.isPending}
                              className="btn btn-outline btn-sm"
                              title="Backup now"
                            >
                              <RefreshCw size={11} />
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => {
                                if (confirm(`Delete this backup?`)) deleteMutation.mutate(backup.id)
                              }}
                              className="btn btn-outline btn-sm"
                              style={{ color: 'var(--accent-red)' }}
                              title="Delete backup"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Expanded config view */}
                      {isExpanded && backupDetail && backupDetail.id === backup.id && (
                        <tr key={`${backup.id}-detail`}>
                          <td colSpan={compareMode ? 8 : 7} style={{ padding: 0 }}>
                            <div style={{
                              background: 'var(--bg)', borderTop: '1px solid var(--border)',
                              padding: 16,
                            }}>
                              {backupDetail.error ? (
                                <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>
                                  Error: {backupDetail.error}
                                </div>
                              ) : (
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                                    Running config — {backupDetail.size_bytes
                                      ? `${(backupDetail.size_bytes / 1024).toFixed(1)} KB`
                                      : 'unknown size'}
                                    {backupDetail.created_at && (
                                      <> · {format(new Date(backupDetail.created_at), 'yyyy-MM-dd HH:mm:ss')}</>
                                    )}
                                  </div>
                                  <pre style={{
                                    fontFamily: 'DM Mono, monospace', fontSize: 11,
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    borderRadius: 6, padding: 12, maxHeight: 400,
                                    overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                    color: 'var(--text-muted)', margin: 0,
                                  }}>
                                    {backupDetail.config_text || '(no config stored)'}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-device manual backup buttons */}
      <div className="card">
        <div className="card-header">
          <RefreshCw size={15} />
          <h3>Manual Backup by Device</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {apiDevices.map((d: any) => (
              <button
                key={d.id}
                onClick={() => manualMutation.mutate(d.id)}
                disabled={manualMutation.isPending}
                className="btn btn-outline btn-sm"
              >
                {manualMutation.isPending
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Archive size={11} />}
                {d.hostname}
              </button>
            ))}
            {!apiDevices.length && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No devices with API credentials configured.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
