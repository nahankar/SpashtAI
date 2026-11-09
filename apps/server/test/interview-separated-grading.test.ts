import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {CURRENT_LEARNER_POLICY,hash,invalidOutputReason,LEARNER_POLICIES,parseResult,type EvaluationResult} from '../src/interviews/evaluator/contracts'
import {SEPARATED_TOOL_SCHEMA,LEARNER_PROMPT_16} from '../src/interviews/evaluator/model'
import {assessmentRouting} from '../src/interviews/evaluator/routing'
import {reviewCalibration,reviewCalibrationCase} from '../scripts/review-interview-calibration'
const answer='One claim about isolation. A separate explanation about shared state.'
const core={decision:'FALSE_CORE',correct:[],incorrect:[1,2]}
const parse=(raw:unknown)=>parseResult(JSON.stringify(raw),answer,'interview-result-8')
const complete={decision:'COMPLETE',correct:[1,2],incorrect:[]}
const route=(result:EvaluationResult)=>assessmentRouting({kind:'ASSESSMENT',transcript:'COMPLETE',status:'COMPLETED',result})
describe('knowledge and reasoning are separately validated',()=>{
 it('pins the new preview without changing the active policy or old schemas',()=>{
  expect(CURRENT_LEARNER_POLICY).toBe('learner-evaluation-8')
  expect(hash(LEARNER_POLICIES['learner-evaluation-14'].config)).toBe('fee67206563c902974f4b35e7fc8a9080e2126375c6d4b10cf82a492d337265d')
  expect(hash(SEPARATED_TOOL_SCHEMA)).toBe('1539a0976fe79f0af9611b80fb9e26e5c944a855e5c0ba2bf74ca5a553ae5ece')
  expect(createHash('sha256').update(LEARNER_PROMPT_16).digest('hex')).toBe('4eb18d7e0f6f5c830c9a48b8e0aa8a46c445932c6e0d2b1ef313b6ea12ba7b2f')
  expect(()=>parseResult(JSON.stringify({...core,reasoning:[2]}),answer,'interview-result-7')).toThrow('INCONSISTENT')
 })
 it('retains a false core verdict without crediting the conflicting explanation',()=>{
  const result=parse({...core,validReasoning:[2]})
  expect(result.classification).toBe('INCORRECT')
  expect(result.criteria[1]).toMatchObject({finding:'NOT_ASSESSED',evidence:[]})
  expect(result.assessmentIssues).toEqual(['REASONING_CONFLICT'])
  expect(result.validationNotes?.join(' ')).toContain('adaptive progression is on hold')
  expect(route(result)).toMatchObject({action:'HOLD',updateKnowledge:false})
  const reviewed=reviewCalibrationCase({id:'regression',answer,expected:'INCORRECT'}, {id:'regression',model:'learner-evaluation-14',status:'COMPLETED',result})
  expect(reviewed.usable).toBe(true)
  expect(reviewed.failures).toContain('ASSESSMENT_REQUIRES_HOLD')
  const summary=reviewCalibration({fixtureVersion:'hold',cases:[{id:'regression',answer,expected:'INCORRECT'}]}, {fixtureVersion:'hold',results:[{id:'regression',model:'learner-evaluation-14',status:'COMPLETED',result}]}).summary
  expect(summary).toMatchObject({coreGradesRequiringHold:1,usable:1,exactExpected:1,allRequiredChecksPass:false,allRoutingLabelsMatch:false})
 })
 it('represents explicitly false reasoning without rejecting its core knowledge verdict',()=>{
  const r=parse({...core,invalidReasoning:[2]})
  expect(r.classification).toBe('INCORRECT')
  expect(r.criteria[1]).toMatchObject({finding:'NOT_MET',evidence:['A separate explanation about shared state.']})
  expect(r.assessmentIssues).toBeUndefined()
 })
 it.each([null,[999],[1,1],['1'],[1.5]])('leaves malformed reasoning unassessed and holds routing: %j',validReasoning=>{
  const r=parse({...complete,validReasoning})
  expect(r.classification).toBe('CORRECT')
  expect(r.assessmentIssues).toEqual(['REASONING_INVALID_OUTPUT'])
  expect(r.criteria[1].finding).toBe('NOT_ASSESSED')
  expect(route(r).action).toBe('HOLD')
 })
 it('does not demand optional reasoning and supports independently valid/mixed findings',()=>{
  expect(parse(complete).criteria[1].finding).toBe('NOT_ASSESSED')
  expect(parse(complete).classification).toBe('CORRECT')
  expect(parse({...complete,validReasoning:[],invalidReasoning:[]}).assessmentIssues).toBeUndefined()
  const mixed=parse({decision:'INCOMPLETE',correct:[1],incorrect:[2],validReasoning:[1],invalidReasoning:[2]})
  expect(mixed.classification).toBe('PARTIAL');expect(mixed.criteria[1].finding).toBe('PARTIAL')
  expect(mixed.criteria[1].evidence.every(q=>answer.includes(q))).toBe(true)
 })
 it.each([{...complete,incorrect:[1]},{...complete,correct:[]},{...core,incorrect:[]},{...core,incorrect:[999]},
  {...complete,assessmentIssues:[]},{decision:'NO_SUBJECT',correct:[1],incorrect:[]},
  {decision:'NO_SUBJECT',correct:[],incorrect:[],validReasoning:[1]}])('still rejects contradictory or injected core judgments',input=>expect(()=>parse(input)).toThrow())
 it('publishes no grade for genuine review even with unavailable optional reasoning',()=>{
  const input={decision:'REVIEW',correct:[],incorrect:[],reviewReason:'The relationships cannot be resolved.',validReasoning:null}
  try{parse(input);throw Error('Expected review')}catch(e){expect(invalidOutputReason(e)).toBe('EVALUATION_REVIEW_REQUIRED')}
  expect(()=>parse({...input,reviewReason:''})).toThrow('INVALID_REVIEW_REASON')
 })
})
describe('shadow next-action safety policy',()=>{
 it.each([['REPEAT','REPEAT_QUESTION'],['SKIP','NEXT_QUESTION'],['PAUSE','PAUSE'],['DECLINE','NEXT_TOPIC']] as const)('keeps %s as learner intent', (control,action)=>{
  expect(assessmentRouting({kind:'CONTROL',control})).toEqual({action,updateKnowledge:false,reason:'LEARNER_CONTROL'})
 })
 it.each(['PENDING','RUNNING','FAILED','CANCELLED'])('never updates knowledge from %s',status=>{
  expect(assessmentRouting({kind:'ASSESSMENT',status,transcript:'COMPLETE',result:parse(complete)})).toMatchObject({action:'HOLD',updateKnowledge:false})
 })
 it.each(['UNKNOWN','INCOMPLETE'] as const)('never treats %s capture as ignorance',transcript=>{
  expect(assessmentRouting({kind:'ASSESSMENT',status:'COMPLETED',transcript,result:parse(complete)}).action).toBe('HOLD')
 })
 it('keeps ambiguous/invalid results, request-only responses and no-subject answers distinct',()=>{
  expect(assessmentRouting({kind:'ASSESSMENT',transcript:'COMPLETE',status:'FAILED',errorCode:'EVALUATION_REVIEW_REQUIRED'}).action).toBe('HOLD')
  const empty=parse({decision:'NO_SUBJECT',correct:[],incorrect:[]})
  expect(route(empty)).toMatchObject({action:'CLARIFY_RESPONSE',updateKnowledge:false})
  expect(route({...empty,responseKind:'REQUEST_ONLY'}).action).toBe('HOLD')
  expect(route({...empty,responseKind:'DONT_KNOW'})).toMatchObject({action:'NEXT_TOPIC',updateKnowledge:false})
 })
 it('proposes an action only for a complete usable assessment, without selecting or generating questions',()=>{
  expect(route(parse(complete)).action).toBe('DEEPEN')
  expect(route(parse({...complete,decision:'INCOMPLETE'})).action).toBe('CLARIFY')
  expect(route(parse(core)).action).toBe('SIMPLIFY')
  expect(route(parse(complete))).not.toHaveProperty('questionText')
 })
})
