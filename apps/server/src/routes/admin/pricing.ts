import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

async function ensureSettings() {
  const existing = await prisma.pricingSettings.findUnique({ where: { id: 'default' } })
  if (!existing) {
    await prisma.pricingSettings.create({
      data: { id: 'default', enabled: false, comingSoonText: 'Pricing plans coming soon!' },
    })
  }
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    await ensureSettings()
    const settings = await prisma.pricingSettings.findUnique({ where: { id: 'default' } })
    const plans = await prisma.pricingPlan.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { features: { orderBy: { sortOrder: 'asc' } } },
    })
    res.json({ settings, plans })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load pricing admin' })
  }
})

router.put('/settings', async (req: Request, res: Response) => {
  try {
    await ensureSettings()
    const { enabled, comingSoonText } = req.body as { enabled?: boolean; comingSoonText?: string }
    const settings = await prisma.pricingSettings.update({
      where: { id: 'default' },
      data: {
        ...(enabled !== undefined && { enabled }),
        ...(comingSoonText !== undefined && { comingSoonText }),
      },
    })
    res.json({ settings })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' })
  }
})

router.post('/plans', async (req: Request, res: Response) => {
  try {
    const { name, priceMonthly, description, isPromoted, sortOrder, features } = req.body as {
      name?: string
      priceMonthly?: number
      description?: string
      isPromoted?: boolean
      sortOrder?: number
      features?: string[]
    }
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    if (isPromoted) {
      await prisma.pricingPlan.updateMany({ data: { isPromoted: false } })
    }

    const plan = await prisma.pricingPlan.create({
      data: {
        name: name.trim(),
        priceMonthly: Number(priceMonthly) || 0,
        description: description?.trim() || null,
        isPromoted: Boolean(isPromoted),
        sortOrder: sortOrder ?? 0,
        features: {
          create: (features ?? []).map((text, i) => ({ text, sortOrder: i })),
        },
      },
      include: { features: true },
    })
    res.status(201).json({ plan })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create plan' })
  }
})

router.put('/plans/:id', async (req: Request, res: Response) => {
  try {
    const { name, priceMonthly, description, isPromoted, sortOrder, features } = req.body as {
      name?: string
      priceMonthly?: number
      description?: string
      isPromoted?: boolean
      sortOrder?: number
      features?: string[]
    }

    if (isPromoted) {
      await prisma.pricingPlan.updateMany({ data: { isPromoted: false } })
    }

    await prisma.pricingPlanFeature.deleteMany({ where: { planId: req.params.id } })

    const plan = await prisma.pricingPlan.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(priceMonthly !== undefined && { priceMonthly: Number(priceMonthly) }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(isPromoted !== undefined && { isPromoted }),
        ...(sortOrder !== undefined && { sortOrder }),
        features: {
          create: (features ?? []).map((text, i) => ({ text, sortOrder: i })),
        },
      },
      include: { features: { orderBy: { sortOrder: 'asc' } } },
    })
    res.json({ plan })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' })
  }
})

router.delete('/plans/:id', async (req: Request, res: Response) => {
  try {
    await prisma.pricingPlan.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete plan' })
  }
})

export default router
