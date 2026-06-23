import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

export async function saveAdvancedMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const body = req.body as Record<string, unknown>
    const contentMetrics = body.contentMetrics ?? body.content_metrics
    const deliveryMetrics = body.deliveryMetrics ?? body.delivery_metrics
    const performanceInsights = body.performanceInsights ?? body.performance_insights
    const processingStatus =
      body.processingStatus ??
      body.processing_status ??
      (body.content_processed !== undefined ||
      body.audio_processed !== undefined ||
      body.insights_generated !== undefined
        ? {
            content_processed: body.content_processed,
            audio_processed: body.audio_processed,
            insights_generated: body.insights_generated,
            processing_errors: body.processing_errors,
          }
        : undefined)

    const existing = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
    })

    if (!existing) {
      return res.status(404).json({ error: 'Session metrics not found. Save basic metrics first.' })
    }

    const data: Prisma.SessionMetricsUpdateInput = {}
    if (contentMetrics !== undefined) {
      data.contentMetrics = contentMetrics as Prisma.InputJsonValue
    }
    if (deliveryMetrics !== undefined) {
      data.deliveryMetrics = deliveryMetrics as Prisma.InputJsonValue
    }
    if (performanceInsights !== undefined) {
      data.performanceInsights = performanceInsights as Prisma.InputJsonValue
    }
    if (processingStatus !== undefined) {
      data.processingStatus = processingStatus as Prisma.InputJsonValue
    }

    const updated = await prisma.sessionMetrics.update({
      where: { sessionId },
      data,
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

    // Normalize to snake_case for the AdvancedInsights UI.
    res.json({
      content_processed: (metrics.processingStatus as Record<string, unknown> | null)?.content_processed ?? false,
      audio_processed: (metrics.processingStatus as Record<string, unknown> | null)?.audio_processed ?? false,
      insights_generated: (metrics.processingStatus as Record<string, unknown> | null)?.insights_generated ?? false,
      content_metrics: metrics.contentMetrics,
      delivery_metrics: metrics.deliveryMetrics,
      performance_insights: metrics.performanceInsights,
      processing_errors: (metrics.processingStatus as Record<string, unknown> | null)?.processing_errors,
      updated_at: metrics.updatedAt,
    })
  } catch (error) {
    console.error('Error fetching advanced metrics:', error)
    res.status(500).json({ error: 'Failed to fetch advanced metrics' })
  }
}
