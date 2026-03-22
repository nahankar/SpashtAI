import { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export async function saveAdvancedMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const { contentMetrics, deliveryMetrics, performanceInsights, processingStatus } = req.body

    const existing = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
    })

    if (!existing) {
      return res.status(404).json({ error: 'Session metrics not found. Save basic metrics first.' })
    }

    const updated = await prisma.sessionMetrics.update({
      where: { sessionId },
      data: {
        ...(contentMetrics !== undefined && { contentMetrics }),
        ...(deliveryMetrics !== undefined && { deliveryMetrics }),
        ...(performanceInsights !== undefined && { performanceInsights }),
        ...(processingStatus !== undefined && { processingStatus }),
      },
    })

    res.json(updated)
  } catch (error) {
    console.error('Error saving advanced metrics:', error)
    res.status(500).json({ error: 'Failed to save advanced metrics' })
  }
}

export async function getAdvancedMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: {
        sessionId: true,
        contentMetrics: true,
        deliveryMetrics: true,
        performanceInsights: true,
        processingStatus: true,
        updatedAt: true,
      },
    })

    if (!metrics) {
      return res.status(404).json({ error: 'No metrics found for this session' })
    }

    res.json(metrics)
  } catch (error) {
    console.error('Error fetching advanced metrics:', error)
    res.status(500).json({ error: 'Failed to fetch advanced metrics' })
  }
}
