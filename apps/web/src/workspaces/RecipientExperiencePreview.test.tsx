import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecipientExperiencePreview, SignupFieldsPreview } from './RecipientExperiencePreview'
import { OwnerAccessPanel } from './OwnerAccessPanel'
describe('recipient and Owner access previews', () => {
  it('shows actual custom controls and normal profile details as separate, disabled steps', () => {
    const html = renderToStaticMarkup(<SignupFieldsPreview workspaceName="College" fields={[{ id: 'department', label: 'Department', type: 'dropdown', required: true, options: ['CS', 'ECE'] }]} />)
    for (const label of ['Department', 'Phone number', 'Date of birth', 'Gender', 'Pincode', 'Continue with Google', 'already complete']) expect(html).toContain(label)
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(2)
    expect(html).not.toContain('<form')
  })
  it('does not call a provider or send automatically when a preview is rendered', () => {
    let called = false
    const html = renderToStaticMarkup(<RecipientExperiencePreview emailContent={{ subject: '', message: '' }} onEmailPreview={async () => { called = true; throw new Error('should not load on render') }} />)
    expect(called).toBe(false); expect(html).toContain('No email is sent'); expect(html).toContain('Generate email preview')
  })
  it('shows assigned Owner identity, pending acceptance and a workspace-scoped login link', () => {
    let sent = false
    const html = renderToStaticMarkup(<OwnerAccessPanel name="College" slug="college" owners={[{ id: 'm1', email: 'owner@example.invalid', state: 'INVITED' }]} disabled={false} onSend={async () => { sent = true; return { deliveryStatus: 'SENT' } }} />)
    expect(html).toContain('https://spasht.ai/w/college'); expect(html).toContain('owner@example.invalid'); expect(html).toContain('Pending acceptance'); expect(html).toContain('Copy access instructions'); expect(html).toContain('Send access email'); expect(sent).toBe(false)
  })
})
