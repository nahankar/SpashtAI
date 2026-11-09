import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {answerPassages,CURRENT_LEARNER_POLICY,hash,invalidOutputReason,LEARNER_POLICIES,parseResult} from '../src/interviews/evaluator/contracts'
const sdk=vi.hoisted(()=>({send:vi.fn(),destroy:vi.fn()}))
vi.mock('@aws-sdk/client-bedrock-runtime',()=>({BedrockRuntimeClient:class{send=sdk.send;destroy=sdk.destroy},ConverseCommand:class{constructor(public input:unknown){}}}))
import {SEPARATED_TOOL_SCHEMA,COMPACT_TOOL_SCHEMA,evaluateAnswer,LEARNER_PROMPT_15} from '../src/interviews/evaluator/model'
const answer='Fresh data isolates tests. Shared rows let one test change another test’s result.'
const grade=(overrides={})=>({decision:'COMPLETE',correct:[1,2],incorrect:[],reasoning:[2],...overrides})
const parse=(input:unknown)=>parseResult(JSON.stringify(input),answer,'interview-result-7')
const q={id:'q',namespace:'pilot',externalQid:'Q',revision:2,questionText:'Why isolate test data?',track:'Testing',category:'Isolation',topic:'Isolation',difficulty:'Simple',experienceBand:'0-2',goodAnswerPoints:'Core: independent state',exampleAnswer:'Fresh data',expectedDepth:'Mechanism',followUpGuidance:''}
describe('compact assessment separates knowledge from prose',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('freezes the preview and leaves production policy unchanged',()=>{
  expect(CURRENT_LEARNER_POLICY).toBe('learner-evaluation-8')
  expect(hash(LEARNER_POLICIES['learner-evaluation-13'].config)).toBe('f8d1d35fe6f73fc18cf8170b10c7795bd9d541169dc3586c7be13554c0c81252')
  expect(hash(COMPACT_TOOL_SCHEMA)).toBe('c7ee5f6e9272c94688ed57f7a5dcf39c67d6a39fad8651a693463365b1f9961d')
  expect(createHash('sha256').update(LEARNER_PROMPT_15).digest('hex')).toBe('2597d10aa198ce0300f7f770650832be8a2b14d45737f9c6f1404e9077a5f566')
 })
 it('uses only copied passages including bounded long and fragmented input',()=>{
  for(const input of [answer,'  First line.\nAnd\nAnother fact?\n  End!','x. '.repeat(200)]){
   const passages=answerPassages(input)
   expect(passages.length).toBeLessThanOrEqual(128)
   for(const p of passages)expect(input.includes(p.text)).toBe(true)
   if(input.startsWith('x.'))expect(passages.at(-1)?.text.endsWith('x.')).toBe(true)
  }
  expect(answerPassages('...?!')).toEqual([])
 })
 it('keeps grading identical when optional feedback is missing, malformed or invalid',()=>{
  for(const feedback of [undefined,null,[],{guidance:[]},{gaps:'wrong type'}]){
   const result=parse(grade({...(feedback!==undefined?{feedback}:{})}))
   expect(result.classification).toBe('CORRECT')
   expect(result.criteria[1]).toMatchObject({finding:'MET',evidence:[answerPassages(answer)[1].text]})
   expect(result.criteria.flatMap(c=>c.evidence).every(q=>answer.includes(q))).toBe(true)
  }
 })
 it('ignores presentation claims that contradict grade-bearing citations',()=>{
  const r=parse(grade({feedback:{misconceptions:['An invented error.'],gaps:['An invented gap.']}}))
  expect(r.misconceptions).toEqual([]);expect(r.gaps).toEqual([])
 })
 it.each([
  {correct:[999]}, {correct:[1,1]}, {correct:['1']}, {correct:[1.5]}, {correct:[]},
  {incorrect:[1]}, {reasoning:[3]}, {decision:'INCOMPLETE',correct:[]}, {decision:'FALSE_CORE',incorrect:[]},
  {decision:'NO_SUBJECT'}, {decision:'REVIEW'}, {decision:'NO_SUBJECT',correct:[],reasoning:[],incorrect:[1]},
 ])('rejects unsafe core assessment %j',overrides=>expect(()=>parse(grade(overrides))).toThrow())
 it('supports meaningful mixed answers and false central claims without optional prose',()=>{
  expect(parse(grade({decision:'INCOMPLETE',incorrect:[1]})).classification).toBe('PARTIAL')
  const wrong=parse(grade({decision:'FALSE_CORE',correct:[],incorrect:[1],reasoning:[]}))
  expect(wrong.classification).toBe('INCORRECT');expect(wrong.misconceptions).toEqual([answerPassages(answer)[0].text])
 })
 it('distinguishes empty subject response from genuinely uncertain meaning',()=>{
  const empty={decision:'NO_SUBJECT',correct:[],incorrect:[],reasoning:[]}
  expect(parse(empty)).toMatchObject({classification:'NOT_ANSWERED',strengths:[],misconceptions:[]})
  const review={...empty,decision:'REVIEW',reviewReason:'The fragments do not establish which relationship was intended.'}
  try{parse(review);throw Error('Expected review')}catch(e){expect(invalidOutputReason(e)).toBe('EVALUATION_REVIEW_REQUIRED')}
  expect(()=>parse({...review,reviewReason:''})).toThrow('INVALID_REVIEW_REASON')
 })
 it('sends the full transcript plus immutable source IDs and the compact tool schema',async()=>{
  sdk.send.mockResolvedValue({stopReason:'tool_use',output:{message:{content:[{toolUse:{name:'grade_interview_answer',input:grade()}}]}},usage:{inputTokens:100,outputTokens:50}})
  const r=await evaluateAnswer(q,answer,LEARNER_POLICIES['learner-evaluation-13'].config,'NONE')
  expect(r.result.classification).toBe('CORRECT')
  const input=sdk.send.mock.calls[0][0].input
  expect(JSON.parse(input.messages[0].content[0].text)).toMatchObject({candidateAnswer:answer,passages:answerPassages(answer)})
  expect(input.toolConfig.tools[0].toolSpec.inputSchema.json).toEqual(COMPACT_TOOL_SCHEMA)
  expect(sdk.send).toHaveBeenCalledOnce()
 })
 it('uses the separated tool contract for policy 14 and preserves usage on a held core result',async()=>{
  sdk.send.mockResolvedValue({stopReason:'tool_use',output:{message:{content:[{toolUse:{name:'grade_interview_answer',input:{decision:'FALSE_CORE',correct:[],incorrect:[1],validReasoning:[1]}}}]}},usage:{inputTokens:123,outputTokens:45}})
  const r=await evaluateAnswer(q,answer,LEARNER_POLICIES['learner-evaluation-14'].config,'NONE')
  expect(r).toMatchObject({inputTokens:123,outputTokens:45,result:{classification:'INCORRECT',assessmentIssues:['REASONING_CONFLICT']}})
  expect(sdk.send.mock.calls[0][0].input.toolConfig.tools[0].toolSpec.inputSchema.json).toEqual(SEPARATED_TOOL_SCHEMA)
  expect(sdk.send).toHaveBeenCalledOnce()
 })

 it('pins a bounded low-thinking comparison with unchanged grading input and no persisted reasoning text',async()=>{
  const config=LEARNER_POLICIES['learner-evaluation-14-thinking-low'].config
  expect(hash(config)).toBe('b5f0749eea9fd6a5398cd3274f8edb6f78aa46c6b95dd8e9c8fd7fed9c7806af')
  const content=[{reasoningContent:{reasoningText:{text:'FIXTURE_PRIVATE_REASONING'}}},{toolUse:{name:'grade_interview_answer',input:{decision:'COMPLETE',correct:[1,2],incorrect:[],validReasoning:[2]}}}]
  sdk.send.mockResolvedValue({stopReason:'tool_use',output:{message:{content}},usage:{inputTokens:123,outputTokens:456}})
  const r=await evaluateAnswer(q,answer,config,'NONE')
  const control=LEARNER_POLICIES['learner-evaluation-14-budget-control'].config
  expect(hash(control)).toBe('59d0d74942166c3aaed28cc8a0f484ab0fb1331d775289af960d7842a7a56bea')
  expect(control.timeoutMs).toBe(config.timeoutMs)
  await evaluateAnswer(q,answer,control,'NONE')
  await evaluateAnswer(q,answer,LEARNER_POLICIES['learner-evaluation-14'].config,'NONE')
  const [low,matched,baseline]=sdk.send.mock.calls.map(c=>c[0].input)
  expect(low.additionalModelRequestFields).toEqual({reasoningConfig:{type:'enabled',maxReasoningEffort:'low'}})
  expect(low.inferenceConfig).toEqual({temperature:0,maxTokens:15000})
  expect(config.timeoutMs).toBe(40000)
  expect(low.inferenceConfig).toEqual(matched.inferenceConfig)
  expect(low.system).toEqual(matched.system);expect(low.messages).toEqual(matched.messages);expect(low.toolConfig).toEqual(matched.toolConfig)
  expect(matched).not.toHaveProperty('additionalModelRequestFields')
  expect(low.system).toEqual(baseline.system);expect(low.messages).toEqual(baseline.messages);expect(low.toolConfig).toEqual(baseline.toolConfig)
  expect(baseline).not.toHaveProperty('additionalModelRequestFields')
  expect(r).toMatchObject({inputTokens:123,outputTokens:456,result:{classification:'CORRECT'}})
  expect(JSON.stringify(r)).not.toContain('FIXTURE_PRIVATE_REASONING')
 })

})
