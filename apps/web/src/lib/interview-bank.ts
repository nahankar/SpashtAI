import { apiClient, getAuthHeaders } from './api-client'
export const BANK_API = '/api/admin/interview-bank'
export interface BankDraft {
  questionText: string; track: string; category: string; topic: string
  difficulty: string; experienceBand: string; frequency: string; questionType: string; roleArchetype: string
  tags: string[]; trendNote: string; explanation: string; exampleAnswer: string; goodAnswerPoints: string; followUpGuidance: string
  verbalSuitable: boolean; expectedDepth: string; referenceSources: string[]; reviewNotes: string; generationNotes: string
}
export function emptyDraft(): BankDraft {
  return { questionText: '', track: 'General', category: 'General', topic: 'General', difficulty: 'Medium', experienceBand: '2-5',
    frequency: 'Core', questionType: 'Technical', roleArchetype: 'IC', tags: [], trendNote: '', explanation: '', exampleAnswer: '',
    goodAnswerPoints: '', followUpGuidance: '', verbalSuitable: true, expectedDepth: 'Explain your reasoning and give a practical example.',
    referenceSources: [], reviewNotes: '', generationNotes: '' }
}
export interface BankQuestion {
  id: string; revision: number; approved: boolean; active: boolean; namespace: string; externalQid: string
  questionText: string; track: string; difficulty: string; origin: string
}
export interface BankDetail {
  draft: BankDraft; blockers: string[]
  question: BankQuestion & { sourceAnswer: string | null; sourceQuestionText: string | null }
}
export interface BankPreview { status: string; preview: { questionText: string; explanation: string; exampleAnswer: string; expectedDepth: string } }
export type BankAction = 'approve' | 'activate' | 'deactivate' | 'approve_activate' | 'delete'
export function bankStatus(question: Pick<BankQuestion, 'approved' | 'active'>) {
  return question.active ? 'Active' : question.approved ? 'Approved · inactive' : 'Draft · inactive'
}
export interface BatchSummary { id: string; status: string; namespace: string; fileHash: string; mode: string; createdAt: string }
export interface BatchDetail {
  batch: BatchSummary; page: number; counts: Record<string, number>
  rows: { id: string; rowNumber: number; status: string; outcome: string | null; errors: string[]; warnings: string[]; normalized: { externalQid: string } }[]
}
export function bankWrite<T>(path: string, body: unknown, method = 'POST', signal?: AbortSignal) {
  return apiClient<T>(`${BANK_API}${path}`, { method, body: JSON.stringify(body), signal })
}
const base = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
// FormData needs the browser's multipart boundary; JSON clients deliberately aren't reused.
export async function bankFile<T>(path: string, form?: FormData, signal?: AbortSignal): Promise<T> {
  const headers = getAuthHeaders(); delete headers['Content-Type']
  const response = await fetch(`${base}${BANK_API}${path}`, { method: form ? 'POST' : 'GET', headers, body: form, signal })
  if (response.status === 401) throw new Error('Your sign-in expired. Sign in again before importing.')
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `Request failed: ${response.status}`)
  }
  return (form ? response.json() : response.blob()) as Promise<T>
}
export async function downloadBankFile(path: string, name: string) {
  const blob = await bankFile<Blob>(path); const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
