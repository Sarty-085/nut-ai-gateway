import type { ProviderId } from '@nutai/prompt'

/** Supported perception / task types */
export type GatewayTask =
  | 'food-analysis'
  | 'label-scan'
  | 'receipt-scan'
  | 'web-lookup'
  | 'exercise-estimate'

export type TaskCapability = GatewayTask

/** Health states for a provider resource */
export type ResourceHealthState =
  | 'healthy'
  | 'degraded'
  | 'cooldown'
  | 'disabled'
  | 'auth_error'

/**
 * ProviderResource definition.
 * A separately configurable provider resource (project / key / credential).
 */
export interface ProviderResourceConfig {
  /** Unique human-readable resource ID, e.g. "google-01", "anthropic-primary" */
  id: string
  /** Provider identifier */
  provider: ProviderId
  /** Environment variable name containing the secret (e.g. "GOOGLE_KEY_01") or direct placeholder */
  secretEnv?: string
  /** Direct secret value if configured directly (never logged or sent to clients) */
  secretValue?: string
  /** Whether this resource is administratively enabled */
  enabled: boolean
  /** Priority score (lower number = higher priority, e.g. 1 is tried before 2) */
  priority: number
  /** Supported task capabilities */
  capabilities: TaskCapability[]
  /** Configured models for tasks or override models */
  models?: Partial<Record<GatewayTask, string>> & { default?: string }
  /** Optional custom cooldown duration in ms (default: 30,000 ms) */
  cooldownDurationMs?: number
  /** Optional max consecutive failures before entering degraded/cooldown state */
  maxConsecutiveFailures?: number
}

export interface ProviderResource extends ProviderResourceConfig {
  /** Resolved secret value from environment / secret store */
  resolvedSecret: string
}

/** Operational telemetry for a resource (safe to display, secrets stripped) */
export interface ResourceTelemetry {
  id: string
  provider: ProviderId
  enabled: boolean
  priority: number
  capabilities: TaskCapability[]
  healthState: ResourceHealthState
  cooldownUntil: number | null
  consecutiveFailures: number
  totalRequests: number
  totalSuccesses: number
  totalFailures: number
  totalFailovers: number
  avgLatencyMs: number
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastErrorReason: string | null
}

/** Rate limit and budget protection configuration */
export interface RateLimitConfig {
  /** Requests allowed per minute per token / device */
  perTokenPerMinute: number
  /** Requests allowed per day per token / device */
  perTokenDaily: number
  /** Global gateway requests allowed per minute */
  globalPerMinute: number
  /** Optional daily estimated dollar ceiling for the entire gateway */
  dailyCostCapUsd?: number | undefined
}

/** Gateway configuration */
export interface GatewayConfig {
  /** Port the gateway listens on */
  port: number
  /** Host address to bind */
  host: string
  /** Admin secret token for /v1/admin/* endpoints */
  adminToken: string
  /** Allowed client application / device tokens */
  appTokens: Set<string>
  /** Revoked tokens */
  revokedTokens: Set<string>
  /** Configured provider resources */
  resources: ProviderResourceConfig[]
  /** Default provider priority order (e.g. ['google', 'anthropic', 'openai']) */
  providerOrder: ProviderId[]
  /** Default models per task per provider */
  defaultModels: Record<ProviderId, Record<GatewayTask, string>>
  /** Request timeout in ms */
  requestTimeoutMs: number
  /** Max retries for transient errors */
  maxTransientRetries: number
  /** Base retry delay ms */
  retryBackoffBaseMs: number
  /** Rate limit configuration */
  rateLimits: RateLimitConfig
  /** Deduplication window in ms */
  dedupWindowMs: number
}

/** Normalized metadata returned to mobile client (zero secrets) */
export interface NormalizedResponseMeta {
  provider: ProviderId
  model: string
  resourceId: string
  requestId: string
  latencyMs: number
  failoverCount: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  promptVersion?: string
}

/** Common client request options */
export interface BaseGatewayRequest {
  requestId?: string
  timeoutMs?: number
  preferredProvider?: ProviderId
  preferredModel?: string
}

/** Food analysis (meal scan) request */
export interface AnalyzeGatewayRequest extends BaseGatewayRequest {
  imagesBase64: string[]
  localSignalsBlock?: string
  fixBlock?: string
  keepFraction?: number
}

/** Label scan request */
export interface LabelScanGatewayRequest extends BaseGatewayRequest {
  imageBase64: string
}

/** Receipt scan request */
export interface ReceiptScanGatewayRequest extends BaseGatewayRequest {
  imageBase64: string
}

/** Web lookup request */
export interface WebLookupGatewayRequest extends BaseGatewayRequest {
  itemName: string
  brand?: string | null
  visualContext?: string | null
}

/** Exercise estimate request */
export interface ExerciseEstimateGatewayRequest extends BaseGatewayRequest {
  description: string
  weightKg?: number | null
}

/** Generic gateway outcome */
export interface GatewayResponse<T> {
  ok: boolean
  data?: T
  meta?: NormalizedResponseMeta
  error?: {
    code: string
    message: string
    retryable: boolean
    httpStatus?: number
  }
}
