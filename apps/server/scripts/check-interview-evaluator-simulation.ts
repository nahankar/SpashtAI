// Real HTTP transport check against the owned local stand-in; no grading-quality claim.
import {writeFile} from 'node:fs/promises';
import {evaluateAnswer, EvaluationFailure} from '../src/interviews/evaluator/model';
import {LEARNER_POLICIES} from '../src/interviews/evaluator/contracts';
if(process.env.NODE_ENV!=='test'||!/^http:\/\/127\.0\.0\.1:\d+\/bedrock$/.test(process.env.INTERVIEW_EVALUATOR_TEST_ENDPOINT ?? ''))throw Error('Simulation only');
const q={id:'fixture',namespace:'transport',externalQid:'HTTP',revision:1,questionText:'Fixture?',track:'Testing',category:'Testing',topic:'Transport',difficulty:'Simple',experienceBand:'0-2',goodAnswerPoints:'Core: Fixture.',exampleAnswer:'Fixture.',expectedDepth:'Fixture.',followUpGuidance:''};
const out: {expected: string; observed: string; retryable?: boolean; passed: boolean}[]=[];
for(const [answer,version,expected] of [['Fixture valid.','learner-evaluation-8','CORRECT'],['[REVIEW_REQUIRED]','learner-evaluation-11','EVALUATION_REVIEW_REQUIRED'],['[INVALID_OUTPUT]','learner-evaluation-11','INVALID_OUTPUT_JSON'],['[THROTTLE]','learner-evaluation-11','MODEL_UNAVAILABLE'],
 ['Fixture valid.','learner-evaluation-12','CORRECT'],['[REVIEW_REQUIRED]','learner-evaluation-12','EVALUATION_REVIEW_REQUIRED'],
 ['[WRONG_TOOL]','learner-evaluation-12','INVALID_OUTPUT_TOOL_ENVELOPE'],['[MULTIPLE_TOOLS]','learner-evaluation-12','INVALID_OUTPUT_TOOL_ENVELOPE'],['[THROTTLE]','learner-evaluation-12','MODEL_UNAVAILABLE']] as const){
 try{const r=await evaluateAnswer(q,answer,LEARNER_POLICIES[version].config,'NONE');if(r.result.classification!==expected)throw Error('Unexpected grade');out.push({expected,observed:r.result.classification,passed:true});}
 catch(e){if(!(e instanceof EvaluationFailure) || e.code!==expected)throw e;out.push({expected,observed:e.code,retryable:e.retryable,passed:true});}
}
await writeFile(process.argv[2] ?? '/private/tmp/spasht-interview-evaluator-http-results.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
