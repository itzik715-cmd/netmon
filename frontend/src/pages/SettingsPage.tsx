import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { settingsApi, authApi } from '../services/api'
import { Settings, Shield, TestTube, Loader2, Monitor, Save, Fingerprint } from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'ldap' | 'mfa' | 'security'

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
        <button className={`tab-btn${tab === 'ldap' ? ' active' : ''}`} onClick={() => setTab('ldap')}>
          LDAP / Active Directory
        </button>
        <button className={`tab-btn${tab === 'mfa' ? ' active' : ''}`} onClick={() => setTab('mfa')}>
          <Fingerprint size={13} />
          Multi-Factor Auth
        </button>
        <button className={`tab-btn${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>
          <Shield size={13} />
          Security
        </button>
      </div>

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
        enabled: data.duo_enabled === 'true',
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
