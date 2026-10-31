import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Presentation } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { useAuth } from '@/hooks/useAuth'
import { TenantDemoProvider, useTenantDemo } from '@/contexts/TenantDemoContext'
import { isDemoPath } from '@/lib/tenantDemo'

export function AdminLayout() {
  const { user } = useAuth()
  return (
    <TenantDemoProvider key={user?.id} userId={user?.id}>
      <AdminShell />
    </TenantDemoProvider>
  )
}

function AdminShell() {
  const { enabled } = useTenantDemo()
  const location = useLocation()
  const navigate = useNavigate()
  const hidden = enabled && !isDemoPath(location.pathname)

  // Turning the demo on while a hidden section is open (or opening one by URL) returns to the demo Dashboard.
  useEffect(() => {
    if (!hidden) return
    toast.info('That section is hidden in the Tenant Admin demo')
    navigate('/admin', { replace: true })
  }, [hidden, navigate])

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-65px)]">
      <Sidebar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
        {enabled && <TenantDemoBanner />}
        {hidden ? null : <Outlet />}
      </main>
    </div>
  )
}

function TenantDemoBanner() {
  return (
    <div role="note" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Presentation className="h-4 w-4" /> Tenant Admin demo
        </p>
        <span className="rounded-full border border-amber-400 bg-background px-2.5 py-0.5 text-xs font-medium">Sample data</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed">
        Presentation preview using your platform Admin access. It grants no permissions and there is no tenant isolation yet.
        Everything shown is fictional sample organization data. Only Invite user is a real action.
      </p>
    </div>
  )
}
