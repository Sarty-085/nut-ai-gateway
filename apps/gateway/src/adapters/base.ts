import type { ProviderId } from '@nutai/prompt'
import type {
  AnalyzeGatewayRequest,
  ExerciseEstimateGatewayRequest,
  LabelScanGatewayRequest,
  NormalizedResponseMeta,
  ProviderResource,
  ReceiptScanGatewayRequest,
  WebLookupGatewayRequest,
} from '../types.js'

export interface AdapterExecutionResult<T = unknown> {
  data: T
  meta: Omit<NormalizedResponseMeta, 'resourceId' | 'requestId' | 'latencyMs' | 'failoverCount'>
}

export interface ProviderAdapter {
  readonly provider: ProviderId

  analyze(
    resource: ProviderResource,
    model: string,
    req: AnalyzeGatewayRequest,
    fetchImpl?: typeof fetch,
  ): Promise<AdapterExecutionResult>

  labelScan(
    resource: ProviderResource,
    model: string,
    req: LabelScanGatewayRequest,
    fetchImpl?: typeof fetch,
  ): Promise<AdapterExecutionResult>

  receiptScan(
    resource: ProviderResource,
    model: string,
    req: ReceiptScanGatewayRequest,
    fetchImpl?: typeof fetch,
  ): Promise<AdapterExecutionResult>

  webLookup(
    resource: ProviderResource,
    model: string,
    req: WebLookupGatewayRequest,
    fetchImpl?: typeof fetch,
  ): Promise<AdapterExecutionResult>

  exerciseEstimate(
    resource: ProviderResource,
    model: string,
    req: ExerciseEstimateGatewayRequest,
    fetchImpl?: typeof fetch,
  ): Promise<AdapterExecutionResult>
}

export function extractJsonBlock(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/g, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('No JSON object found in provider response')
  }
  return JSON.parse(fenced.slice(start, end + 1))
}
