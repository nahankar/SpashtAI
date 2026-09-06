import {
  PreparationStageStatus,
  PreparationStageType,
  type PreparationStage,
} from '@prisma/client'

export type StageSeed = {
  type: PreparationStageType
  name: string
  sequence: number
  status: PreparationStageStatus
  scheduledAt: Date | null
}

export const DEFAULT_INTERVIEW_STAGES: ReadonlyArray<
  Pick<StageSeed, 'type' | 'name'>
> = [
  { type: PreparationStageType.APPLIED, name: 'Applied' },
  { type: PreparationStageType.RECRUITER, name: 'Recruiter' },
  { type: PreparationStageType.TECHNICAL, name: 'Technical' },
  { type: PreparationStageType.HIRING_MANAGER, name: 'Hiring Manager' },
  { type: PreparationStageType.LEADERSHIP, name: 'Leadership' },
  { type: PreparationStageType.HR, name: 'HR' },
  { type: PreparationStageType.OFFER, name: 'Offer' },
]

export function buildDefaultStages(
  selectedType?: PreparationStageType,
  interviewDate?: Date,
): StageSeed[] {
  const stages = [...DEFAULT_INTERVIEW_STAGES]
  if (selectedType && !stages.some((stage) => stage.type === selectedType)) {
    const offerIndex = stages.findIndex((stage) => stage.type === PreparationStageType.OFFER)
    const name = selectedType
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
    stages.splice(Math.max(offerIndex, 0), 0, { type: selectedType, name })
  }
  const selectedIndex = selectedType
    ? stages.findIndex((stage) => stage.type === selectedType)
    : interviewDate
      ? 0
      : -1

  return stages.map((stage, sequence) => {
    const isSelected = sequence === selectedIndex
    return {
      ...stage,
      sequence,
      status:
        selectedIndex >= 0 && sequence < selectedIndex
          ? PreparationStageStatus.SKIPPED
          : isSelected && interviewDate
            ? PreparationStageStatus.SCHEDULED
            : PreparationStageStatus.UPCOMING,
      scheduledAt: isSelected && interviewDate ? interviewDate : null,
    }
  })
}

type StageSummaryInput = Pick<
  PreparationStage,
  'id' | 'type' | 'name' | 'sequence' | 'status' | 'scheduledAt' | 'completedAt'
>

export function deriveStageSummary(stages: StageSummaryInput[]) {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence)
  const completed = ordered.filter(
    (stage) => stage.status === PreparationStageStatus.COMPLETED,
  )
  const scheduled = ordered.filter(
    (stage) => stage.status === PreparationStageStatus.SCHEDULED,
  )

  return {
    lastCompletedStage: completed.at(-1) ?? null,
    nextStage:
      scheduled[0] ??
      ordered.find(
        (stage) =>
          stage.status === PreparationStageStatus.UPCOMING ||
          stage.status === PreparationStageStatus.SCHEDULED,
      ) ??
      null,
  }
}

export const MAX_PREPARATION_STAGES = 30

export function sameInstant(
  left: Date | null | undefined,
  right: Date | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.getTime() === right.getTime()
}
