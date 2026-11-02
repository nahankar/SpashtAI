import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnrollmentFields, EnrollmentSettingsEditor, type EnrollmentField } from './EnrollmentForm'
const fields: EnrollmentField[] = [
  { id: 'roll', label: 'Roll number', type: 'text', required: true, options: [] },
  { id: 'department', label: 'Department', type: 'dropdown', required: true, options: ['CS', 'ECE'] },
  { id: 'shift', label: 'Shift', type: 'radio', required: true, options: ['AM', 'PM'] },
  { id: 'skills', label: 'Skills', type: 'checkbox', required: true, options: ['Java', 'Python'] },
  { id: 'notice', label: '<script>Welcome</script>', type: 'message', required: false, options: [] },
]
describe('workspace signup fields', () => {
  it('renders each control, preserves choices, and safely renders plain messages', () => {
    const html = renderToStaticMarkup(<EnrollmentFields fields={fields} values={{ roll: '42', department: 'ECE', shift: 'PM', skills: ['Python'] }} onChange={() => {}} />)
    expect(html).toContain('value="42"'); expect(html).toContain('selected=""'); expect(html).toContain('type="radio"'); expect(html).toContain('type="checkbox"')
    expect(html).toContain('&lt;script&gt;Welcome&lt;/script&gt;'); expect(html).not.toContain('<script>')
  })
  it('requires a checkbox choice as a group, rather than requiring all options', () => {
    const empty = renderToStaticMarkup(<EnrollmentFields fields={[fields[3]]} values={{}} onChange={() => {}} />)
    expect(empty.match(/required=""/g)).toHaveLength(1)
    const answered = renderToStaticMarkup(<EnrollmentFields fields={[fields[3]]} values={{ skills: ['Python'] }} onChange={() => {}} />)
    expect(answered).not.toContain('required=""')
  })
  it('shows the form/email scope and saving behavior in the administrator editor', () => {
    const html = renderToStaticMarkup(<EnrollmentSettingsEditor busy={false} onSave={() => {}} />)
    expect(html).toContain('existing links keep their original form and message')
    expect(html).toContain('Invitation subject'); expect(html).toContain('Invitation message'); expect(html).toContain('Add field')
  })
})
