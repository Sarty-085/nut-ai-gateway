import { checkGatewayHealth, type GatewayHealthStatus } from '../gateway-config'
import type { Credential, ScanFailure } from './client'

/**
 * Gateway Connectivity & Access Validation.
 *
 * In the private AI gateway architecture, the mobile client tests connectivity
 * to the private gateway rather than probing vendor APIs directly.
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

/**
 * Backwards compatibility helper for existing callers.
 */
export async function validateCredential(
  _provider: string,
  _model: string,
  _credential: Credential,
  fetchImpl: typeof fetch = fetch,
  _timeoutMs = 15_000,
): Promise<ValidationResult> {
  return validateGateway(undefined, fetchImpl)
}
