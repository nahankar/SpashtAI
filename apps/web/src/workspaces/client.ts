const BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
export async function workspaceRequest<T>(path: string, token?: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The workspace request could not be completed')
  return data as T
}
export function identityToken() { return localStorage.getItem('spashtai_token') || '' }
export interface Workspace {
  id: string; slug: string; name: string; kind: 'PERSONAL' | 'ORGANIZATION'; state: 'ACTIVE' | 'SUSPENDED';
  logoDataUrl: string | null; accentColor: string; timeZone: string; isolationStage: string;
  limits: { maxMembers: number; dailyEvaluations: number; concurrentVoice: number };
}
export interface Membership { id: string; role: 'OWNER' | 'ADMIN' | 'LEARNER'; state: 'INVITED' | 'ACTIVE' | 'SUSPENDED' }
export interface Feature { feature: string; entitled: boolean; enabled: boolean; memberDefault: boolean; allowed?: boolean; reason?: string | null }
export interface Entry { workspace: Workspace; membership: Membership; accessToken: string | null; notice: string }
export interface Snapshot extends Omit<Entry, 'accessToken'> { counts: { active: number; invited: number; suspended: number } | null; features: Feature[] }
