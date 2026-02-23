export interface User {
  id: number
  username: string
  email: string
  role: { id: number; name: string; description?: string }
  is_active: boolean
  must_change_password: boolean
  auth_source: string
  account_locked: boolean
  failed_attempts: number
  created_at: string
  last_login?: string
}

export interface AuthState {
  token: string | null
  refreshToken: string | null
  user: {
    id: number
    username: string
    role: string
    must_change_password: boolean
  } | null
}

export interface Device {
  id: number
  hostname: string
  ip_address: string
  device_type?: string
  layer?: string
  vendor?: string
  model?: string
  os_version?: string
  location?: Location
  status: 'up' | 'down' | 'unknown' | 'degraded'
  last_seen?: string
  uptime?: number
  cpu_usage?: number
  memory_usage?: number
  poll_interval: number
  polling_enabled: boolean
  flow_enabled: boolean
  is_active: boolean
  description?: string
  tags?: string
  interface_count?: number
  snmp_community?: string
  snmp_version?: string
  snmp_port?: number
  api_username?: string
  api_port?: number
  api_protocol?: string
}

export interface Location {
  id: number
  name: string
  datacenter?: string
  rack?: string
  description?: string
  address?: string
  timezone: string
}

export interface Interface {
  id: number
  device_id: number
  if_index?: number
  name: string
  description?: string
  alias?: string
  speed?: number
  admin_status?: string
  oper_status?: string
  mac_address?: string
  ip_address?: string
  vlan_id?: number
  is_uplink: boolean
  is_monitored: boolean
  is_wan: boolean
  last_change?: string
}

export interface InterfaceMetric {
  id: number
  interface_id: number
  timestamp: string
  in_bps: number
  out_bps: number
  in_pps: number
  out_pps: number
  utilization_in: number
  utilization_out: number
  in_errors: number
  out_errors: number
  oper_status?: string
}

export interface AlertRule {
  id: number
  name: string
  description?: string
  device_id?: number
  interface_id?: number
  metric: string
  condition: string
  threshold: number
  severity: 'info' | 'warning' | 'critical'
  is_active: boolean
  duration_seconds: number
  cooldown_minutes: number
  notification_email?: string
  notification_webhook?: string
  created_at: string
}

export interface AlertEvent {
  id: number
  rule_id: number
  device_id?: number
  interface_id?: number
  severity: string
  status: 'open' | 'acknowledged' | 'resolved'
  message?: string
  metric_value?: number
  threshold_value?: number
  triggered_at: string
  resolved_at?: string
  acknowledged_at?: string
}

export interface FlowRecord {
  id: number
  src_ip: string
  dst_ip: string
  src_port?: number
  dst_port?: number
  protocol?: string
  bytes: number
  packets: number
  application?: string
  timestamp: string
}

export interface FlowStats {
  top_talkers: { ip: string; bytes: number }[]
  top_destinations: { ip: string; bytes: number }[]
  protocol_distribution: { protocol: string; count: number; bytes: number }[]
  application_distribution: { app: string; count: number; bytes: number }[]
  total_flows: number
  total_bytes: number
}

export interface AuditLog {
  id: number
  user_id?: number
  username?: string
  action: string
  resource_type?: string
  resource_id?: string
  details?: string
  source_ip?: string
  success: boolean
  timestamp: string
}

export interface Role {
  id: number
  name: string
  description?: string
}

export interface DeviceRoute {
  id: number
  destination: string
  mask?: string
  prefix_len?: number
  next_hop?: string
  protocol?: string
  metric?: number
  updated_at?: string
}

export interface DeviceBlock {
  id: number
  device_id: number
  prefix: string
  block_type: 'null_route' | 'flowspec'
  description?: string
  is_active: boolean
  created_by?: string
  created_at?: string
  synced_at?: string
}

export interface BlocksSummary {
  total: number
  null_route: number
  flowspec: number
  recent: {
    id: number
    device_id: number
    prefix: string
    block_type: string
    created_at?: string
  }[]
}

export interface ConfigBackup {
  id: number
  device_id: number
  device_hostname?: string
  backup_type: 'scheduled' | 'manual'
  configs_match?: boolean | null
  size_bytes?: number
  config_hash?: string
  error?: string
  created_at?: string
  expires_at?: string
}

export interface ConfigBackupDetail extends ConfigBackup {
  config_text?: string
  startup_config?: string
}

export interface BackupSchedule {
  id?: number
  device_id?: number | null
  device_hostname?: string | null
  hour: number
  minute: number
  retention_days: number
  is_active: boolean
}

export interface BackupSummary {
  total: number
  unsaved_changes: number
  failed: number
  devices_backed_up: number
}

export interface DiffResult {
  diff_lines: string[]
  additions: number
  deletions: number
  identical: boolean
  label_a: string
  label_b: string
}

export interface SubnetScanResult {
  subnet: string
  total_hosts: number
  responsive: number
  new_devices: number
  existing_devices: number
  ips_found: string[]
}
