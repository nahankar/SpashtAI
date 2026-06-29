import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Cloud, Server, CheckCircle2, Loader2, AlertCircle, Activity } from 'lucide-react'
import { ReplayLlmCard } from '@/components/admin/ReplayLlmCard'

interface VoiceConfigRow {
  id: string
  backend: string
  displayName: string
  description: string | null
  sttProvider: string | null
  ttsProvider: string | null
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

interface HealthCheck {
  ok: boolean
  detail: string
}

interface HealthResponse {
  backend: string
  ok: boolean
  checks: Record<string, HealthCheck>
}

const BACKEND_META: Record<string, { icon: typeof Cloud; latency: string; ram: string; offline: boolean }> = {
  'nova-sonic': {
    icon: Cloud,
    latency: '~250ms',
    ram: '0 GB (cloud)',
    offline: false,
  },
  'pipeline-bedrock': {
    icon: Server,
    latency: '~1–2s',
    ram: 'STT/TTS optional local',
    offline: false,
  },
  'pipeline-premium': {
    icon: Server,
    latency: '~700ms',
    ram: '~28 GB',
    offline: true,
  },
}

type SttProvider = 'whisper' | 'transcribe'
type TtsProvider = 'kokoro' | 'polly'

// Whisper models served by the faster-whisper STT host (speaches).
// Only one is "live" at a time — the active backend uses whichever it names.
const WHISPER_STT_MODELS = {
  distil: 'Systran/faster-distil-whisper-small.en',
  turbo: 'deepdml/faster-whisper-large-v3-turbo-ct2',
} as const

export function VoiceBackend() {
  const [data, setData] = useState<VoiceConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingPremiumStt, setSavingPremiumStt] = useState(false)

  const bedrockCfg = data?.configs.find((c) => c.backend === 'pipeline-bedrock')
  const [editStt, setEditStt] = useState<SttProvider>('whisper')
  const [editTts, setEditTts] = useState<TtsProvider>('kokoro')
  const [editSttUrl, setEditSttUrl] = useState('http://localhost:8001/v1')
  const [editTtsUrl, setEditTtsUrl] = useState('http://localhost:8002/v1')
  const [editVoice, setEditVoice] = useState('af_bella')
  const [editLlm, setEditLlm] = useState('amazon.nova-lite-v1:0')
  const [editSttModel, setEditSttModel] = useState('deepdml/faster-whisper-large-v3-turbo-ct2')

  function syncEditFromConfig(cfg: VoiceConfigRow) {
    setEditStt((cfg.sttProvider as SttProvider) || 'whisper')
    setEditTts((cfg.ttsProvider as TtsProvider) || 'kokoro')
    setEditSttUrl(cfg.sttBaseUrl || 'http://localhost:8001/v1')
    setEditTtsUrl(cfg.ttsBaseUrl || 'http://localhost:8002/v1')
    setEditVoice(cfg.voiceName || (cfg.ttsProvider === 'polly' ? 'Ruth' : 'af_bella'))
    setEditLlm(cfg.pipelineLlm || 'amazon.nova-lite-v1:0')
    setEditSttModel(cfg.pipelineStt || 'deepdml/faster-whisper-large-v3-turbo-ct2')
  }

  async function load() {
    setLoading(true)
    try {
      const res = await apiClient<VoiceConfigResponse>('/api/admin/voice-config')
      setData(res)
      const bedrock = res.configs.find((c) => c.backend === 'pipeline-bedrock')
      if (bedrock) syncEditFromConfig(bedrock)
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

  async function runHealth() {
    setHealthLoading(true)
    setHealth(null)
    try {
      const res = await apiClient<HealthResponse>('/api/admin/voice-config/health', {
        method: 'POST',
        body: JSON.stringify({
          backend: 'pipeline-bedrock',
          sttProvider: editStt,
          ttsProvider: editTts,
          sttBaseUrl: editStt === 'whisper' ? editSttUrl : null,
          ttsBaseUrl: editTts === 'kokoro' ? editTtsUrl : null,
        }),
      })
      setHealth(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Health check failed')
    } finally {
      setHealthLoading(false)
    }
  }

  async function savePipelineBedrock() {
    setSaving(true)
    setError(null)
    try {
      await apiClient('/api/admin/voice-config/pipeline-bedrock', {
        method: 'PUT',
        body: JSON.stringify({
          sttProvider: editStt,
          ttsProvider: editTts,
          sttBaseUrl: editStt === 'whisper' ? editSttUrl : null,
          ttsBaseUrl: editTts === 'kokoro' ? editTtsUrl : null,
          pipelineStt: editStt === 'whisper' ? editSttModel : null,
          pipelineLlm: editLlm,
          pipelineTts: editTts,
          voiceName: editVoice,
        }),
      })
      await load()
      await runHealth()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function savePremiumSttModel(model: string) {
    setSavingPremiumStt(true)
    setError(null)
    try {
      await apiClient('/api/admin/voice-config/pipeline-premium', {
        method: 'PUT',
        body: JSON.stringify({ pipelineStt: model }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save STT model')
    } finally {
      setSavingPremiumStt(false)
    }
  }

  function applyPreset(stt: SttProvider, tts: TtsProvider) {
    setEditStt(stt)
    setEditTts(tts)
    if (stt === 'whisper') {
      setEditSttUrl('http://localhost:8001/v1')
      setEditSttModel(WHISPER_STT_MODELS.turbo)
    }
    if (tts === 'kokoro') {
      setEditTtsUrl('http://localhost:8002/v1')
      setEditVoice('af_bella')
    } else {
      setEditVoice('Ruth')
    }
    setEditLlm('amazon.nova-lite-v1:0')
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

      <ReplayLlmCard />

      {bedrockCfg && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">Pipeline Bedrock — stack builder</CardTitle>
            <CardDescription>
              LiveKit → Silero VAD (Whisper) → STT → Nova Lite → TTS. Mix self-hosted Whisper/Kokoro with AWS APIs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('whisper', 'kokoro')}>
                Eco local (Whisper + Kokoro)
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('transcribe', 'polly')}>
                Cloud (Transcribe + Polly)
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => applyPreset('whisper', 'polly')}>
                Hybrid (Whisper + Polly)
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>STT provider</Label>
                <div className="flex gap-2">
                  <ProviderButton
                    active={editStt === 'whisper'}
                    onClick={() => setEditStt('whisper')}
                    label="Whisper"
                    sub="Self-hosted / local"
                  />
                  <ProviderButton
                    active={editStt === 'transcribe'}
                    onClick={() => setEditStt('transcribe')}
                    label="AWS Transcribe"
                    sub="Streaming"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>TTS provider</Label>
                <div className="flex gap-2">
                  <ProviderButton
                    active={editTts === 'kokoro'}
                    onClick={() => {
                      setEditTts('kokoro')
                      setEditVoice('af_bella')
                    }}
                    label="Kokoro"
                    sub="SpashtAI EC2"
                  />
                  <ProviderButton
                    active={editTts === 'polly'}
                    onClick={() => {
                      setEditTts('polly')
                      setEditVoice('Ruth')
                    }}
                    label="AWS Polly"
                    sub="Generative"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pipeline-llm">LLM (Bedrock)</Label>
                <Input id="pipeline-llm" value={editLlm} onChange={(e) => setEditLlm(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pipeline-voice">Voice</Label>
                <Input
                  id="pipeline-voice"
                  value={editVoice}
                  onChange={(e) => setEditVoice(e.target.value)}
                  placeholder={editTts === 'polly' ? 'Ruth' : 'af_bella'}
                />
              </div>
            </div>

            {editStt === 'whisper' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stt-url">Whisper URL</Label>
                  <Input id="stt-url" value={editSttUrl} onChange={(e) => setEditSttUrl(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stt-model">Whisper model</Label>
                  <div className="flex gap-2">
                    <ProviderButton
                      active={editSttModel === WHISPER_STT_MODELS.turbo}
                      onClick={() => setEditSttModel(WHISPER_STT_MODELS.turbo)}
                      label="Whisper Turbo"
                      sub="large-v3 · multilingual"
                    />
                    <ProviderButton
                      active={editSttModel === WHISPER_STT_MODELS.distil}
                      onClick={() => setEditSttModel(WHISPER_STT_MODELS.distil)}
                      label="Distil-Small (.en)"
                      sub="Lightest · English-only"
                    />
                  </div>
                  <Input
                    id="stt-model"
                    value={editSttModel}
                    onChange={(e) => setEditSttModel(e.target.value)}
                    placeholder="or enter a custom model id"
                  />
                  <p className="text-xs text-muted-foreground">
                    Save stack to apply. Takes effect on the next session.
                  </p>
                </div>
              </div>
            )}

            {editTts === 'kokoro' && (
              <div className="space-y-2">
                <Label htmlFor="tts-url">Kokoro URL</Label>
                <Input id="tts-url" value={editTtsUrl} onChange={(e) => setEditTtsUrl(e.target.value)} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={savePipelineBedrock} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  'Save stack'
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => runHealth()} disabled={healthLoading}>
                {healthLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing…
                  </>
                ) : (
                  <>
                    <Activity className="mr-2 h-4 w-4" /> Test connectivity
                  </>
                )}
              </Button>
              {!bedrockCfg.isActive && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setActive('pipeline-bedrock')}
                  disabled={switchingTo === 'pipeline-bedrock'}
                >
                  Activate pipeline-bedrock
                </Button>
              )}
            </div>

            {health?.backend === 'pipeline-bedrock' && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  {health.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  Stack health: {health.ok ? 'OK' : 'Issues detected'}
                </div>
                <dl className="space-y-1">
                  {Object.entries(health.checks).map(([key, check]) => (
                    <div key={key} className="flex justify-between gap-4 font-mono text-xs">
                      <dt className="uppercase text-muted-foreground">{key}</dt>
                      <dd className={check.ok ? 'text-green-700' : 'text-destructive'}>
                        {check.ok ? '✓' : '✗'} {check.detail}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>
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
                    <div className="font-semibold">{meta.offline ? 'Offline' : 'Cloud/hybrid'}</div>
                  </div>
                </div>

                {cfg.backend === 'pipeline-bedrock' && (
                  <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                    <ConfigRow label="STT" value={`${cfg.sttProvider || 'whisper'} (${cfg.pipelineStt || '—'})`} />
                    <ConfigRow label="LLM" value={cfg.pipelineLlm} />
                    <ConfigRow label="TTS" value={cfg.ttsProvider || 'kokoro'} />
                    <ConfigRow label="Voice" value={cfg.voiceName} />
                  </dl>
                )}

                {cfg.backend === 'pipeline-premium' && (
                  <div className="space-y-3">
                    <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                      <ConfigRow label="STT" value={cfg.pipelineStt} />
                      <ConfigRow label="LLM" value={cfg.pipelineLlm} />
                      <ConfigRow label="TTS" value={cfg.pipelineTts} />
                      <ConfigRow label="Voice" value={cfg.voiceName} />
                    </dl>
                    <div className="space-y-2">
                      <Label>Whisper STT model</Label>
                      <div className="flex gap-2">
                        <ProviderButton
                          active={cfg.pipelineStt === WHISPER_STT_MODELS.distil}
                          onClick={() => savePremiumSttModel(WHISPER_STT_MODELS.distil)}
                          label="Distil-Small (.en)"
                          sub="Lightest · English-only"
                        />
                        <ProviderButton
                          active={cfg.pipelineStt === WHISPER_STT_MODELS.turbo}
                          onClick={() => savePremiumSttModel(WHISPER_STT_MODELS.turbo)}
                          label="Whisper Turbo"
                          sub="large-v3 · multilingual"
                        />
                      </div>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {savingPremiumStt ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                          </>
                        ) : (
                          'Applies on the next session start.'
                        )}
                      </p>
                    </div>
                  </div>
                )}
                {cfg.backend === 'nova-sonic' && (
                  <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                    <ConfigRow label="Model" value="amazon.nova-sonic" />
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
            • <strong className="text-foreground">Pipeline Bedrock</strong> — self-hosted Whisper (
            <code className="rounded bg-muted px-1">localhost:8001</code>) or AWS Transcribe for STT, Kokoro (
            <code className="rounded bg-muted px-1">localhost:8002</code>) or AWS Polly for TTS, Nova Lite via Bedrock
            IAM role.
          </p>
          <p>
            • For full-AWS cloud (no local services), use the{' '}
            <strong className="text-foreground">Cloud (Transcribe + Polly)</strong> preset.
          </p>
          <p>
            • If a selected self-hosted service is unreachable when a session starts, the agent falls back to Nova Sonic
            (logged in agent PM2 logs).
          </p>
          <p>• Already-running sessions keep their original backend. Changes apply to new sessions only.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ProviderButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean
  onClick: () => void
  label: string
  sub: string
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      className="h-auto flex-1 flex-col items-start px-3 py-2"
      onClick={onClick}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs font-normal opacity-80">{sub}</span>
    </Button>
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
