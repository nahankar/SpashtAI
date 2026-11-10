import focused from './fixtures/interview-calibration-thinking-medium-focused-1.json'
import repeat from './fixtures/interview-calibration-thinking-medium-repeat-1.json'
import boundaries from './fixtures/interview-calibration-grading-boundaries-1.json'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CURRENT_LEARNER_POLICY, LEARNER_POLICIES, hash } from '../src/interviews/evaluator/contracts'
const sdk = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), options: [] as unknown[] }))
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({ BedrockRuntimeClient: class {
  constructor(options: unknown) { sdk.options.push(options) }
  send = sdk.send; destroy = sdk.destroy
}, ConverseCommand: class { constructor(public input: unknown) {} } }))
import { evaluateAnswer } from '../src/interviews/evaluator/model'
const q = { id: 'q', namespace: 'fixture', externalQid: 'FIX', revision: 1, questionText: 'How do tests stay independent?',
  track: 'Testing', topic: 'Isolation', category: 'Testing', difficulty: 'Simple', experienceBand: '0-2',
  goodAnswerPoints: 'Core: Independent state', exampleAnswer: '', expectedDepth: 'Short explanation', followUpGuidance: '' }
const response = { output: { message: { content: [{ reasoningContent: { reasoningText: { text: 'PRIVATE_REASONING_MUST_NOT_ESCAPE' } } },
  { toolUse: { name: 'grade_interview_answer', input: { interpretation: { status: 'CLEAR', summary: 'Independent data.', evidence: [1] },
    decision: 'COMPLETE', correct: [1], incorrect: [], validReasoning: [], invalidReasoning: [] } } }] } }, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 20 } }
describe('inactive LOW/MEDIUM same-model comparison', () => {
  beforeEach(() => { vi.clearAllMocks(); sdk.options.length = 0; sdk.send.mockResolvedValue(response) })
  it('keeps active and measured configs frozen and changes only comparison metadata/effort', () => {
    const low = LEARNER_POLICIES['learner-evaluation-16'].config, medium = LEARNER_POLICIES['learner-evaluation-16-thinking-medium'].config
    expect(CURRENT_LEARNER_POLICY).toBe('learner-evaluation-8')
    expect(hash(low)).toBe('0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a')
    expect(Object.keys(medium).filter(k => medium[k as keyof typeof medium] !== low[k as keyof typeof low]).sort()).toEqual(['id', 'label', 'policy', 'reasoningEffort'])
  })
  it('sends identical grading input/tool/bounds except effort and never exposes hidden reasoning', async () => {
    for (const name of ['learner-evaluation-16', 'learner-evaluation-16-thinking-medium']) {
      const result = await evaluateAnswer(q, 'Each test uses independent data.', LEARNER_POLICIES[name].config, 'NONE')
      expect(result.result.classification).toBe('CORRECT')
      expect(JSON.stringify(result)).not.toContain('PRIVATE_REASONING_MUST_NOT_ESCAPE')
    }
    const low = sdk.send.mock.calls[0][0].input, medium = sdk.send.mock.calls[1][0].input
    expect(low.additionalModelRequestFields.reasoningConfig.maxReasoningEffort).toBe('low')
    expect(medium.additionalModelRequestFields.reasoningConfig.maxReasoningEffort).toBe('medium')
    expect({ ...medium, additionalModelRequestFields: low.additionalModelRequestFields }).toEqual(low)
    expect(medium.inferenceConfig).toEqual({ temperature: 0, maxTokens: 15000 })
    expect(sdk.options).toEqual([expect.objectContaining({ region: 'us-east-1', maxAttempts: 1 }), expect.objectContaining({ region: 'us-east-1', maxAttempts: 1 })])
  })
  it('freezes six matched cases and two identical repeats per arm without relabelling', () => {
    expect(focused.cases).toHaveLength(6); expect(repeat.cases).toHaveLength(2)
    expect((focused.cases.length + repeat.cases.length) * 2).toBe(16)
    for (const c of focused.cases) expect(c).toEqual(boundaries.cases.find(b => b.id === c.id))
    for (const c of repeat.cases) expect(c).toEqual(focused.cases.find(b => b.id === c.id))
  })
  it('rejects an unregistered effort/configuration instead of broadening provider access', async () => {
    await expect(evaluateAnswer(q, 'Some answer.', { ...LEARNER_POLICIES['learner-evaluation-16'].config, reasoningEffort: 'medium' }, 'NONE')).rejects.toMatchObject({ code: 'CONFIG_UNSUPPORTED' })
    expect(sdk.send).not.toHaveBeenCalled()
  })
})
