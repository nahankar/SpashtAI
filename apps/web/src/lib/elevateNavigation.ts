/**
 * The Elevate header always links to /elevate. Leaving a results URL must
 * restore the session list unless a live connection is actually open.
 */
export function shouldReturnToElevateList(input: {
  previousSessionId: string | null
  nextSessionId: string | null
  hasLiveConnection: boolean
  paused: boolean
  joining: boolean
  leaving: boolean
}): boolean {
  return Boolean(input.previousSessionId)
    && !input.nextSessionId
    && !input.hasLiveConnection
    && !input.paused
    && !input.joining
    && !input.leaving
}
