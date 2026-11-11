/**
 * Control-plane and workspace-admin HTTP helpers.
 *
 * Entry, acceptance and the workspace list use the identity Bearer and ignore
 * `x-spasht-workspace`. After entry, `/api/workspaces/current/*` (members, invitations,
 * branding, admin reports, AI Analytics) use the workspace JWT as the Bearer.
 * Product routes must not use these helpers: they need the identity Bearer plus
 * the workspace header from `getAuthHeaders`.
 */
import type { EnrollmentSettings } from './EnrollmentForm'
import { ApiError } from '@/lib/api-client'
import { isWorkspaceFailure, reportWorkspaceFailure } from './activeWorkspace'
const BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
export async function workspaceRequest<T>(path: string, token?: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data.issues?.map((i: { message: string }) => i.message).join('; ') || data.message || data.error || 'The workspace request could not be completed'
    throw new ApiError(message, response.status, data.code)
  }
  return data as T
}
/** Workspace-admin call with the open workspace token; an ended or expired workspace session asks the shell to re-enter. */
export async function currentWorkspaceRequest<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await workspaceRequest<T>(path, token, method, body)
  } catch (error) {
    if (error instanceof ApiError && isWorkspaceFailure(error.code)) reportWorkspaceFailure(error.code)
    throw error
  }
}
export function identityToken() { return localStorage.getItem('spashtai_token') || '' }
export async function currentWorkspaceDownload(token: string, path: string) {
  const response = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const data = await response.json()
    if (isWorkspaceFailure(data.code)) reportWorkspaceFailure(data.code)
    throw new ApiError(data.issues?.map((i: { message: string }) => i.message).join('; ') || data.message || data.error || 'Unable to export', response.status, data.code)
  }
  if (!response.headers.get('content-type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) throw new Error('The export response was not an Excel workbook')
  return { blob: await response.blob(), filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] }
}
export interface Workspace {
  invitationLimits?: { batchSize: number; hourlyLimit: number | null };
  id: string; slug: string; name: string; kind: 'PERSONAL' | 'ORGANIZATION'; state: 'ACTIVE' | 'SUSPENDED';
  logoDataUrl: string | null; accentColor: string; timeZone: string; isolationStage: string;
  enrollmentSettings?: EnrollmentSettings;
  limits: { maxMembers: number; dailyEvaluations: number; concurrentVoice: number };
}
export interface Membership { id: string; role: 'OWNER' | 'ADMIN' | 'LEARNER'; state: 'INVITED' | 'ACTIVE' | 'SUSPENDED' }
export interface Feature { feature: string; entitled: boolean; enabled: boolean; memberDefault: boolean; allowed?: boolean; ready?: boolean; reason?: string | null }
export interface Entry { workspace: Workspace; membership: Membership; accessToken: string | null; expiresInSeconds?: number; notice: string }
export interface Snapshot extends Omit<Entry, 'accessToken'> { counts: { active: number; invited: number; suspended: number } | null; features: Feature[] }
