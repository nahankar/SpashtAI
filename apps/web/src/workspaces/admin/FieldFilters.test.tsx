import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { FieldFilters } from './FieldFilters'

vi.mock('../shell/context', () => ({
  useWorkspaceData: () => ({ data: [
    { id: 'branch', label: 'Branch', options: ['CS', 'ECE'] },
    { id: 'semester', label: 'Current Semester', options: ['1', '2'] },
  ], loading: false, error: '' }),
}))

describe('custom report filter labels', () => {
  it('stacks each label above its associated trigger on every shared filter surface', () => {
    const html = renderToStaticMarkup(<MemoryRouter><FieldFilters /></MemoryRouter>)
    for (const id of ['branch', 'semester']) {
      expect(html).toContain('class="flex flex-col items-start gap-1.5"')
      expect(html).toContain(`for="custom-filter-${id}"`)
      expect(html).toContain(`id="custom-filter-${id}"`)
    }
    expect(html.match(/class="flex flex-col items-start gap-1.5"/g)).toHaveLength(2)
  })
})
