import { createHash } from 'crypto'
import { z } from 'zod'
import { BankError } from './csv'
import { draftSchema, identitySchema } from './schemas'

export const IMPORT_FIELDS = ['externalQid', 'track', 'category', 'topic', 'questionText', 'sourceAnswer', 'difficulty', 'experienceBand', 'frequency', 'questionType', 'roleArchetype', 'tags', 'trendNote', 'sourceFile', 'sourceSheet'] as const
export const DEFAULT_COLUMNS: Record<typeof IMPORT_FIELDS[number], string> = {
  externalQid: 'QID', track: 'Track', category: 'Category', topic: 'Topic', questionText: 'Question', sourceAnswer: 'Answer',
  difficulty: 'Difficulty', experienceBand: 'Experience Band', frequency: 'Frequency', questionType: 'Question Type',
  roleArchetype: 'Role Archetype', tags: 'Tags', trendNote: 'Trend Note (2026)', sourceFile: 'Source File', sourceSheet: 'Source Sheet',
}
export const importOptionsSchema = z.object({
  namespace: identitySchema.shape.namespace,
  mode: z.enum(['ADD_ONLY', 'UPDATE_BY_QID']),
  mapping: z.record(z.string().max(160)).default(DEFAULT_COLUMNS).refine(m => Object.keys(m).every(k => IMPORT_FIELDS.includes(k as typeof IMPORT_FIELDS[number])), 'Unknown mapped field'),
}).strict()
export type ImportOptions = z.infer<typeof importOptionsSchema>
export function importFingerprint(fileHash: string, options: ImportOptions) {
  return createHash('sha256').update(JSON.stringify({ fileHash, namespace: options.namespace, mode: options.mode,
    mapping: Object.entries(options.mapping).sort(([a], [b]) => a.localeCompare(b)) })).digest('hex')
}
export function normalizeRows(headers: string[], rows: string[][], options: ImportOptions) {
  for (const key of ['externalQid', 'questionText']) {
    if (!options.mapping[key] || !headers.includes(options.mapping[key])) throw new BankError(400, `Map ${key} to an existing CSV column`)
  }
  for (const name of Object.values(options.mapping)) if (name && !headers.includes(name)) throw new BankError(400, `Mapped column is missing: ${name}`)
  const seenIds = new Set<string>(); const seenText = new Set<string>()
  return rows.map((cells, index) => {
    // Array entries preserve even malformed source rows without evaluating keys.
    const raw = Array.from({ length: Math.max(headers.length, cells.length) }, (_, i) => ({ header: headers[i] ?? `Unmapped column ${i + 1}`, value: cells[i] ?? '' }))
    const read = (key: string) => { const column = options.mapping[key]; return column ? (cells[headers.indexOf(column)] ?? '').trim() : '' }
    const errors: string[] = []; const warnings: string[] = []
    if (cells.length !== headers.length) errors.push(`Expected ${headers.length} columns; found ${cells.length}`)
    const externalQid = read('externalQid'); const questionText = read('questionText')
    const identity = identitySchema.safeParse({ namespace: options.namespace, externalQid })
    if (!identity.success) errors.push('QID must contain only letters, numbers, underscore, dot or dash (max 100)')
    if (seenIds.has(externalQid)) errors.push('Duplicate QID in this batch')
    seenIds.add(externalQid)
    const questionKey = questionText.normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
    if (seenText.has(questionKey)) warnings.push('An earlier row has the same question text; review before publishing')
    seenText.add(questionKey)
    const sourceAnswer = read('sourceAnswer')
    if (!sourceAnswer) warnings.push('Missing source answer: draft needs an approved example and rubric')
    if (!read('track')) warnings.push('Track is unknown; assign it during review')
    if (!read('questionType') || !read('roleArchetype')) warnings.push('Question type or role archetype is unknown')
    const values = Object.fromEntries(IMPORT_FIELDS.filter(k => !['externalQid','sourceAnswer','sourceFile','sourceSheet','tags'].includes(k)).map(k => [k, read(k) || null]))
    const parsed = draftSchema.safeParse({ ...values, questionText, tags: [...new Set(read('tags').split(',').map(t => t.trim()).filter(Boolean))] })
    if (!parsed.success) errors.push(...parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`))
    const normalized = { externalQid, draft: parsed.success ? parsed.data : null,
      sourceAnswer: sourceAnswer || null, sourceQuestionText: questionText,
      sourceFile: read('sourceFile') || null, sourceSheet: read('sourceSheet') || null }
    return { rowNumber: index + 2, raw, normalized, errors, warnings, status: errors.length ? 'ERROR' : 'READY' }
  })
}
