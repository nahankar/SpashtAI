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
 ['Fixture valid.','learner-evaluation-14','CORRECT'],['[REASONING_CONFLICT]','learner-evaluation-14','INCORRECT'],['[BAD_REASONING]','learner-evaluation-14','CORRECT'],['[FALSE_REASON]','learner-evaluation-14','INCORRECT'],['[BAD_CORE]','learner-evaluation-14','INVALID_OUTPUT_INCONSISTENT'],['[REVIEW_REQUIRED]','learner-evaluation-14','EVALUATION_REVIEW_REQUIRED']] as const){
 try{const r=await evaluateAnswer(q,answer,LEARNER_POLICIES[version].config,'NONE');if(r.result.classification!==expected)throw Error('Unexpected grade');
 if(version==='learner-evaluation-14'){const issue=answer==='[REASONING_CONFLICT]'?'REASONING_CONFLICT':answer==='[BAD_REASONING]'?'REASONING_INVALID_OUTPUT':null;if(issue?!r.result.assessmentIssues?.includes(issue):Boolean(r.result.assessmentIssues?.length))throw Error('Wrong hold status');if(answer==='[FALSE_REASON]'&&r.result.criteria[1].finding!=='NOT_MET')throw Error('False reason received credit');}
 out.push({expected,observed:r.result.classification,passed:true});}
 catch(e){if(!(e instanceof EvaluationFailure) || e.code!==expected)throw e;out.push({expected,observed:e.code,retryable:e.retryable,passed:true});}
}
await writeFile(process.argv[2] ?? '/private/tmp/spasht-interview-evaluator-http-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
