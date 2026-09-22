import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  lockWritableSession,
  SessionDiscardedError,
  SessionMissingError,
} from '../lib/sessionDiscard'
import { resolveElevateAudioInputSignature } from '../analytics/insightProviders/resolveSessionAudio'
import { hasRealProsody } from '../analytics/audioStatus'

export function deliveryEvidenceQuality(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return -1
  const delivery = value as Record<string, unknown>
  const explicit = Number(delivery.evidence_quality)
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(3, explicit))
  if (Number(delivery.speech_rate) > 0 || Number(delivery.articulation_rate) > 0) return 2
  if (
    Number(delivery.pitch_variation) > 0 ||
    Number(delivery.energy_stability) > 0 ||
    Number(delivery.voice_quality_score) > 0
  ) {
    return 1
  }
  return 0
}

export function selectPreferredDeliveryMetrics(existing: unknown, incoming: unknown): unknown {
  const existingQuality = deliveryEvidenceQuality(existing)
  const incomingQuality = deliveryEvidenceQuality(incoming)
  if (existingQuality !== incomingQuality) {
    return existingQuality > incomingQuality ? existing : incoming
  }
  const evidenceCoverage = (value: unknown): [number, number] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [0, 0]
    const delivery = value as Record<string, unknown>
    const alignedWords = Number(delivery.aligned_word_count)
    const coverage = Number(
      delivery.alignment_coverage ?? delivery.timing_coverage ?? 0,
    )
    return [
      Number.isFinite(alignedWords) ? Math.max(0, alignedWords) : 0,
      Number.isFinite(coverage) ? Math.max(0, coverage) : 0,
    ]
  }
  const [existingWords, existingCoverage] = evidenceCoverage(existing)
  const [incomingWords, incomingCoverage] = evidenceCoverage(incoming)
  if (existingWords !== incomingWords) {
    return existingWords > incomingWords ? existing : incoming
  }
  return existingCoverage > incomingCoverage ? existing : incoming
}

export function isDeliverySignatureCurrent(
  supplied: string | null,
  current: string,
): boolean {
  return supplied !== null && supplied === current
}

export function resolveEffectiveDeliverySignature(
  supplied: string | null,
): string | null {
  // Authentication establishes who submitted a result; it does not establish
  // which audio that result analysed.  A delayed agent write can otherwise be
  // stamped with a newer pause/resume recording at receipt time.
  return supplied
}

/**
 * Quality ranking is only meaningful between results describing the same
 * recording. Stored metrics from a superseded audio input are not a candidate,
 * however rich they are.
 */
export function selectAcceptedDeliveryMetrics(input: {
  existing: unknown
  existingSignature: unknown
  currentSignature: string
  incoming: unknown
}): unknown {
  const comparableExisting =
    input.existingSignature === input.currentSignature ? input.existing : undefined
  return selectPreferredDeliveryMetrics(comparableExisting, input.incoming)
}

export function planDeliverySignatureUpdate(input: {
  suppliedSignature: string | null
  currentSignature: string
  existingSignature: unknown
}): 'accept' | 'preserve' | 'clear' {
  if (isDeliverySignatureCurrent(input.suppliedSignature, input.currentSignature)) {
    return 'accept'
  }
  return input.existingSignature === input.currentSignature ? 'preserve' : 'clear'
}

export function mergeAdvancedProcessingStatus(input: {
  previous: Record<string, unknown>
  incoming: Record<string, unknown>
  deliveryPresent: boolean
  deliveryUpdatePlan: 'accept' | 'preserve' | 'clear' | null
  effectiveSignature: string | null
  currentProsodyRemains: boolean
}): Record<string, unknown> {
  const incoming = { ...input.incoming }
  if (input.deliveryPresent && input.deliveryUpdatePlan !== 'accept') {
    delete incoming.audio_processed
    incoming.delivery_metrics_stale = input.deliveryUpdatePlan === 'clear'
    if (input.deliveryUpdatePlan === 'clear') {
      incoming.deliveryAudioInputSignature = null
    }
  } else if (input.deliveryUpdatePlan === 'accept') {
    incoming.delivery_metrics_stale = false
    incoming.deliveryAudioInputSignature = input.effectiveSignature
  }
  return {
    ...input.previous,
    ...incoming,
    audio_processed:
      input.deliveryUpdatePlan === 'clear'
        ? input.currentProsodyRemains
        : input.previous.audio_processed === true || incoming.audio_processed === true,
  }
}

export async function saveAdvancedMetrics(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const body = req.body as Record<string, unknown>
    const contentMetrics = body.contentMetrics ?? body.content_metrics
    const deliveryMetrics = body.deliveryMetrics ?? body.delivery_metrics
    const audioInputSignature =
      typeof body.audioInputSignature === 'string'
        ? body.audioInputSignature
        : typeof body.audio_input_signature === 'string'
          ? body.audio_input_signature
          : null
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

    const baseData: Prisma.SessionMetricsUpdateInput = {}
    if (contentMetrics !== undefined) {
      baseData.contentMetrics = contentMetrics as Prisma.InputJsonValue
    }
    if (deliveryMetrics !== undefined) {
      baseData.deliveryMetrics = deliveryMetrics as Prisma.InputJsonValue
    }
    if (performanceInsights !== undefined) {
      baseData.performanceInsights = performanceInsights as Prisma.InputJsonValue
    }

    const updated = await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      const existing = await tx.sessionMetrics.findUnique({
        where: { sessionId },
        select: {
          processingStatus: true,
          deliveryMetrics: true,
          communicationSignals: true,
        },
      })
      if (!existing) return null
      const data = { ...baseData }
      const previous =
        existing.processingStatus &&
        typeof existing.processingStatus === 'object' &&
        !Array.isArray(existing.processingStatus)
          ? (existing.processingStatus as Record<string, unknown>)
          : {}
      const currentAudioInputSignature =
        deliveryMetrics !== undefined
          ? await resolveElevateAudioInputSignature(sessionId, tx)
          : null
      // Legacy live agents do not know the server's segment fingerprint. The
      // internal-agent credential authenticates the writer, but cannot prove
      // which recording an asynchronously produced delivery result analysed.
      // Only a server-issued signature captured before analysis is evidence.
      const effectiveAudioInputSignature = resolveEffectiveDeliverySignature(
        audioInputSignature,
      )
      const deliveryUpdatePlan =
        deliveryMetrics !== undefined
          ? planDeliverySignatureUpdate({
              suppliedSignature: effectiveAudioInputSignature,
              currentSignature: currentAudioInputSignature ?? '',
              existingSignature: previous.deliveryAudioInputSignature,
            })
          : null
      if (deliveryUpdatePlan === 'accept') {
        data.deliveryMetrics = selectAcceptedDeliveryMetrics({
          existing: existing.deliveryMetrics,
          existingSignature: previous.deliveryAudioInputSignature,
          currentSignature: currentAudioInputSignature ?? '',
          incoming: deliveryMetrics,
        }) as Prisma.InputJsonValue
      } else if (deliveryMetrics !== undefined) {
        if (deliveryUpdatePlan === 'preserve') {
          delete data.deliveryMetrics
          delete data.performanceInsights
        } else {
          data.deliveryMetrics = Prisma.JsonNull
          data.performanceInsights = Prisma.JsonNull
        }
      }
      if (processingStatus !== undefined || deliveryMetrics !== undefined) {
        // Merge against the fresh row under the session lock. Advanced
        // reprocessing owns these flags, never the live pace contract.
        const currentProsodyRemains =
          hasRealProsody(existing.communicationSignals) &&
          previous.audioInputSignature === currentAudioInputSignature
        data.processingStatus = mergeAdvancedProcessingStatus({
          previous,
          incoming:
            processingStatus &&
            typeof processingStatus === 'object' &&
            !Array.isArray(processingStatus)
              ? (processingStatus as Record<string, unknown>)
              : {},
          deliveryPresent: deliveryMetrics !== undefined,
          deliveryUpdatePlan,
          effectiveSignature: effectiveAudioInputSignature,
          currentProsodyRemains,
        }) as Prisma.InputJsonValue
      }
      return tx.sessionMetrics.update({
        where: { sessionId },
        data,
      })
    })
    if (!updated) {
      return res.status(404).json({ error: 'Session metrics not found. Save basic metrics first.' })
    }

    res.json(updated)
  } catch (error) {
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
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
