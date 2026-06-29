import { prisma } from './prisma'

/** Env default used when no admin override is set. */
export const DEFAULT_REPLAY_MODEL_ID =
  process.env.BEDROCK_REPLAY_MODEL_ID || 'amazon.nova-pro-v1:0'

export interface ReplayModelOption {
  id: string
  label: string
}

/** Curated set of Bedrock models offered to admins for Replay analysis. */
export const REPLAY_MODEL_OPTIONS: ReplayModelOption[] = [
  { id: 'amazon.nova-pro-v1:0', label: 'Amazon Nova Pro — highest quality (default)' },
  { id: 'amazon.nova-lite-v1:0', label: 'Amazon Nova Lite — faster & cheaper' },
  { id: 'amazon.nova-micro-v1:0', label: 'Amazon Nova Micro — fastest, lowest cost' },
  { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0', label: 'Anthropic Claude 3.5 Sonnet' },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Anthropic Claude 3.5 Haiku' },
]

export const ALLOWED_REPLAY_MODEL_IDS = new Set(REPLAY_MODEL_OPTIONS.map((o) => o.id))

let cache: { modelId: string; expiresAt: number } | null = null
const CACHE_TTL_MS = 10_000

export function invalidateAnalysisConfigCache(): void {
  cache = null
}

/**
 * The Bedrock model id to use for Replay analysis right now: the admin override
 * if set, otherwise the env default. Cached briefly to avoid a DB hit per call.
 */
export async function getReplayModelId(): Promise<string> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.modelId

  let modelId = DEFAULT_REPLAY_MODEL_ID
  try {
    const row = await prisma.analysisConfig.findUnique({ where: { id: 'default' } })
    if (row?.replayModelId) modelId = row.replayModelId
  } catch {
    // Table may not exist yet (pre-migration) — fall back to the env default.
  }
  cache = { modelId, expiresAt: now + CACHE_TTL_MS }
  return modelId
}

export interface AnalysisConfigView {
  /** Admin-set override (null = using the env default). */
  replayModelId: string | null
  /** What is actually used (override || env default). */
  effectiveModelId: string
  updatedAt: string | null
}

export async function getAnalysisConfig(): Promise<AnalysisConfigView> {
  let row: { replayModelId: string | null; updatedAt: Date } | null = null
  try {
    row = await prisma.analysisConfig.findUnique({
      where: { id: 'default' },
      select: { replayModelId: true, updatedAt: true },
    })
  } catch {
    /* pre-migration */
  }
  return {
    replayModelId: row?.replayModelId ?? null,
    effectiveModelId: row?.replayModelId || DEFAULT_REPLAY_MODEL_ID,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  }
}
