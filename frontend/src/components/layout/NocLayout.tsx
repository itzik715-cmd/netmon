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
            <img src="/logo-omc.svg" alt="OMC" style={{ height: 22 }} />
            <span>OMC</span>
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
