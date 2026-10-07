import type { RefObject } from 'react'
import { LiveKitRoom, RoomAudioRenderer, StartAudio } from '@livekit/components-react'
import '@livekit/components-styles'
import { AUDIO_CAPTURE } from '@/lib/audioCapture'
import { CoachAudioBootstrap } from '@/components/session/CoachAudioBootstrap'
import { SessionRecorder, type SessionRecorderHandle } from '@/components/session/SessionRecorder'
import { AgentVisualizer } from '@/components/layout/AgentVisualizer'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { LiveMetricsUpdate } from '@/hooks/useSessionMetrics'
import type { TurnMetrics } from '@/components/session/UserTurnMetrics'
import type { ChatMessage } from '../types'
import { ConnectionStatus } from './ConnectionStatus'
import { LiveKitConversation } from './LiveKitConversation'
import { InRoomControls } from './InRoomControls'
export interface LiveSessionRoomProps {
  token: string; url: string; sessionId: string | null; segmentId: string | null; roomName: string
  recorderRef: RefObject<SessionRecorderHandle | null>
  isPausing: boolean; pauseAudioFailure: 'failed' | 'unavailable' | null; isSessionPaused: boolean; isLeaving: boolean
  assistantState: 'restarting' | 'ready' | 'recovering' | 'unknown'
  handleDisconnected: () => Promise<void>; handleNewMessage: (message: ChatMessage & { partial?: boolean }) => void
  setAssistantState: (state: LiveSessionRoomProps['assistantState']) => void; handleConversationRestart: () => void
  onTurnMetrics: (text: string, metrics: TurnMetrics, turnIndex?: number) => void
  updateMetrics: (metrics: LiveMetricsUpdate) => void
  handleLeave: () => Promise<void>; showMetrics: boolean; setShowMetrics: (show: boolean) => void
  handlePause: () => Promise<void>; exportFlags: { enableAudioExport: boolean }
  canDiscardPreparePractice: boolean; isPrepare: boolean; handleDiscard: () => Promise<void>
  retryPauseUpload: () => Promise<void>; pauseWithoutReplayAudio: () => Promise<void>
  continueInNewSegmentAfterPauseFailure: () => Promise<void>
}
export function LiveSessionRoom({ token, url, sessionId, segmentId, roomName, recorderRef, isPausing, pauseAudioFailure, isSessionPaused, isLeaving, assistantState, handleDisconnected, handleNewMessage, setAssistantState, handleConversationRestart, onTurnMetrics, updateMetrics, handleLeave, showMetrics, setShowMetrics, handlePause, exportFlags, canDiscardPreparePractice, isPrepare, handleDiscard, retryPauseUpload, pauseWithoutReplayAudio, continueInNewSegmentAfterPauseFailure }: LiveSessionRoomProps) {
  return (
                <LiveKitRoom
                  token={token}
                  serverUrl={url}
                  connectOptions={{ autoSubscribe: true }}
                  video={false}
                  audio={AUDIO_CAPTURE}
                  onDisconnected={handleDisconnected}
                >
                  <RoomAudioRenderer muted={isPausing || pauseAudioFailure != null} />
                  <CoachAudioBootstrap />
                  <SessionRecorder
                    key={segmentId}
                    ref={recorderRef}
                    sessionId={sessionId}
                    segmentId={segmentId}
                  />
                  <StartAudio label="Click to enable coach audio" />
                  <div className="flex justify-center w-full mb-2">
                    <AgentVisualizer className="bg-muted/20 rounded-lg w-full" isPaused={isSessionPaused} compact />
                  </div>
                  <ConnectionStatus assistantState={assistantState} />
                  <LiveKitConversation
                    key={roomName}
                    sessionId={sessionId}
                    isSessionPaused={isSessionPaused}
                    onNewMessage={handleNewMessage}
                    onStateChange={setAssistantState}
                    onRestart={handleConversationRestart}
                    onTurnMetrics={onTurnMetrics}
                    onMetricsUpdate={updateMetrics}
                  />
                  <div className="flex flex-wrap items-center gap-2 py-2">
                    <Button onClick={handleLeave}>Leave</Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setShowMetrics(!showMetrics)}
                    >
                      {showMetrics ? 'Hide Metrics' : 'Show Metrics'}
                    </Button>
                    <InRoomControls
                      sessionId={sessionId}
                      onSealRecording={() => recorderRef.current?.seal() ?? Promise.resolve()}
                      onPauseSession={handlePause}
                      isPausing={isPausing}
                      inputBlocked={isPausing || pauseAudioFailure != null}
                      enableAudioRecord={exportFlags.enableAudioExport}
                    />
                    {canDiscardPreparePractice && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDiscard} disabled={isLeaving}>
                        {isPrepare ? 'Discard interview practice' : 'Discard Session'}
                      </Button>
                    )}
                  </div>
                  {pauseAudioFailure && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                      <p className="text-sm font-medium">Replay audio could not be saved</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Retry saving, pause without this part of the replay, or continue in a new
                        recording segment.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={retryPauseUpload} disabled={isPausing}>
                          {isPausing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Retry saving audio
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={pauseWithoutReplayAudio}
                          disabled={isPausing}
                        >
                          Pause without replay audio
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={continueInNewSegmentAfterPauseFailure}
                          disabled={isPausing}
                        >
                          Continue in a new recording segment
                        </Button>
                      </div>
                    </div>
                  )}
                  {isPausing && !pauseAudioFailure && (
                    <div
                      className="rounded-lg border border-border bg-muted/40 p-3 text-sm"
                      role="status"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving this recording segment before pausing. Your microphone is muted.
                      </span>
                    </div>
                  )}
                </LiveKitRoom>
  )
}
