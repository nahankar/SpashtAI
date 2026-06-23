import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

const DEFAULT_PROMPTS = [
  {
    key: 'elevate_coach_persona',
    label: 'Elevate — Coach persona',
    description:
      'Opening personality and coaching style for live Elevate sessions. Tool-grounding rules (WPM, filler counts) are always appended from code.',
    content: `You are a voice AI coach for SpashtAI, a platform that helps people become better communicators.
Your interface with users will be voice. Use short and concise responses,
and avoid unpronounceable punctuation. Be warm, encouraging, and professional.
At the start of every session, greet the user first and take the initiative before they speak.`,
  },
  {
    key: 'elevate_exercise_filler_words',
    label: 'Elevate — Filler words exercise',
    description:
      'Session script when focus area is filler_words. Must tell the coach to use get_speech_metrics before quoting filler counts.',
    content: `SESSION TYPE: Guided Practice — "Filler Word Elimination"

Use the exercise below as your coaching GUIDE, not a rigid script.
Follow the general flow but adapt naturally based on the conversation.

WARM-UP:
We're going to practice speaking without filler words — no 'um', 'uh', discourse 'like', 'you know', 'basically', or 'actually'.
I'll give you a topic and you speak for about 90 seconds.
When you catch yourself using a filler, pause and restart the sentence.
Silence is better than a filler.

ROUND 1:
Speak about the topic I give you for about 90 seconds.
Focus on replacing fillers with brief pauses.

ROUND 2:
Repeat with a new topic. Try to cut your filler count from round 1.
Slow down slightly — rushing causes fillers.

IMPORTANT: Before telling the user how many filler words they used, call get_speech_metrics and quote that number.
Never invent a filler count. Acknowledgments like "okay" or "yeah" are tracked separately.`,
  },
]

async function ensurePrompts() {
  for (const seed of DEFAULT_PROMPTS) {
    const existing = await prisma.agentPrompt.findUnique({ where: { key: seed.key } })
    if (!existing) {
      await prisma.agentPrompt.create({ data: seed })
    }
  }
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    await ensurePrompts()
    const prompts = await prisma.agentPrompt.findMany({ orderBy: { key: 'asc' } })
    res.json({ prompts })
  } catch (err) {
    console.error('Agent prompts list error:', err)
    res.status(500).json({ error: 'Failed to load agent prompts' })
  }
})

router.put('/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params
    const { content } = req.body as { content?: string }
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' })
    }
    const updated = await prisma.agentPrompt.update({
      where: { key },
      data: {
        content: content.trim(),
        updatedBy: (req as Request & { user?: { email?: string } }).user?.email ?? null,
      },
    })
    res.json({ prompt: updated })
  } catch (err) {
    console.error('Agent prompt update error:', err)
    res.status(500).json({ error: 'Failed to update agent prompt' })
  }
})

export default router
export { ensurePrompts }
