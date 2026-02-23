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
  const { data: schedule } = useQuery<BackupSchedule>({
    queryKey: ['backup-schedule'],
    queryFn: () => backupsApi.schedule().then((r) => r.data),
  })
  const [hour, setHour] = useState<number | null>(null)
  const [minute, setMinute] = useState<number | null>(null)
  const [retention, setRetention] = useState<number | null>(null)
  const [active, setActive] = useState<boolean | null>(null)

  const effectiveHour = hour ?? schedule?.hour ?? 2
  const effectiveMinute = minute ?? schedule?.minute ?? 0
  const effectiveRetention = retention ?? schedule?.retention_days ?? 90
  const effectiveActive = active ?? schedule?.is_active ?? true

  const saveMutation = useMutation({
    mutationFn: () => backupsApi.updateSchedule({
      hour: effectiveHour,
      minute: effectiveMinute,
      retention_days: effectiveRetention,
      is_active: effectiveActive,
    }),
    onSuccess: () => {
      toast.success('Backup schedule saved')
      qc.invalidateQueries({ queryKey: ['backup-schedule'] })
    },
    onError: () => toast.error('Failed to save schedule'),
  })

  return (
    <div className="card">
      <div className="card-header">
        <Clock size={15} />
        <h3>Backup Schedule</h3>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
          <div>
            <label className="label">Daily Backup Time (UTC)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                className="select"
                value={effectiveHour}
                onChange={(e) => setHour(parseInt(e.target.value))}
                style={{ flex: 1 }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{h.toString().padStart(2, '0')}h</option>
                ))}
              </select>
              <select
                className="select"
                value={effectiveMinute}
                onChange={(e) => setMinute(parseInt(e.target.value))}
                style={{ flex: 1 }}
              >
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{m.toString().padStart(2, '0')}m</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Retention Period (days)</label>
            <input
              type="number"
              className="input"
              value={effectiveRetention}
              min={1}
              max={3650}
              onChange={(e) => setRetention(parseInt(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Enabled</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 6 }}>
              <input
                type="checkbox"
                id="backup-active"
                checked={effectiveActive}
                onChange={(e) => setActive(e.target.checked)}
              />
              <label htmlFor="backup-active" style={{ fontSize: 13, color: 'var(--text-main)' }}>
                Automatic daily backups
              </label>
            </div>
          </div>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="btn btn-primary btn-sm"
        >
          {saveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
          Save Schedule
        </button>
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

  const backupAllMutation = useMutation({
    mutationFn: async () => {
      const devList = (devices || []) as any[]
      await Promise.allSettled(devList.map((d) => backupsApi.manualBackup(d.id)))
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
          disabled={backupAllMutation.isPending || !devices?.length}
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
            {(devices || []).map((d: any) => (
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
            {!devices?.length && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No devices configured.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
