import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Presentation } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { useAuth } from '@/hooks/useAuth'
import { TenantDemoProvider, useTenantDemo } from '@/contexts/TenantDemoContext'
import { DEMO_ANALYTICS_PATHS, isDemoPath } from '@/lib/tenantDemo'
import { cn } from '@/lib/utils'

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
  const learnerInUrl = enabled && new URLSearchParams(location.search).has('learner')

  // Turning the demo on while a hidden section is open (or opening one by URL) returns to the demo Dashboard.
  useEffect(() => {
    if (hidden) {
      toast.info('That section is hidden in the Tenant Admin demo')
      navigate('/admin', { replace: true })
    } else if (learnerInUrl) {
      // Individual learner analytics are not part of the demo.
      const params = new URLSearchParams(location.search)
      params.delete('learner')
      navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true })
    }
  }, [hidden, learnerInUrl, location.pathname, location.search, location.hash, navigate])

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-65px)]">
      <Sidebar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
        {enabled && <TenantDemoBanner pathname={location.pathname} />}
        {hidden || learnerInUrl ? null : <Outlet />}
      </main>
    </div>
  )
}

function TenantDemoBanner({ pathname }: { pathname: string }) {
  const { dataSource, setDataSource } = useTenantDemo()
  const analytics = DEMO_ANALYTICS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  return (
    <div role="note" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <Presentation className="h-4 w-4" /> Tenant Admin demo
        </p>
        {!analytics && (
          <div className="inline-flex rounded-md border border-amber-300 bg-background p-0.5 text-xs dark:border-amber-500/40" role="group" aria-label="Demo data">
            {(['sample', 'live'] as const).map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={dataSource === source}
                onClick={() => setDataSource(source)}
                className={cn('rounded px-2.5 py-1 font-medium', dataSource === source ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground')}
              >
                {source === 'sample' ? 'Sample data' : 'Live platform data'}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed">
        Presentation preview using your platform Admin access. It grants no permissions and there is no tenant isolation yet.{' '}
        {analytics
          ? 'Analytics below are platform-wide aggregates, not a tenant’s data. Individual learner views are off in the demo.'
          : dataSource === 'sample'
            ? 'Showing fictional sample data for demonstrations.'
            : 'Showing live platform-wide data. It is not scoped to any tenant; do not present it as a customer’s data.'}
      </p>
    </div>
  )
}
