import { MetricCard } from '@/components/admin/MetricCard'
import { InvitationOverview } from '@/components/admin/InvitationOverview'
import { SAMPLE_ORG, sampleLearners } from '@/lib/tenantDemoSample'

/**
 * Tenant Admin demo Dashboard: fictional sample organization data only. Once real tenancy exists, these counts
 * and lists must come from the active tenant only.
 */
export function TenantDemoDashboard() {
  const learners = sampleLearners()
  const activeThisWeek = learners.filter((l) => l.lastActiveAt && Date.now() - new Date(l.lastActiveAt).getTime() < 7 * 86_400_000).length
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">{SAMPLE_ORG} · learners and invitations (sample data)</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Learners" value={learners.length} sublabel="Accepted accounts. Pending invitations are not counted." />
        <MetricCard label="Active this week" value={activeThisWeek} />
        <MetricCard label="Practice sessions" value={learners.reduce((sum, l) => sum + l.sessions, 0)} />
      </div>

      <InvitationOverview sample />
    </div>
  )
}
