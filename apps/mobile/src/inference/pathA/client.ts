import {
  BODY_SCAN_PROMPT_VERSION,
  buildBodyScanRequest,
  buildExerciseEstimateInstruction,
  buildGeminiRequest,
  buildLabelScanRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupRequest,
  computeScanCost,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
  geminiWireSchema,
  LABEL_SCAN_PROMPT_VERSION,
  PROMPT_VERSION,
  RECEIPT_SCAN_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import {
  BodyScanPayloadZ,
  ExerciseEstimateZ,
  LabelPayloadZ,
  ReceiptPayloadZ,
  VISION_WIRE_SCHEMA,
  VisionPayloadZ,
  WebLookupResultZ,
} from '@nutai/core-schema'
import { getAppToken, getGatewayUrl, getProviderMode } from '../gateway-config'
import { loadCredential } from '../credentials'

/**
 * Mobile AI Perception Client (Dual Engine: Private AI Gateway & Direct Google BYOK).
 *
 * SPEC-accuracy-engine.md §3, PLAN.md D10.
 *
 * Supports both:
 * 1. Self-hosted / Cloud Private AI Gateway (no client secrets)
 * 2. Personal Google Gemini API Key (Direct on-device BYOK)
 *
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

function extractJsonBlock(text: string): unknown {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = match ? match[1]! : text
  return JSON.parse(candidate.trim())
}

async function callGoogleGeminiDirect<T = any>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: any } },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; data?: T; meta?: any; error?: ScanFailure }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) {
      if (res.status === 400 || res.status === 403) {
        return {
          ok: false,
          error: {
            kind: 'key-invalid',
            message: `Google Gemini API rejected key (HTTP ${res.status})`,
            retryable: false,
            httpStatus: res.status,
          },
        }
      }
      if (res.status === 429) {
        return {
          ok: false,
          error: {
            kind: 'quota-exhausted',
            message: 'Google Gemini quota or rate limit reached. Try again later.',
            retryable: true,
            httpStatus: 429,
          },
        }
      }
      return {
        ok: false,
        error: {
          kind: 'error-retryable',
          message: `Google Gemini API returned HTTP ${res.status}`,
          retryable: true,
          httpStatus: res.status,
        },
      }
    }

    let json: Record<string, any>
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'Google Gemini returned non-JSON response', retryable: false } }
    }

    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      return { ok: false, error: { kind: 'schema-violation', message: 'Google Gemini returned empty response', retryable: false } }
    }

    let parsedRaw: unknown
    try {
      parsedRaw = typeof rawText === 'string' ? JSON.parse(rawText) : rawText
    } catch {
      parsedRaw = extractJsonBlock(rawText)
    }

    const validated = schema.safeParse(parsedRaw)
    if (!validated.success) {
      return {
        ok: false,
        error: {
          kind: 'schema-violation',
          message: `Response failed schema validation: ${validated.error.message}`,
          retryable: false,
        },
      }
    }

    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0
    const latencyMs = Date.now() - started
    const costUsd = computeScanCost('google', 'gemini-2.0-flash', inputTokens, outputTokens)

    return {
      ok: true,
      data: validated.data,
      meta: {
        provider: 'google',
        model: 'gemini-2.0-flash',
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
      },
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout-ambiguous', message: 'Google Gemini request timed out.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'Could not connect to Google Gemini API. Check network connection.', retryable: true } }
  } finally {
    clearTimeout(timer)
  }
}

async function postGateway<T = any>(
  path: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 45_000,
): Promise<{ ok: boolean; data?: T; meta?: any; error?: ScanFailure }> {
  const baseUrl = (await getGatewayUrl()).replace(/\/+$/, '')
  const token = await getAppToken()

  if (!baseUrl) {
    return {
      ok: false,
      error: {
        kind: 'no-key',
        message: 'No AI Gateway or Google Gemini API Key configured. Please configure in Profile > AI Perception Settings.',
        retryable: false,
      },
    }
  }

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
    const providerSetting = await getProviderMode()
    const googleCred = await loadCredential('google')
    const gatewayUrl = (await getGatewayUrl()).trim()

    if (providerSetting === 'none') {
      return { ok: false, error: { kind: 'offline', message: 'AI Perception is set to Offline/Manual mode in Profile settings.', retryable: false } }
    }

    const useGoogle = providerSetting === 'google' || (!gatewayUrl && !!googleCred?.value)

    if (useGoogle) {
      if (!googleCred?.value) {
        return { ok: false, error: { kind: 'no-key', message: 'No Google Gemini API Key configured. Please enter your API key in Profile > AI Perception Settings.', retryable: false } }
      }
      const built = buildGeminiRequest(
        {
          model: 'gemini-2.0-flash',
          imagesBase64,
          localSignalsBlock: opts?.fixBlock || localSignalsBlock,
          jsonSchema: geminiWireSchema(VISION_WIRE_SCHEMA),
        },
        googleCred.value,
      )
      const res = await callGoogleGeminiDirect(built.url, built.headers, built.body, opts?.timeoutMs ?? 45_000, VisionPayloadZ, fetchImpl)
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
          promptVersion: PROMPT_VERSION,
          provider: 'google',
          model: 'gemini-2.0-flash',
        },
      }
    }

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
    const providerSetting = await getProviderMode()
    const googleCred = await loadCredential('google')
    const gatewayUrl = (await getGatewayUrl()).trim()

    const useGoogle = providerSetting === 'google' || (!gatewayUrl && !!googleCred?.value)

    if (useGoogle && googleCred?.value) {
      const built = buildLabelScanRequest(
        'google',
        { model: 'gemini-2.0-flash', imageBase64 },
        { kind: 'api_key', value: googleCred.value },
      )
      const res = await callGoogleGeminiDirect(built.url, built.headers, built.body, opts?.timeoutMs ?? 30_000, LabelPayloadZ, fetchImpl)
      if (!res.ok || !res.data) return { ok: false, error: res.error }
      return { ok: true, raw: res.data }
    }

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
    const providerSetting = await getProviderMode()
    const googleCred = await loadCredential('google')
    const gatewayUrl = (await getGatewayUrl()).trim()

    const useGoogle = providerSetting === 'google' || (!gatewayUrl && !!googleCred?.value)

    if (useGoogle && googleCred?.value) {
      const built = buildReceiptScanRequest(
        'google',
        { model: 'gemini-2.0-flash', imageBase64 },
        { kind: 'api_key', value: googleCred.value },
      )
      const res = await callGoogleGeminiDirect(built.url, built.headers, built.body, opts?.timeoutMs ?? 30_000, ReceiptPayloadZ, fetchImpl)
      if (!res.ok || !res.data) return { ok: false, error: res.error }
      return { ok: true, raw: res.data }
    }

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
    const providerSetting = await getProviderMode()
    const googleCred = await loadCredential('google')
    const gatewayUrl = (await getGatewayUrl()).trim()

    const useGoogle = providerSetting === 'google' || (!gatewayUrl && !!googleCred?.value)

    if (useGoogle && googleCred?.value) {
      const built = buildWebLookupRequest(
        'google',
        { model: 'gemini-2.0-flash', itemName, brand: brand ?? null, visualContext: visualContext ?? null },
        { kind: 'api_key', value: googleCred.value },
      )
      const res = await callGoogleGeminiDirect(built.url, built.headers, built.body, opts?.timeoutMs ?? 30_000, WebLookupResultZ, fetchImpl)
      if (!res.ok || !res.data) return { ok: false, error: res.error }
      return { ok: true, raw: res.data }
    }

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
    const providerSetting = await getProviderMode()
    const googleCred = await loadCredential('google')
    const gatewayUrl = (await getGatewayUrl()).trim()

    const useGoogle = providerSetting === 'google' || (!gatewayUrl && !!googleCred?.value)

    if (useGoogle && googleCred?.value) {
      const built = buildTextJsonRequest(
        'google',
        {
          model: 'gemini-2.0-flash',
          instruction: buildExerciseEstimateInstruction(description, weightKg ?? null),
        },
        { kind: 'api_key', value: googleCred.value },
        EXERCISE_ESTIMATE_PROMPT_VERSION,
      )
      const res = await callGoogleGeminiDirect(built.url, built.headers, built.body, opts?.timeoutMs ?? 20_000, ExerciseEstimateZ, fetchImpl)
      if (!res.ok || !res.data) return { ok: false, error: res.error }
      return { ok: true, raw: res.data }
    }

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

  async analyzeBodyScan(
    imageBase64: string,
    localSignalsBlock?: string,
    opts?: { timeoutMs?: number },
    fetchImpl: typeof fetch = fetch,
  ): Promise<WebLookupOutcome> {
    const providerSetting = await getProviderMode()
    const googleCred = await loadCredential('google')
    const gatewayUrl = (await getGatewayUrl()).trim()

    const useGoogle = providerSetting === 'google' || (!gatewayUrl && !!googleCred?.value)

    if (useGoogle && googleCred?.value) {
      const built = buildBodyScanRequest(
        'google',
        { model: 'gemini-2.0-flash', imageBase64, localSignalsBlock },
        { kind: 'api_key', value: googleCred.value },
      )
      const res = await callGoogleGeminiDirect(built.url, built.headers, built.body, opts?.timeoutMs ?? 45_000, BodyScanPayloadZ, fetchImpl)
      if (!res.ok || !res.data) return { ok: false, error: res.error }
      return { ok: true, raw: res.data }
    }

    const res = await postGateway(
      '/v1/body-scan',
      { imageBase64, localSignalsBlock },
      fetchImpl,
      opts?.timeoutMs ?? 45_000,
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

export async function runBodyScan(
  input: { imageBase64: string; localSignalsBlock?: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 45_000,
): Promise<WebLookupOutcome> {
  return AIService.analyzeBodyScan(input.imageBase64, input.localSignalsBlock, { timeoutMs }, fetchImpl)
}
