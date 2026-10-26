import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ParticipantEvent, RoomEvent, Track } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import { CaptureError, captureFailure, confirmedInterviewDrain, conversationStatus, CONVERSATION_STOP_REASONS, interviewCompletionMessage, INTERVIEWS_API, interviewWrite,
  NO_SPEECH_HELP, UNCONFIRMED_SPEECH_HELP, type CaptureAction, type CaptureReceipt, type ConversationState, type InterviewOperation } from '@/lib/interview-practice'
import type { SessionRecorderHandle } from '@/components/session/SessionRecorder'

type AgentState = { state: ConversationState; reason: string; attemptId: string; hold: boolean; receiptId: string; receiptAction: string }
const LISTENING: ConversationState[] = ['listening', 'candidate_end']
const IDLE_AGENT: AgentState = { state: '', reason: '', attemptId: '', hold: false, receiptId: '', receiptAction: '' }
const agentState = (v: Record<string, string|undefined>): AgentState => ({ state: (v.state ?? '') as ConversationState, reason: v.reason ?? '',
  attemptId: v.attemptId ?? '', hold: v.hold === '1', receiptId: v.receiptId ?? '', receiptAction: v.receiptAction ?? '' })
/** What the room strip should say while the interviewer, not a click, is saving or moving on. */
function agentOperation(state: ConversationState): InterviewOperation {
  return state==='confirming' || state==='saving' ? 'saving' : state==='preparing' ? 'preparing' : state==='waiting' ? 'waiting' : null
}

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
  const [error,setError]=useState('')
  const [errorCode,setErrorCode]=useState<string|undefined>(undefined)
  const [notice,setNotice]=useState('')
  const [confirmIncomplete,setConfirmIncomplete]=useState(false); const [confirmDiscard,setConfirmDiscard]=useState(false)
  const [timeUp,setTimeUp]=useState(false)
  const [questionReady,setQuestionReady]=useState(false)
  const [completionMessage,setCompletionMessage]=useState<string|null>(null)
  const [agent,setAgent]=useState<AgentState>(IDLE_AGENT)
  // The agent owns automatic finish; the browser shows its published hold rather than a local guess.
  const hold=agent.hold
  const agentListening=conversation && LISTENING.includes(agent.state)
  const canSpeak=ready && questionReady
  useEffect(()=> {
    operationChanged(operation ?? (conversation ? agentOperation(agent.state) : null))
    return ()=>operationChanged(null)
  },[operation,operationChanged,conversation,agent.state])
  const pending=useRef<{ action: CaptureAction; requestId: string }|null>(null)
  // The control that failed: retry repeats that kind (Pause stays Pause) for the answer it failed on.
  const [failure,setFailure]=useState<{ kind: CaptureAction|'NEXT'; attemptId: string; viaInterviewer: boolean }|null>(null)
  const holdBeforeMute=useRef(false)
  // The learner's own Mute persists until they unmute; interviewer gating (asking, saving, recovery,
  // reconnect, question changes) only ever closes the microphone on top of it.
  const [learnerMuted,setLearnerMuted]=useState(false)
  const running=useRef(false)
  const desiredMic=useRef(false)
  function microphone(enabled: boolean) {
    desiredMic.current=enabled
    const track=room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    // Keep the recorder's track alive between questions. Disabling samples is
    // different from stopping/unpublishing the track used by MediaRecorder.
    if (track) track.enabled=enabled
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
  const inputAllowed=(conversation ? ready && agentListening : canSpeak && status==='ASKED') && !blocked && !busy && !error
  useEffect(() => {
    // The time limit stops new questions, not speech for the open answer. In conversation
    // practices the microphone also follows the interviewer: open only while it is listening.
    // Conversation practices follow the agent's published state, which leads the saved status by a refresh.
    desiredMic.current=inputAllowed && !learnerMuted
    const track=room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    if (track) track.enabled=desiredMic.current
  },[inputAllowed,learnerMuted,room])
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
        if (data.type==='interview_state') setAgent(agentState(data))
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
        if (attributes['interview.state']) setAgent(agentState(Object.fromEntries(Object.entries(attributes)
          .filter(([key]) => key.startsWith('interview.')).map(([key, value]) => [key.slice('interview.'.length), value]))))
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
  },[conversation,agent.state,agent.attemptId])
  useEffect(() => {
    // A failure banner belongs to its answer: once the interviewer moves to another question it no longer applies.
    if (!conversation || !failure || !agent.attemptId || agent.attemptId===failure.attemptId) return
    setFailure(null); setError(''); setErrorCode(undefined)
  },[conversation,agent.attemptId,failure])
  const finishing=useRef('')
  useEffect(() => {
    // Conversation access was withdrawn after the answer was saved: finish it through the learner route.
    if (!conversation || agent.state!=='waiting' || agent.reason!=='CONVERSATION_UNAVAILABLE' || !agent.receiptId || finishing.current===agent.receiptId) return
    finishing.current=agent.receiptId
    setNotice('Automatic conversation was turned off for this practice. Your saved answer is being completed; continue with Next question.')
    void interviewWrite(`/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(agent.attemptId)}/finish`,
      { skip: agent.receiptAction==='SKIP', receiptId: agent.receiptId })
      .catch(() => setError('Your saved answer could not be completed. Reload the page to retry.'))
      .finally(() => void changedRef.current())
  },[conversation,agent.state,agent.reason,agent.receiptId,agent.receiptAction,agent.attemptId,runId])
  useEffect(() => {
    const disconnected=(participant: { isAgent: boolean; metadata?: string }) => {
      try {
        if (participant.isAgent && JSON.parse(participant.metadata ?? '{}').interviewRunId===runId) setQuestionReady(false)
      } catch { /* unrelated participant */ }
    }
    const reconnected=() => {
      // In conversation practices the interviewer owns the question; its attributes are re-read instead.
      if (conversation) return
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
  },[room,runId,interviewer,conversation])
  async function action(action: CaptureAction, options: { acceptUnresolved?: boolean } = {}) {
    if (running.current) return
    running.current=true; setOperation('saving'); setError(''); setErrorCode(undefined); setNotice('')
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
      pending.current=null; setFailure(null)
    } catch (e) {
      if (e instanceof CaptureError && e.code==='NO_SPEECH') { pending.current=null; setFailure(null); setNotice(NO_SPEECH_HELP) }
      else {
        setFailure({ kind:action, attemptId, viaInterviewer:false })
        setErrorCode(e instanceof CaptureError ? e.code : undefined)
        setError(e instanceof Error ? e.message : 'Speech could not be saved. Retry before continuing.')
      }
    }
    finally { running.current=false; setOperation(null) }
  }
  /** Conversation practices: the interviewer saves, finishes and moves on; the attempt id fences stale clicks. */
  async function converse(kind: 'FINISH'|'SKIP'|'NEXT', options: { acceptUnresolved?: boolean; attemptId?: string } = {}) {
    if (running.current) return
    running.current=true; setOperation(kind==='NEXT' ? 'preparing' : 'saving'); setError(''); setErrorCode(undefined); setNotice('')
    // The answer the interviewer is listening to (its state leads the saved status), or the one a retry names.
    const target=options.attemptId ?? (agent.attemptId || attemptId)
    try {
      const payload={ action:kind, requestId:crypto.randomUUID(), attemptId:target, ...(options.acceptUnresolved && kind==='FINISH' ? { acceptUnresolved:true } : {}) }
      const result=JSON.parse(await room.localParticipant.performRpc({ destinationIdentity:interviewer().identity,
        method:'interview.control',payload:JSON.stringify(payload),responseTimeout:30_000 })) as { error?: string }
      if (result.error) throw new CaptureError(result.error)
      setFailure(null)
      await changed()
    } catch (e) {
      if (e instanceof CaptureError && e.code==='NO_SPEECH') { setFailure(null); setNotice(NO_SPEECH_HELP) }
      else {
        setFailure({ kind, attemptId:target, viaInterviewer:true })
        setErrorCode(e instanceof CaptureError ? e.code : undefined)
        setError(e instanceof Error ? e.message : 'The interviewer could not save this answer. Retry or end practice.')
      }
    }
    finally { running.current=false; setOperation(null) }
  }
  async function interviewerControl(kind: 'REPEAT'|'HOLD'|'RESUME_AUTO') {
    try {
      // The agent publishes the resulting hold; the browser renders that rather than assuming success.
      await room.localParticipant.performRpc({ destinationIdentity:interviewer().identity, method:'interview.control',
        payload:JSON.stringify({ action:kind, requestId:crypto.randomUUID() }), responseTimeout:30_000 })
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
  // Recovery repeats the action that failed (Pause and End stay Pause and End), for the answer it failed on.
  const retry=(options: { acceptUnresolved?: boolean } = {}) => {
    if (!failure) return
    if (failure.viaInterviewer) void converse(failure.kind as 'FINISH'|'SKIP'|'NEXT', { ...options, attemptId: failure.attemptId })
    else void action(failure.kind as CaptureAction, options)
  }
  const retryable=!!failure && failure.kind!=='NEXT'
  const confirmedOnly=unconfirmed && !!failure && failure.kind!=='SKIP' && failure.kind!=='NEXT'
  const answerOpen=conversation ? agentListening && !busy && !blocked && !error : canSpeak && !busy && !blocked && !error
  // Pauses during an answer are shown but not announced: announcing every pause interrupts (and, through
  // speakers, re-enters) the learner's answer.
  const announced=conversation && !busy && agent.state ? conversationStatus(agent.state==='candidate_end' ? 'listening' : agent.state,agent.reason,hold) : ''
  const statusLine=conversation && !busy && agent.state ? conversationStatus(agent.state,agent.reason,hold)
    : operation==='preparing' ? 'Starting your next question…' : busy ? 'Saving and confirming your speech…' : timeUp ? 'Practice time is up. Finish your current answer or end practice.' : status==='ASKED' ? 'Take your time. Choose Finish answer when you are done; thinking pauses are welcome.' : status==='PREPARED' ? 'Waiting for the interviewer to read your next question.' : 'Your answer is saved. Continue with another question or end practice.'
  // Continue resumes whatever stopped automatic progression (saving, finishing, the next question).
  const conversationNext=conversation && agent.state==='waiting' && !CONVERSATION_STOP_REASONS.includes(agent.reason) && agent.reason!=='CONVERSATION_UNAVAILABLE'
  const answering=conversation ? status==='ASKED' || agentListening : status==='ASKED'
  return <div className="space-y-3 py-3">
    {conversation ? <>
      <p className="sr-only" aria-live="polite">{announced}</p>
      <p className="text-sm text-muted-foreground" aria-hidden="true">{statusLine}</p>
    </> : <p className="text-sm text-muted-foreground" aria-live="polite">{statusLine}</p>}
    <div className="flex flex-wrap gap-2">
      {answering && <><Button disabled={!answerOpen} onClick={() => finish()}>Finish answer</Button>
        <Button variant="outline" disabled={!answerOpen} onClick={() => void (conversation ? converse('SKIP') : action('SKIP'))}>Skip question</Button></>}
      {conversation && answering && <><Button variant="outline" disabled={!answerOpen} onClick={() => void interviewerControl(hold ? 'RESUME_AUTO' : 'HOLD')}>{hold ? 'Resume automatic finish' : 'More time'}</Button>
        <Button variant="outline" disabled={!answerOpen} onClick={() => void interviewerControl('REPEAT')}>Repeat question</Button></>}
      {!conversation && ['ANSWERED','SKIPPED'].includes(status) && !completionMessage && <Button disabled={busy || blocked || timeUp} onClick={() => void next()}>Next question</Button>}
      {conversationNext && <Button disabled={busy || blocked} onClick={() => void converse('NEXT')}>{['ANSWERED','SKIPPED'].includes(status) ? 'Next question' : 'Continue'}</Button>}
      <Button variant="outline" disabled={learnerMuted ? busy || blocked : !inputAllowed} onClick={() => {
        // A muted microphone is not a finished answer: automatic finish stays off while muted, and unmuting
        // restores whatever the learner chose with More time before muting.
        if (!learnerMuted) {
          if (conversation) { holdBeforeMute.current=hold; void interviewerControl('HOLD') }
          setLearnerMuted(true); microphone(false)
        } else {
          if (conversation && !holdBeforeMute.current) void interviewerControl('RESUME_AUTO')
          // Unmuting never opens input the interviewer is not currently accepting.
          setLearnerMuted(false); microphone(inputAllowed)
        }
      }}>{learnerMuted ? 'Unmute' : 'Mute'}</Button>
      <Button variant="outline" disabled={!(canSpeak || (conversation && agent.state==='asking')) || busy || blocked || !!error} onClick={() => void action('PAUSE')}>Pause</Button>
      <Button variant="secondary" disabled={!(canSpeak || (conversation && agent.state==='asking')) || busy || blocked || !!error} onClick={() => void action('LEAVE')}>End practice</Button>
      <Button variant="ghost" disabled={busy || blocked} onClick={() => setConfirmDiscard(true)}>Discard</Button>
    </div>
    {completionMessage && <p role="status" className="rounded-lg border p-3 text-sm">{completionMessage}</p>}
    {notice && !error && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    {error && <div role="alert" className="rounded-lg border border-amber-400/40 p-3 space-y-3"><p>{error}</p>
      {unconfirmed && <p className="text-sm text-muted-foreground">{UNCONFIRMED_SPEECH_HELP}</p>}
      <div className="flex flex-wrap gap-2">{retryable && <Button disabled={busy} onClick={() => retry()}>Retry saving speech</Button>}
        {confirmedOnly && <Button variant="outline" disabled={busy} onClick={() => retry({ acceptUnresolved: true })}>Save confirmed speech only</Button>}
        {!retryable && !conversation && ['PREPARED','ASKED'].includes(status) && <Button disabled={busy || blocked} onClick={() => void next()}>Retry question</Button>}
        {!retryable && <Button variant="outline" disabled={busy || blocked} onClick={() => void reconnect()}>Reconnect interviewer</Button>}
        {failure?.kind==='FINISH' && status==='ASKED' && <Button variant="outline" disabled={busy || blocked} onClick={() => void (failure.viaInterviewer ? converse('SKIP', { attemptId: failure.attemptId }) : action('SKIP'))}>Skip this question</Button>}
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
