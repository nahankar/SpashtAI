import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { safeAppPath } from '@/lib/safe-next-path'

interface ProtectedRouteProps {
  requireAdmin?: boolean
  requireProfile?: boolean
}

export function ProtectedRoute({ requireAdmin = false, requireProfile = true }: ProtectedRouteProps) {
  const { user, loading, isAdmin } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  const next = safeAppPath(`${location.pathname}${location.search}`)

  if (!user) {
    return (
      <Navigate
        to={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}
        state={{ from: location }}
        replace
      />
    )
  }

  if (requireProfile && user.needsProfileCompletion) {
    return (
      <Navigate
        to={next ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : '/auth/complete-profile'}
        replace
      />
    )
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
