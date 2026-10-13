import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { interviewPlaybackWords } from './interview-playback-words'
import { KaraokeText } from '@/components/session/KaraokeText'
import type { ChatMessage } from '@/features/live-session/types'
const messages: ChatMessage[] = [{id:'q1',role:'assistant',content:'Question one?',timestamp:''},
  {id:'a1',role:'user',content:'First part. Second part.',timestamp:''},
  {id:'q2',role:'assistant',content:'Question two?',timestamp:''},
  {id:'a2',role:'user',content:'Another answer.',timestamp:''}]
const word = (w:string,start:number,timingOrigin='forced_alignment') => ({w,start,end:start+.5,timingOrigin})
const turns = [{role:'assistant',text:'Question one?'},
  {role:'user',text:'First part.',words:[word('First',10),word('part',11)]},
  {role:'user',text:'Second part.',words:[word('Second',20),word('part',21)]},
  {role:'assistant',text:'Question two?'},
  {role:'user',text:'Another answer.',words:[word('Another',30),word('answer',31)]}]
describe('recording-bound words on stitched interview answers',()=> {
  it('joins chunk timings into one answer without crossing the next question',()=> {
    const result=interviewPlaybackWords(messages,turns)
    expect(result.get('a1')?.map(w=>w.start)).toEqual([10,11,20,21])
    expect(result.get('a2')?.map(w=>w.start)).toEqual([30,31])
  })
  it('rejects synthetic timestamps and stale answer text',()=> {
    const synthetic=turns.map(turn=>({...turn,words:'words' in turn ? turn.words!.map(w=>({...w,timingOrigin:'synthetic'})) : undefined}))
    expect(interviewPlaybackWords(messages,synthetic).size).toBe(0)
    expect(interviewPlaybackWords(messages.map(m=>m.id==='a1'?{...m,content:'Rewritten answer.'}:m),turns).has('a1')).toBe(false)
  })
  it('does not bind words after a mismatched question boundary',()=> {
    expect(interviewPlaybackWords(messages,[{role:'assistant',text:'Different question?'},...turns.slice(1)]).size).toBe(0)
  })
  it('distinguishes the current word from three words before and after it',()=> {
    const words=['one','two','three','four','five','six','seven','eight','nine'].map((w,i)=>word(w,i+1))
    const html=renderToStaticMarkup(<KaraokeText text={words.map(w=>w.w).join(' ')} words={words} currentTime={5.2} active onSeek={()=>undefined} lightOnDark />)
    expect(html.match(/data-word-state="current"/g)).toHaveLength(1)
    expect(html.match(/data-word-state="context"/g)).toHaveLength(6)
    expect(html).toContain('aria-current="true"')
  })
  it('does not pretend an earlier word is spoken during an unaligned stretch',()=> {
    const html=renderToStaticMarkup(<KaraokeText text="First part. Second part." words={[word('First',10),word('part',11),word('Second',20),word('part',21)]}
      currentTime={15} active onSeek={()=>undefined} lightOnDark />)
    expect(html).not.toContain('data-word-state="current"')
    expect(html).not.toContain('data-word-state="context"')
  })
})
