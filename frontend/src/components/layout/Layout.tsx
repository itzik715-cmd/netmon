import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function Layout() {
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
