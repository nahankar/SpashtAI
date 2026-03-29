/**
 * SpashtAI Coaching Prompt Builder
 *
 * Builds structured Bedrock prompts from skill scores and raw signals.
 * Outputs natural language coaching insights, not raw metric numbers.
 */

import type { SkillScores, TextSignals } from './skillScores'

export interface CoachingContext {
  skillScores: SkillScores
  signals: TextSignals
  sessionName?: string
  focusArea?: string
  totalMessages: number
  durationSec: number
}

export function buildCoachingPrompt(ctx: CoachingContext): string {
  const { skillScores: s, signals: sig } = ctx

  const availableScores = Object.entries(s)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${formatSkillName(k)}: ${v}/10`)
    .join('\n')

  const signalSummary = [
    `WPM: ${sig.speechRate.wpm}`,
    `Filler words: ${sig.fillers.count} (${(sig.fillers.rate * 100).toFixed(1)}% rate)`,
    `Hedging phrases: ${sig.hedging.count} (${sig.hedging.phrases.slice(0, 5).join(', ')})`,
    `Avg sentence length: ${sig.sentenceComplexity.avgLength} words`,
    `Readability (Flesch): ${sig.sentenceComplexity.readability}`,
    `Vocabulary diversity: ${(sig.vocabDiversity.ratio * 100).toFixed(0)}% unique words`,
    `Questions asked by user: ${sig.interactionSignals.questionsAsked}`,
    `Talk ratio: ${(sig.talkListenBalance.userRatio * 100).toFixed(0)}%`,
    `Discourse markers used: ${sig.ideaStructure.markerCount}`,
    `Topic coherence: ${(sig.topicCoherence.avgSimilarity * 100).toFixed(0)}%`,
  ].join('\n')

  const focusLine = ctx.focusArea
    ? `The user was practicing: "${ctx.focusArea}". Tailor feedback to this area.`
    : ''

  return `You are a communication coach for SpashtAI. Analyze this session and provide actionable coaching.

SKILL SCORES (0-10):
${availableScores}

RAW SIGNALS:
${signalSummary}

SESSION INFO:
- Duration: ${Math.round(ctx.durationSec / 60)} minutes
- Total messages: ${ctx.totalMessages}
${focusLine}

Respond with VALID JSON ONLY using this schema:

{
  "topStrength": "<one sentence about their best communication behavior>",
  "primaryImprovement": "<one sentence about the most impactful thing to improve>",
  "actionableAdvice": "<specific, concrete advice with an example>",
  "practiceExercise": "<a short exercise they can do in their next Elevate session>",
  "practicePlan": [
    {"title": "<exercise 1 title>", "description": "<1-2 sentence description of what to practice>", "focusSkill": "<skill name>"},
    {"title": "<exercise 2 title>", "description": "<1-2 sentence description>", "focusSkill": "<skill name>"},
    {"title": "<exercise 3 title>", "description": "<1-2 sentence description>", "focusSkill": "<skill name>"}
  ],
  "decisionClarity": {
    "decisionsDetected": <number of decisions or commitments, including implicit ones>,
    "actionItemsDetected": <number of action items, including informal ones>,
    "decisions": ["<brief description of each decision>"],
    "actionItems": ["<brief description of each action item with owner if mentioned>"],
    "summary": "<one sentence about decision/action clarity>"
  },
  "meetingSummary": {
    "topicsDiscussed": ["<topic 1>", "<topic 2>", "..."],
    "keyOutcomes": ["<outcome 1>", "<outcome 2>", "..."],
    "openQuestions": ["<unresolved question 1>", "..."]
  },
  "topicFlow": "<one sentence about how well ideas were organized>",
  "overallNarrative": "<2-3 sentence summary of the session, written warmly like a coach speaking to the user>"
}

DECISION & ACTION ITEM DETECTION (IMPORTANT — use semantic detection, not just keyword matching):
Detect BOTH explicit and implicit decisions and action items:
- Explicit decisions: "we'll go with X", "let's finalize", "we decided", "agreed to"
- Implicit decisions: "let's push for that", "we can do X", "makes sense to go with Y", "I'd say we should", "that works"
- Explicit action items: "I will send", "please send", "you'll handle"
- Implicit action items: "I'll check and revert", "let me look into that", "need to follow up on", "someone should", "let's circle back on"
- Even casual commitments count — "yeah I can do that", "I'll take care of it"
- Count each DISTINCT decision or action item separately
- If the conversation is exploratory with no decisions, say so honestly in the summary
- List each detected decision and action item briefly in the arrays

MEETING SUMMARY:
- topicsDiscussed: List 3-7 main topics/themes discussed in the conversation
- keyOutcomes: List concrete outcomes, agreements, or conclusions reached (can be empty if exploratory)
- openQuestions: List unresolved questions or items that need follow-up

RULES:
- Never show raw numbers. Say "Your sentences were slightly long" not "Avg sentence length was 22.4"
- Reference specific behaviors, not metrics
- Be encouraging but honest
- The practiceExercise should be something they can do in a 5-minute Elevate session
- The practicePlan should contain 3 targeted exercises based on the user's weakest skills. Each exercise should be specific and doable in an Elevate session. Order from most impactful to least.
- Keep overallNarrative warm and motivating`
}

function formatSkillName(key: string): string {
  const map: Record<string, string> = {
    clarity: 'Clarity',
    conciseness: 'Conciseness',
    confidence: 'Confidence',
    structure: 'Structure',
    engagement: 'Engagement',
    pacing: 'Pacing',
    delivery: 'Delivery',
    emotionalControl: 'Emotional Control',
  }
  return map[key] || key
}
