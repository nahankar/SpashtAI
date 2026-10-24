import { describe, expect, it, vi } from 'vitest'
import { fixture, recorder } from './test-fixtures'
import { interviewsAdapter } from './adapters/interviews'
const setup={track:['Automation Testing'],experienceBand:['2-5'],startingDifficulty:['Medium'],durationMinutes:10,recordingConsent:true as const}
function pilot(){
  const f=fixture();let run:string|null=null
  const original=f.fetcher.getMockImplementation()!
  f.fetcher.mockImplementation(async(input,init)=> {
    if(String(input).endsWith('/api/interviews/runs')){
      await original(input,init)
      return new Response(JSON.stringify({id:'run-1',sessionId:JSON.parse(String(init?.body)).sessionId}))
    }
    return original(input,init)
  })
  const created=vi.fn((value:{id:string;sessionId:string})=>{run=value.id})
  const adapter=interviewsAdapter(f.api,setup,()=>run,created)
  return {...f,adapter,created}
}
describe('interviews shared-session adapter',()=> {
  it('creates a consented interview and prepares a question before requesting a room token',async()=> {
    const f=pilot();await f.controller.start(f.config,f.adapter)
    expect(f.calls.map(c=>c.path.split('?')[0])).toEqual(['/api/interviews/runs','/api/interviews/runs/run-1/next',expect.stringMatching(/\/segments$/),'/livekit/token'])
    expect(f.calls[0].body).toMatchObject(setup)
    expect(f.calls[0].body).not.toHaveProperty('focusContext')
    expect([...new URL(`http://api${f.calls.at(-1)!.path}`).searchParams.keys()]).toEqual(['room','sessionId','segmentId'])
    expect(f.created).toHaveBeenCalledOnce()
  })
  it('uses owned cleanup if first-question preparation fails',async()=> {
    const f=pilot();const original=f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation(async(input,init)=>String(input).endsWith('/next')?new Response('{}',{status:409}):original(input,init))
    await f.controller.start(f.config,f.adapter)
    expect(f.calls.at(-1)).toMatchObject({path:'/api/interviews/runs/run-1',method:'DELETE'})
    expect(f.controller.getSnapshot().token).toBeNull()
  })
  it('ends the owned interview without communication points or Pulse tracking',async()=> {
    const f=pilot();await f.controller.start(f.config,f.adapter);f.calls.splice(0)
    await f.controller.leave(recorder(),f.adapter)
    expect(f.calls.some(c=>c.path==='/api/interviews/runs/run-1/end')).toBe(true)
    expect(f.calls.some(c=>c.path.includes('progress-pulse'))).toBe(false)
    // Shared engine invokes the effect, so this page supplies a deliberate no-op.
    expect(f.effects.left).toHaveBeenCalledWith(expect.any(String),false)
    expect(f.calls.some(c=>c.path.endsWith('/sessions'))).toBe(false)
    expect(f.adapter.trackPulse).toBe(false);expect(f.adapter.skipPulseCall).toBe(false)
    expect(f.calls.find(c=>c.path.endsWith('/analyze'))?.body).toMatchObject({autoTrackPulse:false})
  })
})
