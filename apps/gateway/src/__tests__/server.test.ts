import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AdapterExecutionResult, ProviderAdapter } from '../adapters/base.js'
import { GatewayServer } from '../server.js'

describe('GatewayServer HTTP Endpoints', () => {
  let server: GatewayServer
  let port: number
  let baseUrl: string

  const appToken = 'test-client-token'
  const adminToken = 'test-admin-secret'

  beforeAll(async () => {
    server = new GatewayServer({
      port: 0,
      adminToken,
      appTokens: new Set([appToken]),
      revokedTokens: new Set(),
      resources: [
        {
          id: 'test-google-01',
          provider: 'google',
          secretValue: 'mock-key',
          enabled: true,
          priority: 1,
          capabilities: ['food-analysis', 'label-scan', 'receipt-scan', 'web-lookup', 'exercise-estimate'],
        },
      ],
    })

    // Mock the adapter
    const mockGoogle: ProviderAdapter = {
      provider: 'google',
      analyze: vi.fn().mockResolvedValue({
        data: { schema_version: '1.0.0', is_food: true, items: [] },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
      labelScan: vi.fn().mockResolvedValue({
        data: { product_name: 'Greek Yogurt', serving_g: 150, per_serving: { calories_kcal: 100, protein_g: 15, fat_g: 0, carbs_g: 5 } },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
      receiptScan: vi.fn().mockResolvedValue({
        data: { merchant: 'Sweetgreen', items: [{ name: 'Kale Salad', quantity: 1 }] },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
      webLookup: vi.fn().mockResolvedValue({
        data: { found: true, source_url: 'https://example.com', options: [{ label: 'Salad', calories_kcal: 300, protein_g: 10, carbs_g: 20, fat_g: 5 }] },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
      exerciseEstimate: vi.fn().mockResolvedValue({
        data: { label: 'Running', duration_min: 30, calories_kcal: 350 },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
      bodyScan: vi.fn().mockResolvedValue({
        data: { schema_version: '1.0.0', is_person_visible: true, refusal_reason: null },
        meta: { provider: 'google', model: 'mock-model' },
      } as AdapterExecutionResult),
    }

    server.router.registerAdapter(mockGoogle)
    port = await server.start()
    baseUrl = `http://localhost:${port}`
  })

  afterAll(async () => {
    await server.stop()
  })

  it('GET /v1/health returns 200 without auth', async () => {
    const res = await fetch(`${baseUrl}/v1/health`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(json.status).toBe('online')
    expect(json.activeResources).toBe(1)
  })

  it('rejects POST /v1/analyze without authentication token', async () => {
    const res = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagesBase64: ['test'] }),
    })
    expect(res.status).toBe(401)
  })

  it('accepts POST /v1/analyze with valid app token in Authorization header', async () => {
    const res = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appToken}`,
      },
      body: JSON.stringify({ imagesBase64: ['test'] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(json.data.is_food).toBe(true)
    expect(json.meta.resourceId).toBe('test-google-01')
  })

  it('accepts POST /v1/label-scan', async () => {
    const res = await fetch(`${baseUrl}/v1/label-scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nutai-app-token': appToken,
      },
      body: JSON.stringify({ imageBase64: 'test' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(json.data.product_name).toBe('Greek Yogurt')
  })

  it('accepts POST /v1/exercise-estimate', async () => {
    const res = await fetch(`${baseUrl}/v1/exercise-estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appToken}`,
      },
      body: JSON.stringify({ description: '30 mins running' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(json.data.calories_kcal).toBe(350)
  })

  it('protects GET /v1/admin/status: rejects invalid admin token', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/status`, {
      headers: { Authorization: 'Bearer wrong-admin-token' },
    })
    expect(res.status).toBe(403)
  })

  it('GET /v1/admin/status: returns telemetry and masked pool status for valid admin token', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(json.telemetry).toHaveLength(1)
    expect(json.telemetry[0].id).toBe('test-google-01')
    expect(json.telemetry[0].healthState).toBe('healthy')
    // Ensure secrets are NEVER exposed in admin response
    expect(JSON.stringify(json)).not.toContain('mock-key')
  })

  it('POST /v1/admin/tokens/revoke revokes an app token immediately', async () => {
    const tempToken = 'temp-token-to-revoke'
    server.config.appTokens.add(tempToken)

    // Token works initially
    const res1 = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tempToken}`,
      },
      body: JSON.stringify({ imagesBase64: ['test'] }),
    })
    expect(res1.status).toBe(200)

    // Revoke token via admin endpoint
    const revokeRes = await fetch(`${baseUrl}/v1/admin/tokens/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ token: tempToken }),
    })
    expect(revokeRes.status).toBe(200)

    // Token is now forbidden (403)
    const res2 = await fetch(`${baseUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tempToken}`,
      },
      body: JSON.stringify({ imagesBase64: ['test'] }),
    })
    expect(res2.status).toBe(403)
  })
})
