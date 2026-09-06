import {
  Prisma,
  PreparationStageStatus,
  PreparationStatus,
  type Preparation,
  type PreparationStage,
} from '@prisma/client'
import { Router, type Request, type Response } from 'express'
import type { ZodError } from 'zod'
import { prisma } from '../lib/prisma'
import { reqLog } from '../lib/logger'
import { getOwnedPreparation, lockOwnedPreparation } from '../lib/prepareAccess'
import {
  createPreparationSchema,
  createStageSchema,
  reorderStagesSchema,
  updatePreparationSchema,
  updateStageSchema,
} from '../lib/prepareSchemas'
import {
  deriveStageSummary,
  MAX_PREPARATION_STAGES,
  sameInstant,
} from '../lib/prepareStages'
import {
  createInterviewJourney,
  preparationInclude,
} from '../services/preparations/createInterviewJourney'

const router = Router()

function userId(req: Request): string {
  return req.user!.userId
}

function withStageSummary<T extends { stages: PreparationStage[] }>(preparation: T) {
  return { ...preparation, ...deriveStageSummary(preparation.stages) }
}

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Company',
  roleTitle: 'Role',
  interviewDate: 'Interview date',
  currentStageType: 'Round',
  jobDescriptionText: 'Job description',
  resumeText: 'Profile / resume',
  resumeLabel: 'Profile label',
  interviewerName: 'Interviewer name',
  interviewerRole: 'Interviewer role',
  interviewerProfileText: 'Interviewer profile details',
  name: 'Stage name',
  scheduledAt: 'Scheduled date',
}

function validationError(res: Response, error: ZodError) {
  const flattened = error.flatten()
  const message =
    Object.entries(flattened.fieldErrors)
      .map(([field, errors]) => `${FIELD_LABELS[field] ?? field}: ${errors?.[0]}`)
      .join('. ') ||
    flattened.formErrors[0] ||
    'Invalid request'
  return res.status(400).json({ error: message, details: flattened })
}

router.get('/', async (req, res) => {
  try {
    const preparations = await prisma.preparation.findMany({
      where: { userId: userId(req) },
      include: preparationInclude,
      orderBy: { updatedAt: 'desc' },
    })
    const enriched = preparations
      .map(withStageSummary)
      .sort((a, b) => {
        const aDate = a.nextStage?.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER
        const bDate = b.nextStage?.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER
        return aDate - bDate || b.updatedAt.getTime() - a.updatedAt.getTime()
      })
    res.json({ preparations: enriched })
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to list preparations')
    res.status(500).json({ error: 'Failed to load preparations' })
  }
})

router.post('/', async (req, res) => {
  const parsed = createPreparationSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error)

  try {
    const preparation = await createInterviewJourney(userId(req), {
      ...parsed.data,
      interviewDate: parsed.data.interviewDate ?? null,
      currentStageType: parsed.data.currentStageType ?? null,
      jobDescriptionText: parsed.data.jobDescriptionText ?? null,
      resumeText: parsed.data.resumeText ?? null,
      resumeLabel: parsed.data.resumeLabel ?? null,
      interviewerName: parsed.data.interviewerName ?? null,
      interviewerRole: parsed.data.interviewerRole ?? null,
      interviewerProfileText: parsed.data.interviewerProfileText ?? null,
    })
    reqLog(req).info(
      { event: 'prepare.created', preparationId: preparation.id },
      'Interview journey created',
    )
    res.status(201).json({ preparation: withStageSummary(preparation) })
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to create preparation')
    res.status(500).json({ error: 'Failed to create preparation' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const preparation = await getOwnedPreparation(userId(req), req.params.id)
    if (!preparation) return res.status(404).json({ error: 'Not found' })
    res.json({ preparation: withStageSummary(preparation) })
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to get preparation')
    res.status(500).json({ error: 'Failed to load preparation' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = updatePreparationSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error)

  try {
    const existing = await getOwnedPreparation(userId(req), req.params.id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const {
      status,
      companyName,
      roleTitle,
      interviewDate,
      jobDescriptionText,
      resumeText,
      resumeLabel,
    } = parsed.data
    const nextCompany = companyName ?? existing.interview!.companyName
    const nextRole = roleTitle ?? existing.interview!.roleTitle
    const terminal = status && status !== PreparationStatus.ACTIVE && status !== PreparationStatus.PAUSED
    const dateChanged =
      interviewDate !== undefined &&
      !sameInstant(existing.interview?.interviewDate, interviewDate)
    const nextStage = dateChanged ? deriveStageSummary(existing.stages).nextStage : null

    const preparation = await prisma.preparation.update({
      where: { id: existing.id },
      data: {
        ...(status
          ? {
              status,
              completedAt: terminal ? new Date() : null,
            }
          : {}),
        ...(companyName || roleTitle ? { title: `${nextCompany} — ${nextRole}` } : {}),
        interview: {
          update: {
            ...(companyName !== undefined ? { companyName } : {}),
            ...(roleTitle !== undefined ? { roleTitle } : {}),
            ...(interviewDate !== undefined ? { interviewDate } : {}),
            ...(jobDescriptionText !== undefined ? { jobDescriptionText } : {}),
            ...(resumeText !== undefined ? { resumeText } : {}),
            ...(resumeLabel !== undefined ? { resumeLabel } : {}),
          },
        },
        ...(nextStage
          ? {
              stages: {
                update: {
                  where: { id: nextStage.id },
                  data: {
                    scheduledAt: interviewDate,
                    status: interviewDate
                      ? PreparationStageStatus.SCHEDULED
                      : PreparationStageStatus.UPCOMING,
                  },
                },
              },
            }
          : {}),
      },
      include: preparationInclude,
    })
    res.json({ preparation: withStageSummary(preparation) })
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to update preparation')
    res.status(500).json({ error: 'Failed to update preparation' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const result = await prisma.preparation.deleteMany({
      where: { id: req.params.id, userId: userId(req) },
    })
    if (result.count === 0) return res.status(404).json({ error: 'Not found' })
    res.status(204).send()
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to delete preparation')
    res.status(500).json({ error: 'Failed to delete preparation' })
  }
})

router.post('/:id/stages', async (req, res) => {
  const parsed = createStageSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error)

  try {
    const stage = await prisma.$transaction(async (tx) => {
      if (!(await lockOwnedPreparation(tx, userId(req), req.params.id))) return null
      const count = await tx.preparationStage.count({
        where: { preparationId: req.params.id },
      })
      if (count >= MAX_PREPARATION_STAGES) {
        throw new Error('STAGE_LIMIT')
      }
      const last = await tx.preparationStage.findFirst({
        where: { preparationId: req.params.id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      })
      const scheduledAt = parsed.data.scheduledAt ?? null
      const status =
        parsed.data.status ??
        (scheduledAt ? PreparationStageStatus.SCHEDULED : PreparationStageStatus.UPCOMING)
      return tx.preparationStage.create({
        data: {
          preparationId: req.params.id,
          ...parsed.data,
          status,
          sequence: (last?.sequence ?? -1) + 1,
          scheduledAt,
          interviewerName: parsed.data.interviewerName ?? null,
          interviewerRole: parsed.data.interviewerRole ?? null,
          interviewerProfileText: parsed.data.interviewerProfileText ?? null,
        },
      })
    })
    if (!stage) return res.status(404).json({ error: 'Not found' })
    res.status(201).json({ stage })
  } catch (error) {
    if (error instanceof Error && error.message === 'STAGE_LIMIT') {
      return res.status(400).json({ error: 'A journey can have at most 30 stages' })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Stage order conflict. Try again.' })
    }
    reqLog(req).error({ err: error }, 'Failed to add preparation stage')
    res.status(500).json({ error: 'Failed to add stage' })
  }
})

router.patch('/:id/stages/:stageId', async (req, res) => {
  const parsed = updateStageSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error)

  try {
    const stage = await prisma.preparationStage.findFirst({
      where: {
        id: req.params.stageId,
        preparationId: req.params.id,
        preparation: { userId: userId(req) },
      },
    })
    if (!stage) return res.status(404).json({ error: 'Not found' })

    const effectiveStatus =
      parsed.data.status ??
      (stage.status === PreparationStageStatus.UPCOMING ||
      stage.status === PreparationStageStatus.SCHEDULED
        ? parsed.data.scheduledAt instanceof Date
          ? PreparationStageStatus.SCHEDULED
          : parsed.data.scheduledAt === null &&
              stage.status === PreparationStageStatus.SCHEDULED
            ? PreparationStageStatus.UPCOMING
            : undefined
        : undefined)
    const completedAt =
      parsed.data.completedAt !== undefined
        ? parsed.data.completedAt
        : effectiveStatus === PreparationStageStatus.COMPLETED
          ? new Date()
          : effectiveStatus
            ? null
            : undefined
    const updated = await prisma.preparationStage.update({
      where: { id: stage.id },
      data: {
        ...parsed.data,
        ...(effectiveStatus ? { status: effectiveStatus } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
      },
    })
    res.json({ stage: updated })
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to update preparation stage')
    res.status(500).json({ error: 'Failed to update stage' })
  }
})

router.delete('/:id/stages/:stageId', async (req, res) => {
  try {
    const stage = await prisma.preparationStage.findFirst({
      where: {
        id: req.params.stageId,
        preparationId: req.params.id,
        preparation: { userId: userId(req) },
      },
      select: { id: true },
    })
    if (!stage) return res.status(404).json({ error: 'Not found' })
    await prisma.preparationStage.delete({ where: { id: stage.id } })
    res.status(204).send()
  } catch (error) {
    reqLog(req).error({ err: error }, 'Failed to delete preparation stage')
    res.status(500).json({ error: 'Failed to delete stage' })
  }
})

router.post('/:id/stages/reorder', async (req, res) => {
  const parsed = reorderStagesSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error)

  try {
    const park = 10_000
    const preparation = await prisma.$transaction(async (tx) => {
      if (!(await lockOwnedPreparation(tx, userId(req), req.params.id))) {
        throw new Error('NOT_FOUND')
      }
      const stages = await tx.preparationStage.findMany({
        where: { preparationId: req.params.id },
        select: { id: true },
      })
      const expected = new Set(stages.map((stage) => stage.id))
      const supplied = new Set(parsed.data.stageIds)
      const exactMatch =
        expected.size === supplied.size &&
        supplied.size === parsed.data.stageIds.length &&
        [...expected].every((id) => supplied.has(id))
      if (!exactMatch) {
        throw new Error('STAGE_ORDER')
      }
      for (const [index, id] of parsed.data.stageIds.entries()) {
        await tx.preparationStage.update({
          where: { id },
          data: { sequence: park + index },
        })
      }
      for (const [index, id] of parsed.data.stageIds.entries()) {
        await tx.preparationStage.update({
          where: { id },
          data: { sequence: index },
        })
      }
      return tx.preparation.findFirst({
        where: { id: req.params.id, userId: userId(req) },
        include: preparationInclude,
      })
    })
    res.json({ preparation: withStageSummary(preparation!) })
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Not found' })
    }
    if (error instanceof Error && error.message === 'STAGE_ORDER') {
      return res.status(400).json({ error: 'Stage order must include every journey stage exactly once' })
    }
    reqLog(req).error({ err: error }, 'Failed to reorder preparation stages')
    res.status(500).json({ error: 'Failed to reorder stages' })
  }
})

export default router
