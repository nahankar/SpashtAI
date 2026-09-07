import { apiClient, getAuthHeaders } from '@/lib/api-client'
import type {
  InterviewOutcome,
  InterviewQuestion,
  InterviewQuestionSource,
  InterviewRating,
  Preparation,
  PreparationStageStatus,
  PreparationStageType,
  PreparationStatus,
  StageReflection,
} from '@/lib/prepare-types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export type CreatePreparationInput = {
  companyName: string
  roleTitle: string
  interviewDate?: string | null
  currentStageType?: PreparationStageType | null
  jobDescriptionText?: string | null
  resumeText?: string | null
  resumeLabel?: string | null
  interviewerName?: string | null
  interviewerRole?: string | null
  interviewerProfileText?: string | null
}

export async function listPreparations(): Promise<Preparation[]> {
  const data = await apiClient<{ preparations: Preparation[] }>('/api/preparations')
  return data.preparations
}

export async function getPreparation(id: string): Promise<Preparation> {
  const data = await apiClient<{ preparation: Preparation }>(
    `/api/preparations/${encodeURIComponent(id)}`,
  )
  return data.preparation
}

export async function createPreparation(input: CreatePreparationInput): Promise<Preparation> {
  const data = await apiClient<{ preparation: Preparation }>('/api/preparations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.preparation
}

export async function updatePreparation(
  id: string,
  input: Partial<
    Pick<
      CreatePreparationInput,
      | 'companyName'
      | 'roleTitle'
      | 'interviewDate'
      | 'jobDescriptionText'
      | 'resumeText'
      | 'resumeLabel'
    >
  > & { status?: PreparationStatus },
): Promise<Preparation> {
  const data = await apiClient<{ preparation: Preparation }>(
    `/api/preparations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
  return data.preparation
}

export async function updatePreparationStage(
  preparationId: string,
  stageId: string,
  input: {
    name?: string
    type?: PreparationStageType
    status?: PreparationStageStatus
    scheduledAt?: string | null
    interviewerName?: string | null
    interviewerRole?: string | null
    interviewerProfileText?: string | null
  },
) {
  await apiClient(
    `/api/preparations/${encodeURIComponent(preparationId)}/stages/${encodeURIComponent(stageId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
}

export async function addPreparationStage(
  preparationId: string,
  input: { type: PreparationStageType; name: string },
) {
  await apiClient(`/api/preparations/${encodeURIComponent(preparationId)}/stages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function reorderPreparationStages(
  preparationId: string,
  stageIds: string[],
): Promise<Preparation> {
  const data = await apiClient<{ preparation: Preparation }>(
    `/api/preparations/${encodeURIComponent(preparationId)}/stages/reorder`,
    { method: 'POST', body: JSON.stringify({ stageIds }) },
  )
  return data.preparation
}

export async function deletePreparationStage(preparationId: string, stageId: string) {
  const response = await fetch(
    `${API_BASE}/api/preparations/${encodeURIComponent(preparationId)}/stages/${encodeURIComponent(stageId)}`,
    { method: 'DELETE', headers: getAuthHeaders() },
  )
  if (!response.ok) throw new Error('Failed to remove stage')
}

export async function deletePreparation(id: string) {
  const response = await fetch(`${API_BASE}/api/preparations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!response.ok) throw new Error('Failed to delete journey')
}

export type LogInterviewInput = {
  stageId: string
  rating?: InterviewRating | null
  outcome?: InterviewOutcome | null
  wentWell?: string | null
  difficulties?: string | null
  surprisedBy?: string | null
  feedbackReceived?: string | null
  nextRoundHints?: string | null
  questionsText?: string | null
  nextStageScheduledAt?: string | null
}

export async function logInterview(
  preparationId: string,
  input: LogInterviewInput,
): Promise<Preparation> {
  const data = await apiClient<{ preparation: Preparation }>(
    `/api/preparations/${encodeURIComponent(preparationId)}/log-interview`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  return data.preparation
}

export async function addInterviewQuestion(
  preparationId: string,
  input: {
    questionText: string
    stageId?: string | null
    source?: InterviewQuestionSource
    notes?: string | null
  },
): Promise<InterviewQuestion> {
  const data = await apiClient<{ question: InterviewQuestion }>(
    `/api/preparations/${encodeURIComponent(preparationId)}/questions`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  return data.question
}

export async function deleteInterviewQuestion(preparationId: string, questionId: string) {
  const response = await fetch(
    `${API_BASE}/api/preparations/${encodeURIComponent(preparationId)}/questions/${encodeURIComponent(questionId)}`,
    { method: 'DELETE', headers: getAuthHeaders() },
  )
  if (!response.ok) throw new Error('Failed to delete question')
}

export async function updateStageReflection(
  preparationId: string,
  stageId: string,
  input: Partial<
    Pick<
      StageReflection,
      | 'rating'
      | 'outcome'
      | 'wentWell'
      | 'difficulties'
      | 'surprisedBy'
      | 'feedbackReceived'
      | 'nextRoundHints'
    >
  >,
): Promise<StageReflection> {
  const data = await apiClient<{ reflection: StageReflection }>(
    `/api/preparations/${encodeURIComponent(preparationId)}/stages/${encodeURIComponent(stageId)}/reflection`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
  return data.reflection
}
