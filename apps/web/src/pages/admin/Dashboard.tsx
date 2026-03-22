import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { MetricCard } from '@/components/admin/MetricCard'

interface Overview {
  users: { total: number; newToday: number; newThisWeek: number; activeThisWeek: number }
  sessions: { totalElevate: number; totalReplay: number; elevateThisMonth: number; replayThisMonth: number }
}

export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient<Overview>('/api/admin/analytics/overview')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading dashboard...</div>
  }

  if (!data) {
    return <div className="text-muted-foreground">Failed to load dashboard data.</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your SpashtAI platform</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Users"
          value={data.users.total}
          sublabel={`${data.users.newToday} new today`}
        />
        <MetricCard
          label="Active Users"
          value={data.users.activeThisWeek}
          sublabel="Last 7 days"
        />
        <MetricCard
          label="Elevate Sessions"
          value={data.sessions.totalElevate}
          sublabel={`${data.sessions.elevateThisMonth} this month`}
        />
        <MetricCard
          label="Replay Uploads"
          value={data.sessions.totalReplay}
          sublabel={`${data.sessions.replayThisMonth} this month`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Quick Stats</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>New users this week: <strong className="text-foreground">{data.users.newThisWeek}</strong></li>
            <li>Total elevate sessions: <strong className="text-foreground">{data.sessions.totalElevate}</strong></li>
            <li>Total replay sessions: <strong className="text-foreground">{data.sessions.totalReplay}</strong></li>
          </ul>
        </div>
        <div className="rounded-md border p-4">
          <h3 className="mb-2 font-semibold">Recent Activity</h3>
          <p className="text-sm text-muted-foreground">
            {data.users.activeThisWeek} users have been active in the last week,
            with {data.sessions.elevateThisMonth + data.sessions.replayThisMonth} sessions this month.
          </p>
        </div>
      </div>
    </div>
  )
}
