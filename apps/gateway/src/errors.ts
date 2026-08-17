/**
 * Explicit gateway error hierarchy for robust classification and failover decisions.
 */

export type GatewayErrorCode =
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_OUTAGE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SCHEMA_VIOLATION'
  | 'CONTENT_REFUSAL'
  | 'CONFIG_ERROR'
  | 'NO_ELIGIBLE_RESOURCE'
  | 'BUDGET_EXCEEDED'

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly httpStatus: number = 500,
    public readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export class AuthenticationError extends GatewayError {
  constructor(message = 'Invalid application authentication token') {
    super('AUTH_FAILED', message, false, 401)
  }
}

export class ForbiddenError extends GatewayError {
  constructor(message = 'Access denied: token has been revoked or lacks required permissions') {
    super('FORBIDDEN', message, false, 403)
  }
}

export class InvalidRequestError extends GatewayError {
  constructor(message: string) {
    super('INVALID_REQUEST', message, false, 400)
  }
}

export class RateLimitError extends GatewayError {
  constructor(message = 'Rate limit reached. Please try again shortly.', public readonly retryAfterSeconds?: number) {
    super('RATE_LIMITED', message, true, 429)
  }
}

export class QuotaExhaustedError extends GatewayError {
  constructor(message = 'Provider account quota exhausted.') {
    super('QUOTA_EXHAUSTED', message, false, 402)
  }
}

export class ModelUnavailableError extends GatewayError {
  constructor(message = 'Configured model is unavailable for this provider resource.') {
    super('MODEL_UNAVAILABLE', message, false, 404)
  }
}

export class ProviderOutageError extends GatewayError {
  constructor(message = 'Provider service unavailable or server error.', httpStatus = 503) {
    super('PROVIDER_OUTAGE', message, true, httpStatus)
  }
}

export class TimeoutError extends GatewayError {
  constructor(message = 'The upstream provider request timed out.') {
    super('TIMEOUT', message, true, 504)
  }
}

export class SchemaViolationError extends GatewayError {
  constructor(message = 'Provider response violated schema contract.') {
    super('SCHEMA_VIOLATION', message, true, 502)
  }
}

export class NoEligibleResourceError extends GatewayError {
  constructor(task: string, message = `No healthy, compatible provider resources available for task: ${task}`) {
    super('NO_ELIGIBLE_RESOURCE', message, true, 503)
  }
}

export class BudgetExceededError extends GatewayError {
  constructor(message = 'Gateway usage ceiling has been reached.') {
    super('BUDGET_EXCEEDED', message, false, 429)
  }
}

/**
 * Classify HTTP response from an upstream provider into structured GatewayError.
 */
export function classifyUpstreamError(status: number, body: string): GatewayError {
  if (status === 401 || status === 403) {
    return new GatewayError('AUTH_FAILED', 'Provider rejected authentication credentials.', false, status)
  }
  if (status === 402) {
    return new QuotaExhaustedError('Provider account has exhausted its quota or credits.')
  }
  if (status === 404) {
    return new ModelUnavailableError('Requested model is not found or not enabled on provider resource.')
  }
  if (status === 429) {
    const match = body.match(/retry[- ]after[:= ]*(\d+)/i)
    const retrySec = match && match[1] ? parseInt(match[1], 10) : undefined
    return new RateLimitError('Provider returned rate limit (429).', retrySec)
  }
  if (status >= 500) {
    return new ProviderOutageError(`Provider server error (HTTP ${status}).`, status)
  }
  if (/refus|safety|policy|blocked/i.test(body)) {
    return new GatewayError('CONTENT_REFUSAL', 'The provider declined to process this content.', false, status)
  }
  return new GatewayError('PROVIDER_OUTAGE', `Unexpected provider response (HTTP ${status}).`, true, status)
}
