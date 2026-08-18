import { createHash } from 'node:crypto'

interface InFlightEntry<T> {
  promise: Promise<T>
  timestamp: number
}

interface CachedResult<T> {
  result: T
  cachedAt: number
}

export class RequestDeduplicator {
  private inFlight = new Map<string, InFlightEntry<any>>()
  private cache = new Map<string, CachedResult<any>>()

  constructor(private windowMs = 10_000) {}

  /**
   * Compute a hash key for a request payload + task if no explicit idempotency key is provided.
   */
  public generateKey(task: string, payload: unknown, explicitKey?: string): string {
    if (explicitKey && explicitKey.trim().length > 0) {
      return `idemp:${task}:${explicitKey.trim()}`
    }
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const hash = createHash('sha256').update(serialized).digest('hex').slice(0, 32)
    return `hash:${task}:${hash}`
  }

  /**
   * Execute an operation or return in-flight/cached result to avoid duplicate upstream provider calls.
   */
  public async executeOrShare<T>(key: string, operation: () => Promise<T>, now = Date.now()): Promise<T> {
    this.prune(now)

    // 1. Check if we already have a recent completed result within window
    const cached = this.cache.get(key)
    if (cached && now - cached.cachedAt < this.windowMs) {
      return cached.result as T
    }

    // 2. Check if identical request is currently in-flight
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing.promise as Promise<T>
    }

    // 3. Launch operation and track
    const promise = (async () => {
      try {
        const result = await operation()
        this.cache.set(key, { result, cachedAt: Date.now() })
        return result
      } finally {
        this.inFlight.delete(key)
      }
    })()

    this.inFlight.set(key, { promise, timestamp: now })
    return promise
  }

  private prune(now: number): void {
    for (const [k, v] of this.cache.entries()) {
      if (now - v.cachedAt > this.windowMs) {
        this.cache.delete(k)
      }
    }
    for (const [k, v] of this.inFlight.entries()) {
      // In-flight safety timeout (e.g. 60s)
      if (now - v.timestamp > 60_000) {
        this.inFlight.delete(k)
      }
    }
  }

  public clear(): void {
    this.inFlight.clear()
    this.cache.clear()
  }
}
