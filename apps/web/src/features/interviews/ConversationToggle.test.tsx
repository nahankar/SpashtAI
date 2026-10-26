import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationToggle } from './ConversationToggle'
import { conversationHidden } from '@/lib/interview-practice'

describe('Show conversation toggle', () => {
  it('is a labelled keyboard-operable switch that names the panel it controls', () => {
    const on = renderToStaticMarkup(<ConversationToggle checked onChange={() => undefined} controls="interview-conversation" />)
    expect(on).toMatch(/^<button type="button" role="switch" aria-checked="true" aria-controls="interview-conversation"/)
    expect(on).toContain('Show conversation')
    expect(on).toContain('focus-visible:ring-2')
    expect(renderToStaticMarkup(<ConversationToggle checked={false} onChange={() => undefined} controls="x" />)).toContain('aria-checked="false"')
  })
  it('hides the panel only during practice; a finished practice always shows it', () => {
    expect(conversationHidden(true, false)).toBe(false)
    expect(conversationHidden(false, false)).toBe(true)
    expect(conversationHidden(false, true)).toBe(false)
  })
})
