import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Cloud, Server, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'

interface VoiceConfigRow {
  id: string
  backend: string
  displayName: string
  description: string | null
  pipelineStt: string | null
  pipelineLlm: string | null
  pipelineTts: string | null
  voiceName: string | null
  sttBaseUrl: string | null
  llmBaseUrl: string | null
  ttsBaseUrl: string | null
  isActive: boolean
  updatedBy: string | null
  updatedAt: string
}

interface VoiceConfigResponse {
  configs: VoiceConfigRow[]
  active: VoiceConfigRow | null
}

const BACKEND_META: Record<string, { icon: typeof Cloud; latency: string; ram: string; offline: boolean }> = {
  'nova-sonic': {
    icon: Cloud,
    latency: '~250ms',
    ram: '0 GB (cloud)',
    offline: false,
  },
  'pipeline-premium': {
    icon: Server,
    latency: '~700ms',
    ram: '~28 GB',
    offline: true,
  },
}

export function VoiceBackend() {
  const [data, setData] = useState<VoiceConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<VoiceConfigResponse>('/api/admin/voice-config')
      setData(res)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function setActive(backend: string) {
    setSwitchingTo(backend)
    setError(null)
    try {
      await apiClient('/api/admin/voice-config/active', {
        method: 'PUT',
        body: JSON.stringify({ backend }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch backend')
    } finally {
      setSwitchingTo(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading voice backends…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-4 w-4" /> Failed to load voice config{error ? `: ${error}` : ''}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Voice Backend</h1>
        <p className="text-muted-foreground">
          Choose which speech engine powers Elevate live coaching sessions. Changes take effect on the next session start.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data.configs.map((cfg) => {
          const meta = BACKEND_META[cfg.backend] ?? {
            icon: Server,
            latency: '—',
            ram: '—',
            offline: cfg.backend.startsWith('pipeline'),
          }
          const Icon = meta.icon
          const isActive = cfg.isActive
          const isSwitchingHere = switchingTo === cfg.backend

          return (
            <Card
              key={cfg.id}
              className={
                isActive
                  ? 'border-primary/60 ring-1 ring-primary/30 transition-all'
                  : 'transition-all hover:border-primary/30'
              }
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{cfg.displayName}</CardTitle>
                      <CardDescription className="font-mono text-xs">{cfg.backend}</CardDescription>
                    </div>
                  </div>
                  {isActive ? (
                    <Badge className="bg-primary text-primary-foreground">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Active
                    </Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {cfg.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground">{cfg.description}</p>
                )}

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border bg-card/50 p-2 text-center">
                    <div className="text-muted-foreground">Latency</div>
                    <div className="font-semibold">{meta.latency}</div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-2 text-center">
                    <div className="text-muted-foreground">RAM</div>
                    <div className="font-semibold">{meta.ram}</div>
                  </div>
                  <div className="rounded-md border bg-card/50 p-2 text-center">
                    <div className="text-muted-foreground">Mode</div>
                    <div className="font-semibold">{meta.offline ? 'Offline' : 'Cloud'}</div>
                  </div>
                </div>

                {cfg.backend.startsWith('pipeline') && (
                  <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                    <ConfigRow label="STT" value={cfg.pipelineStt} />
                    <ConfigRow label="LLM" value={cfg.pipelineLlm} />
                    <ConfigRow label="TTS" value={cfg.pipelineTts} />
                    <ConfigRow label="Voice" value={cfg.voiceName} />
                  </dl>
                )}
                {cfg.backend === 'nova-sonic' && (
                  <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                    <ConfigRow label="Model" value="amazon.nova-sonic-v1:0" />
                    <ConfigRow label="Voice" value={cfg.voiceName} />
                    <ConfigRow label="Region" value="us-east-1" />
                  </dl>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Last updated {new Date(cfg.updatedAt).toLocaleString()}
                  </span>
                  {isActive ? (
                    <Button size="sm" variant="outline" disabled>
                      <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> In use
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setActive(cfg.backend)} disabled={isSwitchingHere}>
                      {isSwitchingHere ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Switching…
                        </>
                      ) : (
                        'Set as active'
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">Operational notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            • <strong className="text-foreground">Nova Sonic</strong> needs valid AWS Bedrock credentials in{' '}
            <code className="rounded bg-muted px-1">apps/server/.env</code> and{' '}
            <code className="rounded bg-muted px-1">apps/agent/.env</code>.
          </p>
          <p>
            • <strong className="text-foreground">Pipeline Premium</strong> needs three local servers running:
            faster-whisper-server (:8001), Ollama (:11434), Kokoro-FastAPI (:8002). Start them via{' '}
            <code className="rounded bg-muted px-1">apps/agent/start-local-stack.sh</code>.
          </p>
          <p>
            • If a pipeline server is unreachable when a session starts, the agent automatically falls back to Nova Sonic.
            This is logged in the agent terminal.
          </p>
          <p>• Already-running sessions keep their original backend. Changes apply to new sessions only.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ConfigRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">{value || '—'}</dd>
    </div>
  )
}
