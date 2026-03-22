import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { MetricCard } from '@/components/admin/MetricCard'
import { UsageChart } from '@/components/admin/UsageChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface FeatureUsageSummary {
  feature: string
  action: string
  _count: { id: number }
}

interface RecentUsage {
  feature: string
  action: string
  timestamp: string
  duration: number | null
  user: { email: string; firstName: string | null }
}

export function FeatureAnalytics() {
  const [usage, setUsage] = useState<FeatureUsageSummary[]>([])
  const [recent, setRecent] = useState<RecentUsage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient<{ usage: FeatureUsageSummary[]; recentUsage: RecentUsage[] }>('/api/admin/analytics/features')
      .then((data) => {
        setUsage(data.usage)
        setRecent(data.recentUsage)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading analytics...</div>
  }

  const elevateCount = usage.filter((u) => u.feature === 'elevate').reduce((sum, u) => sum + u._count.id, 0)
  const replayCount = usage.filter((u) => u.feature === 'replay').reduce((sum, u) => sum + u._count.id, 0)

  const chartData = [
    { name: 'Elevate', elevate: elevateCount, replay: 0 },
    { name: 'Replay', elevate: 0, replay: replayCount },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Analytics</h1>
        <p className="text-muted-foreground">Usage breakdown by feature (last 30 days)</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Elevate Usage" value={elevateCount} sublabel="Events tracked" />
        <MetricCard label="Replay Usage" value={replayCount} sublabel="Events tracked" />
        <MetricCard label="Total Events" value={elevateCount + replayCount} sublabel="All features" />
      </div>

      <UsageChart title="Feature Usage" data={chartData} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">Feature</th>
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                    <th className="px-3 py-2 text-right font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2 capitalize">{u.feature}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.action}</td>
                      <td className="px-3 py-2 text-right font-medium">{u._count.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <div className="space-y-2">
              {recent.slice(0, 20).map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                  <div>
                    <span className="font-medium capitalize">{r.feature}</span>
                    <span className="text-muted-foreground ml-2">{r.action}</span>
                    <span className="text-muted-foreground ml-2">by {r.user.firstName || r.user.email}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
