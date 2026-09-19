import { useState, useRef, useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { Menu, RotateCcw, X } from 'lucide-react'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { Coach } from '@/pages/Coach'
import { Elevate } from '@/pages/Elevate'
import { Replay } from '@/pages/Replay'
import { ReplayResults } from '@/pages/ReplayResults'
import { SessionReplay } from '@/pages/SessionReplay'
import { History } from '@/pages/History'
import { ProgressPulse } from '@/pages/ProgressPulse'
import { Prepare } from '@/pages/Prepare'
import { InterviewJourneys } from '@/pages/InterviewJourneys'
import { InterviewJourney } from '@/pages/InterviewJourney'
import { Landing } from '@/pages/Landing'
import { Login } from '@/pages/auth/Login'
import { AdminLogin } from '@/pages/auth/AdminLogin'
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
import { safeAppPath } from '@/lib/safe-next-path'

function AppBreadcrumbs() {
  const location = useLocation()
  const path = location.pathname
  const fromCoach = new URLSearchParams(location.search).get('coach') === '1'

  if (path.startsWith('/admin')) return null
  if (path.startsWith('/auth')) return null
  if (path === '/coach') return null

  const routeLabelMap: Record<string, string> = {
    '/': 'Home',
    '/replay': 'Replay',
    '/elevate': 'Elevate',
    '/prepare': 'Prepare',
    '/prepare/interviews': 'Your Interviews',
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
  const isElevatePlayback = path.startsWith('/elevate/playback/')
  const isElevateResults =
    path === '/elevate' && new URLSearchParams(location.search).has('session')
  const isInterviewJourney =
    path.startsWith('/prepare/interviews/') && path !== '/prepare/interviews'

  const currentLabel =
    (isElevateResults ? 'Results' : null) ||
    routeLabelMap[path] ||
    (isReplayResults ? 'Results' : null) ||
    (isFeedbackDetail ? 'Feedback Details' : null) ||
    (isInterviewJourney ? 'Interview Journey' : null) ||
    (isElevatePlayback ? 'Playback' : null) ||
    path
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' / ')

  if (fromCoach) {
    const sourceParams = new URLSearchParams(location.search)
    const coachParams = new URLSearchParams()
    const threadId = sourceParams.get('thread')
    if (threadId) coachParams.set('thread', threadId)
    if (isReplayResults) {
      const replayId = path.split('/').filter(Boolean)[1]
      if (replayId) coachParams.set('replayResult', replayId)
    }
    const coachPath = coachParams.size > 0 ? `/coach?${coachParams.toString()}` : '/coach'
    return (
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to={coachPath}
          className="inline-flex items-center gap-1.5 font-medium text-primary transition-colors hover:text-primary/80"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Back to Coach
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{currentLabel}</span>
      </nav>
    )
  }

  // Modules are peers of Coach, not children of it, so only genuinely nested
  // pages get a trail — rooted at their own module.
  const parent = isReplayResults
    ? { to: '/replay', label: 'Replay' }
    : isFeedbackDetail || path === '/feedback/new'
      ? { to: '/feedback', label: 'Feedback' }
      : isElevatePlayback
        ? { to: '/history?tab=elevate', label: 'Sessions' }
        : isElevateResults
          ? { to: '/elevate', label: 'Elevate' }
          : isInterviewJourney || path === '/prepare/interviews'
            ? { to: '/prepare', label: 'Prepare' }
            : null

  if (!parent) return null

  return (
    <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
      <Link to={parent.to} className="hover:text-foreground transition-colors">
        {parent.label}
      </Link>
      <span>/</span>
      <span className="text-foreground font-medium">{currentLabel}</span>
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
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Full-height pages (Coach) need the real navbar height; it changes with the
  // logo, points badge, and mobile menu, so it can't be a hardcoded constant.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const publish = () =>
      document.documentElement.style.setProperty('--app-nav-h', `${el.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
    feature: 'elevate' | 'replay' | 'prepare'
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
  const coachActive = location.pathname === '/coach'

  return (
    <header
      ref={headerRef}
      className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 sticky top-0 z-40"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <Link to={user ? '/coach' : '/'} className="shrink-0">
          <LogoWithBeta />
        </Link>

        <nav className="hidden lg:flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link
                to="/coach"
                aria-current={coachActive ? 'page' : undefined}
                className={cn(
                  'rounded-sm underline-offset-[6px] hover:underline',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  coachActive
                    ? 'font-medium text-foreground underline decoration-2'
                    : 'text-muted-foreground',
                )}
              >
                Coach
              </Link>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <NavFeatureLink feature="replay" to="/replay" label="Replay" />
              <span className="text-muted-foreground/40 select-none" aria-hidden="true">·</span>
              <NavFeatureLink feature="elevate" to="/elevate" label="Elevate" />
              <span className="text-muted-foreground/40 select-none" aria-hidden="true">·</span>
              <NavFeatureLink feature="prepare" to="/prepare" label="Prepare" />
              <span className="text-muted-foreground/40 select-none" aria-hidden="true">·</span>
              <Link className="hover:underline" to="/progress">Progress Pulse</Link>
              <span className="text-muted-foreground/40 select-none" aria-hidden="true">·</span>
              <Link className="hover:underline" to="/history">Sessions</Link>
              <span className="text-muted-foreground/40 select-none" aria-hidden="true">·</span>
              <Link className="hover:underline" to="/feedback">Feedback</Link>
              {pricingEnabled && (
                <>
                  <span className="text-muted-foreground/40 select-none" aria-hidden="true">·</span>
                  <Link className="hover:underline" to="/pricing">Pricing</Link>
                </>
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
              <Link className={cn(navLinkClass, coachActive && 'font-medium text-foreground')} to="/coach" onClick={() => setMobileOpen(false)}>Coach</Link>
              <NavFeatureLink feature="replay" to="/replay" label="Replay" className={navLinkClass} onClick={() => setMobileOpen(false)} />
              <NavFeatureLink feature="elevate" to="/elevate" label="Elevate" className={navLinkClass} onClick={() => setMobileOpen(false)} />
              <NavFeatureLink feature="prepare" to="/prepare" label="Prepare" className={navLinkClass} onClick={() => setMobileOpen(false)} />
              <Link className={navLinkClass} to="/progress" onClick={() => setMobileOpen(false)}>Progress Pulse</Link>
              <Link className={navLinkClass} to="/history" onClick={() => setMobileOpen(false)}>Sessions</Link>
              <Link className={navLinkClass} to="/feedback" onClick={() => setMobileOpen(false)}>Feedback</Link>
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

/**
 * Root route: a public marketing landing page for signed-out visitors, and the
 * authenticated dashboard for signed-in users.
 */
function HomeRoute() {
  const { user, loading } = useAuth()
  const [homeParams] = useSearchParams()
  const pendingNext = safeAppPath(homeParams.get('next'))
  if (loading) return null
  if (!user) return <Landing />
  if (user.needsProfileCompletion) {
    return (
      <Navigate
        to={pendingNext ? `/auth/complete-profile?next=${encodeURIComponent(pendingNext)}` : '/auth/complete-profile'}
        replace
      />
    )
  }
  return <Navigate to="/coach" replace />
}

function ElevateRoute() {
  const [params] = useSearchParams()
  const fromCoach = params.get('coach') === '1'
  const originThread = params.get('thread')
  const content = (
    <FeatureGate feature="elevate">
      <Elevate />
    </FeatureGate>
  )
  const returnTo = originThread
    ? `/coach?thread=${encodeURIComponent(originThread)}`
    : '/coach'

  if (fromCoach) {
    return (
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
                Focused practice
              </p>
              <p className="text-sm text-muted-foreground">
                Your Coach thread is paused while Elevate owns this workspace.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={returnTo}>Return to Coach thread</Link>
            </Button>
          </div>
          <div className="p-5 sm:p-6">{content}</div>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
      <AppBreadcrumbs />
      {content}
    </main>
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
        {/* Root: public landing for signed-out, dashboard for signed-in */}
        <Route path="/" element={<HomeRoute />} />

        {/* Public auth routes */}
        <Route path="/auth/login" element={<Login />} />
        <Route path="/auth/admin" element={<AdminLogin />} />
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
          <Route path="/coach" element={<Coach />} />
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
          <Route path="/elevate" element={<ElevateRoute />} />
          <Route path="/elevate/playback/:sessionId" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="elevate">
                <SessionReplay />
              </FeatureGate>
            </main>
          } />
          <Route path="/prepare" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="prepare">
                <Prepare />
              </FeatureGate>
            </main>
          } />
          <Route path="/prepare/interviews" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="prepare">
                <InterviewJourneys />
              </FeatureGate>
            </main>
          } />
          <Route path="/prepare/interviews/:id" element={
            <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
              <AppBreadcrumbs />
              <FeatureGate feature="prepare">
                <InterviewJourney />
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
