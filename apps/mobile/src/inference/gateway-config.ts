const GATEWAY_URL_KEY = 'nutai.gateway.url'
const GATEWAY_APP_TOKEN_KEY = 'nutai.gateway.token'
const GATEWAY_ADMIN_TOKEN_KEY = 'nutai.gateway.admin_token'

export const DEFAULT_GATEWAY_URL =
  process.env['EXPO_PUBLIC_GATEWAY_URL'] || 'http://10.0.2.2:3000'

export const DEFAULT_APP_TOKEN =
  process.env['EXPO_PUBLIC_APP_TOKEN'] || 'nutai-app-default-token'

const memoryStore = new Map<string, string>()

async function getSecureItem(key: string): Promise<string | null> {
  try {
    const mod = await import('expo-secure-store')
    const val = await mod.getItemAsync(key)
    return val
  } catch {
    return memoryStore.get(key) ?? null
  }
}

async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    const mod = await import('expo-secure-store')
    await mod.setItemAsync(key, value)
  } catch {
    memoryStore.set(key, value)
  }
}

async function deleteSecureItem(key: string): Promise<void> {
  try {
    const mod = await import('expo-secure-store')
    await mod.deleteItemAsync(key)
  } catch {
    memoryStore.delete(key)
  }
}

export async function getGatewayUrl(): Promise<string> {
  const saved = await getSecureItem(GATEWAY_URL_KEY)
  return saved?.trim() || DEFAULT_GATEWAY_URL
}

export async function setGatewayUrl(url: string): Promise<void> {
  if (!url.trim()) {
    await deleteSecureItem(GATEWAY_URL_KEY)
  } else {
    await setSecureItem(GATEWAY_URL_KEY, url.trim())
  }
}

export async function getAppToken(): Promise<string> {
  const saved = await getSecureItem(GATEWAY_APP_TOKEN_KEY)
  return saved?.trim() || DEFAULT_APP_TOKEN
}

export async function setAppToken(token: string): Promise<void> {
  if (!token.trim()) {
    await deleteSecureItem(GATEWAY_APP_TOKEN_KEY)
  } else {
    await setSecureItem(GATEWAY_APP_TOKEN_KEY, token.trim())
  }
}

export async function getAdminToken(): Promise<string | null> {
  return getSecureItem(GATEWAY_ADMIN_TOKEN_KEY)
}

export async function setAdminToken(token: string | null): Promise<void> {
  if (!token) {
    await deleteSecureItem(GATEWAY_ADMIN_TOKEN_KEY)
  } else {
    await setSecureItem(GATEWAY_ADMIN_TOKEN_KEY, token.trim())
  }
}

export interface GatewayHealthStatus {
  ok: boolean
  status: 'online' | 'degraded' | 'offline'
  activeResources?: number
  totalResources?: number
  version?: string
  latencyMs?: number
  error?: string
}

export async function checkGatewayHealth(
  gatewayUrl?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayHealthStatus> {
  const url = (gatewayUrl || (await getGatewayUrl())).replace(/\/+$/, '')
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)

  try {
    const res = await fetchImpl(`${url}/v1/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      return { ok: false, status: 'offline', latencyMs, error: `Gateway returned HTTP ${res.status}` }
    }
    const json = (await res.json()) as Record<string, any>
    return {
      ok: true,
      status: json['status'] === 'online' ? 'online' : 'degraded',
      activeResources: json['activeResources'] ?? 0,
      totalResources: json['totalResources'] ?? 0,
      version: json['version'] ?? '1.0.0',
      latencyMs,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - started
    return {
      ok: false,
      status: 'offline',
      latencyMs,
      error: err.name === 'AbortError' ? 'Connection timed out' : 'Could not connect to Gateway',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchAdminStatus(
  gatewayUrl?: string,
  adminToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const url = (gatewayUrl || (await getGatewayUrl())).replace(/\/+$/, '')
  const token = adminToken || (await getAdminToken())
  if (!token) {
    return { ok: false, error: 'No admin token configured' }
  }

  try {
    const res = await fetchImpl(`${url}/v1/admin/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      return { ok: false, error: `Admin access rejected (HTTP ${res.status})` }
    }
    const data = await res.json()
    return { ok: true, data }
  } catch (err: any) {
    return { ok: false, error: String(err.message ?? err) }
  }
}
