import { createHash } from 'crypto'

export const CSV_LIMITS = { bytes: 5 * 1024 * 1024, rows: 10000, columns: 40, cellChars: 20000 } as const
export class BankError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
/** Bounded RFC 4180 reader. No spreadsheet/formula evaluation, external resources or uploads on disk. */
export function parseCsv(buffer: Buffer) {
  if (!buffer.length || buffer.length > CSV_LIMITS.bytes) throw new BankError(400, 'CSV must be between 1 byte and 5 MB')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '') }
  catch { throw new BankError(400, 'Save the file as UTF-8 CSV') }
  if (text.includes('\0') || buffer.subarray(0, 2).toString() === 'PK') throw new BankError(400, 'Only UTF-8 CSV is supported. Save the question sheet as CSV first.')
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false
  const endCell = () => {
    row.push(cell); cell = ''; closed = false
    if (row.length > CSV_LIMITS.columns) throw new BankError(400, 'CSV has more than 40 columns')
  }
  const endRow = () => {
    endCell(); rows.push(row); row = []
    if (rows.length > CSV_LIMITS.rows + 1) throw new BankError(400, 'CSV has more than 10,000 data rows')
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } }
      else cell += ch
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      if (ch === ',') endCell()
      else { if (ch === '\r' && text[i + 1] === '\n') i++; endRow() }
    } else if (ch === '"' && !cell && !closed) quoted = true
    else {
      if (closed || ch === '"') throw new BankError(400, 'Malformed CSV quoting')
      cell += ch
    }
    if (cell.length > CSV_LIMITS.cellChars) throw new BankError(400, 'CSV cell exceeds 20,000 characters')
  }
  if (quoted) throw new BankError(400, 'CSV has an unclosed quoted field')
  if (cell || row.length || closed) endRow()
  const headers = rows.shift()?.map(h => h.trim()) ?? []
  if (!headers.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new BankError(400, 'CSV headers must be non-empty and unique')
  if (!rows.length) throw new BankError(400, 'CSV has no question rows')
  return { headers, rows, fileHash: createHash('sha256').update(buffer).digest('hex') }
}
export function csvCell(value: string) {
  // Spreadsheet-safe error/template exports. Raw values remain unchanged in the database.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
