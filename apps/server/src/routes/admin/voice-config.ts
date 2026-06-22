import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

// ── Seed defaults if none exist ──
const DEFAULT_PRESETS = [
  {
    backend: 'nova-sonic',
    displayName: 'Nova Sonic (AWS, cloud)',
    description:
      'Speech-to-speech via AWS Bedrock Nova Sonic. Lowest latency (~250ms), highest naturalness. Requires valid AWS credentials with Bedrock access.',
    pipelineStt: null,
    pipelineLlm: null,
    pipelineTts: null,
    voiceName: 'tiffany',
    sttBaseUrl: null,
    llmBaseUrl: null,
    ttsBaseUrl: null,
    isActive: true,
  },
  {
    backend: 'pipeline-premium',
    displayName: 'Pipeline Premium (local)',
    description:
      'Distil-Whisper small.en (STT) + Qwen 2.5 14B via Ollama (LLM) + Kokoro-FastAPI (TTS). ' +
      'Fully offline, optimized for low-latency English voice on Apple Silicon (~1-2s per turn).',
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

async function ensurePresets() {
  const count = await prisma.voiceConfig.count()
  if (count === 0) {
    await prisma.voiceConfig.createMany({ data: DEFAULT_PRESETS })
    console.log(`✅ Seeded ${DEFAULT_PRESETS.length} voice config presets`)
  } else {
    // Make sure both required presets exist (idempotent: insert any missing one)
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

    // Atomic flip: clear all isActive, set target.
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

    // Best-effort audit log (matches pattern of other admin routes)
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
    const adminId = (req as any).user?.userId ?? null
    const allowed = [
      'displayName',
      'description',
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
