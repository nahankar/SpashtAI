// Fixture-only Converse transport contract. This does not assess technical quality.
const http = require('http')
http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/converse')) { res.writeHead(501); res.end(); return }
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    const request = JSON.parse(raw)
    const answer = JSON.parse(request.messages[0].content[0].text).candidateAnswer
    if (answer === '[TIMEOUT]') await new Promise(resolve => setTimeout(resolve, 25000))
    res.setHeader('content-type', 'application/json')
    if (answer === '[THROTTLE]') {
      res.writeHead(429, { 'x-amzn-errortype': 'ThrottlingException' })
      res.end(JSON.stringify({ __type: 'ThrottlingException', message: 'Fixture rate limit' })); return
    }
    const toolOutput = request.toolConfig?.toolChoice?.tool?.name === 'grade_interview_answer'
    const compact = Boolean(request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json?.properties?.decision)
    const result = compact ? (answer === '[REVIEW_REQUIRED]' ? {decision:'REVIEW',correct:[],incorrect:[],reasoning:[],reviewReason:'Fixture ambiguity.'}
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
    const tool = { toolUse: { toolUseId: 'fixture', name: answer === '[WRONG_TOOL]' ? 'other' : 'grade_interview_answer', input: result } }
    const content = toolOutput ? (answer === '[MULTIPLE_TOOLS]' ? [tool, tool] : [tool])
      : [{ text: answer === '[INVALID_OUTPUT]' ? 'not json' : JSON.stringify(result) }]
    res.end(JSON.stringify({ output: { message: { role: 'assistant', content } },
      stopReason: toolOutput ? 'tool_use' : 'end_turn', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, metrics: { latencyMs: 1 } }))
  } catch { res.writeHead(400); res.end(JSON.stringify({ message: 'Invalid Converse fixture request' })) }
}).listen(process.env.PORT)
