import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Brain, CheckCircle2, Loader2 } from 'lucide-react'

interface ReplayModelOption {
  id: string
  label: string
}

interface AnalysisConfigResponse {
  replayModelId: string | null
  effectiveModelId: string
  updatedAt: string | null
  defaultModelId: string
  options: ReplayModelOption[]
}

/**
 * Admin control for the LLM used by the Replay feature (transcript analysis +
 * coaching insights). Independent of the live Elevate voice backend. Empty
 * selection ("Use default") falls back to the BEDROCK_REPLAY_MODEL_ID env var.
 */
export function ReplayLlmCard() {
  const [data, setData] = useState<AnalysisConfigResponse | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<AnalysisConfigResponse>('/api/admin/analysis-config')
      setData(res)
      setSelected(res.replayModelId ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analysis config')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await apiClient<AnalysisConfigResponse>('/api/admin/analysis-config', {
        method: 'PUT',
        body: JSON.stringify({ replayModelId: selected || null }),
      })
      setData(res)
      setSelected(res.replayModelId ?? '')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const dirty = data ? (selected || null) !== (data.replayModelId ?? null) : false

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5 text-primary" /> Replay analysis LLM
        </CardTitle>
        <CardDescription>
          Bedrock model used to analyze Replay uploads and generate coaching insights. Separate from
          the live voice backend above. Changes apply to the next Replay analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:max-w-md">
              <Label htmlFor="replay-llm">Model</Label>
              <select
                id="replay-llm"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">
                  Use environment default ({data?.defaultModelId})
                </option>
                {data?.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Currently in use:</span>
              <Badge variant="secondary" className="font-mono">
                {data?.effectiveModelId}
              </Badge>
              {!data?.replayModelId && <span>(env default)</span>}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-3">
              <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
