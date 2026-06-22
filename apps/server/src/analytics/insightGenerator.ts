/**
 * Coaching insights entry point (re-exports provider router).
 */

export {
  generateCoachingInsights,
  resolveElevateSessionAudio,
  resolveReplayUploadAudio,
  type CoachingContext,
  type CoachingInsights,
  type InsightProviderId,
  type PracticePlanItem,
  type MeetingSummary,
} from './insightProviders/index'
