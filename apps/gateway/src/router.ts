import { randomUUID } from 'node:crypto'
import type { ProviderId } from '@nutai/prompt'
import { AnthropicAdapter } from './adapters/anthropic.js'
import type { AdapterExecutionResult, ProviderAdapter } from './adapters/base.js'
import { GoogleAdapter } from './adapters/google.js'
import { OpenAIAdapter } from './adapters/openai.js'
import {
  GatewayError,
  NoEligibleResourceError,
} from './errors.js'
import type { ResourceHealthTracker } from './health-tracker.js'
import type { GatewayRateLimiter } from './rate-limiter.js'
import type {
  AnalyzeGatewayRequest,
  ExerciseEstimateGatewayRequest,
  GatewayConfig,
  GatewayResponse,
  GatewayTask,
  LabelScanGatewayRequest,
  NormalizedResponseMeta,
  ProviderResource,
  ReceiptScanGatewayRequest,
  WebLookupGatewayRequest,
} from './types.js'

export class ProviderRouter {
  private adapters: Map<ProviderId, ProviderAdapter> = new Map()

  constructor(
    private config: GatewayConfig,
    private healthTracker: ResourceHealthTracker,
    private rateLimiter?: GatewayRateLimiter,
  ) {
    this.registerAdapter(new GoogleAdapter())
    this.registerAdapter(new AnthropicAdapter())
    this.registerAdapter(new OpenAIAdapter())
  }

  public registerAdapter(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter)
  }

  public updateConfig(config: GatewayConfig): void {
    this.config = config
  }

  /**
   * Select eligible, healthy candidates for a task according to priority and provider order.
   */
  public selectCandidateResources(
    task: GatewayTask,
    preferredProvider?: ProviderId,
    now = Date.now(),
  ): ProviderResource[] {
    const all = this.healthTracker.getAllResources()

    // 1. Filter by capability
    const capable = all.filter((r) => r.capabilities.includes(task))

    // 2. Filter by health eligibility (auto-recovers expired cooldowns)
    const eligible = capable.filter((r) => this.healthTracker.isResourceEligible(r.id, now))

    if (eligible.length === 0) {
      return []
    }

    // 3. Sort by provider order and resource priority
    const providerOrder = this.config.providerOrder
    return eligible.sort((a, b) => {
      // If a specific provider was preferred, sort it first
      if (preferredProvider) {
        if (a.provider === preferredProvider && b.provider !== preferredProvider) return -1
        if (b.provider === preferredProvider && a.provider !== preferredProvider) return 1
      }

      // Check configured provider order
      const aIdx = providerOrder.indexOf(a.provider)
      const bIdx = providerOrder.indexOf(b.provider)
      const orderA = aIdx === -1 ? 999 : aIdx
      const orderB = bIdx === -1 ? 999 : bIdx

      if (orderA !== orderB) {
        return orderA - orderB
      }

      // Within same provider, sort by resource priority
      return a.priority - b.priority
    })
  }

  /**
   * Execute task with resilient routing, bounded retry, failover, and telemetry recording.
   */
  public async executeTask<TReq, TRes>(
    task: GatewayTask,
    req: TReq & { requestId?: string; timeoutMs?: number; preferredProvider?: ProviderId; preferredModel?: string },
    runner: (adapter: ProviderAdapter, resource: ProviderResource, model: string, req: TReq, fetchImpl?: typeof fetch) => Promise<AdapterExecutionResult<TRes>>,
    fetchImpl: typeof fetch = fetch,
  ): Promise<GatewayResponse<TRes>> {
    const requestId = req.requestId ?? `req_${Date.now()}_${randomUUID().slice(0, 8)}`
    const candidates = this.selectCandidateResources(task, req.preferredProvider)

    if (candidates.length === 0) {
      const err = new NoEligibleResourceError(task)
      return {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          retryable: err.retryable,
          httpStatus: err.httpStatus,
        },
      }
    }

    let failoverCount = 0
    let lastError: GatewayError | null = null

    for (let i = 0; i < candidates.length; i++) {
      const resource = candidates[i]!
      const adapter = this.adapters.get(resource.provider)
      if (!adapter) {
        continue
      }

      const model =
        req.preferredModel ??
        resource.models?.[task] ??
        resource.models?.default ??
        this.config.defaultModels[resource.provider]![task]

      // Bounded retry loop for transient network / server errors
      const maxRetries = this.config.maxTransientRetries
      let attempt = 0
      let success = false
      let executionResult: AdapterExecutionResult<TRes> | null = null

      while (attempt <= maxRetries && !success) {
        const startTime = Date.now()
        try {
          executionResult = await runner(adapter, resource, model, req, fetchImpl)
          const latencyMs = Date.now() - startTime
          this.healthTracker.recordSuccess(resource.id, latencyMs)
          if (this.rateLimiter && executionResult.meta.costUsd) {
            this.rateLimiter.recordCost(executionResult.meta.costUsd)
          }
          success = true

          const fullMeta: NormalizedResponseMeta = {
            ...executionResult.meta,
            resourceId: resource.id,
            requestId,
            latencyMs,
            failoverCount,
          }

          return {
            ok: true,
            data: executionResult.data,
            meta: fullMeta,
          }
        } catch (err: any) {
          const latencyMs = Date.now() - startTime
          const gatewayErr =
            err instanceof GatewayError ? err : new GatewayError('PROVIDER_OUTAGE', String(err.message ?? err), true, 500, err)

          lastError = gatewayErr

          // User / content errors: DO NOT retry or failover!
          if (gatewayErr.code === 'INVALID_REQUEST' || gatewayErr.code === 'CONTENT_REFUSAL') {
            return {
              ok: false,
              error: {
                code: gatewayErr.code,
                message: gatewayErr.message,
                retryable: false,
                httpStatus: gatewayErr.httpStatus,
              },
            }
          }

          // Rate limit / Quota / Auth errors: do not retry the SAME resource; record failure and failover immediately
          if (
            gatewayErr.code === 'AUTH_FAILED' ||
            gatewayErr.code === 'RATE_LIMITED' ||
            gatewayErr.code === 'QUOTA_EXHAUSTED' ||
            gatewayErr.code === 'MODEL_UNAVAILABLE'
          ) {
            this.healthTracker.recordFailure(resource.id, gatewayErr, latencyMs)
            break // exit retry loop and failover to next candidate
          }

          // Transient error: retry with exponential backoff if attempts remain
          if (gatewayErr.retryable && attempt < maxRetries) {
            attempt++
            const delay = this.config.retryBackoffBaseMs * Math.pow(2, attempt - 1)
            await new Promise((res) => setTimeout(res, delay))
            continue
          } else {
            this.healthTracker.recordFailure(resource.id, gatewayErr, latencyMs)
            break
          }
        }
      }

      // If we got here, this candidate failed; mark failover for next candidate
      this.healthTracker.recordFailover(resource.id)
      failoverCount++
    }

    const finalErr = lastError ?? new NoEligibleResourceError(task)
    return {
      ok: false,
      error: {
        code: finalErr.code,
        message: finalErr.message,
        retryable: finalErr.retryable,
        httpStatus: finalErr.httpStatus,
      },
    }
  }

  public async analyze(
    req: AnalyzeGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<GatewayResponse<unknown>> {
    return this.executeTask('food-analysis', req, (adapter, resource, model, r, f) =>
      adapter.analyze(resource, model, r, f),
      fetchImpl,
    )
  }

  public async labelScan(
    req: LabelScanGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<GatewayResponse<unknown>> {
    return this.executeTask('label-scan', req, (adapter, resource, model, r, f) =>
      adapter.labelScan(resource, model, r, f),
      fetchImpl,
    )
  }

  public async receiptScan(
    req: ReceiptScanGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<GatewayResponse<unknown>> {
    return this.executeTask('receipt-scan', req, (adapter, resource, model, r, f) =>
      adapter.receiptScan(resource, model, r, f),
      fetchImpl,
    )
  }

  public async webLookup(
    req: WebLookupGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<GatewayResponse<unknown>> {
    return this.executeTask('web-lookup', req, (adapter, resource, model, r, f) =>
      adapter.webLookup(resource, model, r, f),
      fetchImpl,
    )
  }

  public async exerciseEstimate(
    req: ExerciseEstimateGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<GatewayResponse<unknown>> {
    return this.executeTask('exercise-estimate', req, (adapter, resource, model, r, f) =>
      adapter.exerciseEstimate(resource, model, r, f),
      fetchImpl,
    )
  }
}
