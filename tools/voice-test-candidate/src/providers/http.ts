/** Request budget + timeout + single careful retry for transient provider failures. */
export class ProviderBudgetExceeded extends Error {}

export class Budget {
  private used = 0
  constructor(readonly name: string, readonly max: number) {}
  take(): void {
    if (this.used >= this.max) throw new ProviderBudgetExceeded(`${this.name} request limit (${this.max}) reached`)
    this.used++
  }
  get count(): number { return this.used }
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504])

export async function providerFetch(budget: Budget, url: string, init: RequestInit, opts: { timeoutMs: number; retries?: number; signal?: AbortSignal }): Promise<Response> {
  const retries = opts.retries ?? 1
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    budget.take()
    const timeout = AbortSignal.timeout(opts.timeoutMs)
    const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout
    try {
      const res = await fetch(url, { ...init, signal })
      if (res.ok) return res
      const body = (await res.text().catch(() => '')).slice(0, 300)
      lastError = new Error(`${budget.name} HTTP ${res.status}: ${body}`)
      if (!TRANSIENT.has(res.status)) break
    } catch (error) {
      if (opts.signal?.aborted) throw error
      lastError = error
      // A timed-out request may still have been processed (and billed); never repeat it silently.
      if (error instanceof Error && error.name === 'TimeoutError') break
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 750 * (attempt + 1)))
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
