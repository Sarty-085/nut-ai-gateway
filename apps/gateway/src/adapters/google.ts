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
  RECEIPT_SCAN_PROMPT_VERSION,
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
import { classifyUpstreamError, InvalidRequestError, SchemaViolationError, TimeoutError } from '../errors.js'
import type {
  AnalyzeGatewayRequest,
  BodyScanGatewayRequest,
  ExerciseEstimateGatewayRequest,
  LabelScanGatewayRequest,
  ProviderResource,
  ReceiptScanGatewayRequest,
  WebLookupGatewayRequest,
} from '../types.js'
import { type AdapterExecutionResult, extractJsonBlock, type ProviderAdapter } from './base.js'

export class GoogleAdapter implements ProviderAdapter {
  public readonly provider = 'google' as const

  private async fetchJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number,
    fetchImpl: typeof fetch,
  ): Promise<{ status: number; text: string; json: any }> {
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
      console.log('[gateway:google] url:', url, 'status:', res.status, 'body:', text.slice(0, 300))
      if (!res.ok) {
        throw classifyUpstreamError(res.status, text)
      }
      try {
        const json = JSON.parse(text)
        return { status: res.status, text, json }
      } catch (err) {
        throw new SchemaViolationError(`Provider returned malformed JSON: ${String(err)}`)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError('Google Gemini request timed out.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  public async analyze(
    resource: ProviderResource,
    model: string,
    req: AnalyzeGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<AdapterExecutionResult> {
    if (!resource.resolvedSecret) {
      throw new InvalidRequestError('Google resource has no API key configured')
    }
    const timeoutMs = req.timeoutMs ?? 45_000
    const localSignalsBlock = req.fixBlock ? req.fixBlock : req.localSignalsBlock ?? ''

    const built = buildGeminiRequest(
      {
        model,
        imagesBase64: req.imagesBase64,
        localSignalsBlock,
        jsonSchema: geminiWireSchema(VISION_WIRE_SCHEMA),
      },
      resource.resolvedSecret,
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      throw new SchemaViolationError('Gemini returned no text content in parts')
    }

    let parsedRaw: unknown
    try {
      parsedRaw = typeof rawText === 'string' ? JSON.parse(rawText) : rawText
    } catch {
      parsedRaw = extractJsonBlock(rawText)
    }

    const validated = VisionPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Gemini response failed VisionPayload schema: ${validated.error.message}`)
    }

    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0
    const costUsd = computeScanCost('google', model, inputTokens, outputTokens)

    return {
      data: validated.data,
      meta: {
        provider: 'google',
        model,
        inputTokens,
        outputTokens,
        costUsd,
        promptVersion: built.promptVersion,
      },
    }
  }

  public async labelScan(
    resource: ProviderResource,
    model: string,
    req: LabelScanGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<AdapterExecutionResult> {
    const timeoutMs = req.timeoutMs ?? 30_000
    const built = buildLabelScanRequest(
      'google',
      { model, imageBase64: req.imageBase64 },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const parts = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
    if (!parts) {
      throw new SchemaViolationError('Gemini returned empty parts for label scan')
    }

    const parsedRaw = extractJsonBlock(parts)
    const validated = LabelPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Label scan validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'google',
        model,
        promptVersion: LABEL_SCAN_PROMPT_VERSION,
      },
    }
  }

  public async receiptScan(
    resource: ProviderResource,
    model: string,
    req: ReceiptScanGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<AdapterExecutionResult> {
    const timeoutMs = req.timeoutMs ?? 30_000
    const built = buildReceiptScanRequest(
      'google',
      { model, imageBase64: req.imageBase64 },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const parts = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
    if (!parts) {
      throw new SchemaViolationError('Gemini returned empty parts for receipt scan')
    }

    const parsedRaw = extractJsonBlock(parts)
    const validated = ReceiptPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Receipt scan validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'google',
        model,
        promptVersion: RECEIPT_SCAN_PROMPT_VERSION,
      },
    }
  }

  public async webLookup(
    resource: ProviderResource,
    model: string,
    req: WebLookupGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<AdapterExecutionResult> {
    const timeoutMs = req.timeoutMs ?? 30_000
    const built = buildWebLookupRequest(
      'google',
      {
        model,
        itemName: req.itemName,
        brand: req.brand ?? null,
        visualContext: req.visualContext ?? null,
      },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const parts = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
    if (!parts) {
      throw new SchemaViolationError('Gemini returned empty search response')
    }

    const parsedRaw = extractJsonBlock(parts)
    const validated = WebLookupResultZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Web lookup validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'google',
        model,
      },
    }
  }

  public async exerciseEstimate(
    resource: ProviderResource,
    model: string,
    req: ExerciseEstimateGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<AdapterExecutionResult> {
    const timeoutMs = req.timeoutMs ?? 20_000
    const built = buildTextJsonRequest(
      'google',
      {
        model,
        instruction: buildExerciseEstimateInstruction(req.description, req.weightKg ?? null),
      },
      { kind: 'api_key', value: resource.resolvedSecret },
      EXERCISE_ESTIMATE_PROMPT_VERSION,
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const parts = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
    if (!parts) {
      throw new SchemaViolationError('Gemini returned empty response for exercise estimation')
    }

    const parsedRaw = extractJsonBlock(parts)
    const validated = ExerciseEstimateZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Exercise estimate validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'google',
        model,
        promptVersion: EXERCISE_ESTIMATE_PROMPT_VERSION,
      },
    }
  }

  public async bodyScan(
    resource: ProviderResource,
    model: string,
    req: BodyScanGatewayRequest,
    fetchImpl: typeof fetch = fetch,
  ): Promise<AdapterExecutionResult> {
    if (!req.imageBase64) {
      throw new InvalidRequestError('Body scan requires an imageBase64 payload.')
    }
    const timeoutMs = req.timeoutMs ?? 45_000
    const built = buildBodyScanRequest(
      'google',
      {
        model,
        imageBase64: req.imageBase64,
        localSignalsBlock: req.localSignalsBlock,
      },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      throw new SchemaViolationError('Gemini returned no text content for body scan')
    }

    let parsedRaw: unknown
    try {
      parsedRaw = typeof rawText === 'string' ? JSON.parse(rawText) : rawText
    } catch {
      parsedRaw = extractJsonBlock(rawText)
    }

    const validated = BodyScanPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Body scan validation failed: ${validated.error.message}`)
    }

    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0
    const costUsd = computeScanCost('google', model, inputTokens, outputTokens)

    return {
      data: validated.data,
      meta: {
        provider: 'google',
        model,
        inputTokens,
        outputTokens,
        costUsd,
        promptVersion: BODY_SCAN_PROMPT_VERSION,
      },
    }
  }
}
