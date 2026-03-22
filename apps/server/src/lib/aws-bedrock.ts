import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'

const BEDROCK_MODEL_ID = process.env.BEDROCK_REPLAY_MODEL_ID || 'amazon.nova-pro-v1:0'

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

interface ReplayContext {
  meetingType: string
  userRole: string
  focusAreas: string[]
  meetingGoal?: string
  participantName?: string
  speakerCount: number
  durationEstimate?: number
}

export interface BedrockAnalysisResult {
  overallScore: number
  clarityScore: number
  confidenceScore: number
  engagementScore: number
  strengths: { point: string; example?: string }[]
  improvements: { point: string; example?: string; suggestion?: string }[]
  recommendations: string[]
  contextSpecificFeedback: { label: string; detail: string; rating?: string }[]
  keyMoments: { timestamp?: string; text: string; type: string }[]
  annotatedTranscript: { speaker: string; text: string; annotations?: string[] }[]
  promptTokens: number
  completionTokens: number
  analysisError?: boolean
  analysisErrorMessage?: string
}

function buildContextCriteria(ctx: ReplayContext): string {
  const map: Record<string, string> = {
    'Job Interview': `- STAR method usage (Situation, Task, Action, Result)
- Confidence without arrogance
- Enthusiasm and cultural fit signals
- Question handling quality
- Closing strength`,
    'Sales Call': `- Discovery question quality
- Pain point identification
- Value proposition clarity
- Objection handling
- Call to action strength`,
    'Client Presentation': `- Opening hook effectiveness
- Structure clarity (intro, body, conclusion)
- Data and evidence usage
- Storytelling elements
- Audience engagement techniques
- Closing impact`,
    'Team Meeting': `- Collaboration signals
- Decision-making clarity
- Action item assignment
- Inclusivity of discussion`,
    'Conference Talk': `- Opening hook effectiveness
- Audience engagement techniques
- Pacing and flow
- Key takeaway clarity`,
  }
  return map[ctx.meetingType] || '- General communication effectiveness'
}

export async function analyzeTranscript(
  transcript: string,
  context: ReplayContext
): Promise<BedrockAnalysisResult> {
  const contextCriteria = buildContextCriteria(context)

  const participantDirective = context.participantName
    ? `Focus your entire analysis and coaching on "${context.participantName}"'s communication. Evaluate only their speech patterns, strengths, and areas for improvement. Other speakers are context only.`
    : 'Analyze the primary speaker based on their role.'

  const prompt = `You are an expert communication coach analyzing a ${context.meetingType} conversation.
The speaker's role is: ${context.userRole}.
${context.participantName ? `The participant to analyze is: ${context.participantName}.` : ''}

${participantDirective}

TRANSCRIPT:
${transcript}

CONTEXT:
- Meeting Type: ${context.meetingType}
- Speaker's Role: ${context.userRole}
${context.participantName ? `- Participant to Analyze: ${context.participantName}` : ''}
- Number of Speakers: ${context.speakerCount}
- Focus Areas: ${context.focusAreas.join(', ') || 'General'}
${context.meetingGoal ? `- Meeting Goal: ${context.meetingGoal}` : ''}
${context.durationEstimate ? `- Estimated Duration: ${Math.round(context.durationEstimate / 60)} minutes` : ''}

Analyze this conversation and provide your assessment. You MUST respond with valid JSON only (no markdown, no explanation outside the JSON). Use this exact schema:

{
  "overallScore": <number 1-10>,
  "clarityScore": <number 1-10>,
  "confidenceScore": <number 1-10>,
  "engagementScore": <number 1-10>,
  "strengths": [
    { "point": "<strength description>", "example": "<quote from transcript>" }
  ],
  "improvements": [
    { "point": "<area>", "example": "<quote>", "suggestion": "<alternative phrasing or technique>" }
  ],
  "recommendations": ["<concrete actionable step>"],
  "contextSpecificFeedback": [
    { "label": "<criterion>", "detail": "<evaluation>", "rating": "good|needs_work|excellent" }
  ],
  "keyMoments": [
    { "text": "<description of moment>", "type": "strength|weakness|turning_point" }
  ],
  "annotatedTranscript": [
    { "speaker": "<speaker label>", "text": "<segment text>", "annotations": ["filler_word", "strong_statement", "hedging", "key_point"] }
  ]
}

CONTEXT-SPECIFIC EVALUATION CRITERIA:
${contextCriteria}

Provide 3-5 strengths, 3-5 improvements, and 3 recommendations. Keep annotatedTranscript to the 15 most notable segments.`

  const body = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: {
      maxTokens: 4096,
      temperature: 0.3,
      topP: 0.9,
    },
  })

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  })

  const response = await client.send(command)
  const raw = JSON.parse(new TextDecoder().decode(response.body))

  const outputText: string =
    raw.output?.message?.content?.[0]?.text ?? ''

  const usage = raw.usage ?? {}
  const promptTokens: number = usage.inputTokens ?? 0
  const completionTokens: number = usage.outputTokens ?? 0

  let parsed: any
  let analysisError = false
  let analysisErrorMessage: string | undefined
  try {
    const jsonMatch = outputText.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : outputText)
  } catch {
    analysisError = true
    analysisErrorMessage = 'AI analysis could not be completed — the model returned an unparseable response'
    parsed = {
      overallScore: 0,
      clarityScore: 0,
      confidenceScore: 0,
      engagementScore: 0,
      strengths: [],
      improvements: [],
      recommendations: [],
      contextSpecificFeedback: [],
      keyMoments: [],
      annotatedTranscript: [],
    }
    console.error('Failed to parse Bedrock response as JSON, flagging error')
  }

  return {
    overallScore: parsed.overallScore ?? 0,
    clarityScore: parsed.clarityScore ?? 0,
    confidenceScore: parsed.confidenceScore ?? 0,
    engagementScore: parsed.engagementScore ?? 0,
    strengths: parsed.strengths ?? [],
    improvements: parsed.improvements ?? [],
    recommendations: parsed.recommendations ?? [],
    contextSpecificFeedback: parsed.contextSpecificFeedback ?? [],
    keyMoments: parsed.keyMoments ?? [],
    annotatedTranscript: parsed.annotatedTranscript ?? [],
    promptTokens,
    completionTokens,
    ...(analysisError && { analysisError, analysisErrorMessage }),
  }
}
