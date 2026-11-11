import { z } from 'zod'

export const rateLimitSettingsSchema = z.object({
  apiRateLimitMax: z.number().int().min(1).max(1_000_000),
  apiRateLimitWindowMinutes: z.number().int().min(1).max(1440),
  authRateLimitMax: z.number().int().min(1).max(1_000_000),
  authRateLimitWindowMinutes: z.number().int().min(1).max(1440),
})
export type RateLimitSettings = z.infer<typeof rateLimitSettingsSchema>
export const DEFAULT_RATE_LIMIT_SETTINGS: RateLimitSettings = {
  apiRateLimitMax: 100, apiRateLimitWindowMinutes: 1,
  authRateLimitMax: 5, authRateLimitWindowMinutes: 15,
}
