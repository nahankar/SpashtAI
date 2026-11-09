import {describe,it,expect} from 'vitest'
import {calibrationNamespace,calibrationGuidanceHash,verifyCalibrationQuestion} from '../scripts/lib/calibration-bank'
const q={id:'id1',namespace:'grading-scope-1',externalQid:'FIX-1',revision:2,questionText:'What is asked?',track:'Testing',category:'Testing',topic:'Isolation',difficulty:'Simple',experienceBand:'0-2',goodAnswerPoints:'Core: Required concept',exampleAnswer:'Example',expectedDepth:'Requested scope only',followUpGuidance:'Optional follow-up'}
const pin={revision:2,guidanceIssues:[],guidanceHash:calibrationGuidanceHash(q)}
describe('frozen calibration bank selection',()=>{
 it('keeps legacy fixtures on the original bank and checks explicit names',()=>{
  expect(calibrationNamespace(undefined)).toBe('automation-pilot')
  expect(calibrationNamespace('grading-scope-1')).toBe('grading-scope-1')
  for(const value of [null,123,'','../other','a b','x'.repeat(101)])expect(()=>calibrationNamespace(value)).toThrow()
 })
 it('pins scoped content but remains portable across generated row IDs',()=>{
  expect(()=>verifyCalibrationQuestion(q,pin,q.namespace)).not.toThrow()
  expect(calibrationGuidanceHash({...q,id:'id2'})).toBe(pin.guidanceHash)
 })
 it.each(['namespace','externalQid','revision','questionText','track','category','topic','difficulty','experienceBand','goodAnswerPoints','exampleAnswer','expectedDepth','followUpGuidance'])('detects a changed %s snapshot field',key=>{
  const changed={...q,[key]:key==='revision'?3:'changed'}
  expect(calibrationGuidanceHash(changed)).not.toBe(pin.guidanceHash)
  expect(()=>verifyCalibrationQuestion(changed,pin,q.namespace)).toThrow()
 })
 it('requires both pins for a new bank and refuses cross-bank fallback',()=>{
  for(const value of [undefined,{revision:2,guidanceIssues:[]},{...pin,guidanceHash:'bad'}])expect(()=>verifyCalibrationQuestion(q,value,q.namespace)).toThrow()
  expect(()=>verifyCalibrationQuestion(q,pin,'other')).toThrow('namespace mismatch')
 })
 it('preserves legacy revision-only and unpinned synthetic behavior',()=>{
  expect(()=>verifyCalibrationQuestion({...q,namespace:'automation-pilot'},undefined,'automation-pilot')).not.toThrow()
  expect(()=>verifyCalibrationQuestion({...q,namespace:'automation-pilot'},{revision:2,guidanceIssues:[]},'automation-pilot')).not.toThrow()
 })
})
