import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ flag: vi.fn(), transaction: vi.fn(), cleanup: vi.fn() }))
vi.mock('../src/lib/prisma', () => ({ prisma: {
  platformFeatureFlag: { findUnique: db.flag }, $transaction: db.transaction,
  interviewEvaluatorBudget: { deleteMany: db.cleanup },
} }))
vi.mock('../src/lib/logger', () => ({ logger: { error: vi.fn() } }))
import { cleanupEvaluatorBudgets, startInterviewEvaluatorWorker, sweepAssessments } from '../src/interviews/evaluator/service'
describe('evaluator worker off-switch and retention schedule', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T20:00:00Z')); db.cleanup.mockResolvedValue({ count: 0 }) })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
  it.each([null, { hidden: false, disabled: true }, { hidden: true, disabled: false }])('returns before job access and cleanup when pilot access is off: %j', async flag => {
    db.flag.mockResolvedValue(flag)
    expect(await sweepAssessments()).toBe(false)
    expect(db.transaction).not.toHaveBeenCalled(); expect(db.cleanup).not.toHaveBeenCalled()
  })
  it('rechecks the flag inside the claim transaction after the early enabled read', async () => {
    db.flag.mockResolvedValueOnce({ hidden: false, disabled: false }).mockResolvedValueOnce({ hidden: false, disabled: true })
    db.transaction.mockImplementationOnce((fn: (tx: unknown) => unknown) => fn({ platformFeatureFlag: { findUnique: db.flag } }))
    expect(await sweepAssessments()).toBe(false)
    expect(db.flag).toHaveBeenCalledTimes(2); expect(db.transaction).toHaveBeenCalledOnce()
    expect(db.cleanup).not.toHaveBeenCalled()
  })
  it('removes only budgets older than seven UTC days', async () => {
    await cleanupEvaluatorBudgets()
    expect(db.cleanup).toHaveBeenCalledWith({ where: { day: { lt: '2026-10-05' } } })
    expect(db.flag).not.toHaveBeenCalled(); expect(db.transaction).not.toHaveBeenCalled()
  })
  it('cleans hourly while disabled, registers only once, and prevents overlapping cleanup', async () => {
    db.flag.mockResolvedValue({ hidden: false, disabled: true })
    let release!: () => void
    db.cleanup.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    startInterviewEvaluatorWorker(); startInterviewEvaluatorWorker()
    expect(vi.getTimerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(3599999)
    expect(db.cleanup).not.toHaveBeenCalled(); expect(db.transaction).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(db.cleanup).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(db.cleanup).toHaveBeenCalledOnce()
    release(); await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(db.cleanup).toHaveBeenCalledTimes(2)
    expect(db.transaction).not.toHaveBeenCalled()
  })
})
