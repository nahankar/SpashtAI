import type { ActivityPurpose, ContextScope } from '@prisma/client'

export type ActivityPolicyInput = {
  purpose?: ActivityPurpose
  contextScope?: ContextScope
  focusArea?: string | null
  preparationPractice?: unknown
  preparationRecording?: unknown
}

// Ownership remains authoritative. A caller that omitted purpose cannot
// establish eligibility for communication history, points or Pulse.
export function isStandaloneCommunication(activity: ActivityPolicyInput): boolean {
  return activity.purpose === 'COMMUNICATION' &&
    !activity.preparationPractice && !activity.preparationRecording
}

export function isPulseEligible(activity: ActivityPolicyInput): boolean {
  return isStandaloneCommunication(activity) && activity.focusArea !== 'snapshot'
}

export function activityCreationPolicy(journeyOwned: boolean, live: boolean) {
  return {
    purpose: journeyOwned ? 'INTERVIEW' as const : 'COMMUNICATION' as const,
    contextScope: journeyOwned ? 'JOURNEY' as const : live ? 'COMMUNICATION_PROFILE' as const : 'SESSION_ONLY' as const,
    communicationProfile: 'communication-v1',
  }
}

export function resolveContextScope(activity: ActivityPolicyInput): ContextScope {
  if (activity.preparationPractice || activity.preparationRecording) return 'JOURNEY'
  if (activity.contextScope === 'COMMUNICATION_PROFILE' && !isStandaloneCommunication(activity)) return 'SESSION_ONLY'
  return activity.contextScope ?? 'SESSION_ONLY'
}
