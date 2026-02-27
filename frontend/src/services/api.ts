import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Request interceptor: attach token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle 401 / token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        const response = await axios.post(`${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/refresh`, {}, { withCredentials: true })
        const { access_token, refresh_token, role, must_change_password, session_start, session_max_seconds } = response.data
        const currentUser = useAuthStore.getState().user
        if (currentUser) {
          useAuthStore.getState().setAuth(access_token, refresh_token, {
            ...currentUser,
            role,
            must_change_password,
          }, session_start, session_max_seconds)
        }
        originalRequest.headers.Authorization = `Bearer ${access_token}`
        return api(originalRequest)
      } catch {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }

    const message =
      (error.response?.data as any)?.detail ||
      error.message ||
      'An error occurred'

    if (error.response?.status !== 401) {
      toast.error(typeof message === 'string' ? message : JSON.stringify(message))
    }

    return Promise.reject(error)
  }
)

export default api

// Auth
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  duoCallback: (duo_code: string, state: string) =>
    api.post('/auth/duo/callback', { duo_code, state }),
  duoStatus: () => api.get('/auth/duo/status'),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (data: { current_password?: string; new_password: string; confirm_password: string }) =>
    api.post('/auth/change-password', data),
  testLdap: (config: object) => api.post('/auth/ldap/test', config),
}

// Devices
export const devicesApi = {
  list: (params?: object) => api.get('/devices/', { params }),
  get: (id: number) => api.get(`/devices/${id}`),
  create: (data: object) => api.post('/devices/', data),
  update: (id: number, data: object) => api.patch(`/devices/${id}`, data),
  delete: (id: number) => api.delete(`/devices/${id}`),
  summary: () => api.get('/devices/summary'),
  poll: (id: number) => api.post(`/devices/${id}/poll`),
  discover: (id: number) => api.post(`/devices/${id}/discover`),
  routes: (id: number) => api.get(`/devices/${id}/routes`),
  discoverRoutes: (id: number) => api.post(`/devices/${id}/discover-routes`),
  scanSubnet: (data: object) => api.post('/devices/scan-subnet', data),
  testSnmp: (data: object) => api.post('/devices/test-snmp', data),
  locations: () => api.get('/devices/locations/list'),
  createLocation: (data: object) => api.post('/devices/locations/', data),
}

// Interfaces
export const interfacesApi = {
  byDevice: (deviceId: number) => api.get(`/interfaces/device/${deviceId}`),
  utilization: (deviceId: number) => api.get(`/interfaces/device/${deviceId}/utilization`),
  get: (id: number) => api.get(`/interfaces/${id}`),
  metrics: (id: number, params?: object) =>
    api.get(`/interfaces/${id}/metrics`, { params }),
  latest: (id: number) => api.get(`/interfaces/${id}/latest`),
  toggleMonitor: (id: number) => api.patch(`/interfaces/${id}/toggle-monitor`),
  toggleWan: (id: number) => api.patch(`/interfaces/${id}/toggle-wan`),
  wanList: () => api.get('/interfaces/wan/list'),
  wanMetrics: (params?: object) => api.get('/interfaces/wan/metrics', { params }),
}

// Alerts
export const alertsApi = {
  listRules: () => api.get('/alerts/rules'),
  createRule: (data: object) => api.post('/alerts/rules', data),
  updateRule: (id: number, data: object) => api.patch(`/alerts/rules/${id}`, data),
  deleteRule: (id: number) => api.delete(`/alerts/rules/${id}`),
  listEvents: (params?: object) => api.get('/alerts/events', { params }),
  eventsSummary: () => api.get('/alerts/events/summary'),
  acknowledge: (id: number, notes?: string) =>
    api.post(`/alerts/events/${id}/acknowledge`, { notes }),
  resolve: (id: number) => api.post(`/alerts/events/${id}/resolve`),
}

// WAN Alerts
export const wanAlertsApi = {
  listRules: () => api.get('/wan-alerts/rules'),
  createRule: (data: object) => api.post('/wan-alerts/rules', data),
  updateRule: (id: number, data: object) => api.patch(`/wan-alerts/rules/${id}`, data),
  deleteRule: (id: number) => api.delete(`/wan-alerts/rules/${id}`),
  listEvents: (params?: object) => api.get('/wan-alerts/events', { params }),
  acknowledge: (id: number) => api.post(`/wan-alerts/events/${id}/acknowledge`),
  resolve: (id: number) => api.post(`/wan-alerts/events/${id}/resolve`),
}

// Power Alerts
export const powerAlertsApi = {
  listRules: () => api.get('/power-alerts/rules'),
  createRule: (data: object) => api.post('/power-alerts/rules', data),
  updateRule: (id: number, data: object) => api.patch(`/power-alerts/rules/${id}`, data),
  deleteRule: (id: number) => api.delete(`/power-alerts/rules/${id}`),
  listEvents: (params?: object) => api.get('/power-alerts/events', { params }),
  acknowledge: (id: number) => api.post(`/power-alerts/events/${id}/acknowledge`),
  resolve: (id: number) => api.post(`/power-alerts/events/${id}/resolve`),
}

// Flows
export const flowsApi = {
  stats: (params?: object) => api.get('/flows/stats', { params }),
  conversations: (params?: object) => api.get('/flows/conversations', { params }),
  ipProfile: (ip: string, params?: object) => api.get('/flows/ip-profile', { params: { ip, ...params } }),
  ownedSubnets: () => api.get('/flows/owned-subnets'),
  createOwnedSubnet: (data: { subnet: string; note?: string }) => api.post('/flows/owned-subnets', data),
  toggleOwnedSubnet: (data: { subnet: string; is_active: boolean }) => api.post('/flows/owned-subnets/toggle', data),
  deleteOwnedSubnet: (id: number) => api.delete(`/flows/owned-subnets/${id}`),
  peerDetail: (ip: string, peer: string, params?: object) =>
    api.get('/flows/peer-detail', { params: { ip, peer, ...params } }),
}

// Users
export const usersApi = {
  list: () => api.get('/users/'),
  get: (id: number) => api.get(`/users/${id}`),
  create: (data: object) => api.post('/users/', data),
  update: (id: number, data: object) => api.patch(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  resetPassword: (id: number) => api.post(`/users/${id}/reset-password`),
  unlock: (id: number) => api.post(`/users/${id}/unlock`),
  roles: () => api.get('/users/roles/list'),
  auditLogs: (params?: object) => api.get('/users/audit/logs', { params }),
}

// Blocks
export const blocksApi = {
  list: (params?: object) => api.get('/blocks/', { params }),
  summary: () => api.get('/blocks/summary'),
  create: (deviceId: number, data: object) => api.post(`/blocks/device/${deviceId}`, data),
  delete: (id: number) => api.delete(`/blocks/${id}`),
  sync: (deviceId: number) => api.post(`/blocks/device/${deviceId}/sync`),
}

// Topology
export const topologyApi = {
  get: () => api.get('/topology/'),
  discover: () => api.post('/topology/discover'),
  addLink: (sourceId: number, targetId: number, sourceIf?: string, targetIf?: string) =>
    api.post('/topology/link', null, { params: { source_id: sourceId, target_id: targetId, source_if: sourceIf, target_if: targetIf } }),
  deleteLink: (id: number) => api.delete(`/topology/link/${id}`),
  deviceMetrics: (deviceId: number, hours?: number) =>
    api.get(`/topology/device/${deviceId}/metrics`, { params: { hours } }),
}

// Reports
export const reportsApi = {
  summary: () => api.get('/reports/summary'),
  devices: () => api.get('/reports/devices', { responseType: 'blob' }),
  interfaces: (deviceId?: number) => api.get('/reports/interfaces', { params: { device_id: deviceId }, responseType: 'blob' }),
  alerts: (hours?: number) => api.get('/reports/alerts', { params: { hours }, responseType: 'blob' }),
  flows: (hours?: number) => api.get('/reports/flows', { params: { hours }, responseType: 'blob' }),
}

// Config Backups
export const backupsApi = {
  list: (params?: object) => api.get('/backups/', { params }),
  summary: () => api.get('/backups/summary'),
  schedules: () => api.get('/backups/schedule'),
  schedule: () => api.get('/backups/schedule'),
  updateSchedule: (data: object) => api.put('/backups/schedule', data),
  deleteSchedule: (id: number) => api.delete(`/backups/schedule/${id}`),
  manualBackup: (deviceId: number) => api.post(`/backups/device/${deviceId}`),
  get: (id: number) => api.get(`/backups/${id}`),
  delete: (id: number) => api.delete(`/backups/${id}`),
  downloadRaw: (id: number) => api.get(`/backups/${id}/raw`, { responseType: 'blob' }),
  diffTwo: (aId: number, bId: number) => api.get('/backups/diff/compare', { params: { a_id: aId, b_id: bId } }),
  diffLive: (id: number) => api.post(`/backups/${id}/diff-live`),
  diffStartup: (id: number) => api.post(`/backups/${id}/diff-startup`),
}

// Settings
export const settingsApi = {
  getAll: () => api.get('/settings/'),
  get: (key: string) => api.get(`/settings/${key}`),
  update: (key: string, value: string) => api.put(`/settings/${key}`, { value }),
  getLdap: () => api.get('/settings/ldap/config'),
  saveLdap: (data: object) => api.put('/settings/ldap/config', data),
  getDuo: () => api.get('/settings/duo/config'),
  saveDuo: (data: object) => api.put('/settings/duo/config', data),
}

export const systemEventsApi = {
  list: (params?: { limit?: number; offset?: number; level?: string; source?: string }) =>
    api.get('/system-events/', { params }),
}

// PDU Power
export const pduApi = {
  dashboard: (hours: number = 1) =>
    api.get('/pdu/dashboard', { params: { hours } }),
  deviceMetrics: (deviceId: number, hours: number = 24) =>
    api.get(`/pdu/device/${deviceId}/metrics`, { params: { hours } }),
  deviceOutlets: (deviceId: number) =>
    api.get(`/pdu/device/${deviceId}/outlets`),
  rackDetail: (locationId: number, hours: number = 24) =>
    api.get(`/pdu/rack/${locationId}`, { params: { hours } }),
  toggleOutlet: (deviceId: number, outletNumber: number) =>
    api.post(`/pdu/device/${deviceId}/outlet/${outletNumber}/toggle`),
}

// Server Management
export const serverMgmtApi = {
  getPorts: () => api.get('/server-mgmt/ports'),
  updatePorts: (data: object) => api.put('/server-mgmt/ports', data),
  getSslStatus: () => api.get('/server-mgmt/ssl/status'),
  uploadSsl: (formData: FormData) => api.post('/server-mgmt/ssl/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  generateSelfSigned: (data: object) => api.post('/server-mgmt/ssl/generate-self-signed', data),
  getServices: () => api.get('/server-mgmt/services'),
  restartService: (id: string) => api.post(`/server-mgmt/services/${id}/restart`),
  stopService: (id: string) => api.post(`/server-mgmt/services/${id}/stop`),
  startService: (id: string) => api.post(`/server-mgmt/services/${id}/start`),
  getSystemHealth: () => api.get('/server-mgmt/system-health'),
  getSmtp: () => api.get('/server-mgmt/smtp'),
  saveSmtp: (data: object) => api.put('/server-mgmt/smtp', data),
  testSmtp: (data: object) => api.post('/server-mgmt/smtp/test', data),
}
