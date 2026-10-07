export interface LiveSessionApiDependencies {
  baseUrl: string
  fetch: typeof fetch
  headers: () => Record<string, string>
  now: () => Date
  randomId: () => string
}

export function createLiveSessionApi(deps: LiveSessionApiDependencies) {
  const { baseUrl, now, randomId } = deps
  const getAuthHeaders = deps.headers
  const request: typeof fetch = (input, init) => deps.fetch(input, init)
async function createSessionSegment(sessionId: string, roomName: string): Promise<string> {
  const segmentId = randomId()
  const response = await request(`${baseUrl}/sessions/${sessionId}/segments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      segmentId,
      roomName,
      startedAt: now().toISOString(),
    }),
  })
  if (!response.ok) throw new Error('Failed to start session segment')
  return segmentId
}

async function closeSessionSegment(
  sessionId: string,
  segmentId: string,
  audioStatus: 'available' | 'pending' | 'failed' | 'unavailable',
  endedAt: Date = now(),
): Promise<void> {
  const response = await request(
    `${baseUrl}/sessions/${sessionId}/segments/${segmentId}`,
    {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ endedAt: endedAt.toISOString(), audioStatus }),
    },
  )
  if (!response.ok) throw new Error('Failed to close session segment')
}

// Helper function to save session data to backend
async function saveSessionData(sessionId: string, metrics: unknown, transcript: unknown) {
  try {
    const metricsResponse = await request(`${baseUrl}/sessions/${sessionId}/metrics`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(metrics)
    })
    
    if (!metricsResponse.ok) {
      throw new Error(`Failed to save metrics: ${metricsResponse.statusText}`)
    }

    const transcriptResponse = await request(`${baseUrl}/sessions/${sessionId}/transcript`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(transcript)
    })
    
    if (!transcriptResponse.ok) {
      throw new Error(`Failed to save transcript: ${transcriptResponse.statusText}`)
    }

    console.log('✅ Session data saved successfully')
  } catch (error) {
    console.error('❌ Failed to save session data:', error)
  }
}


  async function requestAgentDispatch(room: string, sessionId: string | null, segmentId: string | null) {
    return request(`${baseUrl}/livekit/dispatch`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ room, sessionId, segmentId }),
    })
  }
  async function fetchLiveToken(query: Record<string, string>, signal?: AbortSignal) {
    const url = new URL(`${baseUrl}/livekit/token`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await request(url.toString(), { headers: getAuthHeaders(), ...(signal ? { signal } : {}) })
    if (!response.ok) throw new Error('Failed to get token')
    return response.json() as Promise<{ token: string; url: string }>
  }
  return { createSessionSegment, closeSessionSegment, saveSessionData, fetchLiveToken, requestAgentDispatch,
    request(path: string, init?: RequestInit) {
      return request(`${baseUrl}${path}`, { ...init, headers: getAuthHeaders() })
    } }
}
export type LiveSessionApi = ReturnType<typeof createLiveSessionApi>
