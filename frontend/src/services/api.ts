import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

const api: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
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
      const refreshToken = useAuthStore.getState().refreshToken
      if (refreshToken) {
        try {
          const response = await axios.post('/api/auth/refresh', {
            refresh_token: refreshToken,
          })
          const { access_token, refresh_token, role, must_change_password } = response.data
          const currentUser = useAuthStore.getState().user
          if (currentUser) {
            useAuthStore.getState().setAuth(access_token, refresh_token, {
              ...currentUser,
              role,
              must_change_password,
            })
          }
          originalRequest.headers.Authorization = `Bearer ${access_token}`
          return api(originalRequest)
        } catch {
          useAuthStore.getState().logout()
          window.location.href = '/login'
        }
      } else {
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
  get: (id: number) => api.get(`/interfaces/${id}`),
  metrics: (id: number, hours?: number) =>
    api.get(`/interfaces/${id}/metrics`, { params: { hours } }),
  latest: (id: number) => api.get(`/interfaces/${id}/latest`),
  toggleMonitor: (id: number) => api.patch(`/interfaces/${id}/toggle-monitor`),
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

// Flows
export const flowsApi = {
  stats: (params?: object) => api.get('/flows/stats', { params }),
  conversations: (params?: object) => api.get('/flows/conversations', { params }),
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

// Settings
export const settingsApi = {
  getAll: () => api.get('/settings/'),
  get: (key: string) => api.get(`/settings/${key}`),
  update: (key: string, value: string) => api.put(`/settings/${key}`, { value }),
  getLdap: () => api.get('/settings/ldap/config'),
  saveLdap: (data: object) => api.put('/settings/ldap/config', data),
}
