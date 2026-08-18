import type { GatewayError } from './errors.js'
import type {
  ProviderResource,
  ProviderResourceConfig,
  ResourceHealthState,
  ResourceTelemetry,
} from './types.js'

interface InternalResourceState {
  config: ProviderResourceConfig
  resolvedSecret: string
  healthState: ResourceHealthState
  cooldownUntil: number | null
  consecutiveFailures: number
  totalRequests: number
  totalSuccesses: number
  totalFailures: number
  totalFailovers: number
  latencySamples: number[]
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastErrorReason: string | null
}

export class ResourceHealthTracker {
  private resources = new Map<string, InternalResourceState>()
  private defaultCooldownMs = 30_000
  private maxConsecutiveFailures = 3

  constructor(resourceConfigs: ProviderResourceConfig[], env: Record<string, string | undefined> = process.env) {
    this.initResources(resourceConfigs, env)
  }

  public initResources(
    resourceConfigs: ProviderResourceConfig[],
    env: Record<string, string | undefined> = process.env,
  ): void {
    this.resources.clear()
    for (const config of resourceConfigs) {
      let resolvedSecret = config.secretValue ?? ''
      if (!resolvedSecret && config.secretEnv) {
        resolvedSecret = env[config.secretEnv] ?? ''
      }

      this.resources.set(config.id, {
        config,
        resolvedSecret,
        healthState: config.enabled ? 'healthy' : 'disabled',
        cooldownUntil: null,
        consecutiveFailures: 0,
        totalRequests: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        totalFailovers: 0,
        latencySamples: [],
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorReason: null,
      })
    }
  }

  public getResource(id: string): ProviderResource | null {
    const r = this.resources.get(id)
    if (!r) return null
    return {
      ...r.config,
      resolvedSecret: r.resolvedSecret,
    }
  }

  public getAllResources(): ProviderResource[] {
    return Array.from(this.resources.values()).map((r) => ({
      ...r.config,
      resolvedSecret: r.resolvedSecret,
    }))
  }

  /**
   * Check if a resource is eligible to handle requests.
   * Auto-recovers cooldown resources whose cooldown window has expired.
   */
  public isResourceEligible(id: string, now = Date.now()): boolean {
    const r = this.resources.get(id)
    if (!r || !r.config.enabled) return false

    if (r.healthState === 'disabled' || r.healthState === 'auth_error') {
      return false
    }

    if (r.healthState === 'cooldown') {
      if (r.cooldownUntil !== null && now >= r.cooldownUntil) {
        // Cooldown has expired -> auto-recover to healthy!
        r.healthState = 'healthy'
        r.cooldownUntil = null
        r.consecutiveFailures = 0
        return true
      }
      return false
    }

    return true
  }

  /**
   * Record a successful request.
   */
  public recordSuccess(id: string, latencyMs: number, _now = Date.now()): void {
    const r = this.resources.get(id)
    if (!r) return

    r.totalRequests += 1
    r.totalSuccesses += 1
    r.consecutiveFailures = 0
    r.lastSuccessAt = _now
    r.lastErrorReason = null

    // Recover health if degraded or cooldown
    if (r.healthState === 'degraded' || r.healthState === 'cooldown') {
      r.healthState = 'healthy'
      r.cooldownUntil = null
    }

    // Update latency rolling window (last 20 requests)
    r.latencySamples.push(latencyMs)
    if (r.latencySamples.length > 20) {
      r.latencySamples.shift()
    }
  }

  /**
   * Record a failure with precise error-driven state transitions.
   */
  public recordFailure(
    id: string,
    error: GatewayError,
    latencyMs: number,
    now = Date.now(),
  ): void {
    const r = this.resources.get(id)
    if (!r) return

    r.totalRequests += 1
    r.totalFailures += 1
    r.consecutiveFailures += 1
    r.lastFailureAt = now
    r.lastErrorReason = `[${error.code}] ${error.message}`

    r.latencySamples.push(latencyMs)
    if (r.latencySamples.length > 20) {
      r.latencySamples.shift()
    }

    // 1. Auth/Config errors -> permanent auth_error until admin intervenes
    if (error.code === 'AUTH_FAILED' || error.code === 'CONFIG_ERROR') {
      r.healthState = 'auth_error'
      return
    }

    // 2. Rate limit / Quota -> place into cooldown
    if (error.code === 'RATE_LIMITED' || error.code === 'QUOTA_EXHAUSTED') {
      r.healthState = 'cooldown'
      const durationMs =
        (error as any).retryAfterSeconds != null
          ? (error as any).retryAfterSeconds * 1000
          : r.config.cooldownDurationMs ?? this.defaultCooldownMs
      r.cooldownUntil = now + durationMs
      return
    }

    // 3. Transient / Outage errors -> degraded or cooldown if repeated
    const maxFailures = r.config.maxConsecutiveFailures ?? this.maxConsecutiveFailures
    if (r.consecutiveFailures >= maxFailures) {
      r.healthState = 'cooldown'
      r.cooldownUntil = now + (r.config.cooldownDurationMs ?? this.defaultCooldownMs)
    } else {
      r.healthState = 'degraded'
    }
  }

  /**
   * Record a failover occurrence when moving from one resource to another.
   */
  public recordFailover(id: string): void {
    const r = this.resources.get(id)
    if (r) {
      r.totalFailovers += 1
    }
  }

  /**
   * Toggle enabled status of a resource.
   */
  public setResourceEnabled(id: string, enabled: boolean): boolean {
    const r = this.resources.get(id)
    if (!r) return false
    r.config.enabled = enabled
    if (!enabled) {
      r.healthState = 'disabled'
    } else if (r.healthState === 'disabled') {
      r.healthState = 'healthy'
      r.consecutiveFailures = 0
      r.cooldownUntil = null
    }
    return true
  }

  /**
   * Force-reset a resource health state (e.g. from admin panel).
   */
  public resetResourceHealth(id: string): boolean {
    const r = this.resources.get(id)
    if (!r) return false
    r.healthState = r.config.enabled ? 'healthy' : 'disabled'
    r.consecutiveFailures = 0
    r.cooldownUntil = null
    r.lastErrorReason = null
    return true
  }

  /**
   * Safe operational telemetry (zero secrets).
   */
  public getTelemetry(now = Date.now()): ResourceTelemetry[] {
    const list: ResourceTelemetry[] = []

    for (const r of this.resources.values()) {
      // Auto-check cooldown expiry for clean display
      if (r.healthState === 'cooldown' && r.cooldownUntil !== null && now >= r.cooldownUntil) {
        r.healthState = 'healthy'
        r.cooldownUntil = null
        r.consecutiveFailures = 0
      }

      const avgLatencyMs =
        r.latencySamples.length > 0
          ? Math.round(r.latencySamples.reduce((a, b) => a + b, 0) / r.latencySamples.length)
          : 0

      list.push({
        id: r.config.id,
        provider: r.config.provider,
        enabled: r.config.enabled,
        priority: r.config.priority,
        capabilities: [...r.config.capabilities],
        healthState: r.healthState,
        cooldownUntil: r.cooldownUntil,
        consecutiveFailures: r.consecutiveFailures,
        totalRequests: r.totalRequests,
        totalSuccesses: r.totalSuccesses,
        totalFailures: r.totalFailures,
        totalFailovers: r.totalFailovers,
        avgLatencyMs,
        lastSuccessAt: r.lastSuccessAt,
        lastFailureAt: r.lastFailureAt,
        lastErrorReason: r.lastErrorReason,
      })
    }

    return list
  }
}
