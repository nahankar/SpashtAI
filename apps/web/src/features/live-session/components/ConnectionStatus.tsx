import { useEffect, useState } from 'react'
import { useConnectionState, useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
export function ConnectionStatus({ assistantState }: { assistantState: 'restarting' | 'ready' | 'recovering' | 'unknown' }) {
  const state = useConnectionState()
  const room = useRoomContext()
  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'

  const [agentPresent, setAgentPresent] = useState(false)

  useEffect(() => {
    if (!room) return

    const checkAgent = () => {
      for (const p of room.remoteParticipants.values()) {
        if (p.name?.toLowerCase().includes('assistant') || p.identity?.startsWith('agent')) {
          setAgentPresent(true)
          return
        }
      }
    }

    checkAgent()
    const onJoin = () => checkAgent()
    room.on(RoomEvent.ParticipantConnected, onJoin)
    return () => { room.off(RoomEvent.ParticipantConnected, onJoin) }
  }, [room])

  const effectiveState = assistantState === 'unknown' && agentPresent ? 'ready' : assistantState

  const getOverallStatus = () => {
    if (!isConnected && !isConnecting) return { text: 'Disconnected', color: 'text-red-600' }
    if (isConnecting) return { text: 'Connecting to room...', color: 'text-yellow-600' }
    if (isConnected && effectiveState === 'unknown') return { text: 'Waiting for assistant...', color: 'text-yellow-600' }
    if (isConnected && effectiveState === 'ready') return { text: 'Ready', color: 'text-green-600' }
    if (effectiveState === 'restarting') return { text: 'Assistant restarting...', color: 'text-yellow-600' }
    if (effectiveState === 'recovering') return { text: 'Recovering...', color: 'text-yellow-600' }
    return { text: 'Connected', color: 'text-green-600' }
  }

  const status = getOverallStatus()

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={status.color}>
        {status.text}
      </span>
      {(isConnecting || (isConnected && effectiveState === 'unknown')) && (
        <span className="inline-block w-4 h-4 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
