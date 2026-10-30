import { parseAnalyticsFilters } from './adminAnalyticsFilters'
import type { IndividualAnalyticsPlan } from './adminAnalyticsQuerySchema'
import { analyticsPlanHash } from './adminAnalyticsQueryEngine'
import { loadDailyActivity } from './dailyActivity'
import { dayRange, loadLearnerProgress, presentRange, resolveLearner } from './learnerReport'
import { MIN_COHORT } from './productEvents'

/**
 * Executes a version 2 plan through the same services as the Admin dashboard (learner progress and day-wise
 * activity), so an equivalent question returns the same figures. The learner is re-resolved on every execution:
 * an account that is gone, or is no longer a learner, returns a no-match result rather than stale data.
 */
export async function executeIndividualPlan(plan: IndividualAnalyticsPlan, now = new Date()) {
  const parsed = parseAnalyticsFilters({
    days: String(plan.days),
    source: plan.sources.join(','),
    skill: plan.skills.join(','),
    feature: plan.feature ?? undefined,
    learner: plan.learnerId ?? undefined,
  }, now)
  if ('error' in parsed) throw new Error(parsed.error)
  const filters = parsed.filters
  const range = dayRange(plan.days, undefined, now)
  const base = {
    kind: 'individual' as const,
    report: plan.report,
    planHash: analyticsPlanHash(plan),
    executedAt: now.toISOString(),
    privacyThreshold: MIN_COHORT,
    range: presentRange(plan.days, range),
  }
  const learner = plan.learnerId ? await resolveLearner(plan.learnerId) : null
  if (plan.learnerId && !learner) {
    return { ...base, status: 'no_match' as const, learner: null, sampleSize: null, missingData: ['The learner account no longer exists or is not a learner account.'] }
  }

  if (plan.report === 'learner_progress') {
    const progress = await loadLearnerProgress(learner!.id, filters, range)
    const missingData: string[] = []
    if (progress.summary.scoreEntries === 0) missingData.push('No eligible Progress Pulse scores in this range.')
    const single = progress.skills.filter((skill) => skill.change === null).map((skill) => skill.skill)
    if (single.length) missingData.push(`No change is reported for ${single.join(', ')}: a change needs scores from two different sessions.`)
    missingData.push('Days without scores are gaps, not zeros. Legacy Replay scores without validated evidence are excluded; Interviews never contribute to Progress Pulse.')
    return {
      ...base,
      status: 'ok' as const,
      learner,
      sampleSize: { scoreEntries: progress.summary.scoreEntries, sessions: progress.summary.sessionsRepresented, days: progress.summary.daysWithScores },
      missingData,
      progress,
    }
  }

  const activity = await loadDailyActivity(filters, range, learner ? { learnerId: learner.id } : null)
  if ('error' in activity) throw new Error(activity.error)
  const missingData: string[] = []
  if (activity.suppressed) missingData.push(`Hidden: fewer than ${MIN_COHORT} learners match.`)
  else {
    for (const [feature, measures] of Object.entries(activity.recordedSince)) {
      for (const [measure, first] of Object.entries(measures)) {
        if (first === null) missingData.push(`${feature} ${measure} has never been recorded.`)
        else if (first !== 'not_applicable' && first > range.firstDay) missingData.push(`${feature} ${measure} is recorded from ${first}; earlier days show "not recorded", not zero.`)
      }
    }
  }
  return {
    ...base,
    status: 'ok' as const,
    learner,
    sampleSize: activity.suppressed ? null : {
      activeLearners: activity.totals.activeLearners,
      actions: activity.totals.actions,
      pulseEntries: activity.totals.pulseEntries,
      days: range.days.length,
    },
    missingData,
    activity,
  }
}

export type IndividualAnalyticsResult = Awaited<ReturnType<typeof executeIndividualPlan>>
