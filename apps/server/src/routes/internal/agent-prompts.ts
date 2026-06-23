import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ensurePrompts } from '../admin/agent-prompts'

const router = Router()

function validateAgentToken(req: Request): boolean {
  const token = req.header('x-internal-agent-token')
  const expected =
    process.env.INTERNAL_AGENT_TOKEN ||
    (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')
  return Boolean(expected && token === expected)
}

router.get('/:key', async (req: Request, res: Response) => {
  if (!validateAgentToken(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    await ensurePrompts()
    const prompt = await prisma.agentPrompt.findUnique({ where: { key: req.params.key } })
    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' })
    }
    res.json({ key: prompt.key, content: prompt.content })
  } catch (err) {
    console.error('Internal agent prompt fetch error:', err)
    res.status(500).json({ error: 'Failed to load prompt' })
  }
})

export default router
