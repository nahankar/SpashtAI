import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which application code was actually tested. The tool's own revision is recorded separately and is never used
 * as the application revision.
 *
 * status:
 * - verified   — a local process serves the endpoint, its checkout is clean, and it started after the
 *                checkout's HEAD last moved, so it runs that commit (dev servers may hot-reload; clean tree means
 *                there is nothing else to reload).
 * - unverified — a process and checkout were found but the running code may differ (dirty tree, or HEAD moved
 *                after the process started). The commit shown is HEAD at inspection time, not proven.
 * - unknown    — no local process could be inspected (remote target, missing permissions, no Git checkout).
 */
export interface ComponentProvenance {
  component: 'web' | 'api' | 'agent'
  endpoint?: string
  pid?: number
  sourceDir?: string
  branch?: string
  commit?: string
  dirty?: boolean
  processStartedAt?: string
  headMovedAt?: string
  status: 'verified' | 'unverified' | 'unknown'
  basis: string
  /** Non-secret targeting values (LIVEKIT_URL, SERVER_URL, VITE_API_BASE_URL) with where they came from. */
  targets?: Record<string, { value: string; source: string }>
}

type Exec = (cmd: string, args: string[]) => string
const defaultExec: Exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })

function tryExec(exec: Exec, cmd: string, args: string[]): string | null {
  try { return exec(cmd, args).trim() } catch { return null }
}

export function listeningPid(port: number, exec: Exec = defaultExec): number | null {
  const out = tryExec(exec, 'lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  const pid = Number(out?.split('\n')[0])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

export function processCwd(pid: number, exec: Exec = defaultExec): string | null {
  const out = tryExec(exec, 'lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  return out?.split('\n').find(l => l.startsWith('n'))?.slice(1) ?? null
}

/** Reads only the named keys from a process environment (macOS/BSD `ps eww`); never returns other variables. */
export function processEnvKeys(pid: number, keys: string[], exec: Exec = defaultExec): Record<string, string> {
  const out = tryExec(exec, 'ps', ['eww', '-o', 'command=', '-p', String(pid)]) ?? ''
  const found: Record<string, string> = {}
  for (const token of out.split(/\s+/)) {
    const eq = token.indexOf('=')
    if (eq > 0 && keys.includes(token.slice(0, eq))) found[token.slice(0, eq)] = token.slice(eq + 1)
  }
  return found
}

/** dotenv semantics: a value from the process environment wins; otherwise the checkout's `.env`. Named keys only. */
export function dotenvKeys(dir: string, keys: string[]): Record<string, string> {
  return dotenvFile(join(dir, '.env'), keys)
}

export function dotenvFile(file: string, keys: string[]): Record<string, string> {
  if (!existsSync(file)) return {}
  const found: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && keys.includes(m[1]) && !line.trimStart().startsWith('#')) found[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return found
}

/** `node --env-file=…` / `tsx --env-file=…` on the process or its parent (npm/tsx wrappers). */
export function envFileArg(pid: number, exec: Exec = defaultExec): string | null {
  for (let current: number | null = pid, depth = 0; current && depth < 3; depth++) {
    const command = tryExec(exec, 'ps', ['-o', 'command=', '-p', String(current)]) ?? ''
    const m = /--env-file[= ](\S+)/.exec(command)
    if (m) return m[1]
    const parent: number = Number(tryExec(exec, 'ps', ['-o', 'ppid=', '-p', String(current)]))
    current = Number.isInteger(parent) && parent > 1 ? parent : null
  }
  return null
}

export function effectiveTargets(pid: number, cwd: string | null, keys: string[], exec: Exec = defaultExec): Record<string, { value: string; source: string }> {
  const env = processEnvKeys(pid, keys, exec)
  const envFile = envFileArg(pid, exec)
  const fromArg = envFile ? dotenvFile(envFile, keys) : {}
  const file = cwd ? dotenvKeys(cwd, keys) : {}
  const out: Record<string, { value: string; source: string }> = {}
  for (const key of keys) {
    if (env[key] !== undefined) out[key] = { value: env[key], source: 'process environment' }
    else if (fromArg[key] !== undefined) out[key] = { value: fromArg[key], source: `--env-file ${envFile}` }
    else if (file[key] !== undefined) out[key] = { value: file[key], source: `${cwd}/.env` }
  }
  return out
}

export function gitState(dir: string, exec: Exec = defaultExec) {
  const top = tryExec(exec, 'git', ['-C', dir, 'rev-parse', '--show-toplevel'])
  if (!top) return null
  const commit = tryExec(exec, 'git', ['-C', top, 'rev-parse', 'HEAD'])
  const branch = tryExec(exec, 'git', ['-C', top, 'branch', '--show-current'])
  // Scoped to the component's own directory: unrelated edits elsewhere in the checkout do not change what it runs.
  const dirty = (tryExec(exec, 'git', ['-C', top, 'status', '--porcelain', '--untracked-files=no', '--', dir]) ?? '').length > 0
  // The reflog records when HEAD last moved (commit, checkout, reset), which is what a running process may predate.
  const moved = tryExec(exec, 'git', ['-C', top, 'reflog', '-1', '--date=iso-strict', '--format=%gd'])
  const headMovedAt = moved?.match(/\{(.+)\}/)?.[1] ?? tryExec(exec, 'git', ['-C', top, 'log', '-1', '--format=%cI'])
  return { top, commit: commit ?? undefined, branch: branch || undefined, dirty, headMovedAt: headMovedAt ?? undefined }
}

export function processStart(pid: number, exec: Exec = defaultExec): string | null {
  const out = tryExec(exec, 'ps', ['-o', 'lstart=', '-p', String(pid)])
  const date = out ? new Date(out) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/**
 * Revision HEAD pointed to when the process started (from the reflog), and whether the component directory's
 * tree there equals HEAD's. Lets a later unrelated commit keep a running component verified.
 */
export function startRevision(top: string, dir: string, processStartedAt: string, exec: Exec = defaultExec): { rev: string; sameTree: boolean } | null {
  const log = tryExec(exec, 'git', ['-C', top, 'reflog', '--date=iso-strict', '--format=%H %gd', '-n', '200'])
  if (!log) return null
  const start = new Date(processStartedAt).getTime()
  for (const line of log.split('\n')) {
    const m = /^([0-9a-f]{40}) .*\{(.+)\}$/.exec(line.trim())
    if (!m || new Date(m[2]).getTime() > start) continue
    const rel = tryExec(exec, 'git', ['-C', dir, 'rev-parse', '--show-prefix']) ?? ''
    const path = rel.replace(/\/$/, '')
    const at = tryExec(exec, 'git', ['-C', top, 'rev-parse', `${m[1]}:${path}`])
    const head = tryExec(exec, 'git', ['-C', top, 'rev-parse', `HEAD:${path}`])
    return { rev: m[1], sameTree: Boolean(at && head && at === head) }
  }
  return null
}

export function judge(p: Pick<ComponentProvenance, 'commit' | 'dirty' | 'processStartedAt' | 'headMovedAt'> & { start?: { rev: string; sameTree: boolean } | null }): { status: ComponentProvenance['status']; basis: string } {
  if (!p.commit) return { status: 'unknown', basis: 'process found but its directory is not a Git checkout' }
  if (p.dirty) return { status: 'unverified', basis: 'its source directory has uncommitted changes; the running code is not a single commit' }
  if (!p.processStartedAt || !p.headMovedAt) return { status: 'unverified', basis: 'could not compare process start with the last HEAD movement' }
  if (new Date(p.processStartedAt).getTime() < new Date(p.headMovedAt).getTime()) {
    if (p.start?.sameTree) return { status: 'verified', basis: `HEAD moved after the process started, but its source directory is identical at the start revision ${p.start.rev.slice(0, 7)} and at HEAD` }
    return { status: 'unverified', basis: `HEAD moved after the process started${p.start ? ` (it started at ${p.start.rev.slice(0, 7)}, whose source directory differs)` : ''}; it may be running an older revision` }
  }
  return { status: 'verified', basis: 'its source directory is clean at HEAD and the process started after HEAD last moved (shared code outside that directory is not checked)' }
}

function isLocal(url: string): boolean {
  const host = new URL(url).hostname
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)
}

function portOf(url: string): number {
  const u = new URL(url)
  return Number(u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80))
}

function inspectProcess(component: ComponentProvenance['component'], pid: number, endpoint: string | undefined, keys: string[], exec: Exec): ComponentProvenance {
  const cwd = processCwd(pid, exec)
  const git = cwd ? gitState(cwd, exec) : null
  const processStartedAt = processStart(pid, exec) ?? undefined
  const base = { component, endpoint, pid, sourceDir: cwd ?? undefined, branch: git?.branch, commit: git?.commit, dirty: git?.dirty,
    processStartedAt, headMovedAt: git?.headMovedAt, targets: keys.length ? effectiveTargets(pid, cwd, keys, exec) : undefined }
  const start = git?.top && cwd && processStartedAt ? startRevision(git.top, cwd, processStartedAt, exec) : null
  return { ...base, ...judge({ ...base, start }) }
}

/** Agent workers have no fixed port: find `main.py` workers whose effective LIVEKIT_URL is the target LiveKit. */
export function findAgents(livekitUrl: string, exec: Exec = defaultExec): ComponentProvenance[] {
  const list = tryExec(exec, 'ps', ['-axo', 'pid=,command=']) ?? ''
  const found: ComponentProvenance[] = []
  for (const line of list.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m || !/python/i.test(m[2]) || !/\bmain\.py\s+(dev|start|console)\b/.test(m[2])) continue
    const pid = Number(m[1])
    const record = inspectProcess('agent', pid, undefined, ['LIVEKIT_URL', 'SERVER_URL'], exec)
    if (sameUrl(record.targets?.LIVEKIT_URL?.value, livekitUrl)) found.push(record)
  }
  return found
}

export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  try {
    const x = new URL(a), y = new URL(b)
    const norm = (h: string) => (h === '127.0.0.1' || h === '::1' || h === '[::1]' ? 'localhost' : h)
    const proto = (p: string) => p.replace('wss:', 'https:').replace('ws:', 'http:')
    return proto(x.protocol) === proto(y.protocol) && norm(x.hostname) === norm(y.hostname) && portOf(a) === portOf(b)
  } catch { return false }
}

/** Best-effort, read-only inspection of the local processes behind the target. Remote targets are `unknown`. */
export function inspectStack(opts: { targetUrl: string; apiUrl?: string; livekitUrl?: string; declaredSource?: string }, exec: Exec = defaultExec): ComponentProvenance[] {
  const out: ComponentProvenance[] = []
  const add = (component: ComponentProvenance['component'], endpoint: string | undefined, keys: string[]) => {
    if (!endpoint) { out.push({ component, status: 'unknown', basis: 'endpoint not configured for this run' }); return }
    if (!isLocal(endpoint)) { out.push({ component, endpoint, status: 'unknown', basis: 'remote endpoint; running revision cannot be inspected', ...(opts.declaredSource ? { sourceDir: opts.declaredSource } : {}) }); return }
    const pid = listeningPid(portOf(endpoint), exec)
    if (!pid) { out.push({ component, endpoint, status: 'unknown', basis: 'no local process is listening on this port (or it is inside a container)' }); return }
    out.push(inspectProcess(component, pid, endpoint, keys, exec))
  }
  add('web', opts.targetUrl, ['VITE_API_BASE_URL'])
  add('api', opts.apiUrl, ['LIVEKIT_URL', 'SERVER_URL', 'PORT'])
  if (opts.livekitUrl && isLocal(opts.livekitUrl)) {
    const agents = findAgents(opts.livekitUrl, exec)
    if (agents.length) out.push(...agents)
    else out.push({ component: 'agent', status: 'unknown', basis: `no local agent worker process targets ${opts.livekitUrl}` })
  } else out.push({ component: 'agent', status: 'unknown', basis: opts.livekitUrl ? 'remote LiveKit; agent not inspectable' : 'LiveKit URL not configured for this run' })
  return out
}

/** Short label for tables; never substitutes the tool revision. */
export function provenanceLabel(p: ComponentProvenance): string {
  const rev = p.commit ? `${p.commit.slice(0, 7)}${p.branch ? ` (${p.branch})` : ''}${p.dirty ? ' + uncommitted changes' : ''}` : 'revision unknown'
  return `${p.status}: ${rev}${p.sourceDir ? ` — ${p.sourceDir}` : ''}`
}
