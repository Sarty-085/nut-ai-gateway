import { describe, expect, it, vi } from 'vitest'
import { validateCredential, validateGateway } from './validate'

describe('validateGateway', () => {
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

    const res = await validateCredential('google', 'gemini-flash', { kind: 'api_key', value: 'dummy' }, fetchImpl as unknown as typeof fetch)
    expect(res.ok).toBe(true)
  })
})
