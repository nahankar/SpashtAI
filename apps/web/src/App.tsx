import { useState, useRef, useEffect } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { Home } from '@/pages/Home'
import { Elevate } from '@/pages/Elevate'
import { Replay } from '@/pages/Replay'
import { ReplayResults } from '@/pages/ReplayResults'
import { History } from '@/pages/History'
import { Tickets } from '@/pages/tickets/Tickets'
import { NewTicket } from '@/pages/tickets/NewTicket'
import { TicketDetail } from '@/pages/tickets/TicketDetail'
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
import { AdminTickets } from '@/pages/admin/Tickets'
import { AdminTicketDetail } from '@/pages/admin/AdminTicketDetail'

function AppBreadcrumbs() {
  const location = useLocation()
  const path = location.pathname

  if (path.startsWith('/admin')) return null
  if (path.startsWith('/auth')) return null

  const routeLabelMap: Record<string, string> = {
    '/': 'Home',
    '/replay': 'Replay',
    '/elevate': 'Elevate',
    '/history': 'Past Sessions',
    '/settings': 'Settings',
    '/tickets': 'My Tickets',
    '/tickets/new': 'New Ticket',
  }

  const isReplayResults = path.startsWith('/replay/') && path !== '/replay'
  const isTicketDetail = path.startsWith('/tickets/') && path !== '/tickets' && path !== '/tickets/new'

  const currentLabel =
    routeLabelMap[path] ||
    (isReplayResults ? 'Results' : null) ||
    (isTicketDetail ? 'Ticket Details' : null) ||
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
      {(isTicketDetail || path === '/tickets/new') && (
        <>
          <span>/</span>
          <Link to="/tickets" className="hover:text-foreground transition-colors">My Tickets</Link>
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

function UserDropdown() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!user) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="text-muted-foreground text-xs truncate max-w-[150px] hover:text-foreground transition-colors cursor-pointer"
      >
        {user.firstName || user.email}
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-5 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md z-50"
        >
          <Link
            to="/tickets"
            onClick={() => setOpen(false)}
            className="flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            My Tickets
          </Link>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => { setOpen(false); logout() }}
            className="flex w-full items-center rounded-sm px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Navbar() {
  const { user, isAdmin, logout } = useAuth()

  return (
    <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/spashtai_logo.svg" alt="SpashtAI" className="h-12 w-auto" />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link className="hover:underline" to="/replay">Replay</Link>
              <Link className="hover:underline" to="/elevate">Elevate</Link>
              <Link className="hover:underline" to="/history">My Sessions</Link>
              {isAdmin && (
                <Link className="hover:underline text-primary font-medium" to="/admin">Admin</Link>
              )}
              <div className="flex items-center gap-3 ml-2 pl-4 border-l">
                <UserDropdown />
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
          <Route path="/history" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <History />
            </main>
          } />
          <Route path="/tickets" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <Tickets />
            </main>
          } />
          <Route path="/tickets/new" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <NewTicket />
            </main>
          } />
          <Route path="/tickets/:id" element={
            <main className="mx-auto max-w-6xl px-6 py-8">
              <AppBreadcrumbs />
              <TicketDetail />
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
            <Route path="tickets" element={<AdminTickets />} />
            <Route path="tickets/:id" element={<AdminTicketDetail />} />
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
