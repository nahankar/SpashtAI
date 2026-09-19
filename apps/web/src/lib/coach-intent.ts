export type CoachIntent = 'progress' | 'elevate' | 'replay' | 'prepare'

type WeightedPattern = readonly [weight: number, pattern: RegExp]

const INTENT_PATTERNS: Record<CoachIntent, readonly WeightedPattern[]> = {
  replay: [
    [5, /\breplay\b/],
    [4, /\b(?:interview|meeting)\b.*\b(?:recording|transcript|audio|video)\b|\b(?:recording|transcript|audio|video)\b.*\b(?:interview|meeting)\b/],
    [3, /\b(recording|transcript|audio|video|upload)\b/],
    [2, /\b(analy[sz]e|analysis|review|feedback)\b/],
  ],
  prepare: [
    [5, /\b(interview|interviewer)\b/],
    [4, /\b(job description|resume|curriculum vitae)\b/],
    [3, /\b(next round|hiring process|recruiter|technical round|behavioral round)\b/],
    [3, /\b(?:jd|cv)\b/],
  ],
  progress: [
    [5, /\b(progress pulse|pulse)\b/],
    [4, /\b(progress|trend|scores?|weakest skill|strongest skill)\b/],
    [2, /\b(improving|improvement|growth)\b/],
  ],
  elevate: [
    [5, /\belevate\b/],
    [4, /\b(voice practice|speaking practice)\b/],
    [3, /\b(practice|clarity|confidence|pacing|filler words?|fluency)\b/],
    [3, /\b(speaking|communication|presentation|pitch|demo|talk)\b/],
  ],
}

/**
 * Routes only clear, bounded workspace requests. A weak or tied match returns
 * null so the UI asks the user instead of pretending to understand.
 */
export function detectCoachIntent(input: string): CoachIntent | null {
  const text = input.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
  const scores = (Object.entries(INTENT_PATTERNS) as Array<
    [CoachIntent, readonly WeightedPattern[]]
  >).map(([intent, patterns]) => ({
    intent,
    score: patterns.reduce(
      (total, [weight, pattern]) => total + (pattern.test(text) ? weight : 0),
      0,
    ),
  }))
  const highest = Math.max(...scores.map(({ score }) => score))
  if (highest < 3) return null
  const winners = scores.filter(({ score }) => score === highest)
  return winners.length === 1 ? winners[0].intent : null
}

/** Suggest a concise title from the first meaningful message. The UI still
 * requires confirmation before assigning it to the goal. */
export function proposeCoachGoalTitle(input: string): string | null {
  const text = input.replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
  if (text.length < 3 || /^(hi|hello|hey|help|thanks?|thank you)$/i.test(text)) {
    return null
  }

  let phrase = text
    .replace(
      /^(?:i (?:want|need|would like) to|help me|let'?s)\s+/i,
      '',
    )
    .replace(/^(?:work on|improve|practice|prepare for)\s+/i, '')
    .replace(/^(?:i have|i've got|i'?m preparing for)\s+(?:an?\s+)?/i, '')
    .replace(/[.?!]+$/, '')
    .trim()

  if (phrase.length < 3) return null
  if (phrase.length > 60) {
    phrase = phrase.slice(0, 60).replace(/\s+\S*$/, '').trim()
  }

  const words = phrase.split(' ')
  if (words.length > 8) return phrase.charAt(0).toUpperCase() + phrase.slice(1)
  return words
    .map((word) => {
      if (/^(hr|ai|ml|cv|jd)$/i.test(word)) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}
