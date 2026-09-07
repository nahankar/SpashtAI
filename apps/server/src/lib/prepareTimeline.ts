import {
  type InterviewQuestion,
  type PreparationStage,
  type StageReflection,
} from '@prisma/client'
import { PreparationStageStatus } from '@prisma/client'

export type PreparationTimelineKind =
  | 'stage_completed'
  | 'questions_added'
  | 'reflection'

export type PreparationTimelineItem = {
  at: Date
  kind: PreparationTimelineKind
  stageId: string | null
  stageName: string | null
  questionCount?: number
  rating?: StageReflection['rating']
  outcome?: StageReflection['outcome']
}

type StageForTimeline = Pick<
  PreparationStage,
  'id' | 'name' | 'status' | 'completedAt'
> & {
  reflection?: StageReflection | null
}

export function buildPreparationTimeline(
  stages: StageForTimeline[],
  questions: Pick<InterviewQuestion, 'stageId' | 'createdAt'>[],
): PreparationTimelineItem[] {
  const items: PreparationTimelineItem[] = []
  const nameById = new Map(stages.map((stage) => [stage.id, stage.name]))

  for (const stage of stages) {
    if (stage.status === PreparationStageStatus.COMPLETED && stage.completedAt) {
      items.push({
        at: stage.completedAt,
        kind: 'stage_completed',
        stageId: stage.id,
        stageName: stage.name,
      })
    }
    if (stage.reflection) {
      items.push({
        at: stage.reflection.updatedAt,
        kind: 'reflection',
        stageId: stage.id,
        stageName: stage.name,
        rating: stage.reflection.rating,
        outcome: stage.reflection.outcome,
      })
    }
  }

  const grouped = new Map<string | null, { count: number; at: Date }>()
  for (const question of questions) {
    const existing = grouped.get(question.stageId)
    if (!existing) {
      grouped.set(question.stageId, { count: 1, at: question.createdAt })
      continue
    }
    grouped.set(question.stageId, {
      count: existing.count + 1,
      at: question.createdAt > existing.at ? question.createdAt : existing.at,
    })
  }

  for (const [stageId, group] of grouped) {
    items.push({
      at: group.at,
      kind: 'questions_added',
      stageId,
      stageName: stageId ? nameById.get(stageId) ?? null : null,
      questionCount: group.count,
    })
  }

  return items.sort((a, b) => a.at.getTime() - b.at.getTime())
}
