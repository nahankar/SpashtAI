export type ReplayInsightsState = 'confirm_speaker' | 'ready_to_analyze' | 'insufficient_speech' | 'insights_empty' | 'show_insights'

export function replayInsightsState(
  identityState: string,
  hasAssessment: boolean,
  options?: { assessmentGate?: string | null; assessmentEligible?: boolean; hasFeedback?: boolean; hasMoments?: boolean },
): ReplayInsightsState {
  if (identityState !== 'confirmed') return 'confirm_speaker'
  if (options?.assessmentGate === 'insufficient_speech' || options?.assessmentEligible === false) return 'insufficient_speech'
  if (!hasAssessment) return 'ready_to_analyze'
  if (options?.hasFeedback === false && options?.hasMoments === false) return 'insights_empty'
  return 'show_insights'
}

export function rankSpeakerChoices<T extends { speaker: string }>(speakers: T[], hint: string | null | undefined): T[] {
  const needle = hint?.trim().toLowerCase()
  if (!needle) return speakers
  const score = (speaker: string) => {
    const lower = speaker.toLowerCase()
    if (lower === needle) return 0
    if (lower.includes(needle) || needle.includes(lower)) return 1
    return 2
  }
  return speakers
    .map((item, index) => ({ item, index, score: score(item.speaker) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item }) => item)
}

export function hintedSpeaker(speakers: { speaker: string }[], hint: string | null | undefined): string | null {
  const needle = hint?.trim().toLowerCase()
  if (!needle || !speakers.length) return null
  const best = rankSpeakerChoices(speakers, hint)[0]
  const lower = best.speaker.toLowerCase()
  return lower === needle || lower.includes(needle) || needle.includes(lower) ? best.speaker : null
}

export function exactAliasSpeaker(speakers: { speaker: string }[], aliases: string[]): string | null {
  const normalized = new Set(aliases.map(alias => alias.trim().toLocaleLowerCase()).filter(Boolean))
  const matches = speakers.filter(item => normalized.has(item.speaker.trim().toLocaleLowerCase()))
  return matches.length === 1 ? matches[0].speaker : null
}

export function hasInsightItems(items: unknown[] | null | undefined): boolean {
  return Array.isArray(items) && items.length > 0
}

export type ReplayTranscriptMode = 'annotated' | 'turn_blocks' | 'full_text'

export function replayTranscriptMode(annotatedCount: number, structuredCount: number): ReplayTranscriptMode {
  if (annotatedCount > 0) return 'annotated'
  if (structuredCount > 0) return 'turn_blocks'
  return 'full_text'
}
