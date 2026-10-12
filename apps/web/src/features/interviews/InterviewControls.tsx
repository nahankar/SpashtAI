import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ParticipantEvent, RoomEvent, Track } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import { captureFailure, confirmedInterviewDrain, INTERVIEWS_API, interviewWrite, type CaptureAction, type CaptureReceipt } from '@/lib/interview-practice'
import type { SessionRecorderHandle } from '@/components/session/SessionRecorder'

export function InterviewControls({ runId, attemptId, segmentId, status, ready, blocked, recorder, changed, preparing,
  pause, leave, incomplete, discard, reconnect }: {
  runId: string; attemptId: string; segmentId: string; status: string; ready: boolean; blocked: boolean;
  recorder: () => SessionRecorderHandle|null; changed: () => Promise<void>; preparing: () => void;
  pause: () => Promise<void>; leave: () => Promise<void>; incomplete: () => Promise<void>; discard: () => Promise<void>;
  reconnect: () => Promise<void>;
}) {
  const room = useRoomContext()
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [muted,setMuted]=useState(true)
  const [confirmIncomplete,setConfirmIncomplete]=useState(false); const [confirmDiscard,setConfirmDiscard]=useState(false)
  const [timeUp,setTimeUp]=useState(false)
  const [questionReady,setQuestionReady]=useState(false)
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
    desiredMic.current=canSpeak && status==='ASKED' && !blocked && !busy && !error && !timeUp
    const track=room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    if (track) track.enabled=desiredMic.current
    setMuted(!desiredMic.current)
  },[canSpeak,status,blocked,busy,error,timeUp,room])
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
  async function action(action: CaptureAction) {
    if (running.current) return
    running.current=true; setBusy(true); setError('')
    if (!pending.current || pending.current.action!==action) pending.current={ action,requestId:crypto.randomUUID() }
    try {
      const receipt=await confirmedInterviewDrain({
        seal: async () => { await recorder()?.seal() }, mute: async () => { microphone(false) },
        rpc: payload => room.localParticipant.performRpc({ destinationIdentity:interviewer().identity,
          method:'interview.control',payload:JSON.stringify(payload),responseTimeout:30_000 }),
        verify: id => apiClient<CaptureReceipt>(`${INTERVIEWS_API}/runs/${encodeURIComponent(runId)}/receipts/${encodeURIComponent(id)}`),
      },action,pending.current.requestId,attemptId,segmentId)
      if (action==='FINISH' || action==='SKIP') {
        await interviewWrite(`/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(attemptId)}/finish`,{skip:action==='SKIP',receiptId:receipt.id})
        await changed()
      } else if (action==='PAUSE') await pause()
      else await leave()
      pending.current=null
    } catch (e) { setError(e instanceof Error ? e.message : 'Speech could not be saved. Retry before continuing.') }
    finally { running.current=false; setBusy(false) }
  }
  async function next() {
    if (running.current) return
    running.current=true; setBusy(true); setError(''); microphone(false); setQuestionReady(false); preparing()
    try {
      await interviewWrite(`/runs/${encodeURIComponent(runId)}/next`)
      await changed()
      const result=JSON.parse(await room.localParticipant.performRpc({ destinationIdentity:interviewer().identity,
        method:'interview.control',payload:JSON.stringify({action:'NEXT',requestId:crypto.randomUUID()}),responseTimeout:15_000 }))
      if (result.error) throw new Error(result.error==='VOICE_DISCONNECTED' ? captureFailure(result.error) : 'The next question could not be read. Retry the question or reconnect the interviewer.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the next question.') }
    finally { running.current=false; setBusy(false) }
  }
  return <div className="space-y-3 py-3">
    <p className="text-sm text-muted-foreground">{busy ? 'Saving and confirming your speech…' : timeUp ? 'Practice time is up. Finish your current answer or end practice.' : status==='ASKED' ? 'Take your time. Choose Finish answer when you are done; thinking pauses are welcome.' : status==='PREPARED' ? 'Waiting for the interviewer to read your next question.' : 'Your answer is saved. Continue with another question or end practice.'}</p>
    <div className="flex flex-wrap gap-2">
      {status==='ASKED' && <><Button disabled={!canSpeak || busy || blocked || !!error} onClick={() => void action('FINISH')}>Finish answer</Button>
        <Button variant="outline" disabled={!canSpeak || busy || blocked || !!error} onClick={() => void action('SKIP')}>Skip question</Button></>}
      {['ANSWERED','SKIPPED'].includes(status) && <Button disabled={busy || blocked || timeUp} onClick={() => void next()}>Next question</Button>}
      <Button variant="outline" disabled={!canSpeak || status!=='ASKED' || busy || blocked || !!error || timeUp} onClick={() => microphone(muted)}>{muted ? 'Unmute' : 'Mute'}</Button>
      <Button variant="outline" disabled={!canSpeak || busy || blocked || !!error} onClick={() => void action('PAUSE')}>Pause</Button>
      <Button variant="secondary" disabled={!canSpeak || busy || blocked || !!error} onClick={() => void action('LEAVE')}>End practice</Button>
      <Button variant="ghost" disabled={busy || blocked} onClick={() => setConfirmDiscard(true)}>Discard</Button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-amber-400/40 p-3 space-y-3"><p>{error}</p>
      <div className="flex gap-2">{pending.current && <Button disabled={busy} onClick={() => void action(pending.current!.action)}>Retry saving speech</Button>}
        {!pending.current && ['PREPARED','ASKED'].includes(status) && <Button disabled={busy || blocked} onClick={() => void next()}>Retry question</Button>}
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
