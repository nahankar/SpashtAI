import {hash,questionSnapshotSchema,type QuestionSnapshot} from '../../src/interviews/evaluator/contracts'
export type CalibrationQuestionPin={revision:number;guidanceIssues:string[];guidanceHash?:string}
export function calibrationNamespace(value:unknown):string{
 if(value===undefined)return 'automation-pilot'
 if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw Error('Invalid calibration bank namespace')
 return value
}
// Exclude only the database-generated ID so the fixture is portable to a fresh isolated DB.
// Namespace/QID/revision and every actual evaluator guidance field remain pinned.
export function calibrationGuidanceHash(question:QuestionSnapshot):string{
 const schema=questionSnapshotSchema.omit({id:true})
 const snapshot=Object.fromEntries(Object.keys(schema.shape).map(key=>[key,question[key as keyof QuestionSnapshot]]))
 return hash(schema.parse(snapshot))
}
export function verifyCalibrationQuestion(question:QuestionSnapshot,pin:CalibrationQuestionPin|undefined,namespace:string):void{
 if(question.namespace!==namespace)throw Error('Calibration bank namespace mismatch')
 if(namespace!=='automation-pilot'&&(!pin||!Number.isInteger(pin.revision)||!/^[a-f0-9]{64}$/.test(pin.guidanceHash??'')))throw Error('Isolated fixture requires revision and guidance hash')
 if(pin&&pin.revision!==question.revision)throw Error(`${question.externalQid} changed from reviewed revision ${pin.revision} to ${question.revision}; re-review the labels`)
 if(pin?.guidanceHash&&pin.guidanceHash!==calibrationGuidanceHash(question))throw Error(`${question.externalQid} guidance changed; re-review the labels`)
}
