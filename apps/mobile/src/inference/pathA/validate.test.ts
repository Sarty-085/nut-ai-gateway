import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateCredential, validateGateway, validateGoogleApiKey } from './validate'
import { setGatewayUrl } from '../gateway-config'

describe('validateGateway & validateGoogleApiKey', () => {
  beforeEach(async () => {
    await setGatewayUrl('http://localhost:3000')
  })

  it('returns ok: true when gateway health check succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, status: 'online', activeResources: 3, version: '1.0.0' }),
    } as Response)

    const res = await validateGateway('http://localhost:3000', fetchImpl as unknown as typeof fetch)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.usedShape).toBe('bearer')
    }
  })

  it('returns ok: false with offline error when gateway is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Connection refused'))

    const res = await validateGateway('http://localhost:3000', fetchImpl as unknown as typeof fetch)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('offline')
    }
  })

  it('validateCredential compatibility helper routes to gateway validation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, status: 'online', activeResources: 2 }),
    } as Response)

    const res = await validateCredential('gateway', 'gemini-flash', { kind: 'api_key', value: 'dummy' }, fetchImpl as unknown as typeof fetch)
    expect(res.ok).toBe(true)
  })

  it('validateGoogleApiKey validates direct Google Gemini API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] }),
    } as Response)

    const res = await validateGoogleApiKey('AIzaSyValidGoogleKeyForTesting12345', fetchImpl as unknown as typeof fetch)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.modelId).toBe('gemini-2.0-flash')
    }
  })
})
