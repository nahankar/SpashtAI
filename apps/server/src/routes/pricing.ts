import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

async function ensurePricingSettings() {
  const existing = await prisma.pricingSettings.findUnique({ where: { id: 'default' } })
  if (!existing) {
    await prisma.pricingSettings.create({
      data: {
        id: 'default',
        enabled: false,
        comingSoonText: 'Pricing plans coming soon — stay tuned!',
      },
    })
  }
}

export async function getPublicPricing(_req: Request, res: Response) {
  try {
    await ensurePricingSettings()
    const settings = await prisma.pricingSettings.findUnique({ where: { id: 'default' } })
    const plans = await prisma.pricingPlan.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { features: { orderBy: { sortOrder: 'asc' } } },
    })
    res.json({
      enabled: settings?.enabled ?? false,
      comingSoonText: settings?.comingSoonText ?? null,
      plans,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load pricing' })
  }
}
