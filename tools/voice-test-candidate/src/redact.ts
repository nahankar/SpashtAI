/**
 * Removes credentials from anything written to logs or evidence. Applied to every timeline entry, error,
 * report and (post-run) to the Playwright trace archive.
 */
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
const QUERY_SECRET = /([?&](?:access_token|token|key|api_key|apikey|signature|sig|code|password|secret)=)[^&#\s"']+/gi
const JSON_SECRET = /("(?:token|accessToken|refreshToken|access_token|password|secret|apiKey|api_key|authorization|cookie|set-cookie|spashtai_token)"\s*:\s*")[^"]*(")/gi
const HEADER_SECRET = /((?:authorization|cookie|set-cookie|x-internal-agent-token|x-api-key)\s*[:=]\s*)[^\n\r"]+/gi
const AWS_KEY = /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g

export function redact(text: string, extraSecrets: string[] = []): string {
  let out = text
    .replace(JWT, '[REDACTED_JWT]')
    .replace(BEARER, '$1[REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .replace(JSON_SECRET, '$1[REDACTED]$2')
    .replace(HEADER_SECRET, '$1[REDACTED]')
    .replace(AWS_KEY, '[REDACTED_AWS_KEY]')
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[REDACTED]')
  }
  return out
}

export function redactValue<T>(value: T, extraSecrets: string[] = []): T {
  return JSON.parse(redact(JSON.stringify(value ?? null), extraSecrets)) as T
}

/** Keeps origin and path for evidence; drops query strings and fragments that may carry tickets. */
export function safeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}${url.search ? '?[query]' : ''}`
  } catch {
    return redact(raw)
  }
}
