import { describe, expect, it } from 'vitest'
import { CSV_LIMITS, csvCell, parseCsv } from '../src/interviews/bank/csv'
import { importFingerprint, importOptionsSchema, normalizeRows } from '../src/interviews/bank/import'
const read = (text: string) => parseCsv(Buffer.from(text))
const options = importOptionsSchema.parse({ namespace: 'pilot', mode: 'ADD_ONLY', mapping: { externalQid: 'QID', questionText: 'Question', sourceAnswer: 'Answer' } })
describe('bounded CSV import', () => {
  it('reads UTF-8 BOM, multiline cells, commas and escaped quotes', () => {
    const data = read('\uFEFFQID,Question,Answer\r\nAUTO-1,"Why, how?","Line one\r\nSay ""hello"""\r\n')
    expect(data.rows).toEqual([['AUTO-1', 'Why, how?', 'Line one\r\nSay "hello"']])
    expect(data.fileHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each(['QID,Question\na,"open', 'QID,Question\na,a"b', 'QID,Question\na,"closed"bad', 'QID,QID\na,b', 'QID,\na,b', 'QID,Question'])('rejects malformed input %s', text => expect(() => read(text)).toThrow())
  it('rejects binary, invalid UTF-8, excess bytes, cells, rows and columns', () => {
    for (const buffer of [Buffer.from([0xff]), Buffer.from('PKfile'), Buffer.from('a,b\nx,\0'), Buffer.alloc(CSV_LIMITS.bytes + 1)]) expect(() => parseCsv(buffer)).toThrow()
    expect(() => read(`a,b\nx,${'x'.repeat(CSV_LIMITS.cellChars + 1)}`)).toThrow()
    expect(() => read(`a\n${'x\n'.repeat(CSV_LIMITS.rows + 1)}`)).toThrow()
    expect(() => read(`${Array.from({ length: 41 }, (_, i) => `h${i}`).join(',')}\nx`)).toThrow()
  })
  it('preserves unknown metadata and source answers privately, without synthesizing rubrics', () => {
    const data = read('QID,Question,Answer\nAUTO-1,What is isolation?,Source explanation')
    const [row] = normalizeRows(data.headers, data.rows, options)
    expect(row.status).toBe('READY'); expect(row.normalized.sourceAnswer).toBe('Source explanation')
    expect(row.normalized.draft).toMatchObject({ track: null, rightsBasis: 'UNRECORDED', exampleAnswer: '', explanation: '', rubric: null })
    expect(row.warnings).toContain('Track is unknown; assign it during review')
  })
  it('records errors per row and warns on exact text duplicates', () => {
    const data = read('QID,Question,Answer\nAUTO-1,Same question?,\nAUTO-1,Same  question?,\nBAD ID,Another question?,answer\nAUTO-3,Question?')
    const rows = normalizeRows(data.headers, data.rows, options)
    expect(rows.map(r => r.status)).toEqual(['READY', 'ERROR', 'ERROR', 'ERROR'])
    expect(rows[1].errors).toContain('Duplicate QID in this batch')
    expect(rows[1].warnings[0]).toContain('same question text')
  })
  it('rejects missing mapped columns and unknown field names', () => {
    expect(() => normalizeRows(['QID'], [['AUTO-1']], options)).toThrow('Map questionText')
    expect(importOptionsSchema.safeParse({ ...options, mapping: { unknown: 'QID' } }).success).toBe(false)
  })
  it('makes fingerprints mapping-order independent but sensitive to scope/mode/content', () => {
    expect(importFingerprint('a', options)).toBe(importFingerprint('a', { ...options, mapping: { sourceAnswer: 'Answer', questionText: 'Question', externalQid: 'QID' } }))
    expect(importFingerprint('b', options)).not.toBe(importFingerprint('a', options))
    expect(importFingerprint('a', { ...options, mode: 'UPDATE_BY_QID' })).not.toBe(importFingerprint('a', options))
  })
  it('neutralizes spreadsheet formulas only in downloaded reports', () => {
    expect(csvCell(' =SUM(A1)')).toBe('"\' =SUM(A1)"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(read('QID,Question\nAUTO-1,=unchanged').rows[0][1]).toBe('=unchanged')
  })
})
