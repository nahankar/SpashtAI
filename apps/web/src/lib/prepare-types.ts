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

export type InterviewQuestionSource =
  | 'ACTUAL_INTERVIEW'
  | 'PRACTICE'
  | 'USER_ENTERED'
  | 'AI_SUGGESTED'

export type InterviewOutcome = 'PASSED' | 'REJECTED' | 'PENDING' | 'UNKNOWN'

export type InterviewRating = 'VERY_POOR' | 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT'

export type StageReflection = {
  id: string
  stageId: string
  rating: InterviewRating | null
  outcome: InterviewOutcome | null
  wentWell: string | null
  difficulties: string | null
  surprisedBy: string | null
  feedbackReceived: string | null
  nextRoundHints: string | null
  updatedAt: string
}

export type InterviewQuestion = {
  id: string
  stageId: string | null
  questionText: string
  source: InterviewQuestionSource
  category: string | null
  topic: string | null
  difficulty: string | null
  notes: string | null
  askedAt: string | null
  createdAt: string
}

export type PreparationTimelineItem = {
  at: string
  kind: 'stage_completed' | 'questions_added' | 'reflection'
  stageId: string | null
  stageName: string | null
  questionCount?: number
  rating?: InterviewRating | null
  outcome?: InterviewOutcome | null
}

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
  reflection?: StageReflection | null
  questionCount?: number
  practiceCount?: number
}

export type PreparationPractice = {
  id: string
  preparationId: string
  stageId: string | null
  sessionId: string
  createdAt?: string
  session?: {
    sessionName: string | null
    focusArea: string | null
    startedAt: string
    endedAt: string | null
  }
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
  questions?: InterviewQuestion[]
  timeline?: PreparationTimelineItem[]
  practices?: PreparationPractice[]
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
  reflectionText: 8_000,
  questionsText: 20_000,
  questionText: 2_000,
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

export const INTERVIEW_RATINGS: Array<{ value: InterviewRating; label: string }> = [
  { value: 'VERY_POOR', label: 'Very poor' },
  { value: 'POOR', label: 'Poor' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'GOOD', label: 'Good' },
  { value: 'EXCELLENT', label: 'Excellent' },
]

export const INTERVIEW_OUTCOMES: Array<{ value: InterviewOutcome; label: string }> = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'UNKNOWN', label: 'Unknown' },
]

export function ratingLabel(rating: InterviewRating | null | undefined) {
  return INTERVIEW_RATINGS.find((option) => option.value === rating)?.label ?? null
}
