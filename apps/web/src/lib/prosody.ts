const PROSODY_FIELDS = [
  'pitchVariation',
  'energyStability',
  'voiceQuality',
  'pauseCount',
  'meanPauseDuration',
] as const

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True when a prosody payload has at least one finite acoustic measurement. */
export function isUsableProsody(prosody: unknown): boolean {
  if (!prosody || typeof prosody !== 'object') return false
  const p = prosody as Record<string, unknown>
  return PROSODY_FIELDS.some((field) => isFiniteNumber(p[field]))
}

export function hasRealProsody(signals: unknown): boolean {
  if (!signals || typeof signals !== 'object') return false
  return isUsableProsody((signals as { prosody?: unknown }).prosody)
}
