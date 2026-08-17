import type { ProviderId } from '@nutai/prompt'
import { getAppToken, getGatewayUrl } from '../gateway-config'

/**
 * Mobile AI Perception Client (Private AI Gateway Architecture).
 *
 * SPEC-accuracy-engine.md §3, PLAN.md D10.
 *
 * THE APP NEVER CONTAINS VENDOR SECRETS.
 * All requests travel via HTTPS to the Private AI Gateway.
 * The AI is strictly a PERCEPTION layer.
 * All numbers and calculations remain in the deterministic engine.
 */

export type ScanFailureKind =
  | 'key-invalid'
  | 'quota-exhausted'
  | 'model-unavailable'
  | 'error-retryable'
  | 'offline'
  | 'content-refusal'
  | 'schema-violation'
  | 'timeout-ambiguous'
  | 'no-key'

export interface ScanFailure {
  kind: ScanFailureKind
  message: string
  retryable: boolean
  httpStatus?: number
}

export interface ScanSuccess {
  raw: unknown
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  promptVersion: string
  provider?: ProviderId
  model?: string
  resourceId?: string
}

export type ScanOutcome = { ok: true; value: ScanSuccess } | { ok: false; error: ScanFailure }

export interface WebLookupOutcome {
  ok: boolean
  raw?: unknown
  error?: ScanFailure
}

export interface Credential {
  kind: 'api_key' | 'oauth'
  value: string
}

export interface ScanRequest {
  imagesBase64: readonly string[]
  localSignalsBlock?: string
  jsonSchema?: unknown
  timeoutMs?: number
  provider?: ProviderId
  model?: string
  credential?: Credential
  fixBlock?: string
  keepFraction?: number
}

function mapGatewayError(errorObj?: { code?: string; message?: string; retryable?: boolean; httpStatus?: number }): ScanFailure {
  const code = errorObj?.code ?? ''
  const message = errorObj?.message ?? 'Gateway request failed'
  const retryable = errorObj?.retryable ?? false
  const httpStatus = errorObj?.httpStatus

  if (code === 'AUTH_FAILED' || code === 'FORBIDDEN') {
    return { kind: 'key-invalid', message, retryable: false, httpStatus }
  }
  if (code === 'QUOTA_EXHAUSTED') {
    return { kind: 'quota-exhausted', message, retryable: false, httpStatus }
  }
  if (code === 'MODEL_UNAVAILABLE') {
    return { kind: 'model-unavailable', message, retryable: false, httpStatus }
  }
  if (code === 'RATE_LIMITED') {
    return { kind: 'error-retryable', message, retryable: true, httpStatus }
  }
  if (code === 'TIMEOUT') {
    return { kind: 'timeout-ambiguous', message, retryable: false, httpStatus }
  }
  if (code === 'CONTENT_REFUSAL') {
    return { kind: 'content-refusal', message, retryable: false, httpStatus }
  }
  if (code === 'SCHEMA_VIOLATION') {
    return { kind: 'schema-violation', message, retryable: false, httpStatus }
  }
  return { kind: 'error-retryable', message, retryable, httpStatus }
}

async function postGateway<T = any>(
  path: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 45_000,
): Promise<{ ok: boolean; data?: T; meta?: any; error?: ScanFailure }> {
  const baseUrl = (await getGatewayUrl()).replace(/\/+$/, '')
  const token = await getAppToken()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const text = await res.text()
    let json: Record<string, any>
    try {
      json = JSON.parse(text)
    } catch {
      return {
        ok: false,
        error: {
          kind: 'schema-violation',
          message: 'Gateway returned non-JSON response',
          retryable: false,
          httpStatus: res.status,
        },
      }
    }

    if (!res.ok || json['ok'] === false) {
      return {
        ok: false,
        error: mapGatewayError(json['error']),
      }
    }

    return {
      ok: true,
      data: json['data'] as T,
      meta: json['meta'],
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          kind: 'timeout-ambiguous',
          message: 'The request to the AI gateway timed out.',
          retryable: false,
        },
      }
    }
    return {
      ok: false,
      error: {
        kind: 'offline',
        message: 'Could not connect to the private AI gateway. Check network connection.',
        retryable: true,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Unified AIService provider-neutral abstraction.
 */
export const AIService = {
  async analyzeFood(
    imagesBase64: string[],
    localSignalsBlock = '',
    opts?: { fixBlock?: string; keepFraction?: number; timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): Promise<ScanOutcome> {
    const res = await postGateway(
      '/v1/analyze',
      {
        imagesBase64,
        localSignalsBlock,
        fixBlock: opts?.fixBlock,
        keepFraction: opts?.keepFraction,
      },
      fetchImpl,
      opts?.timeoutMs ?? 45_000,
    )

    if (!res.ok || !res.data) {
      return { ok: false, error: res.error ?? { kind: 'error-retryable', message: 'Failed to analyze food', retryable: true } }
    }

    return {
      ok: true,
      value: {
        raw: res.data,
        inputTokens: res.meta?.inputTokens ?? 0,
        outputTokens: res.meta?.outputTokens ?? 0,
        costUsd: res.meta?.costUsd ?? 0,
        latencyMs: res.meta?.latencyMs ?? 0,
        promptVersion: res.meta?.promptVersion ?? '1.0.0',
        provider: res.meta?.provider,
        model: res.meta?.model,
        resourceId: res.meta?.resourceId,
      },
    }
  },

  async analyzeNutritionLabel(
    imageBase64: string,
    opts?: { timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): Promise<WebLookupOutcome> {
    const res = await postGateway(
      '/v1/label-scan',
      { imageBase64 },
      fetchImpl,
      opts?.timeoutMs ?? 30_000,
    )
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error }
    }
    return { ok: true, raw: res.data }
  },

  async analyzeReceipt(
    imageBase64: string,
    opts?: { timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): Promise<WebLookupOutcome> {
    const res = await postGateway(
      '/v1/receipt-scan',
      { imageBase64 },
      fetchImpl,
      opts?.timeoutMs ?? 30_000,
    )
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error }
    }
    return { ok: true, raw: res.data }
  },

  async lookupBrandedFood(
    itemName: string,
    brand?: string | null,
    visualContext?: string | null,
    opts?: { timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): Promise<WebLookupOutcome> {
    const res = await postGateway(
      '/v1/web-lookup',
      { itemName, brand, visualContext },
      fetchImpl,
      opts?.timeoutMs ?? 30_000,
    )
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error }
    }
    return { ok: true, raw: res.data }
  },

  async estimateExercise(
    description: string,
    weightKg?: number | null,
    opts?: { timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): Promise<WebLookupOutcome> {
    const res = await postGateway(
      '/v1/exercise-estimate',
      { description, weightKg },
      fetchImpl,
      opts?.timeoutMs ?? 20_000,
    )
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error }
    }
    return { ok: true, raw: res.data }
  },
}

// ---------------------------------------------------------------------------
// Direct Compatibility Wrappers (reused across orchestrator and existing code)
// ---------------------------------------------------------------------------

export async function runScan(req: ScanRequest, fetchImpl: typeof fetch = fetch): Promise<ScanOutcome> {
  return AIService.analyzeFood(
    [...req.imagesBase64],
    req.localSignalsBlock,
    { fixBlock: req.fixBlock, keepFraction: req.keepFraction, timeoutMs: req.timeoutMs },
    fetchImpl,
  )
}

export async function runScanWithFallback(
  req: ScanRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanOutcome & { usedSchemaFallback?: boolean }> {
  return runScan(req, fetchImpl)
}

export async function runLabelScan(
  _provider: ProviderId | string,
  input: { model?: string; imageBase64: string },
  _credential?: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  return AIService.analyzeNutritionLabel(input.imageBase64, { timeoutMs }, fetchImpl)
}

export async function runReceiptScan(
  _provider: ProviderId | string,
  input: { model?: string; imageBase64: string },
  _credential?: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  return AIService.analyzeReceipt(input.imageBase64, { timeoutMs }, fetchImpl)
}

export async function runWebLookup(
  _provider: ProviderId | string,
  input: { model?: string; itemName: string; brand: string | null; visualContext?: string | null },
  _credential?: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  return AIService.lookupBrandedFood(input.itemName, input.brand, input.visualContext, { timeoutMs }, fetchImpl)
}

export async function runExerciseEstimate(
  _provider: ProviderId | string,
  input: { model?: string; description: string; weightKg: number | null },
  _credential?: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<WebLookupOutcome> {
  return AIService.estimateExercise(input.description, input.weightKg, { timeoutMs }, fetchImpl)
}
