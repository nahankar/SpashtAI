import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Mic, Upload, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext'

interface FeatureFlagRow {
  feature: string
  label: string
  description: string | null
  enabled: boolean
  updatedAt: string
}

const FEATURE_ICONS: Record<string, typeof Mic> = {
  elevate: Mic,
  replay: Upload,
}

export function FeatureFlagsAdmin() {
  const { refresh: refreshPublicFlags } = useFeatureFlags()
  const [flags, setFlags] = useState<FeatureFlagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<{ flags: FeatureFlagRow[] }>('/api/admin/feature-flags')
      setFlags(res.flags)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feature flags')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function toggle(feature: string, enabled: boolean) {
    setToggling(feature)
    setError(null)
    try {
      await apiClient(`/api/admin/feature-flags/${feature}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      await load()
      await refreshPublicFlags()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update feature flag')
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading feature flags…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
        <p className="text-muted-foreground">
          Enable or disable product modules platform-wide. Disabled features are hidden from users and excluded from trends and admin analytics.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {flags.map((flag) => {
          const Icon = FEATURE_ICONS[flag.feature] ?? Mic
          const isToggling = toggling === flag.feature

          return (
            <Card
              key={flag.feature}
              className={flag.enabled ? 'border-primary/40' : 'border-muted opacity-90'}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{flag.label}</CardTitle>
                      <CardDescription className="font-mono text-xs">{flag.feature}</CardDescription>
                    </div>
                  </div>
                  <Badge variant={flag.enabled ? 'default' : 'outline'}>
                    {flag.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {flag.description && (
                  <p className="text-sm text-muted-foreground">{flag.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Updated {new Date(flag.updatedAt).toLocaleString()}
                  </span>
                  <Button
                    size="sm"
                    variant={flag.enabled ? 'outline' : 'default'}
                    disabled={isToggling}
                    onClick={() => toggle(flag.feature, !flag.enabled)}
                  >
                    {isToggling ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…
                      </>
                    ) : flag.enabled ? (
                      'Disable'
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Enable
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Changes apply immediately for new page loads. Users mid-session may need a refresh.</p>
          <p>• Disabled modules return 403 from their APIs — data remains in the database but is excluded from Progress Pulse trends and admin metrics.</p>
          <p>• Per-tenant licensing will extend this model later; flags are global for now.</p>
        </CardContent>
      </Card>
    </div>
  )
}
