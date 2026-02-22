import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { settingsApi, authApi } from '../services/api'
import { Settings, Server, Shield, TestTube, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'ldap' | 'general' | 'security'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('ldap')
  const [ldapConfig, setLdapConfig] = useState({
    enabled: false,
    server: '',
    port: 389,
    use_ssl: false,
    base_dn: '',
    bind_dn: '',
    bind_password: '',
    user_filter: '(sAMAccountName={username})',
    group_admin: '',
    group_operator: '',
    group_readonly: '',
    local_fallback: true,
  })
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useQuery({
    queryKey: ['ldap-config'],
    queryFn: () => settingsApi.getLdap().then((r) => {
      const data = r.data
      setLdapConfig((prev) => ({
        ...prev,
        enabled: data.ldap_enabled === 'true',
        server: data.ldap_server || '',
        port: parseInt(data.ldap_port || '389'),
        use_ssl: data.ldap_use_ssl === 'true',
        base_dn: data.ldap_base_dn || '',
        bind_dn: data.ldap_bind_dn || '',
        user_filter: data.ldap_user_filter || '(sAMAccountName={username})',
        group_admin: data.ldap_group_admin || '',
        group_operator: data.ldap_group_operator || '',
        group_readonly: data.ldap_group_readonly || '',
        local_fallback: data.ldap_local_fallback !== 'false',
      }))
      return data
    }),
  })

  const saveLdapMutation = useMutation({
    mutationFn: () => settingsApi.saveLdap({
      ldap_enabled: ldapConfig.enabled,
      ldap_server: ldapConfig.server,
      ldap_port: ldapConfig.port,
      ldap_use_ssl: ldapConfig.use_ssl,
      ldap_base_dn: ldapConfig.base_dn,
      ldap_bind_dn: ldapConfig.bind_dn,
      ldap_bind_password: ldapConfig.bind_password,
      ldap_user_filter: ldapConfig.user_filter,
      ldap_group_admin: ldapConfig.group_admin,
      ldap_group_operator: ldapConfig.group_operator,
      ldap_group_readonly: ldapConfig.group_readonly,
      ldap_local_fallback: ldapConfig.local_fallback,
    }),
    onSuccess: () => toast.success('LDAP configuration saved'),
  })

  const handleTestLdap = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await authApi.testLdap({
        enabled: true,
        server: ldapConfig.server,
        port: ldapConfig.port,
        use_ssl: ldapConfig.use_ssl,
        base_dn: ldapConfig.base_dn,
        bind_dn: ldapConfig.bind_dn,
        bind_password: ldapConfig.bind_password,
        user_filter: ldapConfig.user_filter,
        group_admin: ldapConfig.group_admin,
        group_operator: ldapConfig.group_operator,
        group_readonly: ldapConfig.group_readonly,
        local_fallback: ldapConfig.local_fallback,
      })
      setTestResult(response.data)
    } catch (err: any) {
      setTestResult({ success: false, message: err.response?.data?.detail || 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const field = (label: string, key: keyof typeof ldapConfig, type = 'text') => (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        className="input"
        value={ldapConfig[key] as string}
        onChange={(e) => setLdapConfig((p) => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>System Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configure platform settings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'ldap', label: 'LDAP / Active Directory', icon: Server },
          { id: 'security', label: 'Security', icon: Shield },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'ldap' && (
        <div className="card max-w-2xl">
          <h3 className="mb-6 flex items-center gap-2">
            <Server className="h-5 w-5 text-blue-600" />
            LDAP / Active Directory Integration
          </h3>

          <div className="space-y-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">Enable LDAP Authentication</div>
                <div className="text-xs text-gray-500">Allow users to authenticate via Active Directory</div>
              </div>
              <button
                onClick={() => setLdapConfig((p) => ({ ...p, enabled: !p.enabled }))}
                className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${ldapConfig.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow mt-0.5 transition-transform ${ldapConfig.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {ldapConfig.enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  {field('LDAP Server (IP or FQDN)', 'server')}
                  <div>
                    <label className="label">Port</label>
                    <input
                      type="number"
                      className="input"
                      value={ldapConfig.port}
                      onChange={(e) => setLdapConfig((p) => ({ ...p, port: parseInt(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="ssl"
                    checked={ldapConfig.use_ssl}
                    onChange={(e) => setLdapConfig((p) => ({ ...p, use_ssl: e.target.checked }))}
                    className="h-4 w-4 rounded bg-white border-gray-300"
                  />
                  <label htmlFor="ssl" className="text-sm text-gray-700">Use SSL/LDAPS (port 636)</label>
                </div>

                {field('Base DN', 'base_dn')}
                {field('Bind DN (Service Account)', 'bind_dn')}
                {field('Bind Password', 'bind_password', 'password')}
                {field('User Search Filter', 'user_filter')}

                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Group → Role Mapping</h4>
                  {field('Admin Group DN', 'group_admin')}
                  {field('Operator Group DN', 'group_operator')}
                  {field('Read-Only Group DN', 'group_readonly')}
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="fallback"
                    checked={ldapConfig.local_fallback}
                    onChange={(e) => setLdapConfig((p) => ({ ...p, local_fallback: e.target.checked }))}
                    className="h-4 w-4 rounded bg-white border-gray-300"
                  />
                  <label htmlFor="fallback" className="text-sm text-gray-700">
                    Allow local fallback authentication (admin always allowed)
                  </label>
                </div>
              </>
            )}

            {/* Test Connection */}
            {ldapConfig.enabled && (
              <div>
                <button
                  onClick={handleTestLdap}
                  disabled={testing || !ldapConfig.server}
                  className="btn-secondary flex items-center gap-2"
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube className="h-4 w-4" />}
                  Test Connection
                </button>
                {testResult && (
                  <div className={`mt-3 p-3 rounded-lg text-sm ${
                    testResult.success
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    {testResult.success ? '✓' : '✗'} {testResult.message}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => saveLdapMutation.mutate()}
                disabled={saveLdapMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {saveLdapMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save LDAP Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="card max-w-2xl">
          <h3 className="mb-6 flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-600" />
            Security Settings
          </h3>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-800 mb-1">Password Policy</div>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>• Minimum length: 10 characters</li>
                <li>• Must include uppercase, lowercase, number, and special character</li>
                <li>• Hashed with bcrypt (cost factor 12)</li>
              </ul>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-800 mb-1">Account Lockout</div>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>• Locked after 5 failed login attempts</li>
                <li>• Lockout duration: 30 minutes</li>
                <li>• Administrators can manually unlock accounts</li>
              </ul>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-800 mb-1">Session Security</div>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>• JWT access tokens: 60 minute expiry</li>
                <li>• Refresh tokens: 7 day expiry</li>
                <li>• Security headers: HSTS, X-Frame-Options, CSP</li>
              </ul>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-800 mb-1">API Security</div>
              <ul className="text-sm text-gray-500 space-y-1">
                <li>• RBAC enforced on all API endpoints</li>
                <li>• Rate limiting on login endpoint (10/minute)</li>
                <li>• All changes logged to audit trail</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
