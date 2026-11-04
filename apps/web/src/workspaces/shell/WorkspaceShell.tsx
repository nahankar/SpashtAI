import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, ArrowLeftRight, BarChart3, BrainCircuit, LayoutDashboard, Loader2, MailPlus, MessageSquareText, Settings2, ShieldCheck, User, Users } from 'lucide-react'
import { AdminSideNav } from '@/components/admin/AdminSideNav'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FeatureGate } from '@/components/auth/FeatureGate'
import { WorkspaceFeatureFlagsProvider } from '@/contexts/FeatureFlagsContext'
import { cn } from '@/lib/utils'
import { Elevate } from '@/pages/Elevate'
import { Replay } from '@/pages/Replay'
import { ReplayResults } from '@/pages/ReplayResults'
import { SessionReplay } from '@/pages/SessionReplay'
import { ProgressPulse } from '@/pages/ProgressPulse'
import { Interviews } from '@/pages/Interviews'
import { InterviewHistory } from '@/pages/InterviewHistory'
import { MyFeedback } from '@/pages/feedback/MyFeedback'
import { NewFeedback } from '@/pages/feedback/NewFeedback'
import { FeedbackDetail } from '@/pages/feedback/FeedbackDetail'
import { identityToken, workspaceRequest } from '../client'
import { WorkspaceInvitations } from '../WorkspaceInvitations'
import { WorkspaceDashboard, WorkspaceFeatureUsage, WorkspaceFeedback, WorkspaceProgressPulse } from '../admin/AnalyticsPages'
import { WorkspaceAIAnalytics } from '../admin/AIAnalyticsPage'
import { WorkspaceSettings } from '../admin/SettingsPage'
import { WorkspaceUsers } from '../admin/UsersPage'
import { useWorkspaceShell, WorkspaceShellContext, type WorkspaceShellValue } from './context'
import { ADMIN_NAV_GROUPS, allowedFeatures, isManager, unavailableReason, workspaceNav, type WorkspaceProductFeature } from './model'
import { createWorkspaceSession, type WorkspaceSessionState } from './session'

export function WorkspaceShell({ slug }: { slug: string }) {
  const [state, setState] = useState<WorkspaceSessionState>({ status: 'loading' })
  const [accepting, setAccepting] = useState(false)
  const [session] = useState(() => createWorkspaceSession(slug, { request: workspaceRequest, identity: identityToken, onState: setState }))

  useEffect(() => {
    // A diagnostics recorder loaded on a Personal page must not observe organization pages.
    if (typeof window !== 'undefined' && window.clarity) { window.location.reload(); return }
    session.start()
    return () => session.stop()
  }, [session])

  async function accept() {
    setAccepting(true)
    try { await session.accept() } finally { setAccepting(false) }
  }
  const enter = session.reload

  const value = useMemo<WorkspaceShellValue | null>(() => state.status === 'ready'
    ? { slug, entry: state.entry, snapshot: state.snapshot, reload: enter } : null, [slug, state, enter])
  const allowed = useMemo(() => state.status === 'ready' ? allowedFeatures(state.snapshot.features) : {}, [state])

  if (state.status === 'loading') return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Opening workspace" /></Centered>
  if (state.status === 'ended') return <Centered><Card className="max-w-md"><CardHeader><CardTitle>Workspace unavailable</CardTitle><CardDescription>{state.message}</CardDescription></CardHeader>
    <CardContent className="flex gap-2">{state.signIn ? <Button asChild><a href={`/auth/login?next=${encodeURIComponent(`/w/${slug}`)}`}>Sign in</a></Button> : <Button asChild variant="outline"><Link to="/workspaces">Your workspaces</Link></Button>}
      <Button asChild variant="ghost"><Link to="/coach">Personal</Link></Button></CardContent></Card></Centered>
  if (state.status === 'invited') return <Centered><Card className="max-w-lg"><CardHeader>
    {state.entry.workspace.logoDataUrl && <img src={state.entry.workspace.logoDataUrl} alt={`${state.entry.workspace.name} logo`} className="mb-2 h-12 w-12 object-contain" />}
    <CardTitle>Join {state.entry.workspace.name}</CardTitle>
    <CardDescription>{`You were invited as ${state.entry.membership.role.toLowerCase()}. Your Personal history stays private and separate from this workspace.`}</CardDescription></CardHeader>
    <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{state.entry.notice}</p>
      <div className="flex gap-2"><Button disabled={accepting} onClick={accept}>{accepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Accept invitation</Button><Button asChild variant="ghost"><Link to="/workspaces">Not now</Link></Button></div>
    </CardContent></Card></Centered>

  return <WorkspaceShellContext.Provider value={value}>
    <WorkspaceFeatureFlagsProvider allowed={allowed}>
      <ShellLayout>
        <Routes>
          <Route index element={<WorkspaceHome />} />
          <Route path="elevate" element={<Product feature="elevate"><FeatureGate feature="elevate"><Elevate /></FeatureGate></Product>} />
          <Route path="elevate/playback/:sessionId" element={<Product feature="elevate"><SessionReplay sessionChatDisabled /></Product>} />
          <Route path="replay" element={<Product feature="replay"><Replay /></Product>} />
          <Route path="replay/:id" element={<Product feature="replay"><ReplayResults /></Product>} />
          <Route path="interviews" element={<Product feature="interviews"><Interviews /></Product>} />
          <Route path="interviews/history" element={<Product feature="interviews"><InterviewHistory /></Product>} />
          <Route path="interviews/playback/:sessionId" element={<Product feature="interviews"><SessionReplay variant="interview" sessionChatDisabled /></Product>} />
          <Route path="progress" element={<Product feature="progress_pulse"><ProgressPulse /></Product>} />
          <Route path="feedback" element={<Product feature="feedback"><MyFeedback /></Product>} />
          <Route path="feedback/new" element={<Product feature="feedback"><NewFeedback /></Product>} />
          <Route path="feedback/:id" element={<Product feature="feedback"><FeedbackDetail /></Product>} />
          <Route path="admin" element={<ManagersOnly />}>
            <Route index element={<WorkspaceDashboard />} />
            <Route path="users" element={<WorkspaceUsers />} />
            <Route path="invitations" element={<InvitationsPage />} />
            <Route path="feedback" element={<WorkspaceFeedback />} />
            <Route path="feature-usage" element={<WorkspaceFeatureUsage />} />
            <Route path="progress-pulse" element={<WorkspaceProgressPulse />} />
            <Route path="ai-analytics" element={<WorkspaceAIAnalytics />} />
            <Route path="settings" element={<WorkspaceSettings />} />
          </Route>
          <Route path="*" element={<Navigate to={`/w/${encodeURIComponent(slug)}`} replace />} />
        </Routes>
      </ShellLayout>
    </WorkspaceFeatureFlagsProvider>
  </WorkspaceShellContext.Provider>
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="flex min-h-[60vh] items-center justify-center p-6">{children}</main>
}

const ADMIN_ICONS = {
  admin: LayoutDashboard,
  'admin/users': Users,
  'admin/invitations': MailPlus,
  'admin/feedback': MessageSquareText,
  'admin/feature-usage': BarChart3,
  'admin/progress-pulse': Activity,
  'admin/ai-analytics': BrainCircuit,
  'admin/settings': Settings2,
} as const

export function ShellLayout({ children }: { children: ReactNode }) {
  const { slug, snapshot } = useWorkspaceShell()
  const { workspace, membership } = snapshot
  const nav = workspaceNav(membership.role, snapshot.features)
  const location = useLocation()
  const base = `/w/${encodeURIComponent(slug)}`
  const adminSection = location.pathname === `${base}/admin` || location.pathname.startsWith(`${base}/admin/`)
  const link = ({ isActive }: { isActive: boolean }) => cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
  return <div className="min-h-screen">
    <header className="border-b bg-card" style={{ borderTop: `4px solid ${workspace.accentColor}` }}>
      <div className={cn('flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6', adminSection ? '' : 'mx-auto max-w-6xl')}>
        <Link to={base} className="flex min-w-0 items-center gap-3">
          {workspace.logoDataUrl ? <img src={workspace.logoDataUrl} alt="" className="h-9 w-9 rounded object-contain" />
            : <span className="flex h-9 w-9 items-center justify-center rounded text-sm font-bold text-white" style={{ background: workspace.accentColor }}>{workspace.name.slice(0, 1).toUpperCase()}</span>}
          <span className="truncate text-lg font-semibold">{workspace.name}</span>
        </Link>
        <Badge variant="secondary">{membership.role.charAt(0) + membership.role.slice(1).toLowerCase()}</Badge>
        <div className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm"><Link to="/workspaces"><ArrowLeftRight className="mr-1.5 h-4 w-4" />Switch</Link></Button>
          <Button asChild variant="ghost" size="sm"><Link to="/coach"><User className="mr-1.5 h-4 w-4" />Personal</Link></Button>
        </div>
      </div>
      <nav aria-label="Workspace" className={cn('flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:px-6', adminSection ? '' : 'mx-auto max-w-6xl')}>
        <NavLink end to={base} className={link}>Home</NavLink>
        {nav.learner.map(item => <NavLink key={item.to} to={`${base}/${item.to}`} className={link}>{item.label}</NavLink>)}
        {nav.admin.length > 0 && <NavLink to={`${base}/admin`} className={link}><span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Admin</span></NavLink>}
      </nav>
    </header>
    {adminSection ? <div className="flex min-h-[calc(100vh-65px)] flex-col md:flex-row">
      <AdminSideNav title="Admin Panel" groups={ADMIN_NAV_GROUPS.map(group => ({
        label: group.label,
        links: group.links.map(item => ({ to: `${base}/${item.to}`, label: item.label, end: item.to === 'admin', icon: ADMIN_ICONS[item.to as keyof typeof ADMIN_ICONS] })),
      }))} />
      <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">{children}</main>
    </div> : <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>}
  </div>
}

function Product({ feature, children }: { feature: WorkspaceProductFeature; children: ReactNode }) {
  const { snapshot } = useWorkspaceShell()
  const decision = snapshot.features.find(f => f.feature === feature)
  if (decision?.allowed) return <>{children}</>
  return <Card className="mx-auto max-w-lg"><CardHeader><CardTitle>Not available</CardTitle><CardDescription>{unavailableReason(decision)}</CardDescription></CardHeader></Card>
}

function ManagersOnly() {
  const { slug, snapshot } = useWorkspaceShell()
  return isManager(snapshot.membership.role) ? <Outlet /> : <Navigate to={`/w/${encodeURIComponent(slug)}`} replace />
}

function InvitationsPage() {
  const { snapshot } = useWorkspaceShell()
  return <WorkspaceInvitations role={snapshot.membership.role} features={snapshot.features} emailContent={snapshot.workspace.enrollmentSettings?.email}
    workspaceName={snapshot.workspace.name} enrollmentFields={snapshot.workspace.enrollmentSettings?.fields} />
}

export function WorkspaceHome() {
  const { slug, snapshot } = useWorkspaceShell()
  const nav = workspaceNav(snapshot.membership.role, snapshot.features)
  const base = `/w/${encodeURIComponent(slug)}`
  const DESCRIPTIONS: Record<string, string> = {
    elevate: 'Live voice practice with instant feedback.', replay: 'Upload a recording and get a detailed review.', interviews: 'Practise interview questions and review your answers.',
    progress: 'Track your communication skills over time.', feedback: 'Tell your organization and SpashtAI what to improve.',
  }
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold tracking-tight">Welcome to {snapshot.workspace.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{snapshot.notice}</p></div>
    {nav.learner.length === 0 ? <Card><CardHeader><CardTitle className="text-base">No products yet</CardTitle>
      <CardDescription>{`Your organization hasn't made any practice products available to you yet.`}</CardDescription></CardHeader></Card>
      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{nav.learner.map(item => <Link key={item.to} to={`${base}/${item.to}`} className="group">
        <Card className="h-full transition-colors group-hover:border-primary"><CardHeader><CardTitle className="text-base">{item.label}</CardTitle><CardDescription>{DESCRIPTIONS[item.to]}</CardDescription></CardHeader></Card>
      </Link>)}</div>}
    {nav.admin.length > 0 && <Card><CardHeader><CardTitle className="text-base">Administration</CardTitle><CardDescription>Members, invitations, usage and progress for this workspace only.</CardDescription></CardHeader>
      <CardContent><Button asChild><Link to={`${base}/admin`}>Open dashboard</Link></Button></CardContent></Card>}
  </div>
}
