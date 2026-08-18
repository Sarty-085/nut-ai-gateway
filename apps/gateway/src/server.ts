import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { loadEnvFile, loadGatewayConfig } from './config.js'
import { RequestDeduplicator } from './dedup.js'
import { AuthenticationError, ForbiddenError, InvalidRequestError } from './errors.js'
import { ResourceHealthTracker } from './health-tracker.js'
import { GatewayRateLimiter } from './rate-limiter.js'
import { ProviderRouter } from './router.js'
import type { GatewayConfig } from './types.js'

export class GatewayServer {
  public readonly config: GatewayConfig
  public readonly healthTracker: ResourceHealthTracker
  public readonly rateLimiter: GatewayRateLimiter
  public readonly dedup: RequestDeduplicator
  public readonly router: ProviderRouter
  private server: Server | null = null

  constructor(customConfig?: Partial<GatewayConfig>, env: Record<string, string | undefined> = process.env) {
    const loadedEnv = loadEnvFile(env)
    const loaded = loadGatewayConfig(loadedEnv)
    this.config = { ...loaded, ...customConfig }
    this.healthTracker = new ResourceHealthTracker(this.config.resources, loadedEnv)
    this.rateLimiter = new GatewayRateLimiter(this.config.rateLimits)
    this.dedup = new RequestDeduplicator(this.config.dedupWindowMs)
    this.router = new ProviderRouter(this.config, this.healthTracker, this.rateLimiter)
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data)
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-nutai-app-token, x-admin-token, x-idempotency-key, Idempotency-Key',
    })
    res.end(body)
  }

  private async parseBody<T = any>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 25 * 1024 * 1024) {
          // 25MB limit for images
          req.destroy()
          reject(new InvalidRequestError('Request payload too large'))
        }
      })
      req.on('end', () => {
        if (!data.trim()) {
          resolve({} as T)
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new InvalidRequestError('Malformed JSON payload'))
        }
      })
      req.on('error', (err) => reject(err))
    })
  }

  private authenticateApp(req: IncomingMessage): string {
    const authHeader = req.headers['authorization']
    const appTokenHeader = req.headers['x-nutai-app-token'] as string | undefined

    let token = ''
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim()
    } else if (appTokenHeader) {
      token = appTokenHeader.trim()
    }

    if (!token) {
      throw new AuthenticationError('Missing application authentication token')
    }

    if (this.config.revokedTokens.has(token)) {
      throw new ForbiddenError('Application token has been revoked')
    }

    if (!this.config.appTokens.has(token)) {
      throw new AuthenticationError('Invalid application token')
    }

    return token
  }

  private authenticateAdmin(req: IncomingMessage): void {
    const authHeader = req.headers['authorization']
    const adminTokenHeader = req.headers['x-admin-token'] as string | undefined

    let token = ''
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim()
    } else if (adminTokenHeader) {
      token = adminTokenHeader.trim()
    }

    if (!token || token !== this.config.adminToken) {
      throw new ForbiddenError('Invalid admin authentication token')
    }
  }

  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-nutai-app-token, x-admin-token, x-idempotency-key, Idempotency-Key',
      })
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const pathname = url.pathname

    try {
      // 1. Health check (public / client liveness)
      if (req.method === 'GET' && pathname === '/v1/health') {
        const eligible = this.healthTracker.getAllResources().filter((r) => this.healthTracker.isResourceEligible(r.id))
        this.sendJson(res, 200, {
          ok: true,
          status: eligible.length > 0 ? 'online' : 'degraded',
          activeResources: eligible.length,
          totalResources: this.healthTracker.getAllResources().length,
          version: '1.0.0',
        })
        return
      }

      // 2. Admin endpoints
      if (pathname.startsWith('/v1/admin/')) {
        this.authenticateAdmin(req)

        if (req.method === 'GET' && pathname === '/v1/admin/status') {
          const telemetry = this.healthTracker.getTelemetry()
          const rateStatus = this.rateLimiter.getStatus()
          this.sendJson(res, 200, {
            ok: true,
            telemetry,
            rateLimits: rateStatus,
            providerOrder: this.config.providerOrder,
            appTokensCount: this.config.appTokens.size,
            revokedTokensCount: this.config.revokedTokens.size,
          })
          return
        }

        if (req.method === 'POST' && pathname === '/v1/admin/tokens/revoke') {
          const body = await this.parseBody<{ token: string }>(req)
          if (!body.token) throw new InvalidRequestError('Missing token to revoke')
          this.config.revokedTokens.add(body.token)
          this.sendJson(res, 200, { ok: true, message: `Token ${body.token} revoked` })
          return
        }

        const toggleMatch = pathname.match(/^\/v1\/admin\/resources\/([^/]+)\/toggle$/)
        if (req.method === 'POST' && toggleMatch && toggleMatch[1]) {
          const resourceId = toggleMatch[1]
          const body = await this.parseBody<{ enabled: boolean }>(req)
          const success = this.healthTracker.setResourceEnabled(resourceId, !!body.enabled)
          if (!success) throw new InvalidRequestError(`Resource ${resourceId} not found`)
          this.sendJson(res, 200, { ok: true, resourceId, enabled: !!body.enabled })
          return
        }

        const resetMatch = pathname.match(/^\/v1\/admin\/resources\/([^/]+)\/reset$/)
        if (req.method === 'POST' && resetMatch && resetMatch[1]) {
          const resourceId = resetMatch[1]
          const success = this.healthTracker.resetResourceHealth(resourceId)
          if (!success) throw new InvalidRequestError(`Resource ${resourceId} not found`)
          this.sendJson(res, 200, { ok: true, resourceId, message: 'Health state reset to healthy' })
          return
        }

        this.sendJson(res, 404, { ok: false, error: { message: 'Admin endpoint not found' } })
        return
      }

      // 3. Normal client perception API endpoints
      if (req.method === 'POST') {
        const token = this.authenticateApp(req)

        // Rate limit check
        const rateCheck = this.rateLimiter.checkAndRecord(token)
        if (!rateCheck.ok) {
          this.sendJson(res, 429, {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message: rateCheck.reason ?? 'Rate limit exceeded',
              retryable: true,
              retryAfterSeconds: rateCheck.retryAfterSeconds,
            },
          })
          return
        }

        const explicitIdemp = (req.headers['x-idempotency-key'] ?? req.headers['idempotency-key']) as string | undefined

        if (pathname === '/v1/analyze') {
          const body = await this.parseBody(req)
          const dedupKey = this.dedup.generateKey('food-analysis', body, explicitIdemp)
          const response = await this.dedup.executeOrShare(dedupKey, () => this.router.analyze(body))
          this.sendJson(res, response.ok ? 200 : response.error?.httpStatus ?? 500, response)
          return
        }

        if (pathname === '/v1/label-scan') {
          const body = await this.parseBody(req)
          const dedupKey = this.dedup.generateKey('label-scan', body, explicitIdemp)
          const response = await this.dedup.executeOrShare(dedupKey, () => this.router.labelScan(body))
          this.sendJson(res, response.ok ? 200 : response.error?.httpStatus ?? 500, response)
          return
        }

        if (pathname === '/v1/receipt-scan') {
          const body = await this.parseBody(req)
          const dedupKey = this.dedup.generateKey('receipt-scan', body, explicitIdemp)
          const response = await this.dedup.executeOrShare(dedupKey, () => this.router.receiptScan(body))
          this.sendJson(res, response.ok ? 200 : response.error?.httpStatus ?? 500, response)
          return
        }

        if (pathname === '/v1/web-lookup') {
          const body = await this.parseBody(req)
          const dedupKey = this.dedup.generateKey('web-lookup', body, explicitIdemp)
          const response = await this.dedup.executeOrShare(dedupKey, () => this.router.webLookup(body))
          this.sendJson(res, response.ok ? 200 : response.error?.httpStatus ?? 500, response)
          return
        }

        if (pathname === '/v1/exercise-estimate') {
          const body = await this.parseBody(req)
          const dedupKey = this.dedup.generateKey('exercise-estimate', body, explicitIdemp)
          const response = await this.dedup.executeOrShare(dedupKey, () => this.router.exerciseEstimate(body))
          this.sendJson(res, response.ok ? 200 : response.error?.httpStatus ?? 500, response)
          return
        }

        if (pathname === '/v1/body-scan') {
          const body = await this.parseBody(req)
          const dedupKey = this.dedup.generateKey('body-scan', body, explicitIdemp)
          const response = await this.dedup.executeOrShare(dedupKey, () => this.router.bodyScan(body))
          this.sendJson(res, response.ok ? 200 : response.error?.httpStatus ?? 500, response)
          return
        }
      }

      this.sendJson(res, 404, { ok: false, error: { message: 'Route not found' } })
    } catch (err: any) {
      const httpStatus = err.httpStatus ?? 500
      this.sendJson(res, httpStatus, {
        ok: false,
        error: {
          code: err.code ?? 'INTERNAL_ERROR',
          message: err.message ?? 'Internal gateway error',
          retryable: err.retryable ?? false,
        },
      })
    }
  }

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })
      this.server.listen(this.config.port, this.config.host, () => {
        const address = this.server?.address()
        const actualPort = typeof address === 'object' && address ? address.port : this.config.port
        console.log(`[gateway] Nut AI Private Gateway listening on ${this.config.host}:${actualPort}`)
        resolve(actualPort)
      })
    })
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }
}
