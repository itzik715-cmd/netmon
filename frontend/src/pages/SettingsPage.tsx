import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi, authApi, serverMgmtApi } from '../services/api'
import {
  Settings, Shield, ShieldAlert, TestTube, Loader2, Monitor, Save, Fingerprint,
  Server, Play, Square, RotateCcw, Cpu, HardDrive, Wifi, MemoryStick, Activity,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'ldap' | 'mfa' | 'fastnetmon' | 'security' | 'services' | 'health'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('services')
  const [ldapConfig, setLdapConfig] = useState({
    enabled: false, server: '', port: 389, use_ssl: false, base_dn: '', bind_dn: '', bind_password: '',
    user_filter: '(sAMAccountName={username})', group_admin: '', group_operator: '', group_readonly: '', local_fallback: true,
  })
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useQuery({
    queryKey: ['ldap-config'],
    queryFn: () => settingsApi.getLdap().then((r) => {
      const data = r.data
      setLdapConfig((prev) => ({
        ...prev,
        enabled: data.ldap_enabled === 'true', server: data.ldap_server || '',
        port: parseInt(data.ldap_port || '389'), use_ssl: data.ldap_use_ssl === 'true',
        base_dn: data.ldap_base_dn || '', bind_dn: data.ldap_bind_dn || '',
        user_filter: data.ldap_user_filter || '(sAMAccountName={username})',
        group_admin: data.ldap_group_admin || '', group_operator: data.ldap_group_operator || '',
        group_readonly: data.ldap_group_readonly || '', local_fallback: data.ldap_local_fallback !== 'false',
      }))
      return data
    }),
  })

  const saveLdapMutation = useMutation({
    mutationFn: () => settingsApi.saveLdap({
      ldap_enabled: ldapConfig.enabled, ldap_server: ldapConfig.server, ldap_port: ldapConfig.port,
      ldap_use_ssl: ldapConfig.use_ssl, ldap_base_dn: ldapConfig.base_dn, ldap_bind_dn: ldapConfig.bind_dn,
      ldap_bind_password: ldapConfig.bind_password, ldap_user_filter: ldapConfig.user_filter,
      ldap_group_admin: ldapConfig.group_admin, ldap_group_operator: ldapConfig.group_operator,
      ldap_group_readonly: ldapConfig.group_readonly, ldap_local_fallback: ldapConfig.local_fallback,
    }),
    onSuccess: () => toast.success('LDAP configuration saved'),
  })

  const handleTestLdap = async () => {
    setTesting(true); setTestResult(null)
    try {
      const response = await authApi.testLdap({
        enabled: true, server: ldapConfig.server, port: ldapConfig.port, use_ssl: ldapConfig.use_ssl,
        base_dn: ldapConfig.base_dn, bind_dn: ldapConfig.bind_dn, bind_password: ldapConfig.bind_password,
        user_filter: ldapConfig.user_filter, group_admin: ldapConfig.group_admin,
        group_operator: ldapConfig.group_operator, group_readonly: ldapConfig.group_readonly,
        local_fallback: ldapConfig.local_fallback,
      })
      setTestResult(response.data)
    } catch (err: any) {
      setTestResult({ success: false, message: err.response?.data?.detail || 'Test failed' })
    } finally { setTesting(false) }
  }

  const field = (label: string, key: keyof typeof ldapConfig, type = 'text') => (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <input type={type} className="form-input" value={ldapConfig[key] as string}
        onChange={(e) => setLdapConfig((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div className="flex-col-gap">
      <div className="page-header">
        <div>
          <h1>System Settings</h1>
          <p>Configure platform settings</p>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn${tab === 'services' ? ' active' : ''}`} onClick={() => setTab('services')}>
          <Server size={13} />
          Services
        </button>
        <button className={`tab-btn${tab === 'health' ? ' active' : ''}`} onClick={() => setTab('health')}>
          <Activity size={13} />
          System Health
        </button>
        <button className={`tab-btn${tab === 'ldap' ? ' active' : ''}`} onClick={() => setTab('ldap')}>
          LDAP / Active Directory
        </button>
        <button className={`tab-btn${tab === 'mfa' ? ' active' : ''}`} onClick={() => setTab('mfa')}>
          <Fingerprint size={13} />
          Multi-Factor Auth
        </button>
        <button className={`tab-btn${tab === 'fastnetmon' ? ' active' : ''}`} onClick={() => setTab('fastnetmon')}>
          <ShieldAlert size={13} />
          FastNetMon
        </button>
        <button className={`tab-btn${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>
          <Shield size={13} />
          Security
        </button>
      </div>

      {tab === 'services' && <ServicesPanel />}
      {tab === 'health' && <SystemHealthPanel />}

      {tab === 'ldap' && (
        <div className="card settings-card">
          <div className="card-header">
            <Monitor size={15} />
            <h3>LDAP / Active Directory Integration</h3>
          </div>
          <div className="card-body">
            <div className="flex-col-gap">
              {/* Enable toggle */}
              <div className="toggle-row">
                <div>
                  <div className="toggle-row__title">Enable LDAP Authentication</div>
                  <div className="toggle-row__description">Allow users to authenticate via Active Directory</div>
                </div>
                <button
                  className={`toggle ${ldapConfig.enabled ? 'toggle--active' : ''}`}
                  onClick={() => setLdapConfig((p) => ({ ...p, enabled: !p.enabled }))}
                >
                  <span className="toggle__knob" />
                </button>
              </div>

              {ldapConfig.enabled && (
                <>
                  <div className="grid-server-port">
                    {field('LDAP Server (IP or FQDN)', 'server')}
                    <div className="form-field">
                      <label className="form-label">Port</label>
                      <input type="number" className="form-input port-input" value={ldapConfig.port} onChange={(e) => setLdapConfig((p) => ({ ...p, port: parseInt(e.target.value) }))} />
                    </div>
                  </div>

                  <label className="checkbox-label">
                    <input type="checkbox" checked={ldapConfig.use_ssl} onChange={(e) => setLdapConfig((p) => ({ ...p, use_ssl: e.target.checked }))} />
                    <span className="checkbox-label__text">Use SSL/LDAPS (port 636)</span>
                  </label>

                  {field('Base DN', 'base_dn')}
                  {field('Bind DN (Service Account)', 'bind_dn')}
                  {field('Bind Password', 'bind_password', 'password')}
                  {field('User Search Filter', 'user_filter')}

                  <div className="settings-section-divider">
                    <div className="form-section-title">Group → Role Mapping</div>
                    {field('Admin Group DN', 'group_admin')}
                    {field('Operator Group DN', 'group_operator')}
                    {field('Read-Only Group DN', 'group_readonly')}
                  </div>

                  <label className="checkbox-label">
                    <input type="checkbox" checked={ldapConfig.local_fallback} onChange={(e) => setLdapConfig((p) => ({ ...p, local_fallback: e.target.checked }))} />
                    <span className="checkbox-label__text">Allow local fallback authentication (admin always allowed)</span>
                  </label>

                  <div>
                    <button onClick={handleTestLdap} disabled={testing || !ldapConfig.server} className="btn btn-outline">
                      {testing ? <Loader2 size={13} className="animate-spin" /> : <TestTube size={13} />}
                      Test Connection
                    </button>
                    {testResult && (
                      <div className={testResult.success ? 'test-success' : 'test-error'}>
                        {testResult.success ? '✓' : '✗'} {testResult.message}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="settings-save-bar">
                <button onClick={() => saveLdapMutation.mutate()} disabled={saveLdapMutation.isPending} className="btn btn-primary">
                  {saveLdapMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save LDAP Configuration
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'mfa' && <DuoStatusPanel />}
      {tab === 'fastnetmon' && <FastNetMonPanel />}

      {tab === 'security' && (
        <div className="card settings-card">
          <div className="card-header">
            <Shield size={15} />
            <h3>Security Settings</h3>
          </div>
          <div className="card-body">
            <div className="flex-col-gap">
              {[
                { title: 'Password Policy', items: ['Minimum length: 10 characters', 'Must include uppercase, lowercase, number, and special character', 'Hashed with bcrypt (cost factor 12)'] },
                { title: 'Account Lockout', items: ['Locked after 5 failed login attempts', 'Lockout duration: 30 minutes', 'Administrators can manually unlock accounts'] },
                { title: 'Session Security', items: ['JWT access tokens: 60 minute expiry', 'Refresh tokens: 7 day expiry', 'Maximum session duration: 4 hours (readonly role exempt)', 'Security headers: HSTS, X-Frame-Options, CSP'] },
                { title: 'API Security', items: ['RBAC enforced on all API endpoints', 'Rate limiting on login endpoint (10/minute)', 'All changes logged to audit trail'] },
              ].map(({ title, items }) => (
                <div key={title} className="form-section">
                  <div className="form-section-title">{title}</div>
                  {items.map((item) => (
                    <div key={item} className="security-item">• {item}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


/* ── Helpers ── */
function formatBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${(b / 1e3).toFixed(1)} KB`
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  return `${h}h ${m}m`
}

function statusColor(status: string) {
  if (status === 'running') return 'svc-status--running'
  if (status === 'exited' || status === 'dead') return 'svc-status--stopped'
  if (status === 'restarting') return 'svc-status--restarting'
  return 'svc-status--unknown'
}

function pctColor(pct: number): string {
  if (pct >= 85) return 'var(--danger-500, #ef4444)'
  if (pct >= 60) return 'var(--warning-500, #f59e0b)'
  return 'var(--success-500, #22c55e)'
}

/* ── Services Panel ── */
function ServicesPanel() {
  const qc = useQueryClient()
  const { data: services, isLoading } = useQuery({
    queryKey: ['admin-services'],
    queryFn: () => serverMgmtApi.getServices().then(r => r.data),
    refetchInterval: 10_000,
  })

  const restartMut = useMutation({
    mutationFn: (id: string) => serverMgmtApi.restartService(id),
    onSuccess: (_, id) => { toast.success(`Restarting ${id}...`); setTimeout(() => qc.invalidateQueries({ queryKey: ['admin-services'] }), 3000) },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Restart failed'),
  })

  const stopMut = useMutation({
    mutationFn: (id: string) => serverMgmtApi.stopService(id),
    onSuccess: (_, id) => { toast.success(`Stopped ${id}`); qc.invalidateQueries({ queryKey: ['admin-services'] }) },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Stop failed'),
  })

  const startMut = useMutation({
    mutationFn: (id: string) => serverMgmtApi.startService(id),
    onSuccess: (_, id) => { toast.success(`Started ${id}`); qc.invalidateQueries({ queryKey: ['admin-services'] }) },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Start failed'),
  })

  return (
    <div className="card settings-card">
      <div className="card-header">
        <Server size={15} />
        <h3>Platform Services</h3>
      </div>
      <div className="card-body">
        {isLoading ? (
          <div className="empty-state"><Loader2 size={24} className="animate-spin" /><p>Loading services...</p></div>
        ) : (
          <div className="table-wrap">
            <table className="svc-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Container</th>
                  <th>Port</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(services || []).map((svc: any) => (
                  <tr key={svc.id}>
                    <td className="svc-name">{svc.name}</td>
                    <td>
                      <span className={`svc-status ${statusColor(svc.status)}`}>
                        <span className={`status-dot ${svc.status === 'running' ? 'dot-green' : svc.status === 'restarting' ? 'dot-orange' : 'dot-red'}`} />
                        {svc.status}
                      </span>
                    </td>
                    <td className="mono text-sm text-muted">{svc.container || '—'}</td>
                    <td className="mono text-sm">{svc.port || '—'}</td>
                    <td>
                      {svc.container && (
                        <div className="svc-actions">
                          {svc.status === 'running' ? (
                            <button
                              className="btn btn-outline btn-sm btn--icon"
                              title="Stop"
                              disabled={svc.id === 'backend' || stopMut.isPending}
                              onClick={() => { if (confirm(`Stop ${svc.name}?`)) stopMut.mutate(svc.id) }}
                            >
                              <Square size={12} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-outline btn-sm btn--icon"
                              title="Start"
                              disabled={startMut.isPending}
                              onClick={() => startMut.mutate(svc.id)}
                            >
                              <Play size={12} />
                            </button>
                          )}
                          <button
                            className="btn btn-outline btn-sm btn--icon"
                            title="Restart"
                            disabled={restartMut.isPending}
                            onClick={() => { if (confirm(`Restart ${svc.name}?`)) restartMut.mutate(svc.id) }}
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── System Health Panel ── */
function SystemHealthPanel() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['admin-system-health'],
    queryFn: () => serverMgmtApi.getSystemHealth().then(r => r.data),
    refetchInterval: 5_000,
  })

  if (isLoading || !health) {
    return (
      <div className="card settings-card">
        <div className="card-header"><Activity size={15} /><h3>System Health</h3></div>
        <div className="card-body"><div className="empty-state"><Loader2 size={24} className="animate-spin" /><p>Loading system metrics...</p></div></div>
      </div>
    )
  }

  const cards = [
    { label: 'CPU', value: health.cpu_percent, unit: '%', icon: <Cpu size={20} />, sub: `${health.cpu_count} cores` },
    { label: 'Memory', value: health.memory_percent, unit: '%', icon: <MemoryStick size={20} />, sub: `${formatBytes(health.memory_used)} / ${formatBytes(health.memory_total)}` },
    { label: 'Disk', value: health.disk_percent, unit: '%', icon: <HardDrive size={20} />, sub: `${formatBytes(health.disk_used)} / ${formatBytes(health.disk_total)}` },
    { label: 'Network', value: null, unit: '', icon: <Wifi size={20} />, sub: `Sent: ${formatBytes(health.net_bytes_sent)} / Recv: ${formatBytes(health.net_bytes_recv)}` },
  ]

  return (
    <div className="card settings-card">
      <div className="card-header">
        <Activity size={15} />
        <h3>System Health</h3>
        <span className="text-muted text-sm" style={{ marginLeft: 'auto' }}>
          {health.hostname} — up {formatUptime(health.uptime_seconds)}
        </span>
      </div>
      <div className="card-body">
        <div className="health-grid">
          {cards.map((c) => (
            <div key={c.label} className="health-card">
              <div className="health-card__icon" style={{ color: c.value != null ? pctColor(c.value) : 'var(--primary-500, #3b82f6)' }}>
                {c.icon}
              </div>
              <div className="health-card__body">
                <div className="health-card__label">{c.label}</div>
                {c.value != null ? (
                  <>
                    <div className="health-card__value" style={{ color: pctColor(c.value) }}>
                      {c.value.toFixed(1)}<span className="health-card__unit">{c.unit}</span>
                    </div>
                    <div className="health-bar">
                      <div className="health-bar__fill" style={{ width: `${Math.min(c.value, 100)}%`, background: pctColor(c.value) }} />
                    </div>
                  </>
                ) : (
                  <div className="health-card__value" style={{ color: 'var(--primary-500, #3b82f6)', fontSize: '16px' }}>
                    Active
                  </div>
                )}
                <div className="health-card__sub">{c.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DuoStatusPanel() {
  const [duoConfig, setDuoConfig] = useState({
    enabled: false,
    integration_key: '',
    secret_key: '',
    api_hostname: '',
    redirect_uri: '',
  })
  const [duoTestResult, setDuoTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [duoTesting, setDuoTesting] = useState(false)

  useQuery({
    queryKey: ['duo-config'],
    queryFn: () => settingsApi.getDuo().then((r) => {
      const data = r.data
      setDuoConfig((prev) => ({
        ...prev,
        enabled: String(data.duo_enabled).toLowerCase() === 'true',
        integration_key: data.duo_integration_key || '',
        secret_key: data.duo_secret_key || '',
        api_hostname: data.duo_api_hostname || '',
        redirect_uri: data.duo_redirect_uri || '',
      }))
      return data
    }),
  })

  const saveDuoMutation = useMutation({
    mutationFn: () => settingsApi.saveDuo({
      duo_enabled: duoConfig.enabled,
      duo_integration_key: duoConfig.integration_key,
      duo_secret_key: duoConfig.secret_key,
      duo_api_hostname: duoConfig.api_hostname,
      duo_redirect_uri: duoConfig.redirect_uri,
    }),
    onSuccess: () => toast.success('Duo MFA configuration saved'),
  })

  const handleTestDuo = async () => {
    setDuoTesting(true)
    setDuoTestResult(null)
    try {
      const r = await authApi.duoStatus()
      const data = r.data
      if (data.healthy) {
        setDuoTestResult({ success: true, message: `Connected to Duo API (${data.api_hostname})` })
      } else if (data.configured) {
        setDuoTestResult({ success: false, message: 'Duo configured but API unreachable — check hostname and credentials' })
      } else {
        setDuoTestResult({ success: false, message: 'Duo not fully configured — save configuration first' })
      }
    } catch (err: any) {
      setDuoTestResult({ success: false, message: err.response?.data?.detail || 'Test failed' })
    } finally {
      setDuoTesting(false)
    }
  }

  const duoField = (label: string, key: keyof typeof duoConfig, type = 'text', placeholder = '') => (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <input type={type} className="form-input" value={duoConfig[key] as string}
        placeholder={placeholder}
        onChange={(e) => setDuoConfig((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div className="card settings-card">
      <div className="card-header">
        <Fingerprint size={15} />
        <h3>Duo Multi-Factor Authentication</h3>
      </div>
      <div className="card-body">
        <div className="flex-col-gap">
          <div className="toggle-row">
            <div>
              <div className="toggle-row__title">Enable Duo MFA</div>
              <div className="toggle-row__description">
                Require all users to verify via Duo after entering credentials
              </div>
            </div>
            <button
              className={`toggle ${duoConfig.enabled ? 'toggle--active' : ''}`}
              onClick={() => setDuoConfig((p) => ({ ...p, enabled: !p.enabled }))}
            >
              <span className="toggle__knob" />
            </button>
          </div>

          {duoConfig.enabled && (
            <>
              <div className="info-box">
                <span className="info-box__title">Setup:</span> Go to{' '}
                <span className="mono">admin.duosecurity.com</span> → Applications → Protect an Application → search <strong>"Web SDK"</strong> → Protect. Copy the Client ID, Client Secret, and API Hostname below.
              </div>

              {duoField('Client ID (Integration Key)', 'integration_key', 'text', 'DIXXXXXXXXXXXXXXXXXX')}
              {duoField('Client Secret (Secret Key)', 'secret_key', 'password', 'Enter secret key')}
              {duoField('API Hostname', 'api_hostname', 'text', 'api-XXXXXXXX.duosecurity.com')}
              {duoField('Redirect URI', 'redirect_uri', 'text', 'https://netmon.example.com/login')}

              <p className="form-help">
                The Redirect URI must match the one configured in the Duo Admin Panel and must point to your NetMon login page.
              </p>

              <div>
                <button onClick={handleTestDuo} disabled={duoTesting} className="btn btn-outline">
                  {duoTesting ? <Loader2 size={13} className="animate-spin" /> : <TestTube size={13} />}
                  Test Connection
                </button>
                {duoTestResult && (
                  <div className={duoTestResult.success ? 'test-success' : 'test-error'}>
                    {duoTestResult.success ? '\u2713' : '\u2717'} {duoTestResult.message}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="settings-save-bar">
            <button onClick={() => saveDuoMutation.mutate()} disabled={saveDuoMutation.isPending} className="btn btn-primary">
              {saveDuoMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save Duo Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


function FastNetMonPanel() {
  const [config, setConfig] = useState({
    enabled: false,
    shared_node: true,
    monitor_host: '',
    monitor_port: '10007',
    monitor_use_ssl: false,
    monitor_api_user: 'admin',
    monitor_api_password: '',
    blocker_host: '',
    blocker_port: '10007',
    blocker_use_ssl: false,
    blocker_api_user: 'admin',
    blocker_api_password: '',
  })
  const [fnmTestResult, setFnmTestResult] = useState<{
    monitor_ok: boolean; blocker_ok: boolean; monitor_version?: string; blocker_version?: string
  } | null>(null)
  const [fnmTesting, setFnmTesting] = useState(false)

  useQuery({
    queryKey: ['fnm-config'],
    queryFn: () => settingsApi.getFastnetmon().then((r) => {
      const d = r.data
      setConfig((prev) => ({
        ...prev,
        enabled: d.fnm_enabled === 'true',
        shared_node: d.fnm_shared_node !== 'false',
        monitor_host: d.fnm_monitor_host || '',
        monitor_port: d.fnm_monitor_port || '10007',
        monitor_use_ssl: d.fnm_monitor_use_ssl === 'true',
        monitor_api_user: d.fnm_monitor_api_user || 'admin',
        monitor_api_password: d.fnm_monitor_api_password || '',
        blocker_host: d.fnm_blocker_host || '',
        blocker_port: d.fnm_blocker_port || '10007',
        blocker_use_ssl: d.fnm_blocker_use_ssl === 'true',
        blocker_api_user: d.fnm_blocker_api_user || 'admin',
        blocker_api_password: d.fnm_blocker_api_password || '',
      }))
      return d
    }),
  })

  const saveFnmMutation = useMutation({
    mutationFn: () => settingsApi.saveFastnetmon({
      fnm_enabled: String(config.enabled),
      fnm_shared_node: String(config.shared_node),
      fnm_monitor_host: config.monitor_host,
      fnm_monitor_port: config.monitor_port,
      fnm_monitor_use_ssl: String(config.monitor_use_ssl),
      fnm_monitor_api_user: config.monitor_api_user,
      fnm_monitor_api_password: config.monitor_api_password,
      fnm_blocker_host: config.blocker_host,
      fnm_blocker_port: config.blocker_port,
      fnm_blocker_use_ssl: String(config.blocker_use_ssl),
      fnm_blocker_api_user: config.blocker_api_user,
      fnm_blocker_api_password: config.blocker_api_password,
    }),
    onSuccess: () => toast.success('FastNetMon configuration saved'),
  })

  const handleTestFnm = async () => {
    setFnmTesting(true)
    setFnmTestResult(null)
    try {
      const r = await settingsApi.testFastnetmon()
      setFnmTestResult(r.data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Test failed')
    } finally {
      setFnmTesting(false)
    }
  }

  const fnmField = (label: string, key: keyof typeof config, type = 'text', placeholder = '') => (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <input type={type} className="form-input" value={config[key] as string}
        placeholder={placeholder}
        onChange={(e) => setConfig((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  const nodeFields = (prefix: 'monitor' | 'blocker') => (
    <>
      {fnmField('Host / IP', `${prefix}_host` as keyof typeof config, 'text', '192.168.1.10')}
      {fnmField('Port', `${prefix}_port` as keyof typeof config, 'text', '10007')}
      <div className="form-field">
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config[`${prefix}_use_ssl`] as boolean}
            onChange={(e) => setConfig((p) => ({ ...p, [`${prefix}_use_ssl`]: e.target.checked }))} />
          Use SSL (HTTPS)
        </label>
      </div>
      {fnmField('API Username', `${prefix}_api_user` as keyof typeof config, 'text', 'admin')}
      {fnmField('API Password', `${prefix}_api_password` as keyof typeof config, 'password', 'Enter password')}
    </>
  )

  return (
    <div className="card settings-card">
      <div className="card-header">
        <ShieldAlert size={15} />
        <h3>FastNetMon DDoS Integration</h3>
      </div>
      <div className="card-body">
        <div className="flex-col-gap">
          <div className="toggle-row">
            <div>
              <div className="toggle-row__title">Enable FastNetMon Integration</div>
              <div className="toggle-row__description">Connect to FastNetMon Advanced for DDoS detection and automated BGP blackhole mitigation</div>
            </div>
            <button className={`toggle ${config.enabled ? 'toggle--active' : ''}`}
              onClick={() => setConfig((p) => ({ ...p, enabled: !p.enabled }))}>
              <span className="toggle__knob" />
            </button>
          </div>

          {config.enabled && (
            <>
              <div className="info-box">
                <span className="info-box__title">How to enable the FastNetMon REST API:</span>
                <pre style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: "'DM Mono', monospace" }}>
{`sudo fcli set main web_api_host 0.0.0.0
sudo fcli set main web_api_port 10007
sudo fcli set main web_api_login admin
sudo fcli set main web_api_password YOUR_SECURE_PASSWORD
sudo systemctl restart fastnetmon_web_api

# For HTTPS (recommended):
sudo fcli set main web_api_ssl true
sudo fcli set main web_api_ssl_port 10443
sudo systemctl restart fastnetmon_web_api`}
                </pre>
              </div>

              <div className="toggle-row">
                <div>
                  <div className="toggle-row__title">Use Same Server for Monitor & Block</div>
                  <div className="toggle-row__description">Enable if one FastNetMon instance handles both detection and blocking. Disable to configure separate monitor and blocker nodes.</div>
                </div>
                <button className={`toggle ${config.shared_node ? 'toggle--active' : ''}`}
                  onClick={() => setConfig((p) => ({ ...p, shared_node: !p.shared_node }))}>
                  <span className="toggle__knob" />
                </button>
              </div>

              <div className="settings-section-divider" />
              <div className="form-section-title">{config.shared_node ? 'FastNetMon Server' : 'Monitor Node'}</div>
              {!config.shared_node && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-8px 0 4px' }}>
                  This node detects attacks and sends alerts. It does NOT block traffic.
                </p>
              )}
              {nodeFields('monitor')}

              {!config.shared_node && (
                <>
                  <div className="settings-section-divider" />
                  <div className="form-section-title">Blocker Node</div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-8px 0 4px' }}>
                    This node executes the actual BGP blackhole/FlowSpec blocks.
                  </p>
                  {nodeFields('blocker')}
                </>
              )}

              <div className="settings-section-divider" />
              <div>
                <button onClick={handleTestFnm} disabled={fnmTesting || !config.monitor_host} className="btn btn-outline">
                  {fnmTesting ? <Loader2 size={13} className="animate-spin" /> : <TestTube size={13} />}
                  Test Connection
                </button>
                {fnmTestResult && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className={fnmTestResult.monitor_ok ? 'test-success' : 'test-error'}>
                      {fnmTestResult.monitor_ok ? '\u2713' : '\u2717'} {config.shared_node ? 'Server' : 'Monitor Node'}: {fnmTestResult.monitor_ok
                        ? `Connected${fnmTestResult.monitor_version ? ` (${fnmTestResult.monitor_version})` : ''}`
                        : 'Unreachable'}
                    </div>
                    {!config.shared_node && (
                      <div className={fnmTestResult.blocker_ok ? 'test-success' : 'test-error'}>
                        {fnmTestResult.blocker_ok ? '\u2713' : '\u2717'} Blocker Node: {fnmTestResult.blocker_ok
                          ? `Connected${fnmTestResult.blocker_version ? ` (${fnmTestResult.blocker_version})` : ''}`
                          : 'Unreachable'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="settings-save-bar">
            <button onClick={() => saveFnmMutation.mutate()} disabled={saveFnmMutation.isPending} className="btn btn-primary">
              {saveFnmMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save FastNetMon Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
