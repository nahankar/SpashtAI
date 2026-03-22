import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { MetricCard } from '@/components/admin/MetricCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface HealthData {
  status: string
  timestamp: string
  uptime: number
  database: { status: string; latencyMs: number }
  memory: { heapUsed: number; heapTotal: number; rss: number }
  system: { platform: string; cpus: number; freeMemory: number; totalMemory: number }
}

interface AuditAction {
  id: string
  adminId: string
  action: string
  targetUserId: string | null
  reason: string | null
  timestamp: string
}

export function SystemHealth() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [audit, setAudit] = useState<AuditAction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiClient<HealthData>('/api/admin/system/health'),
      apiClient<{ actions: AuditAction[] }>('/api/admin/system/audit'),
    ])
      .then(([healthData, auditData]) => {
        setHealth(healthData)
        setAudit(auditData.actions)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading system health...</div>
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h}h ${m}m ${s}s`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
        <p className="text-muted-foreground">Server status and audit log</p>
      </div>

      {health && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Status"
              value={health.status === 'healthy' ? 'Healthy' : 'Degraded'}
            />
            <MetricCard
              label="Uptime"
              value={formatUptime(health.uptime)}
            />
            <MetricCard
              label="DB Latency"
              value={`${health.database.latencyMs}ms`}
            />
            <MetricCard
              label="Memory (RSS)"
              value={`${health.memory.rss} MB`}
              sublabel={`Heap: ${health.memory.heapUsed}/${health.memory.heapTotal} MB`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Server Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Platform</span>
                  <span>{health.system.platform}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CPUs</span>
                  <span>{health.system.cpus}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Free Memory</span>
                  <span>{health.system.freeMemory} MB / {health.system.totalMemory} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Database</span>
                  <Badge variant={health.database.status === 'connected' ? 'default' : 'destructive'}>
                    {health.database.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Memory Usage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Heap Used</span>
                  <span>{health.memory.heapUsed} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Heap Total</span>
                  <span>{health.memory.heapTotal} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RSS</span>
                  <span>{health.memory.rss} MB</span>
                </div>
                <div className="mt-3">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, (health.memory.heapUsed / health.memory.heapTotal) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {Math.round((health.memory.heapUsed / health.memory.heapTotal) * 100)}% heap utilization
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admin Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                  <div>
                    <span className="font-medium">{a.action}</span>
                    {a.targetUserId && (
                      <span className="text-muted-foreground ml-2">target: {a.targetUserId.slice(0, 8)}...</span>
                    )}
                    {a.reason && (
                      <span className="text-muted-foreground ml-2">({a.reason})</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.timestamp).toLocaleString()}
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
