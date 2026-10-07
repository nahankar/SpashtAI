import { createHash } from 'crypto'
import { z } from 'zod'
import { BankError } from './csv'
import { draftSchema, identitySchema } from './schemas'
export const DEFAULT_COLUMNS = {
  externalQid: 'QID', track: 'Track', category: 'Category', topic: 'Topic', questionText: 'Question', sourceAnswer: 'Answer',
  difficulty: 'Difficulty', experienceBand: 'Experience Band', frequency: 'Frequency', questionType: 'Question Type',
  roleArchetype: 'Role Archetype', tags: 'Tags', trendNote: 'Trend Note (2026)', sourceFile: 'Source File', sourceSheet: 'Source Sheet',
  goodAnswerPoints: 'Good Answer Points', exampleAnswer: 'Learner Example Answer', explanation: 'Learner Explanation',
  expectedDepth: 'Expected Depth', verbalSuitable: 'Verbal Suitable', followUpGuidance: 'Follow-up Guidance',
  referenceSources: 'Reference Sources', reviewNotes: 'Review Notes', approved: 'Approved', active: 'Active',
} as const
export const IMPORT_FIELDS = Object.keys(DEFAULT_COLUMNS) as Array<keyof typeof DEFAULT_COLUMNS>
export const importOptionsSchema = z.object({
  namespace: identitySchema.shape.namespace, mode: z.enum(['ADD_ONLY', 'UPDATE_BY_QID']),
  mapping: z.record(z.string().max(160)).default(DEFAULT_COLUMNS).refine(m => Object.keys(m).every(k => IMPORT_FIELDS.includes(k as typeof IMPORT_FIELDS[number])), 'Unknown mapped field'),
}).strict()
export type ImportOptions = z.infer<typeof importOptionsSchema>
export function importFingerprint(fileHash: string, options: ImportOptions) {
  return createHash('sha256').update(JSON.stringify({ format: 'single-copy-v1', fileHash, namespace: options.namespace, mode: options.mode,
    mapping: Object.entries(options.mapping).sort(([a], [b]) => a.localeCompare(b)) })).digest('hex')
}
export function normalizeRows(headers: string[], rows: string[][], options: ImportOptions) {
  for (const key of ['externalQid', 'questionText']) if (!options.mapping[key] || !headers.includes(options.mapping[key])) throw new BankError(400, `Map ${key} to an existing CSV column`)
  for (const name of Object.values(options.mapping)) if (name && !headers.includes(name)) throw new BankError(400, `Mapped column is missing: ${name}`)
  const seenIds = new Set<string>(); const seenText = new Set<string>()
  return rows.map((cells, index) => {
    const raw = Array.from({ length: Math.max(headers.length, cells.length) }, (_, i) => ({ header: headers[i] ?? `Unmapped column ${i + 1}`, value: cells[i] ?? '' }))
    const read = (key: string) => { const column = options.mapping[key]; return column ? (cells[headers.indexOf(column)] ?? '').trim() : '' }
    const errors: string[] = []; const warnings: string[] = []
    if (cells.length !== headers.length) errors.push(`Expected ${headers.length} columns; found ${cells.length}`)
    const externalQid = read('externalQid'); const questionText = read('questionText')
    if (!identitySchema.safeParse({ namespace: options.namespace, externalQid }).success) errors.push('QID must contain only letters, numbers, underscore, dot or dash (max 100)')
    if (seenIds.has(externalQid)) errors.push('Duplicate QID in this batch'); seenIds.add(externalQid)
    const textKey = questionText.normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
    if (seenText.has(textKey)) warnings.push('An earlier row has the same question text; review before activation'); seenText.add(textKey)
    const values: Record<string, unknown> = { questionText }
    for (const key of Object.keys(draftSchema.shape)) {
      if (!options.mapping[key]) continue
      const value = read(key)
      if (key === 'verbalSuitable') {
        if (!value) continue
        if (!/^(true|false)$/i.test(value)) errors.push('Verbal Suitable must be TRUE or FALSE')
        else values[key] = value.toLowerCase() === 'true'
      } else if (key === 'tags') values[key] = [...new Set(value.split(',').map(t => t.trim()).filter(Boolean))]
      else if (key === 'referenceSources') values[key] = value.split(/\r?\n/).map(t => t.trim()).filter(Boolean)
      else if (value || !['track','category','topic','difficulty','experienceBand','frequency','questionType','roleArchetype','expectedDepth'].includes(key)) values[key] = value
    }
    if (!read('track')) warnings.push('Track defaults to General; confirm it before activation')
    for (const key of ['approved','active']) if (read(key)) {
      if (!/^(true|false)$/i.test(read(key))) errors.push(`${DEFAULT_COLUMNS[key as 'approved' | 'active']} must be TRUE or FALSE`)
      else if (read(key).toLowerCase() === 'true') warnings.push('Approval and activation are performed in the app; imported flags are ignored')
    }
    const parsed = draftSchema.partial().safeParse(values)
    if (!parsed.success) errors.push(...parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`))
    const sources = Object.fromEntries(['sourceAnswer','sourceFile','sourceSheet'].filter(key => options.mapping[key]).map(key => [key, read(key) || null]))
    const normalized = { externalQid, draft: parsed.success ? parsed.data : null, sources, sourceQuestionText: questionText, expectedRevision: null as number | null }
    return { rowNumber: index + 2, raw, normalized, errors, warnings, status: errors.length ? 'ERROR' : 'READY' }
  })
}
