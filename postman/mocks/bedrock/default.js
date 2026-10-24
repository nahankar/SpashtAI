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
    const result = { classification: 'CORRECT', criteria: ['ACCURACY', 'REASONING', 'DEPTH'].map(criterion => ({
      criterion, finding: criterion === 'ACCURACY' ? 'MET' : 'NOT_ASSESSED', evidence: criterion === 'ACCURACY' ? [answer] : [], explanation: 'Transport fixture finding.',
    })), strengths: ['Transport fixture'], gaps: [], misconceptions: [], guidance: 'Fixture guidance.', uncertainty: [], followUpQuestion: 'What would you test next?' }
    res.end(JSON.stringify({ output: { message: { role: 'assistant', content: [{ text: answer === '[INVALID_OUTPUT]' ? 'not json' : JSON.stringify(result) }] } },
      stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, metrics: { latencyMs: 1 } }))
  } catch { res.writeHead(400); res.end(JSON.stringify({ message: 'Invalid Converse fixture request' })) }
}).listen(process.env.PORT)
