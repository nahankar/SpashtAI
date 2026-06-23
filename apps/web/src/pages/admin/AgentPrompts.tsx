import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Save, MessageSquareText } from 'lucide-react'

interface AgentPromptRow {
  key: string
  label: string
  description: string | null
  content: string
  updatedAt: string
}

export function AgentPromptsAdmin() {
  const [prompts, setPrompts] = useState<AgentPromptRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<{ prompts: AgentPromptRow[] }>('/api/admin/agent-prompts')
      setPrompts(res.prompts)
      setDrafts(Object.fromEntries(res.prompts.map((p) => [p.key, p.content])))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prompts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function save(key: string) {
    setSaving(key)
    setError(null)
    try {
      await apiClient(`/api/admin/agent-prompts/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ content: drafts[key] }),
      })
      setSavedKey(key)
      setTimeout(() => setSavedKey(null), 2000)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save prompt')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading coach prompts…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Coach Prompts</h1>
        <p className="text-muted-foreground max-w-2xl">
          Edit live Elevate coaching instructions. Tool-grounding rules (call{' '}
          <code className="text-xs">get_live_pacing</code> /{' '}
          <code className="text-xs">get_speech_metrics</code> before quoting numbers) are always appended
          from code — edits here control persona and exercise scripts. Restart the agent worker after saving.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {prompts.map((prompt) => (
        <Card key={prompt.key}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquareText className="h-5 w-5" />
              {prompt.label}
            </CardTitle>
            <CardDescription>
              Key: <code className="text-xs">{prompt.key}</code>
              {prompt.description ? ` — ${prompt.description}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="min-h-[220px] w-full rounded-md border bg-background px-3 py-2 text-sm font-mono leading-relaxed"
              value={drafts[prompt.key] ?? ''}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [prompt.key]: e.target.value }))
              }
            />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => save(prompt.key)}
                disabled={saving === prompt.key || drafts[prompt.key] === prompt.content}
              >
                {saving === prompt.key ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
              {savedKey === prompt.key && (
                <span className="text-xs text-emerald-600">Saved — new sessions will use this text.</span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                Updated {new Date(prompt.updatedAt).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
