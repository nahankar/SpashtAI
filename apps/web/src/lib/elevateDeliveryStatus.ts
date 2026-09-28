type DeliveryState = 'pending' | 'processing' | 'retry' | 'completed' | 'unavailable'

export interface ElevateDeliveryTiming {
  state: 'complete' | 'partial'
  acceptedTurnCount: number
  totalTurnCount: number
  source: 'forced_alignment' | 'live_recording_clock' | 'mixed'
}

export interface ElevateDeliveryStatus {
  state: DeliveryState | null
  reason: string | null
  timing: ElevateDeliveryTiming | null
  requestError: 'unauthorized' | 'forbidden' | 'not-found' | 'unavailable' | null
  ready: boolean
  timedOut: boolean
}

export const EMPTY_ELEVATE_DELIVERY_STATUS: ElevateDeliveryStatus = {
  state: null, reason: null, timing: null, requestError: null, ready: false, timedOut: false,
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function isDeliveryState(value: unknown): value is DeliveryState {
  return value === 'pending' || value === 'processing' || value === 'retry'
    || value === 'completed' || value === 'unavailable'
}

function parseStatus(value: unknown): ElevateDeliveryStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unexpected delivery status response.')
  }
  const data = object(value)
  const state = data.deliveryAlignmentStatus ?? null
  if (state !== null && !isDeliveryState(state)) {
    throw new Error('Unexpected delivery status response.')
  }
  const timing = object(object(data.processingStatus).deliveryTiming)
  const timingState = timing.state
  const accepted = timing.acceptedTurnCount
  const total = timing.totalTurnCount
  const source = timing.source === 'live_recording_clock' || timing.source === 'forced_alignment'
    || timing.source === 'mixed'
    ? timing.source : null
  const validTiming = state === 'completed' && source != null
    && (timingState === 'complete' || timingState === 'partial')
    && typeof accepted === 'number' && Number.isInteger(accepted) && accepted >= 0
    && typeof total === 'number' && Number.isInteger(total) && total > 0 && accepted <= total
    && (timingState !== 'complete' || accepted === total)
  return {
    ...EMPTY_ELEVATE_DELIVERY_STATUS,
    state,
    reason: typeof data.deliveryAlignmentError === 'string' && data.deliveryAlignmentError
      ? data.deliveryAlignmentError : null,
    timing: validTiming ? {
      state: timingState,
      acceptedTurnCount: accepted,
      totalTurnCount: total,
      source,
    } : null,
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'waiting_for_complete_transcript':
      return 'The full transcript is not available yet.'
    case 'waiting_for_recording_or_transcript':
      return 'The recording or transcript is not available yet.'
    case 'complete_user_audio_required':
      return 'Some parts of your recording are missing.'
    case 'alignment_coverage_insufficient':
      return 'Too little speech could be matched reliably to the recording.'
    case 'alignment_rejected':
      return 'Your recording does not match the transcript closely enough to time your words. Part of the recording may not have been captured.'
    case 'alignment_timeout':
      return 'Matching speech to the recording took longer than expected.'
    case 'alignment_process_unavailable':
    case 'alignment_service_failed':
    case 'alignment_input_failed':
      return 'The delivery analysis service could not finish this attempt.'
    case 'invalid_alignment_output':
    case 'alignment_output_limit':
      return 'The timing results could not be verified.'
    default:
      return 'Word timing could not be verified for this recording.'
  }
}

export function elevateDeliveryStatusLabel(status: ElevateDeliveryStatus): string | null {
  if (status.requestError) {
    switch (status.requestError) {
      case 'unauthorized': return 'Sign in again to check delivery analysis. Your current results have not been refreshed.'
      case 'forbidden': return 'You do not have access to delivery analysis for this session.'
      case 'not-found': return 'Delivery analysis could not be found for this session.'
      case 'unavailable': return status.timedOut
        ? 'Delivery analysis status could not be checked. Refresh this page later to try again.'
        : 'Delivery analysis status could not be checked. We will try again shortly; your current results have not been refreshed.'
    }
  }
  const reason = status.reason ? ` ${reasonLabel(status.reason)}` : ''
  const later = status.timedOut
    ? ' Status checks are paused; analysis may continue in the background. Refresh this page later for updated results.'
    : ''
  switch (status.state) {
    case 'pending':
      return `Delivery analysis is queued.${reason} Come back after a few minutes.${later}`
    case 'processing':
      return `Preparing delivery analysis from your recording.${reason} This can take a few minutes. Come back after a few minutes.${later}`
    case 'retry':
      return `Delivery analysis will retry automatically.${reason || ' The previous attempt could not finish.'}${later}`
    case 'unavailable':
      return `Delivery analysis is unavailable.${reason || ' Word timing could not be verified for this recording.'} Playback and other feedback remain available.`
    case 'completed': {
      const timing = status.timing
      const coverage = !timing ? ''
        : timing.source === 'live_recording_clock'
          ? ` Live word timing matched your recording for ${timing.acceptedTurnCount} of ${timing.totalTurnCount} speaking turns.`
          : timing.source === 'mixed'
            ? ` Word timing verified for ${timing.acceptedTurnCount} of ${timing.totalTurnCount} speaking turns. Live recording timing was kept where it matched, and alignment filled the remaining turns.`
            : ` Word timing verified for ${timing.acceptedTurnCount} of ${timing.totalTurnCount} speaking turns.`
      return timing?.state === 'partial'
        ? `Delivery analysis finished with partial coverage.${coverage} Unverified turns are excluded from timing-based feedback.${reason} Playback and other feedback remain available.`
        : `Delivery analysis is ${status.ready ? 'ready' : 'complete'}.${coverage}${reason}`
    }
    default:
      return status.reason ? `Delivery analysis could not be verified.${reason}` : null
  }
}

type StatusResponse = Pick<Response, 'ok' | 'status' | 'json'>

/** Cancels the request and scheduled polls; late responses cannot publish. */
export function watchElevateDeliveryStatus(
  load: (signal: AbortSignal) => Promise<StatusResponse>,
  onChange: (status: ElevateDeliveryStatus) => void,
  {
    intervalMs = 10_000, maxPolls = 120,
    requestTimeoutMs = 15_000, maxWaitMs = 20 * 60_000,
  } = {},
): () => void {
  if (![intervalMs, maxPolls, requestTimeoutMs, maxWaitMs].every(value =>
    Number.isFinite(value) && value > 0) || !Number.isInteger(maxPolls)) {
    throw new RangeError('Delivery polling limits must be positive and finite.')
  }
  const controller = new AbortController()
  const deadline = Date.now() + maxWaitMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let polls = 0
  let wasPending = false
  let latest = EMPTY_ELEVATE_DELIVERY_STATUS

  const request = async (): Promise<ElevateDeliveryStatus> => {
    const attempt = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let cancel: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        attempt.abort()
        reject(new DOMException('Delivery status polling stopped', 'AbortError'))
      }
      controller.signal.addEventListener('abort', cancel, { once: true })
      timeout = setTimeout(() => {
        attempt.abort()
        reject(new Error('Delivery status request timed out.'))
      }, Math.max(0, Math.min(requestTimeoutMs, deadline - Date.now())))
    })
    try {
      return await Promise.race([
        (async (): Promise<ElevateDeliveryStatus> => {
          const response = await load(attempt.signal)
          const terminalError = response.status === 401 ? 'unauthorized'
            : response.status === 403 ? 'forbidden'
              : response.status === 404 ? 'not-found' : null
          if (terminalError) return { ...EMPTY_ELEVATE_DELIVERY_STATUS, requestError: terminalError }
          if (!response.ok) throw new Error('Delivery status request failed.')
          return parseStatus(await response.json())
        })(),
        interrupted,
      ])
    } finally {
      clearTimeout(timeout)
      if (cancel) controller.signal.removeEventListener('abort', cancel)
    }
  }

  const poll = async () => {
    if (controller.signal.aborted) return
    if (Date.now() >= deadline) {
      onChange({ ...latest, timedOut: true })
      return
    }
    let repeat = false
    try {
      const status = await request()
      if (controller.signal.aborted) return
      latest = status
      repeat = latest.state === 'pending' || latest.state === 'processing' || latest.state === 'retry'
      wasPending ||= repeat
      latest.ready = latest.state === 'completed' && wasPending
    } catch {
      if (controller.signal.aborted) return
      latest = { ...latest, requestError: 'unavailable', ready: false }
      repeat = true
    }
    if (controller.signal.aborted) return
    polls += 1
    latest = { ...latest, timedOut: repeat && (polls >= maxPolls || Date.now() >= deadline) }
    onChange(latest)
    if (repeat && !latest.timedOut && !controller.signal.aborted) {
      timer = setTimeout(() => { void poll() }, Math.min(intervalMs, deadline - Date.now()))
    }
  }
  void poll()
  return () => {
    controller.abort()
    clearTimeout(timer)
  }
}
