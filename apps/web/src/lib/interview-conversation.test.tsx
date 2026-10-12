import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { interviewConversation } from './interview-conversation'
import { ConversationPanel } from '@/features/live-session/components/ConversationPanel'
import type { InterviewAttempt } from './interview-practice'
import type { ChatMessage } from '@/features/live-session/types'
const start='2026-10-12T20:00:00Z'
const attempt=(id='a1',index=1):InterviewAttempt=>({id,index,status:'ASKED',assistance:'NONE',askedAt:start,
  question:{text:`Question ${index}?`,track:'Testing',topic:'Isolation',difficulty:'Simple',expectedDepth:'Explain.'},
  capturedText:'',capturedParts:[],completionReason:null,answer:null})
const part=(segmentId:string,sourceTurnId:string,text:string,createdAt=start)=>({segmentId,sourceTurnId,text,createdAt})
const live=(id:string,content:string,timestamp=start):ChatMessage=>({id,role:'user',content,timestamp})

describe('interview input to the existing Elevate conversation panel',()=> {
  it('joins thinking-pause fragments into one answer and deduplicates saved/live overlap',()=> {
    const a={...attempt(),capturedParts:[part('s1','user_turn_0','Streaming in an LLM.'),part('s1','user_turn_1','Sends data in real time.')]}
    const result=interviewConversation([a],[live('room::answer_a1::s1::user_turn_1','Sends data in real time.'),live('room::answer_a1::s1::user_turn_2','The screen updates gradually.')],start)
    expect(result.map(m=>m.role)).toEqual(['assistant','user'])
    expect(result[1].content).toBe('Streaming in an LLM. Sends data in real time. The screen updates gradually.')
  })
  it('preserves identical phrases on different resumed segments and prevents replays duplicating them',()=> {
    const a={...attempt(),capturedParts:[part('s1','user_turn_0','Yes.'),part('s2','user_turn_0','Yes.')]}
    const result=interviewConversation([a],[live('new-room::answer_a1::s2::user_turn_0','Yes.')],start)
    expect(result[1].content).toBe('Yes. Yes.')
  })
  it('keeps question boundaries and uses saved answer text as the authority after Finish',()=> {
    const a={...attempt(),status:'ANSWERED' as const,answer:{answerText:'Saved original answer.',textSource:'AGENT_COMMITTED_TURNS',textRevision:1,assistance:'NONE'}}
    const b={...attempt('a2',2),askedAt:'2026-10-12T20:01:00Z'}
    const result=interviewConversation([a,b],[live('room::answer_a1::s1::user_turn_3','Late notification.'),live('room::answer_a2::s1::user_turn_4','Second answer.','2026-10-12T20:01:01Z')],start)
    expect(result.map(m=>m.content)).toEqual(['Question 1?','Saved original answer.','Question 2?','Second answer.'])
  })
  it('does not show a prepared question as though the interviewer has spoken it',()=> {
    expect(interviewConversation([{...attempt(),status:'PREPARED',askedAt:null}],[],start)).toEqual([])
  })
  it('renders the shared panel with the interviewer left and one blue answer on the right',()=> {
    const a={...attempt(),capturedParts:[part('s1','user_turn_0','First part.'),part('s1','user_turn_1','Second part.')]}
    const html=renderToStaticMarkup(<ConversationPanel messages={interviewConversation([a],[],start)} />)
    expect(html).toContain('justify-start');expect(html).toContain('justify-end')
    expect(html.match(/bg-blue-600 text-white/g)).toHaveLength(1)
    expect(html).toContain('First part. Second part.')
  })
})
