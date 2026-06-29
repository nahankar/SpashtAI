import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import {
  ALLOWED_REPLAY_MODEL_IDS,
  DEFAULT_REPLAY_MODEL_ID,
  REPLAY_MODEL_OPTIONS,
  getAnalysisConfig,
  invalidateAnalysisConfigCache,
} from '../../lib/analysisConfig'

const router = Router()

function payload(cfg: Awaited<ReturnType<typeof getAnalysisConfig>>) {
  return { ...cfg, defaultModelId: DEFAULT_REPLAY_MODEL_ID, options: REPLAY_MODEL_OPTIONS }
}

// GET /api/admin/analysis-config — current Replay LLM selection + options
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(payload(await getAnalysisConfig()))
  } catch (err) {
    console.error('Analysis config get error:', err)
    res.status(500).json({ error: 'Failed to load analysis config' })
  }
})

// PUT /api/admin/analysis-config — set the Replay LLM (null/empty = env default)
router.put('/', async (req: Request, res: Response) => {
  try {
    const { replayModelId } = req.body as { replayModelId?: string | null }

    let value: string | null = null
    if (replayModelId != null && String(replayModelId).trim() !== '') {
      const v = String(replayModelId).trim()
      if (!ALLOWED_REPLAY_MODEL_IDS.has(v)) {
        return res.status(400).json({ error: `Unsupported model id: ${v}` })
      }
      value = v
    }

    const adminId = (req as any).user?.userId ?? null
    await prisma.analysisConfig.upsert({
      where: { id: 'default' },
      update: { replayModelId: value, updatedBy: adminId },
      create: { id: 'default', replayModelId: value, updatedBy: adminId },
    })
    invalidateAnalysisConfigCache()

    try {
      await prisma.adminAction.create({
        data: {
          adminId: adminId ?? 'unknown',
          action: 'analysis_config.set_replay_model',
          metadata: { replayModelId: value },
        },
      })
    } catch (auditErr) {
      console.warn('Audit log skipped:', auditErr)
    }

    res.json(payload(await getAnalysisConfig()))
  } catch (err) {
    console.error('Analysis config update error:', err)
    res.status(500).json({ error: 'Failed to update analysis config' })
  }
})

export default router
