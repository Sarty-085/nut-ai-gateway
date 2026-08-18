import { describe, expect, it } from 'vitest'
import { GatewayRateLimiter } from '../rate-limiter.js'
import type { RateLimitConfig } from '../types.js'

describe('GatewayRateLimiter', () => {
  const config: RateLimitConfig = {
    perTokenPerMinute: 3,
    perTokenDaily: 5,
    globalPerMinute: 10,
    dailyCostCapUsd: 1.0,
  }

  it('allows requests within per-token per-minute rate limit', () => {
    const limiter = new GatewayRateLimiter(config)
    const now = Date.now()

    expect(limiter.checkAndRecord('token-1', now).ok).toBe(true)
    expect(limiter.checkAndRecord('token-1', now + 100).ok).toBe(true)
    expect(limiter.checkAndRecord('token-1', now + 200).ok).toBe(true)

    // 4th request in same minute should be rate limited
    const res = limiter.checkAndRecord('token-1', now + 300)
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Per-minute request limit')

    // Different token should still be allowed
    expect(limiter.checkAndRecord('token-2', now + 400).ok).toBe(true)
  })

  it('resets per-minute bucket after 60 seconds', () => {
    const limiter = new GatewayRateLimiter(config)
    const now = Date.now()

    limiter.checkAndRecord('token-1', now)
    limiter.checkAndRecord('token-1', now)
    limiter.checkAndRecord('token-1', now)
    expect(limiter.checkAndRecord('token-1', now).ok).toBe(false)

    // 61 seconds later
    expect(limiter.checkAndRecord('token-1', now + 61_000).ok).toBe(true)
  })

  it('enforces daily token request limits', () => {
    const limiter = new GatewayRateLimiter(config)
    const now = Date.now()

    // 5 requests spread out across 5 minutes
    for (let i = 0; i < 5; i++) {
      expect(limiter.checkAndRecord('token-1', now + i * 65_000).ok).toBe(true)
    }

    // 6th request within 24h should fail daily limit
    const res = limiter.checkAndRecord('token-1', now + 6 * 65_000)
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('Daily request quota')
  })

  it('enforces daily cost ceiling', () => {
    const limiter = new GatewayRateLimiter(config)
    const now = Date.now()

    expect(limiter.checkAndRecord('token-1', now).ok).toBe(true)
    limiter.recordCost(0.60)
    expect(limiter.checkAndRecord('token-1', now + 1000).ok).toBe(true)
    limiter.recordCost(0.50) // Total now $1.10 > cap $1.00

    const res = limiter.checkAndRecord('token-1', now + 2000)
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('daily budget cap')
  })
})
