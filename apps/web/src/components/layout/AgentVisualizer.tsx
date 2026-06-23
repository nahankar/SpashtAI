/**
 * Agent Audio Visualizer Component
 * Shows real-time audio visualization and agent state
 */

import { useVoiceAssistant, BarVisualizer } from '@livekit/components-react'

const STATE_DISPLAY: Record<string, string> = {
  connecting: 'Connecting...',
  initializing: 'Initializing...',
  listening: 'Listening',
  thinking: 'Thinking...',
  speaking: 'Speaking',
  disconnected: 'Disconnected',
}

const STATE_COLOR: Record<string, string> = {
  connecting: 'text-gray-400',
  initializing: 'text-gray-400',
  listening: 'text-green-500',
  thinking: 'text-yellow-500',
  speaking: 'text-blue-500',
  disconnected: 'text-red-500',
}

/** Presentational status strip — safe outside LiveKitRoom (e.g. paused / disconnected). */
export function SessionStatusBar({
  label,
  hint,
  isPaused = false,
  className = '',
}: {
  label: string
  hint?: string
  isPaused?: boolean
  className?: string
}) {
  return (
    <div className={`flex flex-row items-center justify-center gap-3 py-2 px-3 ${className}`}>
      <div className="flex shrink-0 items-end gap-1 h-6 w-16 justify-center">
        {isPaused ? (
          <>
            <span className="h-3 w-1 rounded-full bg-muted-foreground/40" />
            <span className="h-5 w-1 rounded-full bg-muted-foreground/50" />
            <span className="h-3 w-1 rounded-full bg-muted-foreground/40" />
          </>
        ) : (
          <>
            <span className="h-4 w-1 rounded-full bg-primary/30 animate-pulse" />
            <span className="h-6 w-1 rounded-full bg-primary/50 animate-pulse" />
            <span className="h-3 w-1 rounded-full bg-primary/30 animate-pulse" />
          </>
        )}
      </div>
      <div className={`text-center min-w-0 ${isPaused ? 'text-amber-600' : 'text-muted-foreground'}`}>
        <div className="text-sm font-medium leading-tight">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </div>
  )
}

interface AgentVisualizerProps {
  className?: string
  isPaused?: boolean
  compact?: boolean
}

export function AgentVisualizer({ className = '', isPaused = false, compact = true }: AgentVisualizerProps) {
  const { state, audioTrack } = useVoiceAssistant()

  const displayState = isPaused ? 'paused' : state
  const barHeight = compact ? 'h-10' : 'h-14'
  const padding = compact ? 'py-2 px-3' : 'py-3 px-4'
  const stateTextSize = compact ? 'text-sm' : 'text-base'

  return (
    <div className={`flex flex-row items-center justify-center gap-3 ${padding} ${className}`}>
      <div className={`flex shrink-0 items-center justify-center ${barHeight} w-24 sm:w-28`}>
        {isPaused ? (
          <div className="flex items-end gap-1 h-6">
            <span className="h-3 w-1 rounded-full bg-muted-foreground/40" />
            <span className="h-5 w-1 rounded-full bg-muted-foreground/50" />
            <span className="h-3 w-1 rounded-full bg-muted-foreground/40" />
          </div>
        ) : (
          <BarVisualizer
            state={state}
            barCount={5}
            trackRef={audioTrack}
            className="w-full h-full"
          />
        )}
      </div>

      <div className={`text-center min-w-0 ${isPaused ? 'text-amber-600' : STATE_COLOR[state] || 'text-gray-400'}`}>
        <div className={`${stateTextSize} font-medium leading-tight`}>
          {isPaused ? 'Paused' : STATE_DISPLAY[state] || state}
        </div>
        {!compact && displayState === 'listening' && (
          <div className="text-[10px] text-muted-foreground mt-0.5">Waiting for your voice...</div>
        )}
        {!compact && displayState === 'thinking' && (
          <div className="text-[10px] text-muted-foreground mt-0.5">Processing your request...</div>
        )}
        {isPaused && (
          <div className="text-[10px] text-muted-foreground mt-0.5">Click Resume to continue</div>
        )}
      </div>
    </div>
  )
}
