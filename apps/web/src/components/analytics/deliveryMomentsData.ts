import { useEffect, useState } from 'react'
import { getAuthHeaders } from '@/lib/api-client'
import type { DeliveryEvidenceState } from './delivery'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const MAX_PENDING_POLLS = 120

export interface DeliveryMoment {
  id: string
  kind: 'sentence_boundary_pause' | 'mid_thought_pause'
  polarity: 'strength' | 'opportunity'
  clipStartSec: number
  clipEndSec: number
  pauseSeconds: number
  confidence: number
  observation: string
  interpretation: string
  retry: string
}

export type DeliveryMomentReason =
  | 'feature_disabled'
  | 'complete_recording_required'
  | 'complete_recording_unavailable'
  | 'committed_user_turns_required'
  | 'validated_word_alignment_required'
  | 'alignment_processing'
  | 'alignment_unavailable'
  | 'no_notable_pause'
  | null

export interface DeliveryMomentResponse {
  status: {
    enabled: boolean
    state: 'available' | 'pending' | 'suppressed'
    reason: DeliveryMomentReason
    validTurnCount: number
    momentCount: number
  }
  moments: DeliveryMoment[]
  deliveryEvidence?: DeliveryEvidenceState
}

export type PlayDeliveryMoment = (
  startSeconds: number,
  endSeconds: number,
  includeGaps?: true,
) => void

export const MEASUREMENT_CONFIDENCE_NOTE =
  'Measurement confidence: limited — microphone/browser processing may affect results.'

/** One-line notice for Playback, where an empty result must stay compact. */
export function playbackNoticeCopy(data: DeliveryMomentResponse, pendingTimedOut: boolean): string {
  if (data.status.reason === 'alignment_processing') return pendingTimedOut
    ? 'Delivery analysis is continuing in the background. Reopen this session later to see the results.'
    : 'Preparing delivery moments from your recording. This can take a few minutes; you can leave this page.'
  if (data.status.reason === 'alignment_unavailable') return 'We could not verify word timing for this recording. Playback and other feedback remain available.'
  if (data.status.state === 'pending') {
    return pendingTimedOut
      ? 'Delivery moments are still being prepared — reload after the recording has finished saving.'
      : 'Delivery moments are being prepared while the recording finishes saving…'
  }
  switch (data.status.reason) {
    case 'complete_recording_required':
      return 'Delivery moments will appear once every recording segment is available.'
    case 'complete_recording_unavailable':
      return 'Delivery moments unavailable — one or more recording segments are missing.'
    case 'committed_user_turns_required':
      return 'Delivery moments will appear after your turns are saved.'
    case 'no_notable_pause':
      return 'No pause in this recording met the evidence threshold for a delivery moment.'
    case 'validated_word_alignment_required':
    default:
      return 'Delivery moments unavailable for this recording — verified word timing is required to identify pause placement reliably.'
  }
}

/** Sentence for the Session Analytics summary explaining why no moments are listed. */
export function overviewReasonCopy(data: DeliveryMomentResponse, pendingTimedOut: boolean): string {
  if (data.status.reason === 'alignment_processing' || data.status.reason === 'alignment_unavailable') {
    return playbackNoticeCopy(data, pendingTimedOut)
  }
  if (data.status.state === 'pending') {
    return pendingTimedOut
      ? 'Verified delivery moments are still being prepared. Reload after the recording has finished saving.'
      : 'Verified delivery moments are being prepared while the recording finishes saving.'
  }
  switch (data.status.reason) {
    case 'complete_recording_required':
    case 'complete_recording_unavailable':
      return 'Verified delivery moments are not available because part of the recording is missing.'
    case 'committed_user_turns_required':
      return 'Verified delivery moments will appear after your turns are saved.'
    case 'no_notable_pause':
      return 'Word-level alignment was confirmed, but no pause met the evidence threshold for a delivery moment.'
    case 'validated_word_alignment_required':
    default:
      return 'Verified delivery moments are not available because word-level alignment could not be confirmed.'
  }
}

export function hasVerifiedObservations(evidence: DeliveryEvidenceState | undefined): boolean {
  return (
    evidence?.state === 'ready' &&
    evidence.moments.some((moment) => moment.evidence.quality === 'verified')
  )
}

export function useDeliveryMoments(sessionId: string | undefined) {
  const [data, setData] = useState<DeliveryMomentResponse | null>(null)
  const [pendingTimedOut, setPendingTimedOut] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let retry: number | undefined
    let pendingPolls = 0
    setData(null)
    setPendingTimedOut(false)
    const load = () => {
      fetch(`${API_BASE_URL}/sessions/${sessionId}/delivery-moments`, {
        headers: getAuthHeaders(),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => {
          if (cancelled || !value) return
          const next = value as DeliveryMomentResponse
          setData(next)
          // A completed session can receive its final turn/upload just after
          // Results opens. Poll only while evidence is explicitly pending, and
          // cap the client loop so a broken upload cannot spin indefinitely.
          if (next.status.state === 'pending') {
            pendingPolls += 1
            if (pendingPolls < MAX_PENDING_POLLS) retry = window.setTimeout(load, 10_000)
            else setPendingTimedOut(true)
          }
        })
        .catch(() => {
          /* Delivery evidence is additive; replay and analytics must still load. */
        })
    }
    load()
    return () => {
      cancelled = true
      if (retry != null) window.clearTimeout(retry)
    }
  }, [sessionId])

  return { data, pendingTimedOut }
}
