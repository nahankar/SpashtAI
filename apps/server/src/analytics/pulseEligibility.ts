import { Prisma } from '@prisma/client'

export const REPLAY_PULSE_ORIGIN = 'replay-server-assessment-v1'

/** Legacy Replay entries have no confirmed-speaker provenance; retain but exclude them. */
export function eligiblePulseWhere(): Prisma.ProgressPulseWhereInput {
  return { OR: [
    { source: { not: 'replay' } },
    { source: 'replay', metadata: { path: ['evidenceOrigin'], equals: REPLAY_PULSE_ORIGIN } },
  ] }
}

export const eligiblePulseSql = Prisma.sql`(
  source <> 'replay' OR metadata->>'evidenceOrigin' = ${REPLAY_PULSE_ORIGIN}
)`
