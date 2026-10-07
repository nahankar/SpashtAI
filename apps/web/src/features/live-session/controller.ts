import type { LiveSessionApi } from './api'
import type { ActivityAdapter, LaunchConfig, LiveSessionEffects, LiveSessionState, ChatMessage } from './types'
import { stripThinkingBlocks } from '@/lib/stripThinking'

export interface ControllerDependencies {
  api: LiveSessionApi; now(): Date; random(): number
  effects: LiveSessionEffects
}
export class LiveSessionController {
  private state: LiveSessionState = {
    sessionId: null, segmentId: null, roomName: '', token: null, url: null,
    isJoining: false, isResuming: false, isPausing: false, isLeaving: false,
    isSessionPaused: false, pauseReason: null, pauseAudioFailure: null, assistantState: 'unknown',
  }
  private listeners = new Set<() => void>()
  private resumeGeneration = 0
  constructor(privateDeps: ControllerDependencies) { this.deps = privateDeps }
  private deps: ControllerDependencies
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  patch = (update: Partial<LiveSessionState>) => {
    const previous = this.state.sessionId
    this.state = { ...this.state, ...update }
    if (this.state.sessionId !== previous) this.deps.effects.sessionChanged(this.state.sessionId)
    for (const listener of this.listeners) listener()
  }
  private roomName() { return `room_${this.deps.now().getTime()}_${this.deps.random().toString(36).substr(2, 5)}` }
  private query(config: LaunchConfig, sessionId: string, segmentId: string, room: string) {
    const query: Record<string, string> = { identity: config.identity, room, sessionId, segmentId, userName: config.userName }
    if (config.focusArea) query.focusArea = config.focusArea
    if (config.focusContext) query.focusContext = config.focusContext
    if (config.sessionName.trim()) query.sessionName = config.sessionName.trim()
    if (config.boothDemo || config.focusArea === 'snapshot') query.boothDemo = '1'
    return query
  }
  async start(config: LaunchConfig, adapter: ActivityAdapter) {
    if (this.state.isJoining) return
    this.patch({ isJoining: true })
    let id: string | null = null; let segment: string | null = null; let linked = false
    try {
      if (config.preparationPending) throw new Error(config.preparationError || 'Interview journey is still loading')
      id = `session_${this.deps.now().getTime()}_${this.deps.random().toString(36).substr(2, 9)}`
      const room = this.state.roomName || this.roomName()
      const response = await this.deps.api.request('/sessions', { method: 'POST', body: JSON.stringify(adapter.creationBody(id, this.deps.now().toISOString())) })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create Elevate session')
      }
      linked = adapter.kind === 'prepare'
      segment = await this.deps.api.createSessionSegment(id, room)
      const connection = await this.deps.api.fetchLiveToken(this.query(config, id, segment, room))
      this.patch({ token: connection.token, url: connection.url, sessionId: id, roomName: room, segmentId: segment,
        isSessionPaused: false, pauseReason: null })
      this.deps.effects.resetMetrics()
      this.deps.effects.log('event', 'elevate.session_join', { sessionId: id, focusArea: config.focusArea || null })
    } catch (error) {
      if (id && segment) await this.deps.api.closeSessionSegment(id, segment, 'unavailable').catch(() => undefined)
      if (id) await adapter.cleanupFailedJoin(id, linked)
      this.deps.effects.log('error', 'elevate.session_join_failed', error)
      this.deps.effects.toast('error', error instanceof Error ? error.message : 'Failed to start session')
    } finally { this.patch({ isJoining: false }) }
  }
  async resume(sessionId: string, config: LaunchConfig, signal?: AbortSignal, fromHistory = false) {
    // An aborted Strict Mode attempt must not block its replacement attempt.
    if (this.state.isResuming && !fromHistory) return
    const generation = ++this.resumeGeneration
    this.patch({ isResuming: true })
    let segment: string | null = null
    const cancelled = () => signal?.aborted || generation !== this.resumeGeneration
    try {
      if (cancelled()) return
      const room = this.roomName()
      segment = await this.deps.api.createSessionSegment(sessionId, room)
      if (cancelled()) return
      const connection = await this.deps.api.fetchLiveToken(this.query(config, sessionId, segment, room), signal)
      if (cancelled()) return
      this.patch({ sessionId, token: connection.token, url: connection.url, roomName: room, segmentId: segment,
        isSessionPaused: false, ...(fromHistory ? {} : { pauseReason: null, pauseAudioFailure: null }) })
      segment = null
      this.deps.effects.resetMetrics()
    } catch (error) { if (!cancelled()) throw error }
    finally {
      if (segment) await this.deps.api.closeSessionSegment(sessionId, segment, 'unavailable').catch(() => undefined)
      if (generation === this.resumeGeneration) this.patch({ isResuming: false })
    }
  }
  handleMessage(message: Pick<ChatMessage, 'id' | 'role' | 'content'> & { partial?: boolean }) {
    if (this.state.isSessionPaused) return
    let content = message.content?.trim() || ''
    if (message.role === 'assistant') content = stripThinkingBlocks(content)
    if (!content || content === '[]' || content.length < 2) return
    const room = this.state.roomName
    const id = message.id ? (room ? `${room}::${message.id}` : message.id) : undefined
    const role = message.role as 'user' | 'assistant'
    if (message.role === 'user' && message.id?.startsWith('user_turn_')) {
      if (message.partial) this.deps.effects.upsertStreamingMessage('user', content, id!)
      else void this.deps.effects.addMessage('user', content, id!, false)
      return
    }
    if (message.partial) { this.deps.effects.upsertStreamingMessage(role, content, id || `stream_${room}_${role}`); return }
    if (this.deps.effects.messages().some(m => m.role === role && m.content === content && (id ? m.id === id : true))) return
    void this.deps.effects.addMessage(role, content, id, false)
  }
}
