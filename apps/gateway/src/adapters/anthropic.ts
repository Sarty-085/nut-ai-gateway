import {
  anthropicWireSchema,
  BODY_SCAN_PROMPT_VERSION,
  buildAnthropicRequest,
  buildBodyScanRequest,
  buildExerciseEstimateInstruction,
  buildLabelScanRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupRequest,
  computeScanCost,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
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

export class AnthropicAdapter implements ProviderAdapter {
  public readonly provider = 'anthropic' as const

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
        throw new TimeoutError('Anthropic Claude request timed out.')
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
      throw new InvalidRequestError('Anthropic resource has no API key configured')
    }
    const timeoutMs = req.timeoutMs ?? 45_000
    const localSignalsBlock = req.fixBlock ? req.fixBlock : req.localSignalsBlock ?? ''

    const built = buildAnthropicRequest(
      {
        model,
        imagesBase64: req.imagesBase64,
        localSignalsBlock,
        jsonSchema: anthropicWireSchema(VISION_WIRE_SCHEMA),
      },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const rawContent = json?.content?.[0]?.text
    if (!rawContent) {
      throw new SchemaViolationError('Anthropic returned no text block')
    }

    let parsedRaw: unknown
    try {
      parsedRaw = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent
    } catch {
      parsedRaw = extractJsonBlock(rawContent)
    }

    const validated = VisionPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Anthropic response failed VisionPayload schema: ${validated.error.message}`)
    }

    const inputTokens = json.usage?.input_tokens ?? 0
    const outputTokens = json.usage?.output_tokens ?? 0
    const costUsd = computeScanCost('anthropic', model, inputTokens, outputTokens)

    return {
      data: validated.data,
      meta: {
        provider: 'anthropic',
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
      'anthropic',
      { model, imageBase64: req.imageBase64 },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const texts = (json?.content ?? []).filter((b: any) => b?.type === 'text')
    const out = texts.length ? texts[texts.length - 1].text : null
    if (!out) {
      throw new SchemaViolationError('Anthropic returned no text for label scan')
    }

    const parsedRaw = extractJsonBlock(out)
    const validated = LabelPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Label scan validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'anthropic',
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
      'anthropic',
      { model, imageBase64: req.imageBase64 },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const texts = (json?.content ?? []).filter((b: any) => b?.type === 'text')
    const out = texts.length ? texts[texts.length - 1].text : null
    if (!out) {
      throw new SchemaViolationError('Anthropic returned no text for receipt scan')
    }

    const parsedRaw = extractJsonBlock(out)
    const validated = ReceiptPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Receipt scan validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'anthropic',
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
      'anthropic',
      {
        model,
        itemName: req.itemName,
        brand: req.brand ?? null,
        visualContext: req.visualContext ?? null,
      },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const texts = (json?.content ?? []).filter((b: any) => b?.type === 'text')
    const out = texts.length ? texts[texts.length - 1].text : null
    if (!out) {
      throw new SchemaViolationError('Anthropic returned no text in web search response')
    }

    const parsedRaw = extractJsonBlock(out)
    const validated = WebLookupResultZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Web lookup validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'anthropic',
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
      'anthropic',
      {
        model,
        instruction: buildExerciseEstimateInstruction(req.description, req.weightKg ?? null),
      },
      { kind: 'api_key', value: resource.resolvedSecret },
      EXERCISE_ESTIMATE_PROMPT_VERSION,
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const texts = (json?.content ?? []).filter((b: any) => b?.type === 'text')
    const out = texts.length ? texts[texts.length - 1].text : null
    if (!out) {
      throw new SchemaViolationError('Anthropic returned no text for exercise estimation')
    }

    const parsedRaw = extractJsonBlock(out)
    const validated = ExerciseEstimateZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Exercise estimate validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'anthropic',
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
    const credential = {
      kind: resource.resolvedSecret.startsWith('sk-ant-') ? ('api_key' as const) : ('oauth' as const),
      value: resource.resolvedSecret,
    }
    const built = buildBodyScanRequest(
      'anthropic',
      {
        model,
        imageBase64: req.imageBase64,
        localSignalsBlock: req.localSignalsBlock,
      },
      credential,
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const texts = (json?.content ?? []).filter((b: any) => b?.type === 'text')
    const out = texts.length ? texts[texts.length - 1].text : null
    if (!out) {
      throw new SchemaViolationError('Anthropic returned no text content for body scan')
    }

    let parsedRaw: unknown
    try {
      parsedRaw = typeof out === 'string' ? JSON.parse(out) : out
    } catch {
      parsedRaw = extractJsonBlock(out)
    }

    const validated = BodyScanPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Body scan validation failed: ${validated.error.message}`)
    }

    const inputTokens = json.usage?.input_tokens ?? 0
    const outputTokens = json.usage?.output_tokens ?? 0
    const costUsd = computeScanCost('anthropic', model, inputTokens, outputTokens)

    return {
      data: validated.data,
      meta: {
        provider: 'anthropic',
        model,
        inputTokens,
        outputTokens,
        costUsd,
        promptVersion: BODY_SCAN_PROMPT_VERSION,
      },
    }
  }
}
