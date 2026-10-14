import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RetainCheckbox } from '@/components/session/SessionRetain'
import type { SessionRecorderHandle } from '@/components/session/SessionRecorder'
import { apiClient } from '@/lib/api-client'
import { getInterview, interviewWrite, interviewHistoryPath, interviewPlaybackPath, INTERVIEWS_API, type InterviewHistory, type InterviewOptions, type InterviewRun, type InterviewSetup, type InterviewOperation } from '@/lib/interview-practice'
import { useLiveSession } from '@/features/live-session/useLiveSession'
import { liveSessionApi } from '@/features/live-session/browser'
import { interviewsAdapter } from '@/features/live-session/adapters/interviews'
import { LiveSessionRoom } from '@/features/live-session/components/LiveSessionRoom'
import type { ChatMessage } from '@/features/live-session/types'
import { ConversationPanel } from '@/features/live-session/components/ConversationPanel'
import { interviewConversation } from '@/lib/interview-conversation'
import { InterviewControls } from '@/features/interviews/InterviewControls'

const difficulties=['Simple','Medium','Complex','Very Complex']
const bands=['0-2','2-5','5-8','8+']
const selectClass='w-full rounded-md border bg-background px-3 py-2'
export function Interviews() {
  const [params,setParams]=useSearchParams(); const selected=params.get('run')
  const [options,setOptions]=useState<InterviewOptions|null>(null); const [optionsLoaded,setOptionsLoaded]=useState(false)
  const [history,setHistory]=useState<InterviewHistory[]>([]); const [detail,setDetail]=useState<InterviewRun|null>(null)
  const [setup,setSetup]=useState({track:'Automation Testing',experienceBand:'2-5',startingDifficulty:'Simple',durationMinutes:10})
  const [consent,setConsent]=useState(false); const [error,setError]=useState(''); const [accessError,setAccessError]=useState('')
  const [loading,setLoading]=useState(false); const [messages,setMessages]=useState<ChatMessage[]>([])
  const [observedId,setObservedId]=useState<string|null>(null)
  const [operation,setOperation]=useState<InterviewOperation>(null)
  const recorderRef=useRef<SessionRecorderHandle|null>(null); const activeRun=useRef<string|null>(selected)
  const justStarted=useRef<string|null>(null); const messageRef=useRef(messages); messageRef.current=messages
  async function refreshHistory() {
    const result=await apiClient<{runs:InterviewHistory[]}>(`${INTERVIEWS_API}/runs`); setHistory(result.runs)
  }
  async function refreshDetail() {
    const id=activeRun.current; if (!id) return
    const result=await getInterview(id); if (activeRun.current===id) setDetail(result)
  }
  const live=useLiveSession({
    resetMetrics:()=>undefined,clearMessages:()=>setMessages([]),hideHistory:()=>undefined,
    sessionChanged:setObservedId, toast:(kind,text)=>toast[kind](text), log:()=>undefined,
    messages:()=>messageRef.current,
    addMessage:async (role,content,id)=>setMessages(previous => {
      const next={role,content,id,timestamp:new Date().toISOString()}; const index=id ? previous.findIndex(m=>m.id===id) : -1
      return index<0 ? [...previous,next] : previous.map((m,i)=>i===index?next:m)
    }),
    upsertStreamingMessage:(role,content,id)=>setMessages(previous=> {
      const next={role,content,id,timestamp:new Date().toISOString()}; const index=previous.findIndex(m=>m.id===id)
      return index<0 ? [...previous,next] : previous.map((m,i)=>i===index?next:m)
    }),
    clearActiveSession:()=>undefined,rewardPoints:()=>undefined,
    left:()=>{ void refreshDetail(); void refreshHistory() },
    discarded:()=>{ activeRun.current=null; setDetail(null); setParams({}); void refreshHistory() },discardFinished:()=>undefined,
  },observedId)
  const controller=live.controller
  const adapter=interviewsAdapter(liveSessionApi,{...setup,recordingConsent:true} as InterviewSetup,()=>activeRun.current,run=> {
    activeRun.current=run.id; justStarted.current=run.id; setParams({run:run.id})
  })
  useEffect(() => {
    const abort=new AbortController()
    void Promise.allSettled([
      apiClient<InterviewOptions>(`${INTERVIEWS_API}/options`,{signal:abort.signal}),
      apiClient<{runs:InterviewHistory[]}>(`${INTERVIEWS_API}/runs`,{signal:abort.signal}),
    ]).then(results=> {
      if (abort.signal.aborted) return
      if (results[0].status==='fulfilled') {
        const result=results[0].value; setOptions(result)
        const initial=result.coverage.find(c=>c.track==='Automation Testing' && c.difficulty==='Simple') ?? result.coverage[0]
        if (initial) setSetup(s=>({...s,track:initial.track,experienceBand:initial.experienceBand,startingDifficulty:initial.difficulty}))
      } else setAccessError(results[0].reason instanceof Error ? results[0].reason.message : 'Interview practice is unavailable')
      if (results[1].status==='fulfilled') setHistory(results[1].value.runs)
      setOptionsLoaded(true)
    })
    return ()=>abort.abort()
  },[])
  useEffect(() => {
    if (live.token && activeRun.current && selected!==activeRun.current) {
      setParams({run:activeRun.current},{replace:true})
      return
    }
    if (!optionsLoaded || !selected) { if (!selected) setDetail(null); return }
    const abort=new AbortController(); activeRun.current=selected; setLoading(true); setError('')
    void (async()=> {
      const run=await getInterview(selected,abort.signal); if (abort.signal.aborted) return
      setDetail(run); setObservedId(run.sessionId)
      if (justStarted.current===selected || controller.getSnapshot().sessionId===run.sessionId) return
      setMessages(run.attempts.flatMap(a=>[
        ...(a.status!=='PREPARED' ? [{role:'assistant',content:a.question.text,id:`saved_question_${a.id}`,timestamp:run.startedAt}] : []),
        ...(a.capturedText ? [{role:'user',content:a.capturedText,id:`saved_answer_${a.id}`,timestamp:run.startedAt}] : []),
      ]))
      if (!run.endedAt) {
        controller.patch({sessionId:run.sessionId,isSessionPaused:true,pauseReason:'intentional'})
        if (options) await controller.resume(run.sessionId,abort.signal,true)
      }
    })().catch(e=> { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Interview could not be loaded') })
      .finally(()=> { if (!abort.signal.aborted) setLoading(false) })
    return ()=>abort.abort()
  },[selected,optionsLoaded,options,controller,live.token,setParams])
  useEffect(()=> {
    if (!selected || !live.token) return
    const timer=setInterval(()=> { void getInterview(selected).then(r=> { if (activeRun.current===selected) setDetail(r) }).catch(()=>undefined) },3000)
    return ()=>clearInterval(timer)
  },[selected,live.token])
  const current=detail?.attempts.at(-1)
  const conversationJson=JSON.stringify(detail ? interviewConversation(detail.attempts,messages,detail.startedAt) : [])
  // Keep the shared panel stable when polling returns identical saved speech.
  const conversation=useMemo(()=>JSON.parse(conversationJson) as ChatMessage[],[conversationJson])
  async function start() {
    if (!consent) return
    setError(''); setMessages([])
    await controller.start({sessionName:'Interview practice',focusArea:'',focusContext:'',boothDemo:false},adapter)
    await refreshDetail().catch(()=>undefined); await refreshHistory().catch(()=>undefined)
  }
  async function leave() {
    setError('')
    try {
      if (!controller.getSnapshot().sessionId && activeRun.current) {
        // Room teardown may already have succeeded before an end request failed.
        // Retry the owned end without requiring renewed voice access.
        await interviewWrite(`/runs/${encodeURIComponent(activeRun.current)}/end`)
      } else await controller.leave(recorderRef.current,adapter)
      await refreshDetail(); await refreshHistory()
    } catch (e) { setError(e instanceof Error ? e.message : 'Practice could not be ended. Retry End practice.') }
  }
  async function resume() {
    if (!detail) return
    setError('')
    try { await controller.resume(detail.sessionId,undefined,true) } catch (e) { setError(e instanceof Error ? e.message : 'Could not reconnect') }
  }
  async function reconnect() {
    if (!detail) return
    setError('')
    try {
      const binding=controller.getSnapshot()
      if (binding.token) await controller.onDisconnected(recorderRef.current,{sessionId:binding.sessionId,segmentId:binding.segmentId})
      await controller.resume(detail.sessionId,undefined,true)
      await refreshDetail()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reconnect the interviewer') }
  }
  const coverage=options?.coverage ?? []
  const tracks=[...new Set(coverage.map(c=>c.track))].sort()
  const experience=bands.filter(b=>coverage.some(c=>c.track===setup.track && c.experienceBand===b))
  const levels=difficulties.filter(d=>coverage.some(c=>c.track===setup.track && c.experienceBand===setup.experienceBand && c.difficulty===d))
  const matching=coverage.find(c=>c.track===setup.track && c.experienceBand===setup.experienceBand && c.difficulty===setup.startingDifficulty)?.count ?? 0
  function choose(track:string,experienceBand=setup.experienceBand) {
    const choices=coverage.filter(c=>c.track===track)
    const band=choices.some(c=>c.experienceBand===experienceBand)?experienceBand:choices[0]?.experienceBand ?? '2-5'
    const available=difficulties.filter(d=>choices.some(c=>c.experienceBand===band && c.difficulty===d))
    setSetup(s=>({...s,track,experienceBand:band,startingDifficulty:available.includes(s.startingDifficulty)?s.startingDifficulty:available[0] ?? 'Simple'}))
  }
  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="space-y-2"><h1 className="text-3xl font-semibold">Interviews</h1><p className="text-muted-foreground">Practice technical questions aloud, at your own pace.</p>
      <p className="text-sm text-muted-foreground">This preview saves questions, answers and recordings for review. Technical evaluation is not enabled yet. Interview activity stays outside Progress Pulse.</p></header>
    {accessError && <p role="alert" className="rounded-lg border p-4">{accessError} Your saved interview history is still available below.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading && <p role="status">Loading interview…</p>}
    {!selected && <section className="rounded-xl border bg-card p-5 space-y-5">
      <h2 className="text-xl font-semibold">Start interview practice</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Track<select className={selectClass} value={setup.track} disabled={!options} onChange={e=>choose(e.target.value)}>{tracks.map(t=><option key={t}>{t}</option>)}</select></label>
        <label className="space-y-1 text-sm">Experience<select className={selectClass} value={setup.experienceBand} disabled={!options} onChange={e=>choose(setup.track,e.target.value)}>{experience.map(b=><option key={b} value={b}>{b} years</option>)}</select></label>
        <label className="space-y-1 text-sm">Starting difficulty<select className={selectClass} value={setup.startingDifficulty} disabled={!options} onChange={e=>setSetup(s=>({...s,startingDifficulty:e.target.value}))}>{levels.map(d=><option key={d}>{d}</option>)}</select></label>
        <label className="space-y-1 text-sm">Practice time<select className={selectClass} value={setup.durationMinutes} onChange={e=>setSetup(s=>({...s,durationMinutes:Number(e.target.value)}))}>{[5,10,15].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label>
      </div>
      <p className="text-sm text-muted-foreground">{!options ? 'Practice becomes available once your pilot access and voice pipeline are enabled.' : matching ? `${matching} eligible questions · up to ${Math.min(matching,8)} per practice · pauses do not use practice time` : 'No reviewed questions are ready for this selection. Choose another combination or ask an administrator to confirm a pilot set.'}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={e=>setConsent(e.target.checked)} /><span>I agree to my answers being recorded and transcribed for review. I will avoid sharing confidential company or personal information.</span></label>
      <Button disabled={!consent || !matching || live.isJoining || history.some(h=>!h.endedAt)} onClick={()=>void start()}>{live.isJoining?'Starting…':'Start practice'}</Button>
      {history.some(h=>!h.endedAt) && <p className="text-sm text-muted-foreground">Resume or end your unfinished interview below before starting another.</p>}
    </section>}
    {detail && <section className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">{detail.track} practice</h2><Link className="text-sm underline" to="/interviews" onClick={e=> { if (live.token) { e.preventDefault(); toast.info('Pause or end this practice before opening history.') } }}>Interview history</Link></div>
      {current && !detail.endedAt && <div className="rounded-xl border p-5 space-y-2"><p className="text-sm text-muted-foreground">Question {current.index} · {current.question.difficulty} · {current.question.topic}</p><p className="text-lg font-medium whitespace-pre-wrap">{current.question.text}</p><p className="text-sm text-muted-foreground">{current.question.expectedDepth}</p></div>}
      {live.token && live.url && current && <LiveSessionRoom {...live} token={live.token} url={live.url} recorderRef={recorderRef}
        handleDisconnected={()=>controller.onDisconnected(recorderRef.current,{sessionId:live.sessionId,segmentId:live.segmentId})}
        handleNewMessage={m=>controller.handleMessage(m)} setAssistantState={live.setAssistantState} handleConversationRestart={()=>live.setAssistantState('recovering')}
        statusOverride={operation ? {label:operation==='saving' ? 'Saving answer…' : 'Starting next question…',hint:'Your microphone is muted.'}
          : ['ANSWERED','SKIPPED'].includes(current.status) ? {label:current.status==='ANSWERED' ? 'Answer saved' : 'Question skipped',hint:'Your microphone is muted. Continue or end practice.'} : undefined}
        onTurnMetrics={()=>undefined} updateMetrics={()=>undefined} handleLeave={leave} showMetrics={false} setShowMetrics={()=>undefined}
        handlePause={()=>controller.pause(recorderRef.current)} exportFlags={{enableAudioExport:false}}
        canDiscardPreparePractice={false} isPrepare={false} handleDiscard={()=>controller.discard(recorderRef.current,adapter)}
        retryPauseUpload={()=>controller.retryPauseUpload(recorderRef.current)} pauseWithoutReplayAudio={()=>controller.pauseWithoutReplayAudio()}
        continueInNewSegmentAfterPauseFailure={()=>controller.continueInNewSegment()}
        controls={<InterviewControls runId={detail.id} attemptId={current.id} segmentId={live.segmentId!} status={current.status}
          ready={live.assistantState==='ready'} blocked={live.isPausing || live.isLeaving || !!live.pauseAudioFailure} recorder={()=>recorderRef.current}
          operationChanged={setOperation} changed={refreshDetail} preparing={()=>live.setAssistantState('unknown')} pause={()=>controller.pause(recorderRef.current)}
          leave={leave} incomplete={leave} reconnect={reconnect} discard={()=>controller.discard(recorderRef.current,adapter)} />} />}
      {!live.token && !detail.endedAt && <div className="rounded-xl border p-5 space-y-3"><p>Your interview is paused. Confirmed answers are saved.</p><div className="flex gap-2"><Button disabled={!options || live.isResuming || loading} onClick={()=>void resume()}>{live.isResuming?'Reconnecting…':'Resume practice'}</Button><Button variant="outline" disabled={live.isLeaving} onClick={()=>void leave()}>End practice</Button></div></div>}
      {conversation.length>0 && <ConversationPanel messages={conversation} stitchAdjacentUserMessages={false} />}
      {detail.endedAt && <Link className="text-sm underline" to={interviewPlaybackPath(detail.sessionId)}>Review answer recordings and communication feedback</Link>}
    </section>}
    {!selected && <section className="space-y-3"><h2 className="text-xl font-semibold">Your interview history</h2><p className="text-sm text-muted-foreground">Unfinished practice closes after 24 hours without activity. Retain one interview to keep it open.</p>
      {!history.length && <p className="text-sm text-muted-foreground">Your interviews will appear here.</p>}
      {history.map(h=><article key={h.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h3 className="font-medium">{h.track}</h3><p className="text-sm text-muted-foreground">{h.startingDifficulty} · {h.experienceBand} years · {new Date(h.startedAt).toLocaleString()} · {h.endedAt?'Ended':'In progress'}</p></div><div className="flex items-center gap-3">{!h.endedAt && <RetainCheckbox sessionId={h.sessionId} retained={!!h.retainedAt} onChange={result=>setHistory(rows=>rows.map(r=>({...r,retainedAt:r.sessionId===h.sessionId?result.retainedAt:result.releasedSessionIds.includes(r.sessionId)?null:r.retainedAt})))} />}<Link className="text-sm underline" to={interviewHistoryPath(h)}>{h.endedAt?'Review':'Resume'}</Link></div></article>)}
    </section>}
  </div>
}
