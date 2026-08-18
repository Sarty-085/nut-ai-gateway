import type { RateLimitConfig } from './types.js'

interface TokenUsage {
  minuteTimestamps: number[]
  dailyCount: number
  dailyResetAt: number
}

export class GatewayRateLimiter {
  private tokenUsage = new Map<string, TokenUsage>()
  private globalMinuteTimestamps: number[] = []
  private dailyTotalCostUsd = 0
  private dailyCostResetAt = Date.now() + 86_400_000

  constructor(private config: RateLimitConfig) {}

  public updateConfig(config: RateLimitConfig): void {
    this.config = config
  }

  /**
   * Check whether a request is within limits and record it if allowed.
   */
  public checkAndRecord(
    tokenId: string,
    now = Date.now(),
  ): { ok: boolean; reason?: string; retryAfterSeconds?: number } {
    // 1. Check daily global budget ceiling
    if (this.config.dailyCostCapUsd !== undefined) {
      if (now > this.dailyCostResetAt) {
        this.dailyTotalCostUsd = 0
        this.dailyCostResetAt = now + 86_400_000
      }
      if (this.dailyTotalCostUsd >= this.config.dailyCostCapUsd) {
        return { ok: false, reason: 'Gateway daily budget cap reached.' }
      }
    }

    // 2. Check global rate limit (requests per minute)
    const oneMinAgo = now - 60_000
    this.globalMinuteTimestamps = this.globalMinuteTimestamps.filter((t) => t > oneMinAgo)
    if (this.globalMinuteTimestamps.length >= this.config.globalPerMinute) {
      const oldest = this.globalMinuteTimestamps[0] ?? now
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000))
      return { ok: false, reason: 'Global gateway rate limit exceeded.', retryAfterSeconds }
    }

    // 3. Check per-token rate limit
    let usage = this.tokenUsage.get(tokenId)
    if (!usage) {
      usage = {
        minuteTimestamps: [],
        dailyCount: 0,
        dailyResetAt: now + 86_400_000,
      }
      this.tokenUsage.set(tokenId, usage)
    }

    // Daily reset check
    if (now > usage.dailyResetAt) {
      usage.dailyCount = 0
      usage.dailyResetAt = now + 86_400_000
    }

    // Daily limit check
    if (usage.dailyCount >= this.config.perTokenDaily) {
      const retryAfterSeconds = Math.max(1, Math.ceil((usage.dailyResetAt - now) / 1000))
      return { ok: false, reason: 'Daily request quota exceeded for this token.', retryAfterSeconds }
    }

    // Minute limit check
    usage.minuteTimestamps = usage.minuteTimestamps.filter((t) => t > oneMinAgo)
    if (usage.minuteTimestamps.length >= this.config.perTokenPerMinute) {
      const oldest = usage.minuteTimestamps[0] ?? now
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000))
      return { ok: false, reason: 'Per-minute request limit exceeded for this token.', retryAfterSeconds }
    }

    // Record request
    this.globalMinuteTimestamps.push(now)
    usage.minuteTimestamps.push(now)
    usage.dailyCount += 1

    return { ok: true }
  }

  /**
   * Record estimated cost in USD to track daily usage ceiling.
   */
  public recordCost(costUsd: number): void {
    this.dailyTotalCostUsd += costUsd
  }

  /**
   * Get current metrics for admin status.
   */
  public getStatus(now = Date.now()): {
    activeTokens: number
    globalRequestsLastMinute: number
    dailyTotalCostUsd: number
    dailyCostCapUsd?: number | undefined
  } {
    const oneMinAgo = now - 60_000
    const globalRequestsLastMinute = this.globalMinuteTimestamps.filter((t) => t > oneMinAgo).length

    return {
      activeTokens: this.tokenUsage.size,
      globalRequestsLastMinute,
      dailyTotalCostUsd: this.dailyTotalCostUsd,
      dailyCostCapUsd: this.config.dailyCostCapUsd,
    }
  }

  public reset(): void {
    this.tokenUsage.clear()
    this.globalMinuteTimestamps = []
    this.dailyTotalCostUsd = 0
    this.dailyCostResetAt = Date.now() + 86_400_000
  }
}
