import { ApiError, apiClient } from './api-client'
export const INTERVIEWS_API = '/api/interviews'
// Runs store multi-select choices '|'-joined; single values from older runs read the same.
export const selectionList = (stored: string) => stored.split('|').filter(Boolean)
export const selectionLabel = (stored: string, suffix = '') => selectionList(stored).map(v => v + suffix).join(', ')
export type InterviewSetup = { track: string[]; experienceBand: string[]; startingDifficulty: string[]; durationMinutes: number; recordingConsent: true }
export type InterviewAttempt = {
  id: string; index: number; status: 'PREPARED'|'ASKED'|'ANSWERED'|'SKIPPED'|'INCOMPLETE'; assistance: string;
  question: { text: string; track: string; topic: string; difficulty: string; expectedDepth: string };
  capturedText: string; completionReason: string|null;
  askedAt?: string|null;
  capturedParts?: Array<{ segmentId: string; sourceTurnId: string; text: string; createdAt: string }>;
  answer: { answerText: string; textSource: string; textRevision: number; assistance: string }|null;
}
export type InterviewRun = {
  id: string; sessionId: string; track: string; experienceBand: string; startingDifficulty: string; durationMinutes: number;
  startedAt: string; endedAt: string|null; retainedAt: string|null; recordingConsentAt: string|null; recordingConsentVersion: string|null;
  attempts: InterviewAttempt[];
  evaluationEnabled?: boolean;
}
export type InterviewHistory = { id: string; sessionId: string; track: string; experienceBand: string; startingDifficulty: string;
  startedAt: string; endedAt: string|null; retainedAt: string|null; questionCount: number }
export type InterviewOptions = { coverage: Array<{ track: string; experienceBand: string; difficulty: string; count: number }>; maxQuestions: number; consentVersion: string; evaluationAvailable?: boolean }
export type CaptureAction = 'FINISH'|'SKIP'|'PAUSE'|'LEAVE'
export type InterviewOperation = 'saving'|'preparing'|null
export type CaptureReceipt = { id: string; attemptId: string; segmentId: string; action: CaptureAction }
export const interviewPath = (id: string) => `${INTERVIEWS_API}/runs/${encodeURIComponent(id)}`
export const interviewPlaybackPath = (sessionId: string) => `/interviews/playback/${encodeURIComponent(sessionId)}`
export const interviewHistoryPath = (run: Pick<InterviewHistory, 'id' | 'sessionId' | 'endedAt'>) =>
  run.endedAt ? interviewPlaybackPath(run.sessionId) : `/interviews?run=${encodeURIComponent(run.id)}`
export function getInterview(id: string, signal?: AbortSignal) { return apiClient<InterviewRun>(interviewPath(id), { signal }) }
export function interviewWrite<T>(path: string, body: unknown = {}, method = 'POST') {
  return apiClient<T>(`${INTERVIEWS_API}${path}`, { method, body: JSON.stringify(body) })
}
export function captureFailure(code?: string) {
  if (code === 'VOICE_DISCONNECTED') return 'The interviewer disconnected. Your saved answers are safe. Reconnect the interviewer to continue.'
  return code === 'TRANSCRIPT_PENDING'
    ? 'Your final speech is still being transcribed. Your microphone is muted; retry saving in a moment.'
    : 'Your speech could not be confirmed as saved. Your microphone is muted; retry before continuing.'
}
export function interviewCompletionMessage(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409 &&
    ['QUESTION_BANK_EXHAUSTED', 'PRACTICE_DURATION_REACHED', 'PRACTICE_QUESTION_LIMIT'].includes(error.code ?? '')
    ? error.message : null
}
export async function confirmedInterviewDrain(port: {
  seal(): Promise<void>; mute(): Promise<void>;
  rpc(payload: { action: CaptureAction; requestId: string }): Promise<string>;
  verify(id: string): Promise<CaptureReceipt>;
}, action: CaptureAction, requestId: string, attemptId: string, segmentId: string) {
  if (action === 'PAUSE' || action === 'LEAVE') await port.seal()
  await port.mute()
  const result = JSON.parse(await port.rpc({ action, requestId })) as { error?: string; receiptId?: string }
  if (result.error || !result.receiptId) throw new Error(captureFailure(result.error))
  const receipt = await port.verify(result.receiptId)
  if (receipt.action !== action || receipt.attemptId !== attemptId || receipt.segmentId !== segmentId || receipt.id !== requestId) {
    throw new Error('Speech-save confirmation belongs to another action. Retry saving.')
  }
  return receipt
}
