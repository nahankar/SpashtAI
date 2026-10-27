import { z } from 'zod'

/** Agent-reported transcript-integrity events for one answer (append-only; see InterviewTranscriptIssue). */
export const transcriptIssueSchema = z.object({
  segmentId: z.string().min(1).max(80),
  kind: z.enum(['GAP', 'RECOGNITION_UNAVAILABLE', 'RECOGNITION_RECOVERED', 'UNCONFIRMED_ACCEPTED', 'NOISE_IGNORED']),
  lostSpeechSeconds: z.number().positive().max(7200).optional(),
  eventKey: z.string().min(1).max(120),
}).strict().refine(v => (v.kind === 'GAP') === (v.lostSpeechSeconds !== undefined), 'Only a gap carries lost speech seconds')

type Issue = { kind: string; lostSpeechSeconds: number | null; createdAt: Date }

/**
 * Whether an answer's transcript can be graded. A confirmed gap or an accepted unconfirmed stretch is permanent;
 * recognition that stopped responding counts unless it later recovered (a recovery never clears a gap). A short
 * sound treated as noise never makes a transcript incomplete. Lost time is an estimate of detected speech only.
 */
export function transcriptIntegrity(issues: Issue[]) {
  const ordered = [...issues].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const gapSpeechSeconds = Math.round(ordered.filter(i => i.kind === 'GAP').reduce((sum, i) => sum + (i.lostSpeechSeconds ?? 0), 0) * 10) / 10
  let unresolved = false
  for (const issue of ordered) {
    if (issue.kind === 'RECOGNITION_UNAVAILABLE') unresolved = true
    else if (issue.kind === 'RECOGNITION_RECOVERED') unresolved = false
  }
  const unconfirmedAccepted = ordered.some(i => i.kind === 'UNCONFIRMED_ACCEPTED')
  const ignoredSounds = ordered.filter(i => i.kind === 'NOISE_IGNORED').length
  return { incomplete: gapSpeechSeconds > 0 || unresolved || unconfirmedAccepted, gapSpeechSeconds, unresolved, unconfirmedAccepted, ignoredSounds }
}
export type TranscriptIntegrity = ReturnType<typeof transcriptIntegrity>
