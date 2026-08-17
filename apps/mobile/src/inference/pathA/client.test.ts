import { describe, expect, it, vi } from 'vitest'
import {
  AIService,
  runExerciseEstimate,
  runLabelScan,
  runReceiptScan,
  runScan,
  runScanWithFallback,
  runWebLookup,
} from './client'

type Call = { url: string; body: any; headers: Record<string, string> }

function scripted(responses: Array<{ status: number; body: string }>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : undefined,
      headers: init?.headers ?? {},
    })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
    } as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

describe('AIService / Gateway Client', () => {
  it('analyzeFood: posts to /v1/analyze with bearer auth and extracts normalized result', async () => {
    const { calls, impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { schema_version: '1.0.0', is_food: true, items: [] },
          meta: {
            provider: 'google',
            model: 'gemini-flash',
            resourceId: 'google-01',
            inputTokens: 500,
            outputTokens: 120,
            costUsd: 0.0002,
            latencyMs: 320,
            promptVersion: '1.0.0',
          },
        }),
      },
    ])

    const r = await AIService.analyzeFood(['mock-base64'], 'context', {}, impl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.raw).toEqual({ schema_version: '1.0.0', is_food: true, items: [] })
      expect(r.value.inputTokens).toBe(500)
      expect(r.value.costUsd).toBe(0.0002)
      expect(r.value.provider).toBe('google')
      expect(r.value.resourceId).toBe('google-01')
    }
    expect(calls[0]!.url).toContain('/v1/analyze')
    expect(calls[0]!.headers.Authorization).toContain('Bearer')
  })

  it('analyzeNutritionLabel: posts to /v1/label-scan', async () => {
    const { calls, impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { product_name: 'Almond Milk', serving_g: 240, per_serving: { calories_kcal: 30 } },
        }),
      },
    ])

    const r = await AIService.analyzeNutritionLabel('label-base64', {}, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/label-scan')
    expect((r.raw as any).product_name).toBe('Almond Milk')
  })

  it('analyzeReceipt: posts to /v1/receipt-scan', async () => {
    const { calls, impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { merchant: 'Chipotle', items: [{ name: 'Burrito Bowl', quantity: 1 }] },
        }),
      },
    ])

    const r = await AIService.analyzeReceipt('receipt-base64', {}, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/receipt-scan')
    expect((r.raw as any).merchant).toBe('Chipotle')
  })

  it('lookupBrandedFood: posts to /v1/web-lookup', async () => {
    const { calls, impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { found: true, source_url: 'https://brand.com', options: [] },
        }),
      },
    ])

    const r = await AIService.lookupBrandedFood('Chicken Sandwich', 'Popeyes', null, {}, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/web-lookup')
    expect((r.raw as any).found).toBe(true)
  })

  it('estimateExercise: posts to /v1/exercise-estimate', async () => {
    const { calls, impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { label: 'Cycling', duration_min: 45, calories_kcal: 400 },
        }),
      },
    ])

    const r = await AIService.estimateExercise('45 mins cycling', 75, {}, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/exercise-estimate')
    expect((r.raw as any).calories_kcal).toBe(400)
  })

  it('maps gateway errors accurately into ScanFailureKind', async () => {
    for (const [code, expectedKind] of [
      ['AUTH_FAILED', 'key-invalid'],
      ['FORBIDDEN', 'key-invalid'],
      ['QUOTA_EXHAUSTED', 'quota-exhausted'],
      ['MODEL_UNAVAILABLE', 'model-unavailable'],
      ['RATE_LIMITED', 'error-retryable'],
      ['TIMEOUT', 'timeout-ambiguous'],
      ['CONTENT_REFUSAL', 'content-refusal'],
      ['SCHEMA_VIOLATION', 'schema-violation'],
    ] as const) {
      const { impl } = scripted([
        {
          status: 400,
          body: JSON.stringify({ ok: false, error: { code, message: 'Sample error' } }),
        },
      ])
      const r = await AIService.analyzeFood(['test'], '', {}, impl)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.kind).toBe(expectedKind)
      }
    }
  })

  it('handles offline / network disconnect gracefully without crashing', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('Network failure'))
    const r = await AIService.analyzeFood(['test'], '', {}, impl as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('offline')
      expect(r.error.retryable).toBe(true)
    }
  })
})

describe('runScan & compatibility wrappers', () => {
  it('runScan delegates to AIService.analyzeFood', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { is_food: true },
          meta: { provider: 'google', model: 'flash' },
        }),
      },
    ])
    const r = await runScan({ imagesBase64: ['AAAA'] }, impl)
    expect(r.ok).toBe(true)
  })

  it('runScanWithFallback succeeds with gateway response', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          ok: true,
          data: { is_food: true },
          meta: { provider: 'google', model: 'flash' },
        }),
      },
    ])
    const r = await runScanWithFallback({ imagesBase64: ['AAAA'] }, impl)
    expect(r.ok).toBe(true)
  })

  it('runLabelScan, runReceiptScan, runWebLookup, runExerciseEstimate delegate properly', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({ ok: true, data: { status: 'success' } }),
      },
    ])
    const l = await runLabelScan('google', { imageBase64: 'AAAA' }, null, impl)
    expect(l.ok).toBe(true)

    const rc = await runReceiptScan('google', { imageBase64: 'AAAA' }, null, impl)
    expect(rc.ok).toBe(true)

    const w = await runWebLookup('google', { itemName: 'Burger', brand: null }, null, impl)
    expect(w.ok).toBe(true)

    const e = await runExerciseEstimate('google', { description: 'run', weightKg: 70 }, null, impl)
    expect(e.ok).toBe(true)
  })
})
