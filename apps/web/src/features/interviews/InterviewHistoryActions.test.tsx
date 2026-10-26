import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ConversationPanel } from '@/features/live-session/components/ConversationPanel'
import { practiceTitle, type InterviewHistory } from '@/lib/interview-practice'
import { InterviewHistoryList } from './InterviewHistoryList'
import { PracticeTitle } from './PracticeTitle'

const api = vi.hoisted(() => ({ apiClient: vi.fn() }))
vi.mock('@/lib/api-client', async original => ({ ...await original<typeof import('@/lib/api-client')>(), apiClient: api.apiClient }))
const { deletePractices, toggleVisible } = await import('@/lib/interview-history')

const many = ['Agentic AI', 'Automation Testing', 'Business Analysis', 'Data Engineering', 'Data Science', 'Database Engineering', 'DevOps / Platform Engineering',
  'Engineering Leadership', 'Java', 'Manual Testing', 'Mobile Development', 'Python', 'Scrum Master / Agile Coaching', 'Web / Frontend'].join('|')
const run = (id: string, over: Partial<InterviewHistory> = {}): InterviewHistory => ({ id, sessionId: `s-${id}`, track: many, experienceBand: '0-2|2-5|5-8|8+',
  startingDifficulty: 'Simple|Medium|Complex|Very Complex', startedAt: '2026-10-26T10:00:00Z', endedAt: '2026-10-26T10:20:00Z', retainedAt: null, questionCount: 8, answeredCount: 7, skippedCount: 1, ...over })

describe('practice titles', () => {
  it('stays compact for a mixed practice and lists every track on demand', () => {
    expect(practiceTitle('Python').title).toBe('Python')
    expect(practiceTitle('Python|Java').title).toBe('Python & Java')
    expect(practiceTitle(many)).toMatchObject({ title: 'Mixed practice · 14 tracks' })
    const html = renderToStaticMarkup(<PracticeTitle track={many} suffix=" practice" as="h1" />)
    expect(html).toContain('<h1 class="break-words">Mixed practice · 14 tracks</h1>')
    expect(renderToStaticMarkup(<PracticeTitle track="Python" suffix=" practice" />)).toContain('Python practice')
    expect(html).toContain('Show all 14 tracks'); expect(html).toContain('Scrum Master / Agile Coaching, Web / Frontend')
    expect(html).toContain('min-w-0 max-w-full')
  })
})

describe('history selection and deletion', () => {
  it('renders a checkbox and Delete per record, with shrinkable columns', () => {
    const html = renderToStaticMarkup(<MemoryRouter><InterviewHistoryList runs={[run('a'), run('b', { endedAt: null })]} onRetain={() => undefined}
      selected={new Set(['a'])} onToggle={() => undefined} onDelete={() => undefined} /></MemoryRouter>)
    expect(html.match(/type="checkbox"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('aria-label="Delete Mixed practice · 14 tracks"')
    expect(html).toContain('ring-2 ring-primary')
    expect(html).toContain('flex min-w-0 flex-1 items-start gap-3'); expect(html).toContain('flex shrink-0 flex-wrap items-center justify-end gap-2')
  })
  it('selects or clears only the visible records', () => {
    const visible = [run('a'), run('b')]
    expect([...toggleVisible(new Set(['z']), visible)].sort()).toEqual(['a', 'b', 'z'])
    expect([...toggleVisible(new Set(['a', 'b', 'z']), visible)]).toEqual(['z'])
  })
  it('reports partial bulk-delete failures per record and calls the shared session deletion', async () => {
    api.apiClient.mockReset()
    api.apiClient.mockImplementation(async (path: string) => { if (path.includes('s-b')) throw new Error('500'); return { success: true } })
    expect(await deletePractices([run('a'), run('b'), run('c')])).toEqual({ deleted: ['a', 'c'], failed: ['b'] })
    expect(api.apiClient).toHaveBeenCalledWith('/sessions/s-a', { method: 'DELETE' })
  })
})

describe('interview conversation timestamps', () => {
  const messages = [{ id: 'q', role: 'assistant', content: 'Question?', timestamp: '2026-10-26T10:00:00Z' }, { id: 'a', role: 'user', content: 'Answer', timestamp: '2026-10-26T10:00:05Z' }]
  it('puts the time beside the bubble for interviews, keeping feedback below the answer', () => {
    const html = renderToStaticMarkup(<ConversationPanel messages={messages} autoScroll={false} timestampPlacement="side" renderAfterMessage={m => m.role === 'user' ? <p>FEEDBACK</p> : null} />)
    expect(html).toContain('sm:flex-row-reverse'); expect(html).toContain('sm:flex-row')
    expect(html.indexOf('Answer')).toBeLessThan(html.indexOf('FEEDBACK'))
    const answerRow = html.slice(html.indexOf('Answer'))
    expect(answerRow.indexOf('whitespace-nowrap')).toBeLessThan(answerRow.indexOf('FEEDBACK'))
  })
  it('leaves the default layout for Elevate and Replay unchanged', () => {
    const html = renderToStaticMarkup(<ConversationPanel messages={messages} autoScroll={false} />)
    expect(html).not.toContain('sm:flex-row'); expect(html).toContain('class="contents"'); expect(html).toContain('text-[10px] px-1 text-muted-foreground mt-1')
  })
})
