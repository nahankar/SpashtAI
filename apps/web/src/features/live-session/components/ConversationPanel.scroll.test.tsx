import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationPanel } from './ConversationPanel'
const harness=vi.hoisted(()=>({effects:[] as Array<()=>void>,scroll:vi.fn()}))
vi.mock('react',async importOriginal=>({
  ...await importOriginal<typeof import('react')>(),
  useEffect:(effect:()=>void)=>{harness.effects.push(effect)},
  useRef:()=>({current:{scrollIntoView:harness.scroll}}),
}))
beforeEach(()=>{harness.effects.length=0;harness.scroll.mockClear()})
function render(autoScroll?:boolean,content='First answer.') {
  const html=renderToStaticMarkup(<ConversationPanel messages={[{role:'user',content,timestamp:''}]} autoScroll={autoScroll} scrollable={autoScroll!==false} />)
  harness.effects.splice(0).forEach(effect=>effect())
  return html
}
describe('playback preserves manual page scrolling',()=> {
  it('never forces the page to the bottom on initial render or a transcript update',()=> {
    const html=render(false)
    render(false,'Second answer.')
    expect(harness.scroll).not.toHaveBeenCalled()
    expect(html).not.toContain('max-h-[32rem]')
  })
  it('keeps the existing live Elevate follow behavior by default',()=> {
    render()
    expect(harness.scroll).toHaveBeenCalledWith({behavior:'smooth'})
  })
})
