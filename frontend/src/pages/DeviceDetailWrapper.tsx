import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { devicesApi } from '../services/api'
import DeviceDetailPage from './DeviceDetailPage'
import PduDetailPage from './PduDetailPage'

export default function DeviceDetailWrapper() {
  const { id } = useParams<{ id: string }>()
  const deviceId = parseInt(id || '', 10)
  if (isNaN(deviceId)) return <Navigate to="/devices" replace />

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => devicesApi.get(deviceId).then((r) => r.data),
    staleTime: 30_000,
  })

  if (isLoading) return <div className="empty-state"><p>Loading device...</p></div>
  if (!device) return <div className="empty-state"><p>Device not found</p></div>

  if (device.device_type === 'pdu') {
    return <PduDetailPage device={device} />
  }

  return <DeviceDetailPage />
}
