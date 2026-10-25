import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ParticipantEvent, RoomEvent, Track } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import { CaptureError, captureFailure, confirmedInterviewDrain, conversationStatus, CONVERSATION_STOP_REASONS, interviewCompletionMessage, INTERVIEWS_API, interviewWrite,
  UNCONFIRMED_SPEECH_HELP, type CaptureAction, type CaptureReceipt, type ConversationState, type InterviewOperation } from '@/lib/interview-practice'
import type { SessionRecorderHandle } from '@/components/session/SessionRecorder'

type AgentState = { state: ConversationState; reason: string; attemptId: string }
const LISTENING: ConversationState[] = ['listening', 'candidate_end']

export function InterviewControls({ runId, attemptId, segmentId, status, ready, blocked, recorder, changed, preparing,
  pause, leave, incomplete, discard, reconnect, operationChanged, conversation = false }: {
  runId: string; attemptId: string; segmentId: string; status: string; ready: boolean; blocked: boolean;
  recorder: () => SessionRecorderHandle|null; changed: () => Promise<void>; preparing: () => void;
  pause: () => Promise<void>; leave: () => Promise<void>; incomplete: () => Promise<void>; discard: () => Promise<void>;
  reconnect: () => Promise<void>;
  operationChanged: (operation: InterviewOperation) => void;
  // Conversation practices: the interviewer agent finishes answers and moves on; controls stay as fallbacks.
  conversation?: boolean;
}) {
  const room = useRoomContext()
  const [operation,setOperation]=useState<InterviewOperation>(null); const busy=operation!==null
  const [error,setError]=useState(''); const [muted,setMuted]=useState(true)
  const [errorCode,setErrorCode]=useState<string|undefined>(undefined)
  useEffect(()=> { operationChanged(operation); return ()=>operationChanged(null) },[operation,operationChanged])
  const [confirmIncomplete,setConfirmIncomplete]=useState(false); const [confirmDiscard,setConfirmDiscard]=useState(false)
  const [timeUp,setTimeUp]=useState(false)
  const [questionReady,setQuestionReady]=useState(false)
  const [completionMessage,setCompletionMessage]=useState<string|null>(null)
  const [agent,setAgent]=useState<AgentState>({ state: '', reason: '', attemptId: '' })
  const [hold,setHold]=useState(false)
  const agentListening=conversation && LISTENING.includes(agent.state)
  const canSpeak=ready && questionReady
  const pending=useRef<{ action: CaptureAction; requestId: string }|null>(null)
  const running=useRef(false)
  const desiredMic=useRef(false)
  function microphone(enabled: boolean) {
    desiredMic.current=enabled
    const track=room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    // Keep the recorder's track alive between questions. Disabling samples is
    // different from stopping/unpublishing the track used by MediaRecorder.
    if (track) track.enabled=enabled
    setMuted(!enabled)
  }
  useEffect(() => {
    const sync=() => {
      const track=room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
      if (track) track.enabled=desiredMic.current
    }
    room.localParticipant.on(ParticipantEvent.LocalTrackPublished,sync)
    room.on(RoomEvent.Reconnected,sync)
    return () => { room.localParticipant.off(ParticipantEvent.LocalTrackPublished,sync); room.off(RoomEvent.Reconnected,sync) }
  },[room])
  useEffect(() => {
    // The time limit stops new questions, not speech for the open answer. In conversation
    // practices the microphone also follows the interviewer: open only while it is listening.
    desiredMic.current=canSpeak && status==='ASKED' && !blocked && !busy && !error && (!conversation || agentListening)
    const track=room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    if (track) track.enabled=desiredMic.current
    setMuted(!desiredMic.current)
  },[canSpeak,status,blocked,busy,error,room,conversation,agentListening])
  useEffect(() => {
    const control=(bytes: Uint8Array, participant: { isAgent: boolean; metadata?: string }|undefined, _kind: unknown, topic?: string) => {
      if (topic!=='lk.control' || !participant?.isAgent) return
      try {
        if (JSON.parse(participant.metadata ?? '{}').interviewRunId!==runId) return
        const data=JSON.parse(new TextDecoder().decode(bytes))
        if (data.type==='session_state' && data.text==='ready') setQuestionReady(true)
        if (data.type==='interview_time_up') setTimeUp(true)
        if (data.type==='interview_error') setError('Interview speech capture is unavailable. Retry saving or end with an incomplete answer.')
        if (data.type==='interview_voice_closed') { setQuestionReady(false); setError(captureFailure('VOICE_DISCONNECTED')) }
        if (data.type==='interview_state') setAgent({ state: data.state ?? '', reason: data.reason ?? '', attemptId: data.attemptId ?? '' })
      } catch { /* unrelated control message */ }
    }
    room.on(RoomEvent.DataReceived,control)
    return () => { room.off(RoomEvent.DataReceived,control) }
  },[room,runId])
  const interviewer=useCallback(() => {
    const participant=Array.from(room.remoteParticipants.values()).find(p => {
      if (!p.isAgent) return false
      try { return JSON.parse(p.metadata ?? '{}').interviewRunId===runId } catch { return false }
    })
    if (!participant) throw new Error('The interviewer is still connecting. Please wait and retry.')
    return participant
  },[room,runId])
  useEffect(() => {
    if (!conversation) return
    // Participant attributes are the durable copy of the coordinator state (they survive reconnects).
    const read=() => {
      try {
        const attributes=(interviewer() as { attributes?: Record<string,string> }).attributes ?? {}
        if (attributes['interview.state']) setAgent({ state: attributes['interview.state'] as ConversationState, reason: attributes['interview.reason'] ?? '', attemptId: attributes['interview.attemptId'] ?? '' })
      } catch { /* interviewer not connected yet */ }
    }
    read()
    room.on(RoomEvent.ParticipantAttributesChanged,read); room.on(RoomEvent.ParticipantConnected,read)
    return () => { room.off(RoomEvent.ParticipantAttributesChanged,read); room.off(RoomEvent.ParticipantConnected,read) }
  },[room,conversation,interviewer])
  const changedRef=useRef(changed); changedRef.current=changed
  useEffect(() => {
    // Automatic saves and new questions happen without a click: refresh the saved answers when the state settles.
    if (conversation && ['listening','waiting'].includes(agent.state)) void changedRef.current()
    if (conversation && agent.state==='asking') setHold(false)
  },[conversation,agent.state,agent.attemptId])
  useEffect(() => {
    const disconnected=(participant: { isAgent: boolean; metadata?: string }) => {
      try {
        if (participant.isAgent && JSON.parse(participant.metadata ?? '{}').interviewRunId===runId) setQuestionReady(false)
      } catch { /* unrelated participant */ }
    }
    const reconnected=() => {
      setQuestionReady(false)
      // Reaffirm the saved question after transport recovery. NEXT is
      // idempotent while an answer is open; it does not select another item.
      void Promise.resolve().then(()=>room.localParticipant.performRpc({destinationIdentity:interviewer().identity,
        method:'interview.control',payload:JSON.stringify({action:'NEXT',requestId:crypto.randomUUID()}),responseTimeout:15_000}))
        .catch(()=>setError('The interviewer could not reconnect. Retry the question or end with an incomplete answer.'))
    }
    room.on(RoomEvent.ParticipantDisconnected,disconnected)
    room.on(RoomEvent.Reconnected,reconnected)
    return ()=> { room.off(RoomEvent.ParticipantDisconnected,disconnected); room.off(RoomEvent.Reconnected,reconnected) }
  },[room,runId,interviewer])
  async function action(action: CaptureAction, options: { acceptUnresolved?: boolean } = {}) {
    if (running.current) return
    running.current=true; setOperation('saving'); setError(''); setErrorCode(undefined)
    if (!pending.current || pending.current.action!==action) pending.current={ action,requestId:crypto.randomUUID() }
    try {
      const receipt=await confirmedInterviewDrain({
        seal: async () => { await recorder()?.seal() }, mute: async () => { microphone(false) },
        rpc: payload => room.localParticipant.performRpc({ destinationIdentity:interviewer().identity,
          method:'interview.control',payload:JSON.stringify(payload),responseTimeout:30_000 }),
        verify: id => apiClient<CaptureReceipt>(`${INTERVIEWS_API}/runs/${encodeURIComponent(runId)}/receipts/${encodeURIComponent(id)}`),
      },action,pending.current.requestId,attemptId,segmentId,options)
      if (action==='FINISH' || action==='SKIP') {
        await interviewWrite(`/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(attemptId)}/finish`,{skip:action==='SKIP',receiptId:receipt.id})
        await changed()
      } else if (action==='PAUSE') await pause()
      else await leave()
      pending.current=null
    } catch (e) {
      setErrorCode(e instanceof CaptureError ? e.code : undefined)
      setError(e instanceof Error ? e.message : 'Speech could not be saved. Retry before continuing.')
    }
    finally { running.current=false; setOperation(null) }
  }
  /** Conversation practices: the interviewer saves, finishes and moves on; the attempt id fences stale clicks. */
  async function converse(kind: 'FINISH'|'SKIP'|'NEXT', options: { acceptUnresolved?: boolean } = {}) {
    if (running.current) return
    running.current=true; setOperation(kind==='NEXT' ? 'preparing' : 'saving'); setError(''); setErrorCode(undefined)
    try {
      const payload={ action:kind, requestId:crypto.randomUUID(), attemptId, ...(options.acceptUnresolved && kind==='FINISH' ? { acceptUnresolved:true } : {}) }
      const result=JSON.parse(await room.localParticipant.performRpc({ destinationIdentity:interviewer().identity,
        method:'interview.control',payload:JSON.stringify(payload),responseTimeout:30_000 })) as { error?: string }
      if (result.error) throw new CaptureError(result.error)
      await changed()
    } catch (e) {
      setErrorCode(e instanceof CaptureError ? e.code : undefined)
      setError(e instanceof Error ? e.message : 'The interviewer could not save this answer. Retry or end practice.')
    }
    finally { running.current=false; setOperation(null) }
  }
  async function interviewerControl(kind: 'REPEAT'|'HOLD'|'RESUME_AUTO') {
    try {
      await room.localParticipant.performRpc({ destinationIdentity:interviewer().identity, method:'interview.control',
        payload:JSON.stringify({ action:kind, requestId:crypto.randomUUID() }), responseTimeout:30_000 })
      if (kind!=='REPEAT') setHold(kind==='HOLD')
    } catch (e) { setError(e instanceof Error ? e.message : 'The interviewer did not respond. Retry.') }
  }
  async function next() {
    if (running.current) return
    running.current=true; setOperation('preparing'); setError(''); microphone(false)
    try {
      await interviewWrite(`/runs/${encodeURIComponent(runId)}/next`)
      // Only enter the waiting-for-speech state when another question exists.
      // Exhaustion leaves the completed question ready to close normally.
      setQuestionReady(false); preparing()
      await changed()
      const result=JSON.parse(await room.localParticipant.performRpc({ destinationIdentity:interviewer().identity,
        method:'interview.control',payload:JSON.stringify({action:'NEXT',requestId:crypto.randomUUID()}),responseTimeout:15_000 }))
      if (result.error) throw new Error(result.error==='VOICE_DISCONNECTED' ? captureFailure(result.error) : 'The next question could not be read. Retry the question or reconnect the interviewer.')
    } catch (e) {
      const completion=interviewCompletionMessage(e)
      if (completion) setCompletionMessage(completion)
      else setError(e instanceof Error ? e.message : 'Could not start the next question.')
    }
    finally { running.current=false; setOperation(null) }
  }
  const unconfirmed=errorCode==='TRANSCRIPT_PENDING'
  const finish=(options?: { acceptUnresolved?: boolean }) => void (conversation ? converse('FINISH',options) : action('FINISH',options))
  const answerOpen=conversation ? agentListening && !busy && !blocked && !error : canSpeak && !busy && !blocked && !error
  const statusLine=conversation && !busy && agent.state ? conversationStatus(agent.state,agent.reason,hold)
    : operation==='preparing' ? 'Starting your next question…' : busy ? 'Saving and confirming your speech…' : timeUp ? 'Practice time is up. Finish your current answer or end practice.' : status==='ASKED' ? 'Take your time. Choose Finish answer when you are done; thinking pauses are welcome.' : status==='PREPARED' ? 'Waiting for the interviewer to read your next question.' : 'Your answer is saved. Continue with another question or end practice.'
  const conversationNext=conversation && agent.state==='waiting' && !CONVERSATION_STOP_REASONS.includes(agent.reason) && ['ANSWERED','SKIPPED'].includes(status)
  return <div className="space-y-3 py-3">
    <p className="text-sm text-muted-foreground" aria-live="polite">{statusLine}</p>
    <div className="flex flex-wrap gap-2">
      {status==='ASKED' && <><Button disabled={!answerOpen} onClick={() => finish()}>Finish answer</Button>
        <Button variant="outline" disabled={!answerOpen} onClick={() => void (conversation ? converse('SKIP') : action('SKIP'))}>Skip question</Button></>}
      {conversation && status==='ASKED' && <><Button variant="outline" disabled={!answerOpen} onClick={() => void interviewerControl(hold ? 'RESUME_AUTO' : 'HOLD')}>{hold ? 'Resume automatic finish' : 'More time'}</Button>
        <Button variant="outline" disabled={!answerOpen} onClick={() => void interviewerControl('REPEAT')}>Repeat question</Button></>}
      {!conversation && ['ANSWERED','SKIPPED'].includes(status) && !completionMessage && <Button disabled={busy || blocked || timeUp} onClick={() => void next()}>Next question</Button>}
      {conversationNext && <Button disabled={busy || blocked} onClick={() => void converse('NEXT')}>Next question</Button>}
      <Button variant="outline" disabled={!canSpeak || status!=='ASKED' || busy || blocked || !!error || (conversation && !agentListening)} onClick={() => {
        // A muted microphone is not a finished answer: automatic finish stays off while muted.
        if (conversation) void interviewerControl(muted ? 'RESUME_AUTO' : 'HOLD')
        microphone(muted)
      }}>{muted ? 'Unmute' : 'Mute'}</Button>
      <Button variant="outline" disabled={!(canSpeak || (conversation && agent.state==='asking')) || busy || blocked || !!error} onClick={() => void action('PAUSE')}>Pause</Button>
      <Button variant="secondary" disabled={!(canSpeak || (conversation && agent.state==='asking')) || busy || blocked || !!error} onClick={() => void action('LEAVE')}>End practice</Button>
      <Button variant="ghost" disabled={busy || blocked} onClick={() => setConfirmDiscard(true)}>Discard</Button>
    </div>
    {completionMessage && <p role="status" className="rounded-lg border p-3 text-sm">{completionMessage}</p>}
    {error && <div role="alert" className="rounded-lg border border-amber-400/40 p-3 space-y-3"><p>{error}</p>
      {unconfirmed && <p className="text-sm text-muted-foreground">{UNCONFIRMED_SPEECH_HELP}</p>}
      <div className="flex flex-wrap gap-2">{(pending.current || (conversation && unconfirmed)) && <Button disabled={busy} onClick={() => conversation ? finish() : void action(pending.current!.action)}>Retry saving speech</Button>}
        {unconfirmed && <Button variant="outline" disabled={busy} onClick={() => finish({ acceptUnresolved: true })}>Save confirmed speech only</Button>}
        {!pending.current && !conversation && ['PREPARED','ASKED'].includes(status) && <Button disabled={busy || blocked} onClick={() => void next()}>Retry question</Button>}
        {!pending.current && <Button variant="outline" disabled={busy || blocked} onClick={() => void reconnect()}>Reconnect interviewer</Button>}
        {pending.current?.action==='FINISH' && <Button variant="outline" disabled={busy || blocked} onClick={() => void action('SKIP')}>Skip this question</Button>}
        <Button variant="outline" disabled={busy} onClick={() => setConfirmIncomplete(true)}>End with incomplete answer</Button></div></div>}
    {!canSpeak && !error && <Button variant="ghost" disabled={busy} onClick={() => setConfirmIncomplete(true)}>End without waiting</Button>}
    {confirmIncomplete && <div role="alertdialog" aria-label="End incomplete interview" className="rounded-lg border p-3 space-y-2">
      <p>End practice now? Confirmed speech stays in your history. The unfinished answer is marked incomplete.</p>
      <Button disabled={busy} onClick={() => { setConfirmIncomplete(false); void incomplete() }}>End practice</Button>
      <Button variant="ghost" onClick={() => setConfirmIncomplete(false)}>Keep waiting</Button>
    </div>}
    {confirmDiscard && <div role="alertdialog" aria-label="Discard interview" className="rounded-lg border p-3 space-y-2">
      <p>Discard this interview and its recordings? It will be removed from your history.</p>
      <Button variant="destructive" disabled={busy} onClick={() => { setConfirmDiscard(false); void discard() }}>Discard interview</Button>
      <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep interview</Button>
    </div>}
  </div>
}
