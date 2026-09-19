import { Prisma } from '@prisma/client'

function jsonObject(
  value: Prisma.JsonValue | Prisma.InputJsonValue | typeof Prisma.JsonNull,
): Record<string, unknown> {
  if (value === Prisma.JsonNull) return {}
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Turn payloads are mostly immutable, but a few interaction fields move in one
 * direction. Preserve those transitions when an older browser snapshot arrives
 * after a newer one.
 */
export function mergeCoachTurnPayload(
  stored: Prisma.JsonValue,
  incoming: Prisma.InputJsonValue | typeof Prisma.JsonNull,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const previous = jsonObject(stored)
  const next = jsonObject(incoming)
  const merged: Record<string, unknown> = { ...previous, ...next }

  for (const key of ['answered', 'confirmed', 'superseded', 'routeAfterConfirm'] as const) {
    if (previous[key] === true || next[key] === true) merged[key] = true
  }
  if (previous.answeredIntent != null) {
    merged.answeredIntent = previous.answeredIntent
  }
  if (previous.confirmed === true && previous.suggestedTitle != null) {
    merged.suggestedTitle = previous.suggestedTitle
  }

  return Object.keys(merged).length > 0
    ? (merged as Prisma.InputJsonObject)
    : Prisma.JsonNull
}
