import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { settingsApi, authApi } from '../services/api'
import { Shield, TestTube, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'ldap' | 'security'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('ldap')
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
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={ldapConfig[key] as string}
        onChange={(e) => setLdapConfig((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1>System Settings</h1>
          <p>Configure platform settings</p>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn${tab === 'ldap' ? ' active' : ''}`} onClick={() => setTab('ldap')}>
          LDAP / Active Directory
        </button>
        <button className={`tab-btn${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>
          <Shield size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Security
        </button>
      </div>

      {tab === 'ldap' && (
        <div className="card" style={{ maxWidth: 680 }}>
          <div className="card-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <h3>LDAP / Active Directory Integration</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Enable toggle */}
              <div className="toggle-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>Enable LDAP Authentication</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Allow users to authenticate via Active Directory</div>
                </div>
                <button
                  onClick={() => setLdapConfig((p) => ({ ...p, enabled: !p.enabled }))}
                  style={{ position: 'relative', display: 'inline-flex', height: 22, width: 42, borderRadius: 11, cursor: 'pointer', border: 'none', background: ldapConfig.enabled ? 'var(--primary)' : '#cbd5e1', transition: 'background 0.2s', flexShrink: 0 }}
                >
                  <span style={{ position: 'absolute', top: 3, left: ldapConfig.enabled ? 22 : 3, width: 16, height: 16, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                </button>
              </div>

              {ldapConfig.enabled && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
                    {field('LDAP Server (IP or FQDN)', 'server')}
                    <div>
                      <label className="label">Port</label>
                      <input type="number" className="input" value={ldapConfig.port} onChange={(e) => setLdapConfig((p) => ({ ...p, port: parseInt(e.target.value) }))} style={{ width: 100 }} />
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ldapConfig.use_ssl} onChange={(e) => setLdapConfig((p) => ({ ...p, use_ssl: e.target.checked }))} style={{ width: 14, height: 14 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-main)' }}>Use SSL/LDAPS (port 636)</span>
                  </label>

                  {field('Base DN', 'base_dn')}
                  {field('Bind DN (Service Account)', 'bind_dn')}
                  {field('Bind Password', 'bind_password', 'password')}
                  {field('User Search Filter', 'user_filter')}

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <div className="form-section-title">Group → Role Mapping</div>
                    {field('Admin Group DN', 'group_admin')}
                    {field('Operator Group DN', 'group_operator')}
                    {field('Read-Only Group DN', 'group_readonly')}
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ldapConfig.local_fallback} onChange={(e) => setLdapConfig((p) => ({ ...p, local_fallback: e.target.checked }))} style={{ width: 14, height: 14 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-main)' }}>Allow local fallback authentication (admin always allowed)</span>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <button onClick={() => saveLdapMutation.mutate()} disabled={saveLdapMutation.isPending} className="btn btn-primary">
                  {saveLdapMutation.isPending && <Loader2 size={13} className="animate-spin" />}
                  Save LDAP Configuration
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="card" style={{ maxWidth: 680 }}>
          <div className="card-header">
            <Shield size={15} style={{ color: 'var(--accent-orange)' }} />
            <h3>Security Settings</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { title: 'Password Policy', items: ['Minimum length: 10 characters', 'Must include uppercase, lowercase, number, and special character', 'Hashed with bcrypt (cost factor 12)'] },
                { title: 'Account Lockout', items: ['Locked after 5 failed login attempts', 'Lockout duration: 30 minutes', 'Administrators can manually unlock accounts'] },
                { title: 'Session Security', items: ['JWT access tokens: 60 minute expiry', 'Refresh tokens: 7 day expiry', 'Security headers: HSTS, X-Frame-Options, CSP'] },
                { title: 'API Security', items: ['RBAC enforced on all API endpoints', 'Rate limiting on login endpoint (10/minute)', 'All changes logged to audit trail'] },
              ].map(({ title, items }) => (
                <div key={title} className="form-section">
                  <div className="form-section-title">{title}</div>
                  {items.map((item) => (
                    <div key={item} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>• {item}</div>
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
