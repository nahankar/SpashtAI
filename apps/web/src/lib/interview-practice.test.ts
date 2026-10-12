import { describe, expect, it, vi } from 'vitest'
import { confirmedInterviewDrain, interviewCompletionMessage, type CaptureAction, type CaptureReceipt } from './interview-practice'
import { ApiError } from './api-client'

describe('interview durable speech confirmation',()=> {
  it.each(['QUESTION_BANK_EXHAUSTED', 'PRACTICE_DURATION_REACHED', 'PRACTICE_QUESTION_LIMIT'])('recognizes %s as normal completion', code => {
    expect(interviewCompletionMessage(new ApiError('Your answers are saved.', 409, code))).toBe('Your answers are saved.')
  })
  it('does not classify failed capture, authorization or connectivity as normal completion', () => {
    expect(interviewCompletionMessage(new ApiError('Not permitted', 403, 'QUESTION_BANK_EXHAUSTED'))).toBeNull()
    expect(interviewCompletionMessage(new ApiError('Transcript pending', 409, 'TRANSCRIPT_PENDING'))).toBeNull()
    expect(interviewCompletionMessage(new Error('Connection failed'))).toBeNull()
  })
  function fixture(action:CaptureAction='FINISH') {
    const order:string[]=[]
    const receipt:CaptureReceipt={id:'request-1',attemptId:'attempt-1',segmentId:'segment-1',action}
    const port={seal:vi.fn(async()=>{order.push('seal')}),mute:vi.fn(async()=>{order.push('mute')}),
      rpc:vi.fn(async()=>{order.push('rpc');return JSON.stringify({receiptId:receipt.id})}),
      verify:vi.fn(async()=>{order.push('verify');return receipt})}
    return {port,order,receipt}
  }
  it('seals recorder, mutes and verifies persisted acknowledgement before pause',async()=> {
    const {port,order,receipt}=fixture('PAUSE')
    expect(await confirmedInterviewDrain(port,'PAUSE','request-1','attempt-1','segment-1')).toEqual(receipt)
    expect(order).toEqual(['seal','mute','rpc','verify'])
  })
  it('keeps the recorder open between questions but mutes before finish',async()=> {
    const {port,order}=fixture()
    await confirmedInterviewDrain(port,'FINISH','request-1','attempt-1','segment-1')
    expect(order).toEqual(['mute','rpc','verify'])
    expect(port.rpc).toHaveBeenCalledWith({action:'FINISH',requestId:'request-1'})
  })
  it('cannot advance when provider transcript is pending',async()=> {
    const {port}=fixture();port.rpc.mockResolvedValue(JSON.stringify({error:'TRANSCRIPT_PENDING'}))
    await expect(confirmedInterviewDrain(port,'FINISH','request-1','attempt-1','segment-1')).rejects.toThrow('still being transcribed')
    expect(port.verify).not.toHaveBeenCalled()
  })
  it.each(['id','attemptId','segmentId','action'] as const)('rejects an unrelated %s',async field=> {
    const {port,receipt}=fixture()
    port.verify.mockResolvedValue({...receipt,[field]:'other'} as CaptureReceipt)
    await expect(confirmedInterviewDrain(port,'FINISH','request-1','attempt-1','segment-1')).rejects.toThrow('another action')
  })
  it('does not accept an unverifiable RPC response',async()=> {
    const {port}=fixture();port.verify.mockRejectedValue(new Error('Server unavailable'))
    await expect(confirmedInterviewDrain(port,'FINISH','request-1','attempt-1','segment-1')).rejects.toThrow('Server unavailable')
  })
})
