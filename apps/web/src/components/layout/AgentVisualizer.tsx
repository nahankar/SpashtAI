/**
 * Agent Audio Visualizer Component
 * Shows real-time audio visualization and agent state
 */

import { useVoiceAssistant, BarVisualizer } from '@livekit/components-react'

interface AgentVisualizerProps {
  className?: string
  isPaused?: boolean
}

export function AgentVisualizer({ className = '', isPaused = false }: AgentVisualizerProps) {
  // Get agent's audio track and current state from LiveKit
  const { state, audioTrack } = useVoiceAssistant()
  
  // Map agent states to display text with all possible states
  const stateDisplay: Record<string, string> = {
    'connecting': 'Connecting...',
    'initializing': 'Initializing...',
    'listening': 'Listening',
    'thinking': 'Thinking...',
    'speaking': 'Speaking',
    'disconnected': 'Disconnected'
  }
  
  // Map states to colors
  const stateColor: Record<string, string> = {
    'connecting': 'text-gray-400',
    'initializing': 'text-gray-400',
    'listening': 'text-green-500',
    'thinking': 'text-yellow-500',
    'speaking': 'text-blue-500',
    'disconnected': 'text-red-500'
  }

  const displayState = isPaused ? 'paused' : state
  
  return (
    <div className={`flex flex-col items-center justify-center p-6 ${className}`}>
      {/* Audio Visualizer */}
      <div className="w-full max-w-md h-32 flex items-center justify-center">
        {isPaused ? (
          <div className="flex items-center gap-4">
            <span className="h-10 w-3 rounded-full bg-muted-foreground/40" />
            <span className="h-10 w-3 rounded-full bg-muted-foreground/40" />
          </div>
        ) : (
          <BarVisualizer 
            state={state} 
            barCount={7} 
            trackRef={audioTrack}
            className="w-full h-full"
          />
        )}
      </div>
      
      {/* Agent State */}
      <div className={`mt-4 text-center ${isPaused ? 'text-amber-600' : stateColor[state] || 'text-gray-400'} font-medium`}>
        <div className="text-lg">{isPaused ? 'Paused' : stateDisplay[state] || state}</div>
        {displayState === 'listening' && (
          <div className="text-xs text-muted-foreground mt-1">
            Waiting for your voice...
          </div>
        )}
        {displayState === 'thinking' && (
          <div className="text-xs text-muted-foreground mt-1">
            Processing your request...
          </div>
        )}
        {isPaused && (
          <div className="text-xs text-muted-foreground mt-1">
            Click Resume to continue
          </div>
        )}
      </div>
    </div>
  )
}
