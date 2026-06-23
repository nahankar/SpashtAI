import { useState, useRef, useEffect } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { Home } from '@/pages/Home'
import { Elevate } from '@/pages/Elevate'
import { Replay } from '@/pages/Replay'
import { ReplayResults } from '@/pages/ReplayResults'
import { History } from '@/pages/History'
import { ProgressPulse } from '@/pages/ProgressPulse'
import { Login } from '@/pages/auth/Login'
import { Register } from '@/pages/auth/Register'
import { ForgotPassword } from '@/pages/auth/ForgotPassword'
import { ResetPassword } from '@/pages/auth/ResetPassword'
import { CompleteProfile } from '@/pages/auth/CompleteProfile'
import { AdminLayout } from '@/components/admin/AdminLayout'
import { Dashboard as AdminDashboard } from '@/pages/admin/Dashboard'
import { Users as AdminUsers } from '@/pages/admin/Users'
import { UserDetail as AdminUserDetail } from '@/pages/admin/UserDetail'
import { FeatureAnalytics } from '@/pages/admin/FeatureAnalytics'
import { SystemHealth } from '@/pages/admin/SystemHealth'
import { VoiceBackend as AdminVoiceBackend } from '@/pages/admin/VoiceBackend'
import { FeatureFlagsAdmin } from '@/pages/admin/FeatureFlags'
import { AgentPromptsAdmin } from '@/pages/admin/AgentPrompts'
import { AdminFeedback } from '@/pages/admin/Feedback'
import { AdminFeedbackDetail } from '@/pages/admin/AdminFeedbackDetail'
import { AdminTickers } from '@/pages/admin/Tickers'
import { AdminPricing } from '@/pages/admin/Pricing'
import { MyFeedback } from '@/pages/feedback/MyFeedback'
import { NewFeedback } from '@/pages/feedback/NewFeedback'
import { FeedbackDetail } from '@/pages/feedback/FeedbackDetail'
import { Pricing } from '@/pages/Pricing'
import { TermsPage, PrivacyPage } from '@/pages/legal/Terms'
import { AdminLegal } from '@/pages/admin/Legal'
import { FeatureFlagsProvider, useFeatureFlags } from '@/contexts/FeatureFlagsContext'
import { FeatureGate } from '@/components/auth/FeatureGate'
import { PublicFooter } from '@/components/layout/PublicFooter'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'
import { usePageTracking } from '@/hooks/usePageTracking'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function AppBreadcrumbs() {
  const location = useLocation()
  const path = location.pathname

  if (path.startsWith('/admin')) return null
  if (path.startsWith('/auth')) return null

  const routeLabelMap: Record<string, string> = {
    '/': 'Home',
    '/replay': 'Replay',
    '/elevate': 'Elevate',
    '/progress': 'Progress Pulse',
    '/history': 'Sessions',
    '/feedback': 'Feedback',
    '/feedback/new': 'Provide Feedback',
    '/pricing': 'Pricing',
    '/terms': 'Terms',
    '/privacy': 'Privacy',
    '/settings': 'Settings',
  }

  const isReplayResults = path.startsWith('/replay/') && path !== '/replay'
  const isFeedbackDetail =
    path.startsWith('/feedback/') && path !== '/feedback' && path !== '/feedback/new'

  const currentLabel =
    routeLabelMap[path] ||
    (isReplayResults ? 'Results' : null) ||
    (isFeedbackDetail ? 'Feedback Details' : null) ||
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
      {(isFeedbackDetail || path === '/feedback/new') && (
        <>
          <span>/</span>
          <Link to="/feedback" className="hover:text-foreground transition-colors">Feedback</Link>
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

  const displayLabel =
    user.firstName && user.firstName.toLowerCase() !== 'admin'
      ? user.firstName
      : user.email.split('@')[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="text-muted-foreground text-xs truncate max-w-[150px] hover:text-foreground transition-colors cursor-pointer"
      >
        {displayLabel}
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-5 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md z-50"
        >
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
  const { isVisible, isAccessible, getFlag } = useFeatureFlags()
  const [pricingEnabled, setPricingEnabled] = useState(false)
  const [signupsPaused, setSignupsPaused] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
    fetch(`${API}/api/pricing`)
      .then((r) => r.json())
      .then((d) => setPricingEnabled(Boolean(d.enabled)))
      .catch(() => setPricingEnabled(false))
    fetch(`${API}/api/platform`)
      .then((r) => r.json())
      .then((d) => setSignupsPaused(Boolean(d.signupsPaused)))
      .catch(() => setSignupsPaused(false))
  }, [])

  function NavFeatureLink({
    feature,
    to,
    label,
    className,
    onClick,
  }: {
    feature: 'elevate' | 'replay'
    to: string
    label: string
    className?: string
    onClick?: () => void
  }) {
    if (!isVisible(feature)) return null
    if (!isAccessible(feature)) {
      const comment = getFlag(feature).overlayComment
      return (
        <span
          className={cn('text-muted-foreground/60 cursor-not-allowed', className)}
          title={comment || 'This feature is currently unavailable'}
        >
          {label}
        </span>
      )
    }
    return (
      <Link className={cn('hover:underline', className)} to={to} onClick={onClick}>
        {label}
      </Link>
    )
  }

  const navLinkClass = 'block py-2 text-sm hover:text-foreground text-muted-foreground'

  return (
    <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <Link to="/" className="shrink-0">
          <LogoWithBeta />
        </Link>

        <nav className="hidden lg:flex items-center gap-4 text-sm">
          {user ? (
            <>
              <NavFeatureLink feature="replay" to="/replay" label="Replay" />
              <NavFeatureLink feature="elevate" to="/elevate" label="Elevate" />
              <Link className="hover:underline" to="/progress">Progress Pulse</Link>
              <Link className="hover:underline" to="/history">Sessions</Link>
              <Link className="hover:underline" to="/feedback">Feedback (earn points)</Link>
              {pricingEnabled && (
                <Link className="hover:underline" to="/pricing">Pricing</Link>
              )}
              {user.rewardPoints != null && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary whitespace-nowrap">
                  {user.rewardPoints.toFixed(2)} pts
                </span>
              )}
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
              {!signupsPaused && (
                <Link className="hover:underline" to="/auth/register">Signup</Link>
              )}
            </>
          )}
        </nav>

        <Button
          variant="outline"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t bg-card px-4 py-3 space-y-1">
          {user ? (
            <>
              <NavFeatureLink feature="replay" to="/replay" label="Replay" className={navLinkClass} onClick={() => setMobileOpen(false)} />
              <NavFeatureLink feature="elevate" to="/elevate" label="Elevate" className={navLinkClass} onClick={() => setMobileOpen(false)} />
              <Link className={navLinkClass} to="/progress" onClick={() => setMobileOpen(false)}>Progress Pulse</Link>
              <Link className={navLinkClass} to="/history" onClick={() => setMobileOpen(false)}>Sessions</Link>
              <Link className={navLinkClass} to="/feedback" onClick={() => setMobileOpen(false)}>Feedback (earn points)</Link>
              {pricingEnabled && (
                <Link className={navLinkClass} to="/pricing" onClick={() => setMobileOpen(false)}>Pricing</Link>
              )}
              {user.rewardPoints != null && (
                <p className="py-2 text-sm text-primary font-medium">{user.rewardPoints.toFixed(2)} pts</p>
              )}
              {isAdmin && (
                <Link className={cn(navLinkClass, 'text-primary font-medium')} to="/admin" onClick={() => setMobileOpen(false)}>Admin</Link>
              )}
              <button
                type="button"
                className={cn(navLinkClass, 'w-full text-left')}
                onClick={() => { setMobileOpen(false); logout() }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link className={navLinkClass} to="/auth/login" onClick={() => setMobileOpen(false)}>Sign In</Link>
              {!signupsPaused && (
                <Link className={navLinkClass} to="/auth/register" onClick={() => setMobileOpen(false)}>Signup</Link>
              )}
            </>
          )}
        </div>
      )}
    </header>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()
  usePageTracking()

  return (
    <>
      <Navbar />
      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        <div className="flex-1">
      <Routes>
        {/* Public auth routes */}
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/register" element={<Register />} />
        <Route path="/auth/forgot-password" element={<ForgotPassword />} />
        <Route path="/auth/reset-password" element={<ResetPassword />} />

        <Route element={<ProtectedRoute requireProfile={false} />}>
          <Route path="/auth/complete-profile" element={<CompleteProfile />} />
        </Route>

        {/* Public legal pages */}
        <Route path="/terms" element={
          <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
            <TermsPage />
          </main>
        } />
        <Route path="/privacy" element={
          <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
            <PrivacyPage />
          </main>
        } />

        {/* Protected user routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <Home />
            </main>
          } />
          <Route path="/replay" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="replay">
                <Replay />
              </FeatureGate>
            </main>
          } />
          <Route path="/replay/:id" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="replay">
                <ReplayResults />
              </FeatureGate>
            </main>
          } />
          <Route path="/elevate" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="elevate">
                <Elevate />
              </FeatureGate>
            </main>
          } />
          <Route path="/progress" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <ProgressPulse />
            </main>
          } />
          <Route path="/feedback" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <MyFeedback />
            </main>
          } />
          <Route path="/feedback/new" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <NewFeedback />
            </main>
          } />
          <Route path="/feedback/:id" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeedbackDetail />
            </main>
          } />
          <Route path="/pricing" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <Pricing />
            </main>
          } />
          <Route path="/history" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <History />
            </main>
          } />
          <Route path="/settings" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
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
            <Route path="feedback" element={<AdminFeedback />} />
            <Route path="feedback/:id" element={<AdminFeedbackDetail />} />
            <Route path="analytics" element={<FeatureAnalytics />} />
            <Route path="system" element={<SystemHealth />} />
            <Route path="voice-backend" element={<AdminVoiceBackend />} />
            <Route path="features" element={<FeatureFlagsAdmin />} />
            <Route path="agent-prompts" element={<AgentPromptsAdmin />} />
            <Route path="tickers" element={<AdminTickers />} />
            <Route path="pricing" element={<AdminPricing />} />
            <Route path="legal" element={<AdminLegal />} />
          </Route>
        </Route>
      </Routes>
        </div>
        {!loading && !user && <PublicFooter />}
      </div>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <FeatureFlagsProvider>
        <AuthProvider>
          <div className="min-h-screen bg-background text-foreground">
            <AppRoutes />
          </div>
        </AuthProvider>
      </FeatureFlagsProvider>
    </BrowserRouter>
  )
}

export default App
