import { Outlet } from 'react-router-dom'
import { useState, useEffect } from 'react'

export default function NocLayout() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="noc-popout-layout">
      <div className="noc-popout-topbar">
        <div className="noc-popout-topbar__left">
          <div className="noc-popout-topbar__logo">
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" fill="#29ABE2"/>
            </svg>
            <span>NetMon NMP</span>
          </div>
          <span className="noc-popout-topbar__sep">|</span>
          <span className="noc-popout-topbar__page" id="noc-page-title">NOC View</span>
        </div>
        <div className="noc-popout-topbar__right">
          <span className="noc-popout-topbar__clock">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <span className="noc-popout-topbar__date">
            {time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>
      <div className="noc-popout-content">
        <Outlet />
      </div>
    </div>
  )
}
