import { z } from 'zod'

const captureSetting = z.object({
  requested: z.boolean().nullable().optional(),
  applied: z.boolean().nullable().optional(),
  supported: z.boolean(),
}).strict()

const captureSettings = z.object({
  autoGainControl: captureSetting,
  noiseSuppression: captureSetting,
  echoCancellation: captureSetting,
  voiceIsolation: captureSetting,
}).strict()

export type StoredCaptureSettings = z.infer<typeof captureSettings>
type CaptureKey = keyof StoredCaptureSettings

const CAPTURE_KEYS: CaptureKey[] = [
  'autoGainControl',
  'noiseSuppression',
  'echoCancellation',
  'voiceIsolation',
]

export function parseRecordingCaptureSettings(value: unknown): StoredCaptureSettings | null {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('Invalid capture settings')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new Error('Invalid capture settings JSON')
  }
  const parsed = captureSettings.safeParse(decoded)
  if (!parsed.success) throw new Error('Invalid capture settings')
  return parsed.data
}

export function captureSettingsForDelivery(
  segmentId: string,
  value: unknown,
): StoredCaptureSettings | null {
  if (value == null) return null
  const parsed = captureSettings.safeParse(value)
  if (parsed.success) return parsed.data
  console.warn(`[delivery] invalid capture settings for segment ${segmentId}; treating capture as unknown`)
  return null
}

export function appliedCaptureSettings(settings: StoredCaptureSettings | null) {
  return {
    automaticGainControl: settings?.autoGainControl.applied ?? null,
    noiseSuppression: settings?.noiseSuppression.applied ?? null,
    echoCancellation: settings?.echoCancellation.applied ?? null,
    voiceIsolation: settings?.voiceIsolation.applied ?? null,
  }
}

export function captureFingerprint(settings: StoredCaptureSettings | null): string {
  return CAPTURE_KEYS.map((key) => {
    const setting = settings?.[key]
    return `${key}:${setting?.applied ?? 'unknown'}:${setting?.requested ?? 'unknown'}:${setting?.supported ?? 'unknown'}`
  }).join('|')
}
