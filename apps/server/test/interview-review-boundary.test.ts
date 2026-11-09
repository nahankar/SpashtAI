import {describe,it,expect,vi,beforeEach} from 'vitest'
import {CURRENT_LEARNER_POLICY,LEARNER_POLICIES,hash,invalidOutputReason,parseResult} from '../src/interviews/evaluator/contracts'
const sdk=vi.hoisted(()=>({send:vi.fn(),destroy:vi.fn()}))
vi.mock('@aws-sdk/client-bedrock-runtime',()=>({BedrockRuntimeClient:class{send=sdk.send;destroy=sdk.destroy},ConverseCommand:class{constructor(public input:unknown){}}}))
import {evaluateAnswer,CLAIM_TOOL_NAME} from '../src/interviews/evaluator/model'
const answer='Each test creates its own data. Parallel workers cannot change that test state.'
const grade={decision:'COMPLETE',correct:[1,2],incorrect:[],validReasoning:[2],invalidReasoning:[],interpretation:{status:'CLEAR',summary:'Separate test data prevents worker interference.',evidence:[1,2]}}
const parse=(raw:unknown,schema='interview-result-10')=>parseResult(JSON.stringify(raw),answer,schema)
const outcome=(raw:unknown,schema='interview-result-10')=>{try{return parse(raw,schema).classification}catch(e){return invalidOutputReason(e)}}
const q={id:'q',namespace:'fixture',externalQid:'FIX',revision:1,questionText:'How do tests stay independent?',track:'Testing',category:'Testing',topic:'Isolation',difficulty:'Simple',experienceBand:'0-2',goodAnswerPoints:'Core: Independent state',exampleAnswer:'',expectedDepth:'Short explanation',followUpGuidance:''}
describe('non-grade-bearing summary boundary',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('pins a parser-only preview while preserving the measured and active policies',()=>{
  expect(CURRENT_LEARNER_POLICY).toBe('learner-evaluation-8')
  expect(hash(LEARNER_POLICIES['learner-evaluation-15'].config)).toBe('238d93ddbeb32160f55f45c6fb3ca44e6d4c032999d2959973a27377d7afdcde')
  expect(hash(LEARNER_POLICIES['learner-evaluation-16'].config)).toBe('0f6f309aec2d53806612cac4180f1b4349b6dca98c4681fe1e6e5f93ebe0148a')
  const prior=LEARNER_POLICIES['learner-evaluation-15'].config,next=LEARNER_POLICIES['learner-evaluation-16'].config
  expect(Object.keys(prior).filter(k=>prior[k as keyof typeof prior]!==next[k as keyof typeof next]).sort()).toEqual(['id','label','policy','schema'])
 })
 it.each([undefined,null,'','x'.repeat(401),123,[],{untrusted:'SUMMARY_MUST_NOT_ESCAPE'}])('honors declared uncertainty despite unusable prose: %j',summary=>{
  const raw={...grade,interpretation:{status:'UNCERTAIN',summary,evidence:[1]}}
  expect(outcome(raw)).toBe('EVALUATION_REVIEW_REQUIRED')
  expect(outcome(raw,'interview-result-9')).toMatch(/^INVALID_OUTPUT_SCHEMA_/)
 })
 it.each(['CLEAR','NORMALIZED'])('discards unusable prose without altering a valid %s grade',status=>{
  const raw={...grade,interpretation:{...grade.interpretation,status,summary:{untrusted:'SUMMARY_MUST_NOT_ESCAPE'}}}
  const result=parse(raw),baseline=parse(grade)
  const {validationNotes,...primary}=result
  expect(primary).toEqual(baseline)
  expect(validationNotes).toContain('The interpretation summary was unavailable; only the validated status and original source references were used.')
  expect(JSON.stringify(result)).not.toContain('SUMMARY_MUST_NOT_ESCAPE')
 })
 it('keeps valid summaries and original evidence behavior byte-equivalent to v9',()=>{
  expect(parse(grade)).toEqual(parse(grade,'interview-result-9'))
  expect(parse(grade).criteria[1].evidence).toEqual(['Parallel workers cannot change that test state.'])
 })
 it.each(['decision','correct','incorrect','validReasoning','invalidReasoning','interpretation'])('still requires critical field %s',key=>{
  const raw:Record<string,unknown>={...grade};delete raw[key];expect(outcome(raw)).toMatch(/^INVALID_OUTPUT_SCHEMA_/)
 })
 it.each([{status:'UNCERTAIN',evidence:[]},{status:'UNCERTAIN',evidence:[128]},
  {status:'UNCERTAIN',evidence:[1,1]},{status:'UNCERTAIN',evidence:['1']},
  {status:'uncertain',evidence:[1]},{evidence:[1]}])('never repairs invalid status/source evidence: %j',interpretation=>{
  expect(outcome({...grade,interpretation:{...interpretation,summary:'x'.repeat(401)}})).toMatch(/^INVALID_OUTPUT_/)
 })
 it('validates every grading evidence list before accepting an uncertain response',()=>{
  for(const field of ['correct','incorrect','validReasoning','invalidReasoning']){
   expect(outcome({...grade,[field]:[128],interpretation:{status:'UNCERTAIN',evidence:[1],summary:null}})).toBe('INVALID_OUTPUT_INVALID_PASSAGE_REFERENCE')
  }
 })
 it('does not use malformed prose to repair a contradictory or injected grade',()=>{
  expect(outcome({...grade,correct:[],interpretation:{...grade.interpretation,summary:null}})).toBe('INVALID_OUTPUT_INCONSISTENT')
  expect(outcome({...grade,assessmentIssues:[]})).toMatch(/^INVALID_OUTPUT_SCHEMA_/)
  expect(outcome({...grade,interpretation:{...grade.interpretation,override:true}})).toMatch(/^INVALID_OUTPUT_SCHEMA_/)
 })
 it('does not change retained-core reasoning holds',()=>{
  const raw={...grade,decision:'FALSE_CORE',correct:[],incorrect:[1],validReasoning:[1],interpretation:{...grade.interpretation,summary:null}}
  const result=parse(raw)
  expect(result.classification).toBe('INCORRECT');expect(result.assessmentIssues).toEqual(['REASONING_CONFLICT'])
 })
 it('sends exactly the same provider request as v15; neither candidate switches the active learner policy',async()=>{
  sdk.send.mockResolvedValue({stopReason:'tool_use',output:{message:{content:[{reasoningContent:{reasoningText:{text:'HIDDEN_MUST_NOT_ESCAPE'}}},{toolUse:{name:CLAIM_TOOL_NAME,input:grade}}]}},usage:{inputTokens:100,outputTokens:60}})
  const before=await evaluateAnswer(q,answer,LEARNER_POLICIES['learner-evaluation-15'].config,'NONE')
  const after=await evaluateAnswer(q,answer,LEARNER_POLICIES['learner-evaluation-16'].config,'NONE')
  expect(sdk.send.mock.calls[0][0].input).toEqual(sdk.send.mock.calls[1][0].input)
  expect(before.result).toEqual(after.result)
  expect(JSON.stringify(after)).not.toContain('HIDDEN_MUST_NOT_ESCAPE')
 })
})
