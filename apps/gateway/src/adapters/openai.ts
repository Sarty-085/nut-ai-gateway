import {
  buildExerciseEstimateInstruction,
  buildLabelScanRequest,
  buildOpenAIRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupRequest,
  computeScanCost,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
  LABEL_SCAN_PROMPT_VERSION,
  openAiWireSchema,
  RECEIPT_SCAN_PROMPT_VERSION,
} from '@nutai/prompt'
import {
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
  ExerciseEstimateGatewayRequest,
  LabelScanGatewayRequest,
  ProviderResource,
  ReceiptScanGatewayRequest,
  WebLookupGatewayRequest,
} from '../types.js'
import { type AdapterExecutionResult, extractJsonBlock, type ProviderAdapter } from './base.js'

export class OpenAIAdapter implements ProviderAdapter {
  public readonly provider = 'openai' as const

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
        throw new TimeoutError('OpenAI request timed out.')
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
      throw new InvalidRequestError('OpenAI resource has no API key configured')
    }
    const timeoutMs = req.timeoutMs ?? 45_000
    const localSignalsBlock = req.fixBlock ? req.fixBlock : req.localSignalsBlock ?? ''

    const built = buildOpenAIRequest(
      {
        model,
        imagesBase64: req.imagesBase64,
        localSignalsBlock,
        jsonSchema: openAiWireSchema(VISION_WIRE_SCHEMA),
      },
      resource.resolvedSecret,
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const rawContent = json?.choices?.[0]?.message?.content
    if (!rawContent) {
      throw new SchemaViolationError('OpenAI returned no choices message content')
    }

    let parsedRaw: unknown
    try {
      parsedRaw = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent
    } catch {
      parsedRaw = extractJsonBlock(rawContent)
    }

    const validated = VisionPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`OpenAI response failed VisionPayload schema: ${validated.error.message}`)
    }

    const inputTokens = json.usage?.prompt_tokens ?? 0
    const outputTokens = json.usage?.completion_tokens ?? 0
    const costUsd = computeScanCost('openai', model, inputTokens, outputTokens)

    return {
      data: validated.data,
      meta: {
        provider: 'openai',
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
      'openai',
      { model, imageBase64: req.imageBase64 },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      throw new SchemaViolationError('OpenAI returned no content for label scan')
    }

    const parsedRaw = extractJsonBlock(content)
    const validated = LabelPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Label scan validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'openai',
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
      'openai',
      { model, imageBase64: req.imageBase64 },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      throw new SchemaViolationError('OpenAI returned no content for receipt scan')
    }

    const parsedRaw = extractJsonBlock(content)
    const validated = ReceiptPayloadZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Receipt scan validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'openai',
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
      'openai',
      {
        model,
        itemName: req.itemName,
        brand: req.brand ?? null,
        visualContext: req.visualContext ?? null,
      },
      { kind: 'api_key', value: resource.resolvedSecret },
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    // OpenAI Responses API structure
    const msg = (json?.output ?? []).find((o: any) => o?.type === 'message')
    const out = msg?.content?.map((c: any) => c?.text ?? '').join('') ?? json?.output_text ?? json?.choices?.[0]?.message?.content
    if (!out) {
      throw new SchemaViolationError('OpenAI returned no text in responses output')
    }

    const parsedRaw = extractJsonBlock(out)
    const validated = WebLookupResultZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Web lookup validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'openai',
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
      'openai',
      {
        model,
        instruction: buildExerciseEstimateInstruction(req.description, req.weightKg ?? null),
      },
      { kind: 'api_key', value: resource.resolvedSecret },
      EXERCISE_ESTIMATE_PROMPT_VERSION,
    )

    const { json } = await this.fetchJson(built.url, built.headers, built.body, timeoutMs, fetchImpl)

    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      throw new SchemaViolationError('OpenAI returned no content for exercise estimation')
    }

    const parsedRaw = extractJsonBlock(content)
    const validated = ExerciseEstimateZ.safeParse(parsedRaw)
    if (!validated.success) {
      throw new SchemaViolationError(`Exercise estimate validation failed: ${validated.error.message}`)
    }

    return {
      data: validated.data,
      meta: {
        provider: 'openai',
        model,
        promptVersion: EXERCISE_ESTIMATE_PROMPT_VERSION,
      },
    }
  }
}
