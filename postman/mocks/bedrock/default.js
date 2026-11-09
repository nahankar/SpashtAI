// Fixture-only Converse transport contract. This does not assess technical quality.
const http = require('http')
http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/converse')) { res.writeHead(501); res.end(); return }
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    const request = JSON.parse(raw)
    const answer = JSON.parse(request.messages[0].content[0].text).candidateAnswer
    if (answer === '[MATCHED_CONTROL]' && (request.additionalModelRequestFields || request.inferenceConfig.maxTokens !== 15000)) throw Error('Expected matched control request')
    if (answer === '[LOW_REASONING]' && (request.additionalModelRequestFields?.reasoningConfig?.type !== 'enabled' || request.additionalModelRequestFields?.reasoningConfig?.maxReasoningEffort !== 'low' || request.inferenceConfig.maxTokens !== 15000)) throw Error('Expected bounded reasoning request')
    if (answer === '[TIMEOUT]') await new Promise(resolve => setTimeout(resolve, 25000))
    res.setHeader('content-type', 'application/json')
    if (answer === '[THROTTLE]') {
      res.writeHead(429, { 'x-amzn-errortype': 'ThrottlingException' })
      res.end(JSON.stringify({ __type: 'ThrottlingException', message: 'Fixture rate limit' })); return
    }
    const toolOutput = request.toolConfig?.toolChoice?.tool?.name === 'grade_interview_answer'
    const compact = Boolean(request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json?.properties?.decision)
    const separated = Boolean(request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json?.properties?.validReasoning)
    let result = separated ? (answer === '[REVIEW_REQUIRED]' ? {decision:'REVIEW',correct:[],incorrect:[],reviewReason:'Fixture ambiguity.'}
      : answer === '[REASONING_CONFLICT]' ? {decision:'FALSE_CORE',correct:[],incorrect:[1],validReasoning:[1]}
      : answer === '[FALSE_REASON]' ? {decision:'FALSE_CORE',correct:[],incorrect:[1],invalidReasoning:[1]}
      : answer === '[BAD_CORE]' ? {decision:'COMPLETE',correct:[],incorrect:[1]}
      : {decision:'COMPLETE',correct:[1],incorrect:[],validReasoning:answer === '[BAD_REASONING]' ? null : [1]}) : compact ? (answer === '[REVIEW_REQUIRED]' ? {decision:'REVIEW',correct:[],incorrect:[],reasoning:[],reviewReason:'Fixture ambiguity.'}
      : {decision:'COMPLETE',correct:[1],incorrect:[],reasoning:[], ...(answer === '[BAD_FEEDBACK]' ? {feedback:{guidance:[]}} : {})}) : answer === '[REVIEW_REQUIRED]' ? { reviewRequired: true, claims: [], coverage: 'NONE',
      depth: { finding: 'NOT_ASSESSED', evidence: [], explanation: 'Transport-only ambiguous-answer fixture.' },
      gaps: [], guidance: 'Review the saved answer.', uncertainty: ['Fixture meaning cannot be resolved.'] }
      : toolOutput ? { reviewRequired: false, claims: [{ quote: answer, interpretedClaim: answer,
        interpretation: 'LITERAL', judgment: 'CORRECT', scope: 'CENTRAL', reasoning: 'NONE', explanation: 'Transport fixture claim.' }],
        coverage: 'COMPLETE', depth: { finding: 'NOT_ASSESSED', evidence: [], explanation: 'Transport fixture depth.' },
        gaps: [], guidance: 'Fixture guidance.', uncertainty: [] }
      : { classification: 'CORRECT', criteria: ['ACCURACY', 'REASONING', 'DEPTH'].map(criterion => ({
      criterion, finding: criterion === 'ACCURACY' ? 'MET' : 'NOT_ASSESSED', evidence: criterion === 'ACCURACY' ? [answer] : [], explanation: 'Transport fixture finding.',
    })), strengths: ['Transport fixture'], gaps: [], misconceptions: [], guidance: 'Fixture guidance.', uncertainty: [], followUpQuestion: 'What would you test next?' }
    const interpretationFirst = Boolean(request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json?.properties?.interpretation)
    if (interpretationFirst) {
      result = { ...result, validReasoning: result.validReasoning ?? [], invalidReasoning: result.invalidReasoning ?? [],
        interpretation: {status: answer === '[UNCERTAIN_COMPLETE]' ? 'UNCERTAIN' : answer === '[NORMALIZED]' ? 'NORMALIZED' : 'CLEAR',
          summary: 'Authored fixture interpretation.', evidence: [1]} }
      if (answer === '[MISSING_REASONING]') delete result.validReasoning
      if (answer === '[BAD_INTERPRETATION]') result.interpretation.evidence = [128]
      if (['[LONG_UNCERTAIN_SUMMARY]', '[BAD_UNCERTAIN_SUMMARY]', '[MISSING_UNCERTAIN_SUMMARY]', '[BAD_UNCERTAIN_EVIDENCE]'].includes(answer)) result.interpretation.status = 'UNCERTAIN'
      if (answer === '[LONG_UNCERTAIN_SUMMARY]') result.interpretation.summary = 'FIXTURE_LONG_SUMMARY'.repeat(30)
      if (['[BAD_UNCERTAIN_SUMMARY]', '[BAD_CLEAR_SUMMARY]'].includes(answer)) result.interpretation.summary = {untrusted: 'FIXTURE_BAD_SUMMARY_NOT_OUTPUT'}
      if (answer === '[MISSING_UNCERTAIN_SUMMARY]') delete result.interpretation.summary
      if (answer === '[BAD_UNCERTAIN_EVIDENCE]') { result.interpretation.summary = null; result.interpretation.evidence = [128] }

    }
    const tool = { toolUse: { toolUseId: 'fixture', name: answer === '[WRONG_TOOL]' ? 'other' : 'grade_interview_answer', input: result } }
    const content = toolOutput ? (answer === '[MULTIPLE_TOOLS]' ? [tool, tool] : [tool])
      : [{ text: answer === '[INVALID_OUTPUT]' ? 'not json' : JSON.stringify(result) }]
    if (answer === '[MATCHED_CONTROL]' && (request.additionalModelRequestFields || request.inferenceConfig.maxTokens !== 15000)) throw Error('Expected matched control request')
    if (answer === '[LOW_REASONING]') content.unshift({ reasoningContent: { reasoningText: { text: 'FIXTURE_PRIVATE_REASONING' } } })
    res.end(JSON.stringify({ output: { message: { role: 'assistant', content } },
      stopReason: toolOutput ? 'tool_use' : 'end_turn', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, metrics: { latencyMs: 1 } }))
  } catch { res.writeHead(400); res.end(JSON.stringify({ message: 'Invalid Converse fixture request' })) }
}).listen(process.env.PORT)
