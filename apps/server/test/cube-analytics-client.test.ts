import jwt from 'jsonwebtoken'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCubeAnalytics } from '../src/analytics/cubeAnalyticsClient'

describe('Cube analytics client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.CUBE_API_URL
    delete process.env.CUBEJS_API_SECRET
  })

  it('uses a short-lived AI-group JWT and the private load endpoint', async () => {
    process.env.CUBE_API_URL = 'http://cube.internal/cubejs-api/v1/'
    process.env.CUBEJS_API_SECRET = 'test-cube-secret'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ 'learner_explorer.count': '4' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await loadCubeAnalytics({ measures: ['learner_explorer.count'] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://cube.internal/cubejs-api/v1/load')
    const token = String(init.headers.authorization).replace('Bearer ', '')
    const decoded = jwt.verify(token, 'test-cube-secret') as jwt.JwtPayload
    expect(decoded.groups).toEqual(['ai'])
    expect(decoded.exp! - decoded.iat!).toBe(120)
  })
})
