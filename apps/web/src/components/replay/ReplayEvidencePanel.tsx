import { useEffect, useRef, useState } from 'react'
import { getAuthHeaders } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Clip, ReplayEvidence } from './evidence-contract'
import { playReplayClip } from './clip-playback'
import { exactAliasSpeaker, hintedSpeaker, rankSpeakerChoices } from '@/lib/replayResultsView'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const reasons: Record<string, string> = {
  word_timing_missing_or_legacy: 'Word timing is not available for this analysis. Cue times and older segment-only results are not measured delivery.',
  media_duration_unavailable: 'We could not establish the retained recording’s playable duration.',
  confirm_learner: 'Confirm your speaker below to see learner-specific evidence.',
  provider_stream_incomplete: 'Transcription ended before completion. Local samples are provisional; overall pace is unavailable.',
  transcript_revision_mismatch: 'The transcript has changed. Delivery evidence must be refreshed before it can be shown.',
  word_transcript_mismatch: 'The word evidence does not match the displayed transcript. Delivery is unavailable for this analysis.',
  word_evidence_malformed: 'The stored word evidence could not be validated. Delivery is unavailable for this analysis.',
}
export function ReplayEvidencePanel({ sessionId, evidence, audioDisabled, speakerHint, sessionName, meetingDate, speakerAliases, userFullName, onAliasesSaved, onConfirmed }: {
  sessionId: string
  evidence: ReplayEvidence
  audioDisabled: boolean
  speakerHint?: string | null
  sessionName?: string | null
  meetingDate?: string | null
  speakerAliases?: string[]
  userFullName?: string | null
  onAliasesSaved?: (aliases: string[]) => void
  onConfirmed: (selection: { selectionRevision: string; transcriptRevision: string }) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const operation = useRef<AbortController | null>(null)
  const confirmation = useRef<AbortController | null>(null)
  const blobUrl = useRef<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const initialAliases = [...new Set([...(speakerAliases ?? []), userFullName?.trim() ?? ''].filter(Boolean))]
  const exactAlias = exactAliasSpeaker(evidence.speakers, initialAliases)
  const speakers = rankSpeakerChoices(evidence.speakers, exactAlias ?? speakerHint)
  const [speaker, setSpeaker] = useState(evidence.identity.speaker ?? exactAlias ?? hintedSpeaker(evidence.speakers, speakerHint) ?? (evidence.speakerChoice === 'single_unlabelled' ? evidence.speakers[0]?.speaker ?? '' : ''))
  const [title, setTitle] = useState(sessionName?.trim() || 'Replay session')
  const [date, setDate] = useState(meetingDate ? new Date(meetingDate).toISOString().slice(0, 10) : '')
  const [aliases, setAliases] = useState(initialAliases.join(', '))
  const [saving, setSaving] = useState(false)
  useEffect(() => () => {
    operation.current?.abort()
    confirmation.current?.abort()
    audio.current?.pause()
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
  }, [])
  useEffect(() => {
    if (!audioDisabled) return
    operation.current?.abort()
    audio.current?.pause()
    audio.current?.removeAttribute('src')
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
    blobUrl.current = null
  }, [audioDisabled])
  async function play(clip: Clip) {
    operation.current?.abort()
    const abort = new AbortController(); operation.current = abort
    setBusy(true); setMessage('Loading recording…')
    try {
      const media = audio.current
      if (!media || !evidence.recording || audioDisabled) throw new Error('Recording access unavailable')
      if (!blobUrl.current) {
        const response = await fetch(`${API}/api/replay/sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(evidence.recording.uploadId)}`, { headers: getAuthHeaders(), signal: abort.signal })
        if (!response.ok) throw new Error('Recording access unavailable. Check your access or refresh this result.')
        const blob = await response.blob()
        if (abort.signal.aborted) return
        blobUrl.current = URL.createObjectURL(blob)
        media.src = blobUrl.current; media.load()
      }
      await playReplayClip(media, clip, abort.signal, () => { if (operation.current === abort) { setBusy(false); setMessage('Playback stopped.') } })
      if (!abort.signal.aborted && !media.paused) setMessage(`Playing ${time(clip.start)}–${time(clip.end)}. Gaps are preserved.`)
    } catch (error) {
      if (!abort.signal.aborted) { setMessage(error instanceof Error ? error.message : 'Playback failed.'); setBusy(false) }
    }
  }
  async function confirm() {
    if (!title.trim() || !date) {
      setMessage('Confirm the session name and meeting date before analysis.')
      return
    }
    operation.current?.abort(); setSaving(true); setMessage('')
    confirmation.current?.abort()
    const abort = new AbortController(); confirmation.current = abort
    try {
      const aliasValues = [...new Map(aliases.split(',').map(value => value.trim()).filter(Boolean)
        .map(value => [value.toLocaleLowerCase(), value])).values()]
      const profileResponse = await fetch(`${API}/api/auth/me`, {
        method: 'PUT', signal: abort.signal, headers: getAuthHeaders(), body: JSON.stringify({ speakerAliases: aliasValues }),
      })
      if (!profileResponse.ok) throw new Error('Could not save transcript aliases.')
      await profileResponse.json()
      onAliasesSaved?.(aliasValues)
      const metadataResponse = await fetch(`${API}/api/replay/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH', signal: abort.signal, headers: getAuthHeaders(),
        body: JSON.stringify({ sessionName: title.trim(), meetingDate: date, participantName: speaker }),
      })
      if (!metadataResponse.ok) throw new Error('Could not save the session name and date.')
      const response = await fetch(`${API}/api/replay/sessions/${encodeURIComponent(sessionId)}/learner`, {
        method: 'PUT', signal: abort.signal, headers: getAuthHeaders(), body: JSON.stringify({ speaker, transcriptRevision: evidence.transcriptRevision,
          recordingSignature: evidence.recording?.signature ?? null, selectionRevision: evidence.identity.revision }),
      })
      if (!response.ok) throw new Error('Could not confirm. Refresh if the analysis changed.')
      const result = await response.json()
      if (!abort.signal.aborted) onConfirmed({
        selectionRevision: result.selection.revision,
        transcriptRevision: evidence.transcriptRevision,
      })
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : 'Confirmation failed') }
    finally { if (!abort.signal.aborted) setSaving(false) }
  }
  const playable = !!evidence.recording && !audioDisabled
  const singleUnlabelled = evidence.speakerChoice === 'single_unlabelled'
  const optionLabel = (label: string) => singleUnlabelled ? 'This recording is only my speech' : label
  return <section className="rounded-xl border p-6 space-y-5" aria-labelledby="replay-evidence-heading">
    <h2 id="replay-evidence-heading" className="text-xl font-semibold">Delivery evidence</h2>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="replay-session-name">Session name</Label>
        <Input id="replay-session-name" value={title} onChange={event => setTitle(event.target.value)} />
        <p className="text-xs text-muted-foreground">Suggested from the upload. Edit it before analysis.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="replay-meeting-date">Meeting date</Label>
        <Input id="replay-meeting-date" type="date" value={date} onChange={event => setDate(event.target.value)} />
        <p className="text-xs text-muted-foreground">Extracted when available; required for Progress Pulse.</p>
      </div>
    </div>
    <div className="grid gap-2">
      <Label htmlFor="replay-speaker-aliases">Your transcript names and aliases</Label>
      <Input id="replay-speaker-aliases" value={aliases} onChange={event => setAliases(event.target.value)}
        placeholder="Neelesh Ahankari, Neelesh, N. Ahankari" />
      <p className="text-xs text-muted-foreground">Comma-separated aliases are saved to your profile and only preselect an exact speaker-label match.</p>
    </div>
    <p>{evidence.identity.state === 'confirmed' ? `Confirmed speaker: ${singleUnlabelled ? 'your speech' : evidence.identity.speaker}` : singleUnlabelled ? 'No named speakers were found.' : 'Which speaker are you?'}</p>
    <p className="text-sm text-muted-foreground">{singleUnlabelled
      ? 'If this recording contains only your speech, confirm that below. This does not identify you from the audio.'
      : 'Speaker labels are anonymous—not identity or isolated audio. Confirm one label; if your voice was split across labels, this view covers only the selected label.'}</p>
    {evidence.speakerChoice === 'insufficient_labels' && <p role="status">This transcript does not include a usable speaker label, and there is not enough unlabelled speech to confirm a single speaker. Personalized insights stay unavailable until the transcript names speakers or contains enough of one speaker’s speech.</p>}
    <fieldset className="space-y-3" disabled={saving}>
      <legend className="font-medium">Confirm your speaker</legend>
      {speakers.map(item => <div key={item.speaker} className="border rounded-lg p-3 space-y-2">
        <label className="flex gap-2"><input type="radio" name="learner-speaker" value={item.speaker} checked={speaker === item.speaker} onChange={() => setSpeaker(item.speaker)} />{optionLabel(item.speaker)}</label>
        {item.excerpt && <p className="text-sm">“{item.excerpt}”</p>}
        {playable && item.preview && <Button variant="outline" size="sm" onClick={() => void play(item.preview!)}>Preview {item.speaker}</Button>}
        {playable && !item.preview && <p className="text-sm text-muted-foreground">No suitable continuous audio excerpt for this speaker. Use the transcript excerpt to help identify them.</p>}
      </div>)}
      <Button disabled={!speaker || !title.trim() || !date || saving || evidence.speakerChoice === 'insufficient_labels'} onClick={() => void confirm()}>{saving ? 'Starting analysis…' : 'Confirm details and analyze'}</Button>
    </fieldset>
    <div role="status" className="space-y-2">
      <p>{evidence.reason ? reasons[evidence.reason] ?? evidence.reason : evidence.state === 'empty' ? 'No notable word gaps met the evidence rules.' : `${evidence.moments.length} model-timed moments · ${Math.round(evidence.coverage * 100)}% eligible selected-speaker word coverage`}</p>
      <p>Pace: {evidence.pace.wpm == null ? 'Not available' : `${Math.round(evidence.pace.wpm)} WPM · model-timed`}</p>
    </div>
    <audio ref={audio} preload="none" onError={() => { operation.current?.abort(); setMessage('The browser cannot play this recording.'); setBusy(false) }} />
    {busy && <Button variant="outline" onClick={() => { operation.current?.abort(); setBusy(false); setMessage('Playback stopped.') }}>Stop playback</Button>}
    <p role="status" aria-live="polite">{message}</p>
    {evidence.moments.map(moment => <article key={moment.id} className="rounded-lg border p-4 space-y-2">
      <h3 className="font-medium">{time(moment.start)}–{time(moment.end)} · Word gap</h3>
      <p>{moment.description}</p><p className="text-sm text-muted-foreground">{moment.limitation}</p>
      <div className="flex gap-2"><Button disabled={!playable} onClick={() => void play(moment)}>Hear this moment</Button>
        <Button variant="outline" disabled={!playable} onClick={() => void play({ start: Math.max(0, moment.start - 3), end: Math.min(evidence.recording?.duration ?? moment.end, moment.end + 3) })}>Hear surrounding context</Button></div>
      <p className="text-sm">Listen again: would you keep this gap or try a different delivery?</p>
    </article>)}
    {audioDisabled && <p>Recording playback is disabled for your account.</p>}
    <details><summary>Evidence and limitations</summary><div className="text-sm space-y-2 mt-3">
      <p>{evidence.measurement}</p><p>Source: {evidence.source} · {evidence.version}</p>
      <p>{evidence.eligibleWords} eligible words; {evidence.excludedWords} excluded. Overlap detection and capture settings are unknown.</p>
      {evidence.limitations.map(l => <p key={l}>{l}</p>)}
      {evidence.supplementaryTranscript?.status === 'different_not_aligned' && <p>The uploaded text differs from the audio transcript. Its words have not been given audio timestamps; valid audio passages remain independently eligible.</p>}
      {evidence.supplementaryTranscript?.status === 'unavailable' && <p>The supplemental text could not be read. This analysis uses only the recording’s transcript.</p>}
    </div></details>
  </section>
}
