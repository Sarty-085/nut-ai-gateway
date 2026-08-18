import { describe, expect, it, vi } from 'vitest'
import type { AdapterExecutionResult, ProviderAdapter } from '../adapters/base.js'
import { loadGatewayConfig } from '../config.js'
import {
  GatewayError,
  InvalidRequestError,
  QuotaExhaustedError,
  RateLimitError,
} from '../errors.js'
import { ResourceHealthTracker } from '../health-tracker.js'
import { ProviderRouter } from '../router.js'
import type { GatewayConfig, ProviderResource, ProviderResourceConfig } from '../types.js'

describe('ProviderRouter', () => {
  const baseResources: ProviderResourceConfig[] = [
    {
      id: 'google-01',
      provider: 'google',
      secretValue: 'mock-google-key-1',
      enabled: true,
      priority: 1,
      capabilities: ['food-analysis', 'label-scan', 'receipt-scan', 'web-lookup', 'exercise-estimate'],
      cooldownDurationMs: 1000,
    },
    {
      id: 'google-02',
      provider: 'google',
      secretValue: 'mock-google-key-2',
      enabled: true,
      priority: 2,
      capabilities: ['food-analysis', 'label-scan', 'receipt-scan', 'web-lookup', 'exercise-estimate'],
      cooldownDurationMs: 1000,
    },
    {
      id: 'anthropic-01',
      provider: 'anthropic',
      secretValue: 'mock-anthropic-key-1',
      enabled: true,
      priority: 1,
      capabilities: ['food-analysis', 'label-scan', 'receipt-scan', 'web-lookup', 'exercise-estimate'],
      cooldownDurationMs: 1000,
    },
    {
      id: 'openai-01',
      provider: 'openai',
      secretValue: 'mock-openai-key-1',
      enabled: true,
      priority: 1,
      capabilities: ['food-analysis', 'label-scan', 'receipt-scan', 'web-lookup', 'exercise-estimate'],
      cooldownDurationMs: 1000,
    },
  ]

  function createTestRouter(resourceConfigs = baseResources, customConfig?: Partial<GatewayConfig>) {
    const config: GatewayConfig = {
      ...loadGatewayConfig({}),
      resources: resourceConfigs,
      providerOrder: ['google', 'anthropic', 'openai'],
      maxTransientRetries: 1,
      retryBackoffBaseMs: 10,
      ...customConfig,
    }
    const healthTracker = new ResourceHealthTracker(resourceConfigs)
    const router = new ProviderRouter(config, healthTracker)
    return { router, healthTracker, config }
  }

  it('selects candidates by provider priority and resource priority', () => {
    const { router } = createTestRouter()
    const candidates = router.selectCandidateResources('food-analysis')
    expect(candidates.map((c) => c.id)).toEqual(['google-01', 'google-02', 'anthropic-01', 'openai-01'])
  })

  it('filters candidates by task capability matrix', () => {
    const customResources: ProviderResourceConfig[] = [
      {
        id: 'google-vision-only',
        provider: 'google',
        secretValue: 'mock',
        enabled: true,
        priority: 1,
        capabilities: ['food-analysis'],
      },
      {
        id: 'anthropic-all',
        provider: 'anthropic',
        secretValue: 'mock',
        enabled: true,
        priority: 1,
        capabilities: ['food-analysis', 'web-lookup'],
      },
    ]
    const { router } = createTestRouter(customResources)

    const visionCandidates = router.selectCandidateResources('food-analysis')
    expect(visionCandidates.map((c) => c.id)).toEqual(['google-vision-only', 'anthropic-all'])

    const webCandidates = router.selectCandidateResources('web-lookup')
    expect(webCandidates.map((c) => c.id)).toEqual(['anthropic-all'])
  })

  it('routes to primary provider successfully', async () => {
    const { router } = createTestRouter()
    const mockAdapter: ProviderAdapter = {
      provider: 'google',
      analyze: vi.fn().mockResolvedValue({
        data: { schema_version: '1.0.0', is_food: true, items: [] },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }
    router.registerAdapter(mockAdapter)

    const res = await router.analyze({ imagesBase64: ['test'] })
    expect(res.ok).toBe(true)
    expect(res.meta?.provider).toBe('google')
    expect(res.meta?.resourceId).toBe('google-01')
    expect(res.meta?.failoverCount).toBe(0)
    expect(mockAdapter.analyze).toHaveBeenCalledTimes(1)
  })

  it('fails over to secondary pool resource when primary is rate limited (429)', async () => {
    const { router, healthTracker } = createTestRouter()

    const mockAdapter: ProviderAdapter = {
      provider: 'google',
      analyze: vi.fn().mockImplementation((resource: ProviderResource) => {
        if (resource.id === 'google-01') {
          throw new RateLimitError('Rate limited on google-01', 5)
        }
        return Promise.resolve({
          data: { schema_version: '1.0.0', is_food: true, items: [] },
          meta: { provider: 'google', model: 'mock-model' },
        })
      }),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }
    router.registerAdapter(mockAdapter)

    const res = await router.analyze({ imagesBase64: ['test'] })
    expect(res.ok).toBe(true)
    expect(res.meta?.resourceId).toBe('google-02')
    expect(res.meta?.failoverCount).toBe(1)

    // google-01 should now be in cooldown
    expect(healthTracker.isResourceEligible('google-01')).toBe(false)
    const telemetry = healthTracker.getTelemetry().find((t) => t.id === 'google-01')
    expect(telemetry?.healthState).toBe('cooldown')
  })

  it('automatically recovers cooldown resources after cooldown duration expires', async () => {
    const { healthTracker } = createTestRouter()
    const now = Date.now()

    // Put google-01 in cooldown
    healthTracker.recordFailure('google-01', new RateLimitError('Rate limited', 1), 50, now)
    expect(healthTracker.isResourceEligible('google-01', now)).toBe(false)

    // Before cooldown expiry (now + 500ms)
    expect(healthTracker.isResourceEligible('google-01', now + 500)).toBe(false)

    // After cooldown expiry (now + 1500ms)
    expect(healthTracker.isResourceEligible('google-01', now + 1500)).toBe(true)
    const telemetry = healthTracker.getTelemetry(now + 1500).find((t) => t.id === 'google-01')
    expect(telemetry?.healthState).toBe('healthy')
  })

  it('marks permanently unhealthy on authentication error (401/403) and fails over', async () => {
    const { router, healthTracker } = createTestRouter()

    const mockGoogle: ProviderAdapter = {
      provider: 'google',
      analyze: vi.fn().mockImplementation((resource: ProviderResource) => {
        if (resource.id === 'google-01') {
          throw new GatewayError('AUTH_FAILED', 'API key invalid', false, 401)
        }
        throw new GatewayError('AUTH_FAILED', 'API key invalid', false, 401)
      }),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }

    const mockAnthropic: ProviderAdapter = {
      provider: 'anthropic',
      analyze: vi.fn().mockResolvedValue({
        data: { schema_version: '1.0.0', is_food: true, items: [] },
        meta: { provider: 'anthropic', model: 'claude-haiku' },
      } as AdapterExecutionResult),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }

    router.registerAdapter(mockGoogle)
    router.registerAdapter(mockAnthropic)

    const res = await router.analyze({ imagesBase64: ['test'] })
    expect(res.ok).toBe(true)
    expect(res.meta?.provider).toBe('anthropic')
    expect(res.meta?.resourceId).toBe('anthropic-01')
    expect(res.meta?.failoverCount).toBe(2)

    // Both google-01 and google-02 are marked auth_error and will not be retried
    expect(healthTracker.isResourceEligible('google-01')).toBe(false)
    expect(healthTracker.isResourceEligible('google-02')).toBe(false)
  })

  it('does NOT failover on invalid user request or content refusal', async () => {
    const { router } = createTestRouter()

    const mockGoogle: ProviderAdapter = {
      provider: 'google',
      analyze: vi.fn().mockRejectedValue(new InvalidRequestError('Invalid base64 payload')),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }
    router.registerAdapter(mockGoogle)

    const res = await router.analyze({ imagesBase64: ['bad'] })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('INVALID_REQUEST')
    // Adapter called only ONCE — no rotation!
    expect(mockGoogle.analyze).toHaveBeenCalledTimes(1)
  })

  it('returns clean error when all resources fail', async () => {
    const { router } = createTestRouter()

    const mockGoogle: ProviderAdapter = {
      provider: 'google',
      analyze: vi.fn().mockRejectedValue(new QuotaExhaustedError('No quota')),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }
    const mockAnthropic: ProviderAdapter = {
      provider: 'anthropic',
      analyze: vi.fn().mockRejectedValue(new QuotaExhaustedError('No quota')),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }
    const mockOpenAI: ProviderAdapter = {
      provider: 'openai',
      analyze: vi.fn().mockRejectedValue(new QuotaExhaustedError('No quota')),
      labelScan: vi.fn(),
      receiptScan: vi.fn(),
      webLookup: vi.fn(),
      exerciseEstimate: vi.fn(),
      bodyScan: vi.fn(),
    }
    router.registerAdapter(mockGoogle)
    router.registerAdapter(mockAnthropic)
    router.registerAdapter(mockOpenAI)

    const res = await router.analyze({ imagesBase64: ['test'] })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('QUOTA_EXHAUSTED')
  })
})
