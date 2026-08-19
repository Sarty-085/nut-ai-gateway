import { readFileSync, existsSync } from 'node:fs'
import type { ProviderId } from '@nutai/prompt'
import { cheapestModel } from '@nutai/prompt'
import type { GatewayConfig, GatewayTask, ProviderResourceConfig, RateLimitConfig } from './types.js'

const ALL_TASKS: GatewayTask[] = [
  'food-analysis',
  'label-scan',
  'receipt-scan',
  'web-lookup',
  'exercise-estimate',
  'body-scan',
]

/**
 * Build default model mapping per provider using existing prompt package definitions.
 */
function buildDefaultModels(env: Record<string, string | undefined>): Record<ProviderId, Record<GatewayTask, string>> {
  const gCheap = cheapestModel('google').id
  const aCheap = cheapestModel('anthropic').id
  const oCheap = cheapestModel('openai').id

  return {
    google: {
      'food-analysis': env['MODEL_FOOD_ANALYSIS'] ?? env['GOOGLE_VISION_MODEL'] ?? gCheap,
      'label-scan': env['MODEL_LABEL_SCAN'] ?? env['GOOGLE_LABEL_MODEL'] ?? env['GOOGLE_VISION_MODEL'] ?? gCheap,
      'receipt-scan': env['MODEL_RECEIPT_SCAN'] ?? env['GOOGLE_RECEIPT_MODEL'] ?? env['GOOGLE_VISION_MODEL'] ?? gCheap,
      'web-lookup': env['MODEL_WEB_LOOKUP'] ?? env['GOOGLE_LOOKUP_MODEL'] ?? env['GOOGLE_VISION_MODEL'] ?? gCheap,
      'exercise-estimate': env['MODEL_EXERCISE_ESTIMATE'] ?? env['GOOGLE_EXERCISE_MODEL'] ?? gCheap,
      'body-scan': env['MODEL_BODY_SCAN'] ?? env['GOOGLE_VISION_MODEL'] ?? gCheap,
    },
    anthropic: {
      'food-analysis': env['ANTHROPIC_VISION_MODEL'] ?? aCheap,
      'label-scan': env['ANTHROPIC_LABEL_MODEL'] ?? env['ANTHROPIC_VISION_MODEL'] ?? aCheap,
      'receipt-scan': env['ANTHROPIC_RECEIPT_MODEL'] ?? env['ANTHROPIC_VISION_MODEL'] ?? aCheap,
      'web-lookup': env['ANTHROPIC_LOOKUP_MODEL'] ?? env['ANTHROPIC_VISION_MODEL'] ?? aCheap,
      'exercise-estimate': env['ANTHROPIC_EXERCISE_MODEL'] ?? aCheap,
      'body-scan': env['ANTHROPIC_BODY_MODEL'] ?? env['ANTHROPIC_VISION_MODEL'] ?? aCheap,
    },
    openai: {
      'food-analysis': env['OPENAI_VISION_MODEL'] ?? oCheap,
      'label-scan': env['OPENAI_LABEL_MODEL'] ?? env['OPENAI_VISION_MODEL'] ?? oCheap,
      'receipt-scan': env['OPENAI_RECEIPT_MODEL'] ?? env['OPENAI_VISION_MODEL'] ?? oCheap,
      'web-lookup': env['OPENAI_LOOKUP_MODEL'] ?? env['OPENAI_VISION_MODEL'] ?? oCheap,
      'exercise-estimate': env['OPENAI_EXERCISE_MODEL'] ?? oCheap,
      'body-scan': env['OPENAI_BODY_MODEL'] ?? env['OPENAI_VISION_MODEL'] ?? oCheap,
    },
  }
}

/**
 * Auto-discover resources from environment variables.
 * For example:
 * GOOGLE_API_KEY_1, GOOGLE_API_KEY_2 -> google-01, google-02
 * ANTHROPIC_API_KEY_1, ANTHROPIC_API_KEY_2 -> anthropic-01, anthropic-02
 * OPENAI_API_KEY_1, OPENAI_API_KEY_2 -> openai-01, openai-02
 */
function discoverResourcesFromEnv(env: Record<string, string | undefined>): ProviderResourceConfig[] {
  const resources: ProviderResourceConfig[] = []

  const providers: ProviderId[] = ['google', 'anthropic', 'openai']
  for (const provider of providers) {
    const prefix = provider.toUpperCase()

    // Check single default key: e.g. GOOGLE_API_KEY
    const singleVar = `${prefix}_API_KEY`
    if (env[singleVar] && env[singleVar]?.trim().length) {
      resources.push({
        id: `${provider}-default`,
        provider,
        secretEnv: singleVar,
        secretValue: env[singleVar]!.trim(),
        enabled: true,
        priority: 1,
        capabilities: [...ALL_TASKS],
      })
    }

    // Check numbered keys: e.g. GOOGLE_API_KEY_1, GOOGLE_API_KEY_2, etc. (up to 20)
    for (let i = 1; i <= 20; i++) {
      const varName = `${prefix}_API_KEY_${i}`
      if (env[varName] && env[varName]?.trim().length) {
        resources.push({
          id: `${provider}-${String(i).padStart(2, '0')}`,
          provider,
          secretEnv: varName,
          secretValue: env[varName]!.trim(),
          enabled: true,
          priority: i,
          capabilities: [...ALL_TASKS],
        })
      }
    }
  }

  return resources
}

export function loadEnvFile(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const merged = { ...env }
  const possiblePaths = ['.env', '../../.env', '../.env', 'apps/gateway/.env']
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8')
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim()
            let val = trimmed.slice(eqIdx + 1).trim()
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1)
            }
            merged[key] = val
            process.env[key] = val
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }
  return merged
}

/**
 * Load complete gateway configuration from environment variables.
 */
export function loadGatewayConfig(rawEnv: Record<string, string | undefined> = process.env): GatewayConfig {
  const env = loadEnvFile(rawEnv)
  const port = parseInt(env['PORT'] ?? '3000', 10)
  const host = env['HOST'] ?? '0.0.0.0'

  const adminToken = env['ADMIN_TOKEN'] ?? 'nutai-admin-secret-change-in-production'

  const appTokenRaw = env['APP_TOKENS'] ?? 'nutai-app-default-token'
  const appTokens = new Set(
    appTokenRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  )

  const revokedTokensRaw = env['REVOKED_TOKENS'] ?? ''
  const revokedTokens = new Set(
    revokedTokensRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  )

  const providerOrderRaw = env['AI_PROVIDER_ORDER'] ?? 'google,anthropic,openai'
  const providerOrder = providerOrderRaw
    .split(',')
    .map((p) => p.trim().toLowerCase() as ProviderId)
    .filter((p): p is ProviderId => p === 'google' || p === 'anthropic' || p === 'openai')

  let resources: ProviderResourceConfig[] = []

  // 1. Check GATEWAY_RESOURCES_JSON
  if (env['GATEWAY_RESOURCES_JSON']) {
    try {
      resources = JSON.parse(env['GATEWAY_RESOURCES_JSON'])
    } catch {
      console.warn('[gateway] Failed to parse GATEWAY_RESOURCES_JSON')
    }
  }

  // 2. Check GATEWAY_RESOURCES_FILE
  if (resources.length === 0 && env['GATEWAY_RESOURCES_FILE']) {
    const filePath = env['GATEWAY_RESOURCES_FILE']
    if (existsSync(filePath)) {
      try {
        resources = JSON.parse(readFileSync(filePath, 'utf8'))
      } catch {
        console.warn(`[gateway] Failed to parse GATEWAY_RESOURCES_FILE at ${filePath}`)
      }
    }
  }

  // 3. Fallback to discovery from env
  if (resources.length === 0) {
    resources = discoverResourcesFromEnv(env)
  }

  const defaultModels = buildDefaultModels(env)

  const rateLimits: RateLimitConfig = {
    perTokenPerMinute: parseInt(env['RATE_LIMIT_PER_MIN_PER_TOKEN'] ?? '30', 10),
    perTokenDaily: parseInt(env['RATE_LIMIT_DAILY_PER_TOKEN'] ?? '500', 10),
    globalPerMinute: parseInt(env['RATE_LIMIT_GLOBAL_PER_MIN'] ?? '300', 10),
    dailyCostCapUsd: env['DAILY_COST_CAP_USD'] ? parseFloat(env['DAILY_COST_CAP_USD']) : undefined,
  }

  return {
    port,
    host,
    adminToken,
    appTokens,
    revokedTokens,
    resources,
    providerOrder,
    defaultModels,
    requestTimeoutMs: parseInt(env['REQUEST_TIMEOUT_MS'] ?? '45000', 10),
    maxTransientRetries: parseInt(env['MAX_TRANSIENT_RETRIES'] ?? '2', 10),
    retryBackoffBaseMs: parseInt(env['RETRY_BACKOFF_BASE_MS'] ?? '500', 10),
    rateLimits,
    dedupWindowMs: parseInt(env['DEDUP_WINDOW_MS'] ?? '10000', 10),
  }
}
