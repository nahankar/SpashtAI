import { ApiError, apiClient } from './api-client'
export const INTERVIEWS_API = '/api/interviews'
// Runs store multi-select choices '|'-joined; single values from older runs read the same.
export const selectionList = (stored: string) => stored.split('|').filter(Boolean)
export const selectionLabel = (stored: string, suffix = '') => selectionList(stored).map(v => v + suffix).join(', ')
export type InterviewSetup = { track: string[]; experienceBand: string[]; startingDifficulty: string[]; durationMinutes: number; recordingConsent: true }
export type InterviewAttempt = {
  id: string; index: number; status: 'PREPARED'|'ASKED'|'ANSWERED'|'SKIPPED'|'INCOMPLETE'; assistance: string;
  question: { text: string; track: string; topic: string; difficulty: string };
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
  // Pinned when the practice started with Interview conversation access; earlier runs stay manual.
  conversationMode?: boolean;
}
export type InterviewHistory = { id: string; sessionId: string; track: string; experienceBand: string; startingDifficulty: string;
  startedAt: string; endedAt: string|null; retainedAt: string|null; questionCount: number
  answeredCount?: number; skippedCount?: number; incompleteCount?: number }
export type InterviewOptions = { coverage: Array<{ track: string; experienceBand: string; difficulty: string; count: number }>; maxQuestions: number; consentVersion: string; evaluationAvailable?: boolean; conversationAvailable?: boolean }
/** Coordinator states published by the interviewer agent in conversation practices. */
export type ConversationState = 'asking'|'listening'|'candidate_end'|'confirming'|'saving'|'preparing'|'waiting'|''
export const CONVERSATION_STOP_REASONS = ['PRACTICE_DURATION_REACHED', 'PRACTICE_QUESTION_LIMIT', 'QUESTION_BANK_EXHAUSTED']
export function conversationStatus(state: ConversationState, reason: string, hold: boolean): string {
  if (state === 'asking') return 'The interviewer is reading the question.'
  if (state === 'confirming') return 'Confirming your final words…'
  if (state === 'saving') return 'Saving your answer…'
  if (state === 'preparing') return 'Preparing the next question…'
  if (state === 'waiting') return CONVERSATION_STOP_REASONS.includes(reason)
    ? 'This practice has no more questions. End practice to review your answers.'
    : reason === 'CONVERSATION_UNAVAILABLE' ? 'Automatic conversation is no longer available for this practice. Continue with the controls below.'
    : 'Automatic progression has stopped. Choose Continue (or Next question) to retry, or end practice. Your saved answers are safe.'
  if (state === 'candidate_end') return 'Pause noticed. Keep talking if you have more to add; otherwise your answer is saved in a few seconds.'
  if (state === 'listening') {
    if (hold) return 'Listening. Automatic finish is off for this answer; choose Finish answer when you are done.'
    if (['SPEECH_UNCONFIRMED', 'TRANSCRIPT_PENDING'].includes(reason)) return 'Listening. Some speech has not been transcribed yet; choose Finish answer when you are done.'
    if (reason === 'NO_SPEECH') return 'Listening. No answer has been heard yet. Speak your answer, or choose Skip question.'
    if (reason === 'SAVE_FAILED') return 'Listening. Your last words could not be saved yet; choose Finish answer to retry.'
    return 'Listening. Thinking pauses are fine. When you have finished, stay quiet for about 5 seconds or choose Finish answer.'
  }
  return 'Waiting for the interviewer…'
}
export type CaptureAction = 'FINISH'|'SKIP'|'PAUSE'|'LEAVE'
export type InterviewOperation = 'saving'|'preparing'|'waiting'|null
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
  if (code === 'NO_SPEECH') return NO_SPEECH_HELP
  return code === 'TRANSCRIPT_PENDING'
    ? 'Your final speech is still being transcribed. Your microphone is muted; retry saving in a moment.'
    : 'Your speech could not be confirmed as saved. Your microphone is muted; retry before continuing.'
}
export function interviewCompletionMessage(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409 &&
    ['QUESTION_BANK_EXHAUSTED', 'PRACTICE_DURATION_REACHED', 'PRACTICE_QUESTION_LIMIT'].includes(error.code ?? '')
    ? error.message : null
}
/** A capture failure with its agent code, so the UI can offer the matching recovery. */
export class CaptureError extends Error {
  constructor(public code?: string) { super(captureFailure(code)) }
}
export const NO_SPEECH_HELP = 'No answer has been heard for this question yet. Your microphone is on: speak your answer, or choose Skip question.'
export const UNCONFIRMED_SPEECH_HELP = 'Some speech could not be confirmed as transcribed. Retry saving, or save only the confirmed speech (the unconfirmed part will not be included).'
export async function confirmedInterviewDrain(port: {
  seal(): Promise<void>; mute(): Promise<void>;
  rpc(payload: { action: CaptureAction; requestId: string; acceptUnresolved?: true }): Promise<string>;
  verify(id: string): Promise<CaptureReceipt>;
}, action: CaptureAction, requestId: string, attemptId: string, segmentId: string, options: { acceptUnresolved?: boolean } = {}) {
  if (action === 'PAUSE' || action === 'LEAVE') await port.seal()
  await port.mute()
  // acceptUnresolved is only ever the learner's explicit choice after TRANSCRIPT_PENDING.
  const result = JSON.parse(await port.rpc({ action, requestId, ...(options.acceptUnresolved && action !== 'SKIP' ? { acceptUnresolved: true as const } : {}) })) as { error?: string; receiptId?: string }
  if (result.error || !result.receiptId) throw new CaptureError(result.error)
  const receipt = await port.verify(result.receiptId)
  // Pause and End seal the segment at whichever answer the interviewer holds, which can be one the page
  // has not refreshed to yet; Finish and Skip must name the answer on screen.
  const sameAnswer = action === 'PAUSE' || action === 'LEAVE' || receipt.attemptId === attemptId
  if (receipt.action !== action || !sameAnswer || receipt.segmentId !== segmentId || receipt.id !== requestId) {
    throw new Error('Speech-save confirmation belongs to another action. Retry saving.')
  }
  return receipt
}
