import { apiClient, getAuthHeaders } from './api-client'
export const BANK_API = '/api/admin/interview-bank'
export interface Criterion {
  id: string; essential: boolean; points: string[]; alternatives: string[]; misconceptions: string[]; anchors: string[]
}
export interface BankDraft {
  questionText: string; track: string | null; category: string | null; topic: string | null
  difficulty: string | null; experienceBand: string | null; frequency: string | null; questionType: string | null; roleArchetype: string | null
  tags: string[]; trendNote: string | null; explanation: string; exampleAnswer: string; publicCriteria: { id: string; label: string }[]
  evaluationMode: string | null; verbalSuitable: boolean; expectedDepth: string; referenceSources: string[]
  rightsBasis: string; rightsNotes: string; learnerContentRewritten: boolean; rubricIndependentlyAuthored: boolean
  rubric: { criteria: Criterion[]; notes: string } | null
}
export function emptyDraft(): BankDraft {
  return { questionText: '', track: 'Automation Testing', category: null, topic: null, difficulty: null, experienceBand: null,
    frequency: null, questionType: null, roleArchetype: null, tags: [], trendNote: null, explanation: '', exampleAnswer: '',
    publicCriteria: [], evaluationMode: null, verbalSuitable: false, expectedDepth: '', referenceSources: [], rightsBasis: 'UNRECORDED',
    rightsNotes: '', learnerContentRewritten: false, rubricIndependentlyAuthored: false, rubric: null }
}
export interface BankDetail {
  draft: BankDraft; blockers: string[]
  version: { id: string; version: number; revision: number; status: string; sourceAnswer: string | null; sourceQuestionText: string | null
    question: { namespace: string; externalQid: string } }
}
export interface BankPreview { status: string; preview: { questionText: string; explanation: string; exampleAnswer: string; expectedDepth: string; criteria: { id: string; label: string }[] } }
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
