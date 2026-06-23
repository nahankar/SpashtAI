import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AdminLayout() {
  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-65px)]">
      <Sidebar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
