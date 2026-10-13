import { AgentVisualizer, SessionStatusBar } from '@/components/layout/AgentVisualizer'
import { ConnectionStatus } from './ConnectionStatus'

export type RoomStatusOverride = { label: string; hint?: string }
export function LiveRoomStatus({ override, isPaused, assistantState }: {
  override?: RoomStatusOverride
  isPaused: boolean
  assistantState: 'restarting' | 'ready' | 'recovering' | 'unknown'
}) {
  if (override) return <SessionStatusBar className="bg-muted/20 rounded-lg w-full" label={override.label} hint={override.hint} isPaused />
  return <>
    <div className="flex justify-center w-full mb-2">
      <AgentVisualizer className="bg-muted/20 rounded-lg w-full" isPaused={isPaused} compact />
    </div>
    <ConnectionStatus assistantState={assistantState} />
  </>
}
