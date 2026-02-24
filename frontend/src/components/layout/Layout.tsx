import { useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuthStore } from '../../store/authStore'
import toast from 'react-hot-toast'

export default function Layout() {
  const navigate = useNavigate()
  const { user, sessionStart, sessionMaxSeconds, logout } = useAuthStore()
  const warnedRef = useRef(false)

  useEffect(() => {
    // No timeout enforcement for readonly role or if no session info
    if (!sessionStart || !sessionMaxSeconds || user?.role === 'readonly') return

    const check = () => {
      const elapsed = (Date.now() - new Date(sessionStart).getTime()) / 1000
      const remaining = sessionMaxSeconds - elapsed

      // Warn 5 minutes before expiry
      if (remaining <= 300 && remaining > 0 && !warnedRef.current) {
        warnedRef.current = true
        const mins = Math.ceil(remaining / 60)
        toast(`Session expires in ${mins} minute${mins !== 1 ? 's' : ''}. Save your work.`, { icon: '\u26A0\uFE0F', duration: 10000 })
      }

      // Session expired
      if (remaining <= 0) {
        logout()
        toast.error('Session expired. Please log in again.')
        navigate('/login', { replace: true })
      }
    }

    check()
    const interval = setInterval(check, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [sessionStart, sessionMaxSeconds, user?.role, logout, navigate])

  // Reset warning flag on new session
  useEffect(() => {
    warnedRef.current = false
  }, [sessionStart])

  return (
    <>
      <Sidebar />
      <div className="main">
        <Header />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </>
  )
}
