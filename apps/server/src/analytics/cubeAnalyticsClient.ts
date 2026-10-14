import jwt from 'jsonwebtoken'

export type CubeQuery = {
  measures?: string[]
  dimensions?: string[]
  filters?: Array<{
    member: string
    operator: string
    values?: string[]
  }>
  timeDimensions?: Array<{
    dimension: string
    dateRange: string | [string, string]
  }>
  order?: Record<string, 'asc' | 'desc'>
  limit?: number
  offset?: number
  total?: boolean
}

type CubeLoadResponse = {
  data?: Array<Record<string, string | number | null>>
  total?: number
  error?: string
}

export function isCubeAnalyticsConfigured() {
  return Boolean(process.env.CUBE_API_URL?.trim() && process.env.CUBEJS_API_SECRET?.trim())
}

export async function loadCubeAnalytics(
  query: CubeQuery,
  group: 'ai' | 'admin' = 'ai',
): Promise<CubeLoadResponse> {
  const base = process.env.CUBE_API_URL?.replace(/\/$/, '')
  const secret = process.env.CUBEJS_API_SECRET
  if (!base || !secret) throw new Error('Cube analytics is not configured')
  const token = jwt.sign(
    { groups: [group], source: 'spashtai-api' },
    secret,
    { expiresIn: '2m' },
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${base}/load`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    const payload = await response.json() as CubeLoadResponse
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `Cube returned HTTP ${response.status}`)
    }
    return payload
  } finally {
    clearTimeout(timer)
  }
}
