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
/** Absolute API URL, for media elements that cannot send headers (they use a short-lived ticket in the URL). */
export function workspaceApiUrl(path: string) { return `${BASE}${path}` }
export function identityToken() { return localStorage.getItem('spashtai_token') || '' }
export interface Workspace {
  id: string; slug: string; name: string; kind: 'PERSONAL' | 'ORGANIZATION'; state: 'ACTIVE' | 'SUSPENDED';
  logoDataUrl: string | null; accentColor: string; timeZone: string; isolationStage: string;
  enrollmentSettings?: EnrollmentSettings;
  limits: { maxMembers: number; dailyEvaluations: number; concurrentVoice: number };
}
export interface Membership { id: string; role: 'OWNER' | 'ADMIN' | 'LEARNER'; state: 'INVITED' | 'ACTIVE' | 'SUSPENDED' }
export interface Feature { feature: string; entitled: boolean; enabled: boolean; memberDefault: boolean; allowed?: boolean; ready?: boolean; reason?: string | null }
export interface Entry { workspace: Workspace; membership: Membership; accessToken: string | null; expiresInSeconds?: number; notice: string }
export interface Snapshot extends Omit<Entry, 'accessToken'> { counts: { active: number; invited: number; suspended: number } | null; features: Feature[] }
