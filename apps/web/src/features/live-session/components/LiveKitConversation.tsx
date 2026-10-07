import { useCallback, useEffect, useRef } from 'react'
import { useConnectionState, useRoomContext, useVoiceAssistant } from '@livekit/components-react'
import { RoomEvent, type RemoteParticipant } from 'livekit-client'
import type { LiveMetricsUpdate } from '@/hooks/useSessionMetrics'
import type { TurnMetrics } from '@/components/session/UserTurnMetrics'
import { stripThinkingBlocks } from '@/lib/stripThinking'
import type { ChatMessage } from '../types'
import { liveSessionApi } from '../browser'
const { saveSessionData } = liveSessionApi
export function LiveKitConversation({
  sessionId,
  isSessionPaused,
  onNewMessage,
  onStateChange,
  onRestart,
  onMetricsUpdate,
  onTurnMetrics,
}: {
  sessionId: string | null
  isSessionPaused: boolean
  onNewMessage: (message: ChatMessage & { partial?: boolean }) => void
  onStateChange: (state: 'restarting' | 'ready' | 'recovering' | 'unknown') => void
  onRestart: () => void
  onMetricsUpdate: (metrics: LiveMetricsUpdate) => void
  onTurnMetrics?: (text: string, metrics: TurnMetrics, turnIndex?: number) => void
}) {
  const connectionState = useConnectionState()
  const room = useRoomContext()
  const { agentTranscriptions } = useVoiceAssistant()
  const seenFragmentsRef = useRef<Map<string, string>>(new Map())
  const lastControlStateRef = useRef<string>('unknown')
  const onNewMessageRef = useRef(onNewMessage)
  const lastAgentStreamRef = useRef<{ id: string; text: string; final: boolean } | null>(null)
  const activeAssistantMsgIdRef = useRef<string | null>(null)

  useEffect(() => {
    lastAgentStreamRef.current = null
    activeAssistantMsgIdRef.current = null
    seenFragmentsRef.current.clear()
  }, [sessionId])

  useEffect(() => {
    onNewMessageRef.current = onNewMessage
  }, [onNewMessage])

  // Live typing indicator while coach speaks (finals come from lk.conversation)
  useEffect(() => {
    if (isSessionPaused || agentTranscriptions.length === 0) return
    const latest = agentTranscriptions[agentTranscriptions.length - 1]
    if (latest.final) return
    const text = stripThinkingBlocks(latest.text?.trim() || '')
    if (!text) return

    const streamId = activeAssistantMsgIdRef.current || latest.id || `agent-live-${Date.now()}`
    activeAssistantMsgIdRef.current = streamId

    onNewMessageRef.current({
      role: 'assistant',
      content: text,
      id: streamId,
      partial: true,
      timestamp: new Date().toISOString(),
    })
  }, [agentTranscriptions, isSessionPaused])

  const processPayload = useCallback(
    (payload: string, source: 'dataChannel' | 'roomEvent') => {
      try {
        const parsed = JSON.parse(payload) as {
          type?: string
          text?: string
          final?: boolean
          replace?: boolean
          id?: string
          timestamp?: number
        }

        if (!parsed?.type || !parsed?.text) {
          console.log('⚠️ Ignoring non-conversation payload', { parsed, source })
          return
        }

        // Coach speech is streamed via useVoiceAssistant agentTranscriptions
        if (parsed.type === 'assistant') return

        const key = parsed.id || `${parsed.type}`
        const existing = seenFragmentsRef.current.get(key) || ''

        if (parsed.replace) {
          console.log('♻️ Replacement message received', { key, source })
          seenFragmentsRef.current.delete(key)
          const role = parsed.type === 'assistant' ? 'assistant' : 'user'
          onNewMessageRef.current({ role, content: parsed.text, id: parsed.id, timestamp: new Date().toISOString() })
          return
        }

        const next = `${existing}${parsed.text}`

        if (parsed.final) {
          seenFragmentsRef.current.delete(key)
          const role = parsed.type === 'assistant' ? 'assistant' : 'user'
          onNewMessageRef.current({
            role,
            content: next,
            id: parsed.id || key,
            partial: false,
            timestamp: new Date().toISOString(),
          })
          return
        }

        seenFragmentsRef.current.set(key, next)
        const role = parsed.type === 'assistant' ? 'assistant' : 'user'
        onNewMessageRef.current({
          role,
          content: next,
          id: parsed.id || key,
          partial: true,
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.log('❌ LiveKit message parse error:', error, { payload, source })
      }
    },
    [],
  )



  // Detect agent participant joining as a secondary "ready" signal
  useEffect(() => {
    if (!room) return
    const check = (p: RemoteParticipant) => {
      const name = (p.name || '').toLowerCase()
      const identity = (p.identity || '').toLowerCase()
      if (name.includes('assistant') || identity.startsWith('agent')) {
        if (lastControlStateRef.current === 'unknown') {
          lastControlStateRef.current = 'ready'
          onStateChange('ready')
        }
      }
    }
    for (const p of room.remoteParticipants.values()) check(p)
    room.on(RoomEvent.ParticipantConnected, check)
    return () => { room.off(RoomEvent.ParticipantConnected, check) }
  }, [room, onStateChange])

  // Direct room event handling for data channels (more reliable than useDataChannel hooks)
  useEffect(() => {
    if (!room) return

    const handleData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (!topic) return

      if (isSessionPaused) {
        return
      }
      
      const text = new TextDecoder().decode(payload)
      console.log(`📨 Data channel received on ${topic}:`, text)
      
      // Process different topics
      switch (topic) {
        case 'lk.transcription':
          console.log('📱 LiveKit transcription received:', {
            participantId: participant?.identity,
            topic,
            connected: connectionState
          })
          processPayload(text, 'dataChannel')
          break
          
        case 'lk.control':
          try {
            const parsed = JSON.parse(text) as { type?: string; text?: string }
            if (parsed?.type === 'session_state' && parsed.text) {
              const stateText = parsed.text.toLowerCase()
              let state: 'restarting' | 'ready' | 'recovering' | 'unknown' = 'unknown'
              if (stateText.includes('ready')) state = 'ready'
              else if (stateText.includes('recovering')) state = 'recovering'
              else if (stateText.includes('restart')) state = 'restarting'

              if (lastControlStateRef.current !== state) {
                lastControlStateRef.current = state
                onStateChange(state)
                if (state === 'restarting') {
                  onRestart()
                }
              }
            }
          } catch (error) {
            console.log('⚠️ Invalid control payload', error)
          }
          break
          
        case 'lk.conversation':
          try {
            const conversationData = JSON.parse(text)
            console.log('💬 Conversation data received:', conversationData)

            if (conversationData.type === 'turn_metrics' && conversationData.turnMetrics) {
              onTurnMetrics?.(
                conversationData.text || '',
                conversationData.turnMetrics as TurnMetrics,
                typeof conversationData.turnIndex === 'number' ? conversationData.turnIndex : undefined,
              )
              break
            }
            
            // Final coach turns — one id per utterance from the agent
            if (conversationData.type === 'assistant') {
              const content = stripThinkingBlocks(
                conversationData.text || conversationData.content || '',
              )
              const timestamp = conversationData.timestamp
                ? new Date(conversationData.timestamp).toISOString()
                : new Date().toISOString()

              if (content) {
                // Reuse the live-streamed bubble's id so the authoritative
                // final REPLACES the streaming partial in place rather than
                // creating a second identical bubble. The live coach text is
                // streamed under activeAssistantMsgIdRef (from the TTS
                // transcription); the agent's own item id differs, so using it
                // here would never reconcile with the partial. Fall back to the
                // item id only when no live stream was active for this turn.
                const finalId =
                  activeAssistantMsgIdRef.current ||
                  conversationData.id ||
                  `assistant-${Date.now()}`
                onNewMessageRef.current({
                  role: 'assistant',
                  content,
                  id: finalId,
                  timestamp,
                  partial: false,
                })
                activeAssistantMsgIdRef.current = null
                lastAgentStreamRef.current = null
              }
            } else if (conversationData.type === 'user') {
              const content = conversationData.text || conversationData.content || ''
              const timestamp = conversationData.timestamp 
                ? new Date(conversationData.timestamp).toISOString() 
                : new Date().toISOString()
              
              if (content) {
                onNewMessageRef.current({ 
                  role: 'user', 
                  content, 
                  id: conversationData.id,
                  timestamp,
                  partial: conversationData.final === false,
                })
              }
            }
            // Legacy format support
            else if (conversationData.type === 'conversation_message') {
              const messageText = `${conversationData.role}: ${conversationData.content}`
              processPayload(messageText, 'dataChannel')
            }
          } catch (error) {
            console.log('⚠️ Invalid conversation payload', error)
          }
          break
          
        case 'lk.metrics':
          try {
            const metricsUpdate = JSON.parse(text)
            console.log('📊 Received metrics update:', metricsUpdate)
            onMetricsUpdate(metricsUpdate)
          } catch (error) {
            console.log('⚠️ Invalid metrics payload', error)
          }
          break
          
        case 'lk.session':
          try {
            const sessionData = JSON.parse(text)
            if (sessionData.type === 'session_complete') {
              console.log('🏁 Session completed, saving metrics:', sessionData)
              if (sessionId) {
                saveSessionData(sessionId, sessionData.metrics, sessionData.transcript)
              }
            }
          } catch (error) {
            console.log('⚠️ Invalid session payload', error)
          }
          break
          
        case 'lk.settings':
          // Coach patience is auto-selected by the agent; ignore setting acks.
          break

        default:
          console.log('📨 Unknown data channel topic:', topic)
      }
    }

    room.on(RoomEvent.DataReceived, handleData)
    
    return () => {
      room.off(RoomEvent.DataReceived, handleData)
    }
  }, [room, connectionState, processPayload, onStateChange, onRestart, onMetricsUpdate, onTurnMetrics, sessionId, isSessionPaused])

  // Remove duplicate - handled by first useEffect above
  // This second useEffect was causing messages to be missed!

  return null
}

