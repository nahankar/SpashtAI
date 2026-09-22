import { describe, expect, it } from 'vitest'
import {
  mergePaceIntoProcessingStatus,
  PACE_RECONCILIATION_BATCH_SIZE,
  paceReconciliationEligibilityWhere,
  requeuePaceReconciliationData,
  reconciliationStatusAfterAttempt,
  shouldAttemptPaceReconciliation,
} from '../src/lib/paceReconciliationWorker'

describe('pace reconciliation lifecycle', () => {
  it('becomes eligible when endedAt arrives after agent teardown', () => {
    const lifecycle = {
      endedAt: null as Date | null,
      discardedAt: null as Date | null,
      userTurnCount: 2,
    }

    expect(shouldAttemptPaceReconciliation(lifecycle)).toBe(false)

    lifecycle.endedAt = new Date()
    expect(shouldAttemptPaceReconciliation(lifecycle)).toBe(true)
  })

  it('never reconciles an ended session being discarded', () => {
    expect(
      shouldAttemptPaceReconciliation({
        endedAt: new Date(),
        discardedAt: new Date(),
        userTurnCount: 2,
      }),
    ).toBe(false)
  })

  it('selects only durable outstanding jobs in bounded batches', () => {
    const now = new Date('2026-09-23T00:00:00Z')
    expect(PACE_RECONCILIATION_BATCH_SIZE).toBe(100)
    expect(paceReconciliationEligibilityWhere(now)).toEqual({
      endedAt: { not: null },
      discardedAt: null,
      paceReconciliationStatus: { in: ['pending', 'retry', 'processing'] },
      OR: [
        { paceReconciliationLeaseUntil: null },
        { paceReconciliationLeaseUntil: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { nextPaceReconciliationAt: null },
            { nextPaceReconciliationAt: { lte: now } },
          ],
        },
      ],
    })
  })

  it('requeues late evidence after a job was waiting for evidence', () => {
    const now = new Date('2026-09-23T00:05:00Z')
    expect(requeuePaceReconciliationData(now)).toEqual({
      paceReconciliationStatus: 'pending',
      paceReconciliationAttempts: 0,
      paceReconciliationError: null,
      nextPaceReconciliationAt: now,
      paceReconciliationLeaseId: null,
      paceReconciliationLeaseUntil: null,
    })
  })

  it('waits for late evidence instead of permanently completing an unready job', () => {
    expect(reconciliationStatusAfterAttempt(false, 5)).toBe('waiting_for_evidence')
    expect(reconciliationStatusAfterAttempt(false, 2)).toBe('retry')
    expect(reconciliationStatusAfterAttempt(true, 1)).toBe('completed')
  })

  it('merges pace into the latest status without losing concurrent keys', () => {
    expect(
      mergePaceIntoProcessingStatus(
        {
          audioStatus: 'available',
          audio_processed: true,
          content_processed: true,
        },
        { status: 'available', wpm: 123 },
      ),
    ).toEqual({
      audioStatus: 'available',
      audio_processed: true,
      content_processed: true,
      pace: { status: 'available', wpm: 123 },
    })
  })
})
