// Real HTTP transport check against the owned local stand-in; no grading-quality claim.
import {writeFile} from 'node:fs/promises';
import {evaluateAnswer, EvaluationFailure} from '../src/interviews/evaluator/model';
import {LEARNER_POLICIES} from '../src/interviews/evaluator/contracts';
if(process.env.NODE_ENV!=='test'||!/^http:\/\/127\.0\.0\.1:\d+\/bedrock$/.test(process.env.INTERVIEW_EVALUATOR_TEST_ENDPOINT ?? ''))throw Error('Simulation only');
const q={id:'fixture',namespace:'transport',externalQid:'HTTP',revision:1,questionText:'Fixture?',track:'Testing',category:'Testing',topic:'Transport',difficulty:'Simple',experienceBand:'0-2',goodAnswerPoints:'Core: Fixture.',exampleAnswer:'Fixture.',expectedDepth:'Fixture.',followUpGuidance:''};
const out: {expected: string; observed: string; retryable?: boolean; passed: boolean}[]=[];
for(const [answer,version,expected] of [['Fixture valid.','learner-evaluation-8','CORRECT'],['[REVIEW_REQUIRED]','learner-evaluation-11','EVALUATION_REVIEW_REQUIRED'],['[INVALID_OUTPUT]','learner-evaluation-11','INVALID_OUTPUT_JSON'],['[THROTTLE]','learner-evaluation-11','MODEL_UNAVAILABLE'],
 ['Fixture valid.','learner-evaluation-12','CORRECT'],['[REVIEW_REQUIRED]','learner-evaluation-12','EVALUATION_REVIEW_REQUIRED'],
 ['[WRONG_TOOL]','learner-evaluation-12','INVALID_OUTPUT_TOOL_ENVELOPE'],['[MULTIPLE_TOOLS]','learner-evaluation-12','INVALID_OUTPUT_TOOL_ENVELOPE'],['[THROTTLE]','learner-evaluation-12','MODEL_UNAVAILABLE'],
 ['Fixture valid.','learner-evaluation-13','CORRECT'],['[BAD_FEEDBACK]','learner-evaluation-13','CORRECT'],['[REVIEW_REQUIRED]','learner-evaluation-13','EVALUATION_REVIEW_REQUIRED'],['[WRONG_TOOL]','learner-evaluation-13','INVALID_OUTPUT_TOOL_ENVELOPE'],
 ['Fixture valid.','learner-evaluation-14','CORRECT'],['[REASONING_CONFLICT]','learner-evaluation-14','INCORRECT'],['[BAD_REASONING]','learner-evaluation-14','CORRECT'],['[FALSE_REASON]','learner-evaluation-14','INCORRECT'],['[BAD_CORE]','learner-evaluation-14','INVALID_OUTPUT_INCONSISTENT'],['[REVIEW_REQUIRED]','learner-evaluation-14','EVALUATION_REVIEW_REQUIRED'],['[LOW_REASONING]','learner-evaluation-14-thinking-low','CORRECT'],['[MATCHED_CONTROL]','learner-evaluation-14-budget-control','CORRECT'],
 ['[UNCERTAIN_COMPLETE]','learner-evaluation-15','EVALUATION_REVIEW_REQUIRED'],['[NORMALIZED]','learner-evaluation-15','CORRECT'],['[MISSING_REASONING]','learner-evaluation-15','INVALID_OUTPUT_SCHEMA_validReasoning_invalid_type'],['[BAD_INTERPRETATION]','learner-evaluation-15','INVALID_OUTPUT_INVALID_PASSAGE_REFERENCE'],
 ['[LONG_UNCERTAIN_SUMMARY]','learner-evaluation-15','INVALID_OUTPUT_SCHEMA_interpretation_summary_too_big'],
 ['[LONG_UNCERTAIN_SUMMARY]','learner-evaluation-16','EVALUATION_REVIEW_REQUIRED'],['[BAD_UNCERTAIN_SUMMARY]','learner-evaluation-16','EVALUATION_REVIEW_REQUIRED'],
 ['[MISSING_UNCERTAIN_SUMMARY]','learner-evaluation-16','EVALUATION_REVIEW_REQUIRED'],['[BAD_UNCERTAIN_EVIDENCE]','learner-evaluation-16','INVALID_OUTPUT_INVALID_PASSAGE_REFERENCE'],
 ['[BAD_CLEAR_SUMMARY]','learner-evaluation-16','CORRECT'],['[MISSING_REASONING]','learner-evaluation-16','INVALID_OUTPUT_SCHEMA_validReasoning_invalid_type'],['[NORMALIZED]','learner-evaluation-16','CORRECT'],
 ['[MEDIUM_REASONING]','learner-evaluation-16-thinking-medium','CORRECT'],['[UNCERTAIN_COMPLETE]','learner-evaluation-16-thinking-medium','EVALUATION_REVIEW_REQUIRED'],
 ['[THROTTLE]','learner-evaluation-16-thinking-medium','MODEL_UNAVAILABLE'],['[WRONG_TOOL]','learner-evaluation-16-thinking-medium','INVALID_OUTPUT_TOOL_ENVELOPE'],
 ['[MISSING_REASONING]','learner-evaluation-16-thinking-medium','INVALID_OUTPUT_SCHEMA_validReasoning_invalid_type']] as const){
 try{const r=await evaluateAnswer(q,answer,LEARNER_POLICIES[version].config,'NONE');if(r.result.classification!==expected)throw Error('Unexpected grade');
 if(['learner-evaluation-14-thinking-low','learner-evaluation-16-thinking-medium'].includes(version) && JSON.stringify(r).includes('FIXTURE_PRIVATE_REASONING'))throw Error('Reasoning content escaped');
 if(version==='learner-evaluation-16'){
   if(JSON.stringify(r).includes('FIXTURE_BAD_SUMMARY_NOT_OUTPUT'))throw Error('Discarded summary escaped');
   if(answer==='[BAD_CLEAR_SUMMARY]'&&!r.result.validationNotes?.some(n=>n.includes('summary was unavailable')))throw Error('Missing summary degradation note');
 }
 if(version==='learner-evaluation-14'){const issue=answer==='[REASONING_CONFLICT]'?'REASONING_CONFLICT':answer==='[BAD_REASONING]'?'REASONING_INVALID_OUTPUT':null;if(issue?!r.result.assessmentIssues?.includes(issue):Boolean(r.result.assessmentIssues?.length))throw Error('Wrong hold status');if(answer==='[FALSE_REASON]'&&r.result.criteria[1].finding!=='NOT_MET')throw Error('False reason received credit');}
 out.push({expected,observed:r.result.classification,passed:true});}
 catch(e){if(!(e instanceof EvaluationFailure) || e.code!==expected)throw e;out.push({expected,observed:e.code,retryable:e.retryable,passed:true});}
}
await writeFile(process.argv[2] ?? '/private/tmp/spasht-interview-evaluator-http-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
