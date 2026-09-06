export type PreparationStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'OFFERED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'WITHDRAWN'

export type PreparationStageType =
  | 'APPLIED'
  | 'RECRUITER'
  | 'TECHNICAL'
  | 'BEHAVIORAL'
  | 'HIRING_MANAGER'
  | 'CASE_ASSIGNMENT'
  | 'LEADERSHIP'
  | 'HR'
  | 'OFFER'
  | 'CUSTOM'

export type PreparationStageStatus =
  | 'UPCOMING'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'SKIPPED'

export type PreparationStage = {
  id: string
  type: PreparationStageType
  name: string
  sequence: number
  status: PreparationStageStatus
  scheduledAt: string | null
  completedAt: string | null
  interviewerName: string | null
  interviewerRole: string | null
  interviewerProfileText: string | null
}

export type InterviewPreparation = {
  id: string
  companyName: string
  roleTitle: string
  jobDescriptionText: string | null
  interviewDate: string | null
  resumeText: string | null
  resumeLabel: string | null
}

export type Preparation = {
  id: string
  type: 'INTERVIEW'
  title: string
  status: PreparationStatus
  completedAt: string | null
  createdAt: string
  updatedAt: string
  interview: InterviewPreparation
  stages: PreparationStage[]
  lastCompletedStage: PreparationStage | null
  nextStage: PreparationStage | null
}

/** Mirrors PREPARE_TEXT_LIMITS on the server. */
export const PREPARE_TEXT_LIMITS = {
  companyName: 160,
  roleTitle: 200,
  resumeLabel: 160,
  stageName: 160,
  interviewerName: 160,
  interviewerRole: 200,
  jobDescriptionText: 30_000,
  resumeText: 30_000,
  interviewerProfileText: 20_000,
} as const

export const JOURNEY_FINISHED_STATUSES: PreparationStatus[] = [
  'OFFERED',
  'COMPLETED',
  'REJECTED',
  'WITHDRAWN',
]

export const ROUND_OPTIONS: Array<{
  type: PreparationStageType | null
  label: string
}> = [
  { type: 'RECRUITER', label: 'Recruiter' },
  { type: 'TECHNICAL', label: 'Technical' },
  { type: 'HIRING_MANAGER', label: 'Hiring Manager' },
  { type: 'LEADERSHIP', label: 'Leadership' },
  { type: 'HR', label: 'HR' },
  { type: null, label: 'Not sure' },
]
