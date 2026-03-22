import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { Home } from '@/pages/Home'
import { Elevate } from '@/pages/Elevate'
import { Replay } from '@/pages/Replay'
import { ReplayResults } from '@/pages/ReplayResults'
import { Login } from '@/pages/auth/Login'
import { Register } from '@/pages/auth/Register'
import { ForgotPassword } from '@/pages/auth/ForgotPassword'
import { ResetPassword } from '@/pages/auth/ResetPassword'
import { AdminLayout } from '@/components/admin/AdminLayout'
import { Dashboard as AdminDashboard } from '@/pages/admin/Dashboard'
import { Users as AdminUsers } from '@/pages/admin/Users'
import { UserDetail as AdminUserDetail } from '@/pages/admin/UserDetail'
import { FeatureAnalytics } from '@/pages/admin/FeatureAnalytics'
import { SystemHealth } from '@/pages/admin/SystemHealth'

function AppBreadcrumbs() {
  const location = useLocation()
  const path = location.pathname

  if (path === '/elevate') return null
  if (path.startsWith('/admin')) return null
  if (path.startsWith('/auth')) return null

  const routeLabelMap: Record<string, string> = {
    '/': 'Home',
    '/replay': 'Replay',
    '/settings': 'Settings',
  }

  const isReplayResults = path.startsWith('/replay/') && path !== '/replay'

  const currentLabel =
    routeLabelMap[path] ||
    (isReplayResults ? 'Results' : null) ||
    path
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' / ')

  return (
    <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
      <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
      {isReplayResults && (
        <>
          <span>/</span>
          <Link to="/replay" className="hover:text-foreground transition-colors">Replay</Link>
        </>
      )}
      {path !== '/' && (
        <>
          <span>/</span>
          <span className="text-foreground font-medium">{currentLabel}</span>
        </>
      )}
    </nav>
  )
}

function Navbar() {
  const { user, isAdmin, logout } = useAuth()

  return (
    <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-semibold"><Link to="/">SpashtAI</Link></div>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link className="hover:underline" to="/replay">Replay</Link>
              <Link className="hover:underline" to="/elevate">Elevate</Link>
              {isAdmin && (
                <Link className="hover:underline text-primary font-medium" to="/admin">Admin</Link>
              )}
              <div className="flex items-center gap-3 ml-2 pl-4 border-l">
                <span className="text-muted-foreground text-xs truncate max-w-[150px]">
                  {user.firstName || user.email}
                </span>
                <button
                  onClick={logout}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <Link className="hover:underline" to="/auth/login">Sign In</Link>
              <Link className="hover:underline" to="/auth/register">Register</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

function AppRoutes() {
  return (
    <>
      <Navbar />
      <Routes>
        {/* Public auth routes */}
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<Register />} />
        <Route path="/auth/forgot-password" element={<ForgotPassword />} />
        <Route path="/auth/reset-password" element={<ResetPassword />} />

        {/* Protected user routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <Home />
            </main>
          } />
          <Route path="/replay" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <Replay />
            </main>
          } />
          <Route path="/replay/:id" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <ReplayResults />
            </main>
          } />
          <Route path="/elevate" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <Elevate />
            </main>
          } />
          <Route path="/settings" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <div>Settings</div>
            </main>
          } />
        </Route>

        {/* Protected admin routes */}
        <Route element={<ProtectedRoute requireAdmin />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
            <Route path="analytics" element={<FeatureAnalytics />} />
            <Route path="system" element={<SystemHealth />} />
          </Route>
        </Route>
      </Routes>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-background text-foreground">
          <AppRoutes />
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
