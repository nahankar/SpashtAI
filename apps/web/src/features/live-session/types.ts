export interface ChatMessage {
  id?: string
  role: string
  content: string
  timestamp: string
}

export type AudioStatus = 'available' | 'pending' | 'failed' | 'unavailable'
export type CaptureReport = 'uploaded' | 'pending' | 'failed' | 'unavailable'
export interface RecorderPort {
  seal(): Promise<void>
  finalize(): Promise<{ ok: boolean; audioCapture: CaptureReport }>
  waitForFinalization(): Promise<{ ok: boolean; audioCapture: CaptureReport }>
  retryUpload(): Promise<{ ok: boolean; audioCapture: CaptureReport }>
  discard(): Promise<void>
}
export interface LaunchConfig {
  sessionName: string; focusArea: string; focusContext: string; boothDemo: boolean
  preparationId?: string | null; stageId?: string | null
  preparationPending?: boolean; preparationError?: string | null
}
export interface LiveSessionState {
  sessionId: string | null; segmentId: string | null; roomName: string
  token: string | null; url: string | null
  isJoining: boolean; isResuming: boolean; isPausing: boolean; isLeaving: boolean
  isSessionPaused: boolean; pauseReason: 'intentional' | 'disconnected' | null
  pauseAudioFailure: 'failed' | 'unavailable' | null
  assistantState: 'restarting' | 'ready' | 'recovering' | 'unknown'
}
export interface ActivityAdapter {
  kind: 'elevate' | 'prepare'
  preparationId: string | null
  creationBody(id: string, startedAt: string): Record<string, unknown>
  cleanupFailedJoin(id: string, linked: boolean): Promise<void>
  discard(id: string): Promise<void>
  trackPulse: boolean; skipPulseCall: boolean
  endBody(endedAt: string): Record<string, unknown>
  complete(id: string, capture: CaptureReport, effects: LiveSessionEffects, now: () => Date): Promise<void>
}
export interface LiveSessionEffects {
  resetMetrics(): void; clearMessages(): void; hideHistory(): void
  sessionChanged(id: string | null): void
  toast(kind: 'info' | 'error' | 'success', message: string): void
  log(kind: 'event' | 'error', name: string, data: unknown): void
  messages(): readonly { id?: string; role: string; content: string }[]
  addMessage(role: 'user' | 'assistant', text: string, id?: string, persist?: boolean): Promise<void>
  upsertStreamingMessage(role: 'user' | 'assistant', text: string, id: string): void
  clearActiveSession(): void
  rewardPoints(points: number): void
  left(id: string | null, trackPulse: boolean): void
  discarded(id: string): void
  discardFinished(): void
}
