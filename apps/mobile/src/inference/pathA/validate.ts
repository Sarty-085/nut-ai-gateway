import { checkGatewayHealth, type GatewayHealthStatus } from '../gateway-config'
import type { Credential, ScanFailure } from './client'

/**
 * Gateway & Provider Access Validation.
 */

export interface ValidationOk {
  ok: true
  usedShape: 'bearer'
  modelId: string
}

export interface ValidationErr {
  ok: false
  error: ScanFailure
  detail: string
}

export type ValidationResult = ValidationOk | ValidationErr

export async function validateGateway(
  gatewayUrl?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ValidationResult> {
  const health: GatewayHealthStatus = await checkGatewayHealth(gatewayUrl, fetchImpl)

  if (!health.ok) {
    return {
      ok: false,
      error: {
        kind: 'offline',
        message: 'Could not connect to the Private AI Gateway.',
        retryable: true,
      },
      detail: health.error ?? 'Network error connecting to Gateway',
    }
  }

  return {
    ok: true,
    usedShape: 'bearer',
    modelId: 'gateway-managed',
  }
}

export async function validateGoogleApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ValidationResult> {
  if (!apiKey || apiKey.trim().length < 15) {
    return {
      ok: false,
      error: { kind: 'key-invalid', message: 'API key is too short or empty.', retryable: false },
      detail: 'Invalid API key format',
    }
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey.trim(), 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      return {
        ok: false,
        error: {
          kind: 'key-invalid',
          message: `Google API rejected key (HTTP ${res.status})`,
          retryable: false,
          httpStatus: res.status,
        },
        detail: text.slice(0, 150),
      }
    }

    return { ok: true, usedShape: 'bearer', modelId: 'gemini-2.5-flash' }
  } catch (err: any) {
    return {
      ok: false,
      error: { kind: 'offline', message: 'Could not connect to Google Gemini API.', retryable: true },
      detail: String(err.message ?? err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Backwards compatibility helper for existing callers.
 */
export async function validateCredential(
  provider: string,
  _model: string,
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  _timeoutMs = 15_000,
): Promise<ValidationResult> {
  if (provider === 'google' && credential.value && credential.value !== 'dummy') {
    return validateGoogleApiKey(credential.value, fetchImpl)
  }
  return validateGateway(undefined, fetchImpl)
}
