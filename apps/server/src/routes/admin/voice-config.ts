import net from 'net'
import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

const DEFAULT_STT_URL =
  process.env.PIPELINE_STT_URL || 'http://localhost:8001/v1'
const DEFAULT_TTS_URL =
  process.env.PIPELINE_TTS_URL || 'http://localhost:8002/v1'

// ── Seed defaults if none exist ──
const DEFAULT_PRESETS = [
  {
    backend: 'nova-sonic',
    displayName: 'Nova Sonic (AWS, cloud)',
    description:
      'Speech-to-speech via AWS Bedrock Nova Sonic. Lowest latency (~250ms), highest naturalness. Requires valid AWS credentials with Bedrock access.',
    sttProvider: null,
    ttsProvider: null,
    pipelineStt: null,
    pipelineLlm: null,
    pipelineTts: null,
    voiceName: 'tiffany',
    sttBaseUrl: null,
    llmBaseUrl: null,
    ttsBaseUrl: null,
    isActive: false,
  },
  {
    backend: 'pipeline-bedrock',
    displayName: 'Pipeline Bedrock — Full AWS Cloud (Transcribe + Nova Lite + Polly)',
    description:
      'Full AWS Cloud path: AWS Transcribe streaming (live word-by-word) + Bedrock Nova Lite ' +
      '(ConverseStream) + AWS Polly. No GPU needed — ideal for t3.large. Admin can switch STT to ' +
      'self-hosted Whisper or TTS to Kokoro for local/offline testing.',
    sttProvider: 'transcribe',
    ttsProvider: 'polly',
    pipelineStt: 'deepdml/faster-whisper-large-v3-turbo-ct2',
    pipelineLlm: 'amazon.nova-lite-v1:0',
    pipelineTts: 'polly',
    voiceName: 'Ruth',
    sttBaseUrl: DEFAULT_STT_URL,
    llmBaseUrl: null,
    ttsBaseUrl: DEFAULT_TTS_URL,
    isActive: true,
  },
  {
    backend: 'pipeline-premium',
    displayName: 'Pipeline Premium (local dev)',
    description:
      'Distil-Whisper small.en (STT) + Qwen 2.5 14B via Ollama (LLM) + Kokoro-FastAPI (TTS). ' +
      'Fully offline, for local Mac dev only.',
    sttProvider: 'whisper',
    ttsProvider: 'kokoro',
    pipelineStt: 'Systran/faster-distil-whisper-small.en',
    pipelineLlm: 'qwen2.5:14b',
    pipelineTts: 'kokoro',
    voiceName: 'af_bella',
    sttBaseUrl: 'http://localhost:8001/v1',
    llmBaseUrl: 'http://localhost:11434/v1',
    ttsBaseUrl: 'http://localhost:8002/v1',
    isActive: false,
  },
]

function hostPortFromUrl(baseUrl: string, defaultPort: number): { host: string; port: number } {
  try {
    const u = new URL(baseUrl)
    return {
      host: u.hostname || 'localhost',
      port: u.port ? Number(u.port) : defaultPort,
    }
  } catch {
    return { host: 'localhost', port: defaultPort }
  }
}

function tcpCheck(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    socket.connect(port, host)
  })
}

async function probePipelineBedrock(cfg: {
  sttProvider?: string | null
  ttsProvider?: string | null
  sttBaseUrl?: string | null
  ttsBaseUrl?: string | null
}) {
  const sttProvider = (cfg.sttProvider || 'whisper').toLowerCase()
  const ttsProvider = (cfg.ttsProvider || 'kokoro').toLowerCase()

  const checks: Record<string, { ok: boolean; detail: string }> = {}

  if (sttProvider === 'whisper') {
    const url = cfg.sttBaseUrl || DEFAULT_STT_URL
    const { host, port } = hostPortFromUrl(url, 8001)
    const ok = await tcpCheck(host, port)
    checks.stt = { ok, detail: `${host}:${port}` }
  } else {
    checks.stt = { ok: true, detail: 'aws-transcribe (IAM at runtime)' }
  }

  if (ttsProvider === 'kokoro') {
    const url = cfg.ttsBaseUrl || DEFAULT_TTS_URL
    const { host, port } = hostPortFromUrl(url, 8002)
    const ok = await tcpCheck(host, port)
    checks.tts = { ok, detail: `${host}:${port}` }
  } else {
    checks.tts = { ok: true, detail: 'aws-polly (IAM at runtime)' }
  }

  checks.llm = { ok: true, detail: 'bedrock-nova-lite (IAM at runtime)' }

  const ok = Object.values(checks).every((c) => c.ok)
  return { ok, checks }
}

async function ensurePresets() {
  const count = await prisma.voiceConfig.count()
  if (count === 0) {
    await prisma.voiceConfig.createMany({ data: DEFAULT_PRESETS })
    console.log(`✅ Seeded ${DEFAULT_PRESETS.length} voice config presets`)
  } else {
    const existing = await prisma.voiceConfig.findMany({ select: { backend: true } })
    const have = new Set(existing.map((r) => r.backend))
    const missing = DEFAULT_PRESETS.filter((p) => !have.has(p.backend))
    if (missing.length > 0) {
      await prisma.voiceConfig.createMany({
        data: missing.map((p) => ({ ...p, isActive: false })),
      })
      console.log(`✅ Added ${missing.length} missing voice config preset(s)`)
    }
  }
  const upgraded = await prisma.voiceConfig.updateMany({
    where: { backend: 'pipeline-bedrock', pipelineLlm: 'amazon.nova-pro-v1:0' },
    data: { pipelineLlm: 'amazon.nova-lite-v1:0' },
  })
  if (upgraded.count > 0) {
    console.log(`✅ Upgraded ${upgraded.count} pipeline-bedrock config(s) to Nova Lite`)
  }
  // Retire the never-deployed "Udyogapramoda" Whisper host — point any preset
  // still using it at the local STT default instead.
  const retired = await prisma.voiceConfig.updateMany({
    where: { sttBaseUrl: 'http://10.0.1.212:8001/v1' },
    data: { sttBaseUrl: DEFAULT_STT_URL },
  })
  if (retired.count > 0) {
    console.log(`✅ Repointed ${retired.count} config(s) off the retired Udyogapramoda host`)
  }
}

// GET /api/admin/voice-config — list all backends, mark which is active
router.get('/', async (_req: Request, res: Response) => {
  try {
    await ensurePresets()
    const configs = await prisma.voiceConfig.findMany({
      orderBy: { backend: 'asc' },
    })
    const active = configs.find((c) => c.isActive) ?? null
    res.json({ configs, active })
  } catch (err) {
    console.error('Voice config list error:', err)
    res.status(500).json({ error: 'Failed to load voice config' })
  }
})

type HealthProbeInput = {
  sttProvider: string | null
  ttsProvider: string | null
  sttBaseUrl: string | null
  ttsBaseUrl: string | null
}

// GET/POST /api/admin/voice-config/health — probe STT/TTS (saved config or POST body preview)
async function runHealthForConfig(cfg: {
  backend: string
  sttProvider?: string | null
  ttsProvider?: string | null
  sttBaseUrl?: string | null
  ttsBaseUrl?: string | null
  llmBaseUrl?: string | null
}) {
  if (cfg.backend === 'pipeline-bedrock') {
    return { backend: cfg.backend, ...(await probePipelineBedrock(cfg)) }
  }

  if (cfg.backend === 'pipeline-premium') {
    const stt = hostPortFromUrl(cfg.sttBaseUrl || 'http://localhost:8001/v1', 8001)
    const llm = hostPortFromUrl(cfg.llmBaseUrl || 'http://localhost:11434/v1', 11434)
    const tts = hostPortFromUrl(cfg.ttsBaseUrl || 'http://localhost:8002/v1', 8002)
    const [okStt, okLlm, okTts] = await Promise.all([
      tcpCheck(stt.host, stt.port),
      tcpCheck(llm.host, llm.port),
      tcpCheck(tts.host, tts.port),
    ])
    const checks = {
      stt: { ok: okStt, detail: `${stt.host}:${stt.port}` },
      llm: { ok: okLlm, detail: `${llm.host}:${llm.port}` },
      tts: { ok: okTts, detail: `${tts.host}:${tts.port}` },
    }
    return { backend: cfg.backend, ok: okStt && okLlm && okTts, checks }
  }

  return {
    backend: cfg.backend,
    ok: true,
    checks: { cloud: { ok: true, detail: 'nova-sonic (Bedrock at runtime)' } },
  }
}

router.get('/health', async (req: Request, res: Response) => {
  try {
    await ensurePresets()
    const backend = (req.query.backend as string) || undefined

    const cfg = backend
      ? await prisma.voiceConfig.findUnique({ where: { backend } })
      : await prisma.voiceConfig.findFirst({ where: { isActive: true } })

    if (!cfg) {
      return res.status(404).json({ error: 'No voice config found' })
    }

    res.json(await runHealthForConfig(cfg))
  } catch (err) {
    console.error('Voice config health error:', err)
    res.status(500).json({ error: 'Health check failed' })
  }
})

router.post('/health', async (req: Request, res: Response) => {
  try {
    const body = req.body as HealthProbeInput & { backend?: string }
    const backend = body.backend || 'pipeline-bedrock'
    res.json(
      await runHealthForConfig({
        backend,
        sttProvider: body.sttProvider ?? 'whisper',
        ttsProvider: body.ttsProvider ?? 'kokoro',
        sttBaseUrl: body.sttBaseUrl ?? null,
        ttsBaseUrl: body.ttsBaseUrl ?? null,
      }),
    )
  } catch (err) {
    console.error('Voice config health preview error:', err)
    res.status(500).json({ error: 'Health check failed' })
  }
})

// PUT /api/admin/voice-config/active — set which backend is active
router.put('/active', async (req: Request, res: Response) => {
  try {
    const { backend } = req.body as { backend?: string }
    if (!backend) {
      return res.status(400).json({ error: 'backend is required' })
    }

    const target = await prisma.voiceConfig.findUnique({ where: { backend } })
    if (!target) {
      return res.status(404).json({ error: `Unknown backend: ${backend}` })
    }

    const adminId = (req as any).user?.userId ?? null

    const [_clear, updated] = await prisma.$transaction([
      prisma.voiceConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      prisma.voiceConfig.update({
        where: { backend },
        data: { isActive: true, updatedBy: adminId },
      }),
    ])

    try {
      await prisma.adminAction.create({
        data: {
          adminId: adminId ?? 'unknown',
          action: 'voice_config.set_active',
          metadata: { backend },
        },
      })
    } catch (auditErr) {
      console.warn('Audit log skipped:', auditErr)
    }

    res.json({ active: updated })
  } catch (err) {
    console.error('Voice config set active error:', err)
    res.status(500).json({ error: 'Failed to update voice config' })
  }
})

// PUT /api/admin/voice-config/:backend — update tuning fields (model names, voices, URLs)
router.put('/:backend', async (req: Request, res: Response) => {
  try {
    const backend = req.params.backend
    if (backend === 'active') {
      return res.status(400).json({ error: 'Use PUT /active to change active backend' })
    }

    const adminId = (req as any).user?.userId ?? null
    const allowed = [
      'displayName',
      'description',
      'sttProvider',
      'ttsProvider',
      'pipelineStt',
      'pipelineLlm',
      'pipelineTts',
      'voiceName',
      'sttBaseUrl',
      'llmBaseUrl',
      'ttsBaseUrl',
    ] as const
    const patch: Record<string, unknown> = {}
    for (const k of allowed) {
      if (k in req.body) patch[k] = (req.body as Record<string, unknown>)[k]
    }

    if (patch.sttProvider && !['whisper', 'transcribe'].includes(String(patch.sttProvider))) {
      return res.status(400).json({ error: 'sttProvider must be whisper or transcribe' })
    }
    if (patch.ttsProvider && !['kokoro', 'polly'].includes(String(patch.ttsProvider))) {
      return res.status(400).json({ error: 'ttsProvider must be kokoro or polly' })
    }

    patch['updatedBy'] = adminId

    const updated = await prisma.voiceConfig.update({
      where: { backend },
      data: patch,
    })
    res.json({ config: updated })
  } catch (err) {
    console.error('Voice config update error:', err)
    res.status(500).json({ error: 'Failed to update voice config' })
  }
})

export default router
export { ensurePresets }
