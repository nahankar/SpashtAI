/**
 * Agent Audio Visualizer Component
 * Shows real-time audio visualization and agent state
 */

import { useVoiceAssistant, BarVisualizer } from '@livekit/components-react'

interface AgentVisualizerProps {
  className?: string
}

export function AgentVisualizer({ className = '' }: AgentVisualizerProps) {
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
  
  return (
    <div className={`flex flex-col items-center justify-center p-6 ${className}`}>
      {/* Audio Visualizer */}
      <div className="w-full max-w-md h-32 flex items-center justify-center">
        <BarVisualizer 
          state={state} 
          barCount={7} 
          trackRef={audioTrack}
          className="w-full h-full"
        />
      </div>
      
      {/* Agent State */}
      <div className={`mt-4 text-center ${stateColor[state] || 'text-gray-400'} font-medium`}>
        <div className="text-lg">{stateDisplay[state] || state}</div>
        {state === 'listening' && (
          <div className="text-xs text-muted-foreground mt-1">
            Waiting for your voice...
          </div>
        )}
        {state === 'thinking' && (
          <div className="text-xs text-muted-foreground mt-1">
            Processing your request...
          </div>
        )}
      </div>
    </div>
  )
}
