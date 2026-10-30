/**
 * Tenant Admin demo: a presentation preview of what a tenant administrator would see, available only inside the
 * platform Admin panel. It is purely cosmetic: it grants no permission, changes no role, and creates no tenant
 * isolation — every API call still runs as the signed-in platform Admin. The setting lives in this browser tab
 * only (sessionStorage), belongs to the signed-in user, and is cleared on logout.
 *
 * When real tenancy exists, each section shown here must be scoped to the active tenant before a real tenant
 * administrator may use it.
 */

export type DemoDataSource = 'sample' | 'live'
export interface StoredDemo { userId: string; on: boolean; data: DemoDataSource }

const STORAGE_KEY = 'spashtai_tenant_admin_demo'

/** Paths a tenant administrator would see; everything else in the Admin panel is hidden in the demo. */
export const DEMO_PATHS = ['/admin/users', '/admin/invitations', '/admin/analytics', '/admin/progress-pulse', '/admin/ux-analytics']
export function isDemoPath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/admin' || DEMO_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
}
export const DEMO_ANALYTICS_PATHS = ['/admin/analytics', '/admin/progress-pulse', '/admin/ux-analytics']

export function readDemo(userId: string | undefined): StoredDemo | null {
  if (!userId) return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as StoredDemo) : null
    return parsed?.userId === userId ? parsed : null
  } catch {
    return null
  }
}

export function clearTenantDemo() {
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ }
}

export function writeDemo(state: StoredDemo) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage unavailable: stays in memory */ }
}
