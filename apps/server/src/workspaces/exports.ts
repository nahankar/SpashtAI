import ExcelJS from 'exceljs'
import { z } from 'zod'
import { readEnrollmentSettings } from './enrollment'
import { resolveFieldSelections } from './fieldFilters'
import { workspaceFeatureUsage, workspaceProgressPulse } from './analytics'
import { listWorkspaceMembers } from './service'
import { WorkspaceError } from './contracts'
import { requireWorkspaceManager, type WorkspaceTx, type establishWorkspace } from './context'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>
export type ExportReport = 'users' | 'feature-usage' | 'progress-pulse'
type Cell = string | number | Date | null

export function addExportSheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: Cell[][]) {
  if (rows.length > 10000) throw new WorkspaceError(422, 'EXPORT_TOO_LARGE', 'Export supports at most 10,000 rows per sheet. Narrow the filters and retry.')
  const sheet = workbook.addWorksheet(name)
  // Strings are XLSX text cells, never formulas (including values starting with =, +, -, @).
  sheet.addRow(headers)
  rows.forEach(row => sheet.addRow(row))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } }
  sheet.columns.forEach(column => { column.width = 24 })
  sheet.eachRow(row => row.eachCell(cell => { if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm:ss' }))
}

export async function workspaceExport(tx: WorkspaceTx, scope: Scope, report: ExportReport, input: unknown) {
  requireWorkspaceManager(scope)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SpashtAI'
  workbook.created = new Date()
  const rows: Cell[][] = [['Workspace', scope.workspace.name], ['Report', report], ['Generated (UTC)', workbook.created],
    ['Timezone', scope.workspace.timeZone], ['Limit', '10,000 rows per sheet; larger results fail without truncation']]
  const selections = resolveFieldSelections(scope, z.object({ field: z.unknown().optional() }).passthrough().parse(input ?? {}).field)
  const fields = readEnrollmentSettings(scope.workspace.enrollmentSettings).fields
  selections.forEach(({ id, values }) => rows.push([fields.find(f => f.id === id)!.label, values.map(v => v === '__none__' ? 'No answer' : v).join(', ')]))
  let rowCount = 0
  if (report === 'users') {
    const members = await listWorkspaceMembers(tx, scope, input, true)
    const questions = fields.filter(f => f.type !== 'message')
    addExportSheet(workbook, 'Users', ['Name', 'Email', 'Role', 'Status', 'Accepted (UTC)', ...questions.map(f => f.label), 'Product restrictions'],
      members.items.map(member => {
        const answers = z.record(z.union([z.string(), z.array(z.string()), z.null()])).nullable().parse(member.enrollmentResponses) ?? {}
        return [member.name, member.email, member.role, member.state, member.acceptedAt,
          ...questions.map(f => { const answer = answers[f.id]; return Array.isArray(answer) ? answer.join(', ') : answer ?? '' }),
          member.features.filter(f => !f.allowed).map(f => f.feature).join(', ')]
      }))
    rowCount = members.items.length
    rows.push(['Scope', 'All matching members, not only the current page'])
  } else {
    const data = report === 'feature-usage'
      ? await workspaceFeatureUsage(tx, scope, input, true)
      : await workspaceProgressPulse(tx, scope, input, true)
    rows.push(['From', data.range.from], ['To', data.range.to], ['Product', data.range.product ?? 'All'],
      ['Skill', data.range.skill ?? 'All'], ['Learner membership', data.range.learner ?? 'All'])
    if ('features' in data) {
      addExportSheet(workbook, 'By feature', ['Feature', 'Action', 'Events', 'Learners'], data.features.map(r => [r.feature, r.action, r.events, r.learners]))
      const keys = Object.keys(data.days[0] ?? {}).filter(k => k !== 'day')
      addExportSheet(workbook, 'Daily', ['Day', ...keys], data.days.map(r => [r.day, ...keys.map(k => r[k] ?? 0)]))
      addExportSheet(workbook, 'By learner', ['Name', 'Email', 'Role', 'Events', 'Last active day'], data.learners.map(r => [r.name, r.email, r.role, r.events, r.lastActiveDay]))
      rowCount = data.features.length + data.days.length + data.learners.length
    } else {
      addExportSheet(workbook, 'Skills', ['Skill', 'Average', 'Samples', 'Learners'], data.skills.map(r => [r.skill, r.average, r.samples, r.learners]))
      addExportSheet(workbook, 'Daily', ['Day', 'Average', 'Samples'], data.days.map(r => [r.day, r.average, r.samples]))
      addExportSheet(workbook, 'By learner', ['Name', 'Email', 'Role', 'Average', 'Samples', 'Last active day'], data.learners.map(r => [r.name, r.email, r.role, r.average, r.samples, r.lastActiveDay]))
      rowCount = data.skills.length + data.days.length + data.learners.length
    }
  }
  addExportSheet(workbook, 'Report details', ['Setting', 'Value'], rows)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  await tx.workspaceAudit.create({ data: { workspaceId: scope.workspace.id, actorUserId: scope.member.userId,
    action: 'admin_report_exported', metadata: { report, rowCount, fields: selections.map(f => ({ id: f.id, choices: f.values.length })) } } })
  const slug = scope.workspace.slug.replace(/[^a-z0-9_-]/gi, '-')
  return { buffer, filename: `${slug}-${report}-${workbook.created.toISOString().slice(0, 10)}.xlsx` }
}
