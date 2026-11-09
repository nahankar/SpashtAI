import {describe,it,expect} from 'vitest'
import {CURRENT_LEARNER_POLICY,LEARNER_POLICIES,hash,parseResult,invalidOutputReason} from '../src/interviews/evaluator/contracts'
import {INTERPRETATION_TOOL_SCHEMA,LEARNER_PROMPT_17} from '../src/interviews/evaluator/model'
import {assessmentRouting} from '../src/interviews/evaluator/routing'
const answer='Each request owns its settings. No shared mutation between concurrent requests.'
const complete={interpretation:{status:'CLEAR',summary:'Separate request settings avoid shared mutations.',evidence:[1,2]},decision:'COMPLETE',correct:[1,2],incorrect:[],validReasoning:[1,2],invalidReasoning:[]}
const parse=(x:unknown)=>parseResult(JSON.stringify(x),answer,'interview-result-9')
const code=(x:unknown)=>{try{parse(x);return 'PUBLISHED'}catch(e){return invalidOutputReason(e)}}
describe('interpretation-first preview safety boundary',()=>{
 it('keeps production and the measured comparison frozen',()=>{
  expect(hash(LEARNER_POLICIES['learner-evaluation-15'].config)).toBe('238d93ddbeb32160f55f45c6fb3ca44e6d4c032999d2959973a27377d7afdcde')
  expect(hash(INTERPRETATION_TOOL_SCHEMA)).toBe('4dc72576f341210c99d99dfd704b5870c0e4128b8716c811200bfb99587dea21')
  expect(CURRENT_LEARNER_POLICY).toBe('learner-evaluation-8')
  expect(hash(LEARNER_POLICIES['learner-evaluation-14-thinking-low'].config)).toBe('b5f0749eea9fd6a5398cd3274f8edb6f78aa46c6b95dd8e9c8fd7fed9c7806af')
  expect(LEARNER_POLICIES['learner-evaluation-15'].config).toMatchObject({prompt:'interview-answer-17',schema:'interview-result-9',reasoningEffort:'low',maxTokens:15000,timeoutMs:40000})
  expect(INTERPRETATION_TOOL_SCHEMA.required).toContain('interpretation')
  expect(INTERPRETATION_TOOL_SCHEMA.required).toContain('validReasoning')
  expect(INTERPRETATION_TOOL_SCHEMA.required).toContain('invalidReasoning')
  expect(LEARNER_PROMPT_17).toContain('It is not a chain of thought')
 })
 it.each(['COMPLETE','INCOMPLETE','FALSE_CORE','NO_SUBJECT','REVIEW'])('declared uncertainty blocks even a contradictory %s',decision=>{
  expect(code({...complete,decision,interpretation:{...complete.interpretation,status:'UNCERTAIN'}})).toBe('EVALUATION_REVIEW_REQUIRED')
 })
 it('can credit a mechanism across original fragments without a causal keyword',()=>{
  const r=parse(complete)
  expect(r.classification).toBe('CORRECT')
  expect(r.criteria[1]).toMatchObject({finding:'MET',evidence:[answer.split('. ')[0]+'.',answer.split('. ')[1]]})
  expect(r).not.toHaveProperty('interpretation') // no model paraphrase used as quoted evidence
 })
 it('preserves a clear genuinely false claim and false explanation',()=>{
  const r=parse({...complete,decision:'FALSE_CORE',correct:[],incorrect:[1],validReasoning:[],invalidReasoning:[1]})
  expect(r.classification).toBe('INCORRECT');expect(r.criteria[1].finding).toBe('NOT_MET')
 })
 it('normalization does not automatically upgrade a grade',()=>{
  const r=parse({...complete,interpretation:{...complete.interpretation,status:'NORMALIZED'},decision:'INCOMPLETE'})
  expect(r.classification).toBe('PARTIAL')
 })
 it('allows absent reasoning without lowering otherwise complete knowledge',()=>{
  const r=parse({...complete,validReasoning:[]})
  expect(r.classification).toBe('CORRECT');expect(r.criteria[1].finding).toBe('NOT_ASSESSED')
 })
 it.each(['interpretation','validReasoning','invalidReasoning'])('rejects a skipped %s check instead of silently accepting it',key=>{
  const raw:Record<string,unknown>={...complete};delete raw[key];expect(code(raw)).toMatch(/^INVALID_OUTPUT_SCHEMA_/)
 })
 it.each([{status:'CLEAR',summary:'',evidence:[1]},{status:'CLEAR',summary:'x'.repeat(401),evidence:[1]},
  {status:'UNCERTAIN',summary:'Unclear relationship.',evidence:[]},{status:'NORMALIZED',summary:'Name recognized.',evidence:[999]},
  {status:'CLEAR',summary:'Same passage repeated.',evidence:[1,1]},{status:'certain',summary:'x',evidence:[1]}])('rejects malformed or unsupported interpretation: %j',interpretation=>{
  expect(code({...complete,interpretation})).toMatch(/^INVALID_OUTPUT_/)
 })
 it('does not let fabricated evidence hide behind an uncertainty signal',()=>{
  expect(code({...complete,correct:[128],interpretation:{...complete.interpretation,status:'UNCERTAIN'}})).toBe('INVALID_OUTPUT_INVALID_PASSAGE_REFERENCE')
 })
 it('still holds a conflicting reasoning assessment without changing primary knowledge',()=>{
  const r=parse({...complete,decision:'FALSE_CORE',correct:[],incorrect:[1],validReasoning:[1]})
  expect(r.classification).toBe('INCORRECT');expect(r.assessmentIssues).toContain('REASONING_CONFLICT')
  expect(assessmentRouting({kind:'ASSESSMENT',transcript:'COMPLETE',status:'COMPLETED',result:r}).action).toBe('HOLD')
 })
 it('rejects injection and contradictory clear core verdicts',()=>{
  expect(()=>parse({...complete,correct:[]})).toThrow('INCONSISTENT')
  expect(()=>parse({...complete,interpretation:{...complete.interpretation,override:true}})).toThrow()
  expect(()=>parse({...complete,assessmentIssues:[]})).toThrow()
 })
})
