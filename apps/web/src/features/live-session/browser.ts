import { getAuthHeaders } from '@/lib/api-client'
import { createLiveSessionApi } from './api'
export const liveSessionApi = createLiveSessionApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000',
  fetch: (...args) => fetch(...args), headers: getAuthHeaders,
  now: () => new Date(), randomId: () => crypto.randomUUID(),
})
