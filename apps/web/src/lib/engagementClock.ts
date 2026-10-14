/** Counts foreground time and stops 60 seconds after the last pointer or key activity. */
export const IDLE_AFTER_MS = 60_000

export class EngagementClock {
  private accumulated = 0
  private openAt: number | null
  private hidden = false
  private lastActivity: number
  private now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
    const start = this.now()
    this.openAt = start
    this.lastActivity = start
  }

  private close(at: number) {
    if (this.openAt == null || this.hidden) {
      this.openAt = null
      return
    }
    const countableEnd = Math.min(at, this.lastActivity + IDLE_AFTER_MS)
    if (countableEnd > this.openAt) this.accumulated += countableEnd - this.openAt
    this.openAt = null
  }

  setHidden(hidden: boolean, at = this.now()) {
    if (hidden === this.hidden) return
    if (hidden) this.close(at)
    this.hidden = hidden
    if (!hidden) {
      this.openAt = at
      this.lastActivity = at
    }
  }

  markActivity(at = this.now()) {
    this.lastActivity = at
    if (this.hidden) return
    if (this.openAt == null) this.openAt = at
  }

  flush(at = this.now()) {
    this.markActivityGap(at)
    this.close(at)
    const elapsed = Math.max(0, Math.round(this.accumulated))
    this.accumulated = 0
    if (!this.hidden) {
      this.openAt = at
      this.lastActivity = at
    }
    return elapsed
  }

  private markActivityGap(at: number) {
    if (this.hidden || this.openAt == null) return
    if (at - this.lastActivity < IDLE_AFTER_MS) return
    this.close(at)
  }
}
