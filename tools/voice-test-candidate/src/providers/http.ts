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

function abandoned(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

/**
 * Performs a provider request and reads its body. Cancellation by the caller (`signal`) stops waiting but does
 * not abort the socket: aborting an in-flight fetch can crash Node's fetch implementation, and the request is
 * bounded by its own timeout anyway.
 */
export async function providerRequest<T>(budget: Budget, url: string, init: RequestInit, read: (res: Response) => Promise<T>,
  opts: { timeoutMs: number; retries?: number; signal?: AbortSignal }): Promise<T> {
  const attempt = async (): Promise<T> => {
    const retries = opts.retries ?? 1
    let lastError: unknown
    for (let i = 0; i <= retries; i++) {
      if (opts.signal?.aborted) throw opts.signal.reason
      budget.take()
      try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) })
        if (res.ok) return await read(res)
        const body = (await res.text().catch(() => '')).slice(0, 300)
        lastError = new Error(`${budget.name} HTTP ${res.status}: ${body}`)
        if (!TRANSIENT.has(res.status)) break
      } catch (error) {
        lastError = error
        // A timed-out request may still have been processed (and billed); never repeat it silently.
        if (error instanceof Error && error.name === 'TimeoutError') break
      }
      if (i < retries) await new Promise(r => setTimeout(r, 750 * (i + 1)))
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
  const work = attempt()
  if (!opts.signal) return work
  work.catch(() => undefined)
  return Promise.race([work, abandoned(opts.signal)])
}
