import dns from 'node:dns'

try {
  dns.setDefaultResultOrder('ipv4first')
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])
} catch {
  // Ignore fallback
}

export * from './types.js'
export * from './errors.js'
export * from './config.js'
export * from './rate-limiter.js'
export * from './dedup.js'
export * from './health-tracker.js'
export * from './router.js'
export * from './adapters/base.js'
export * from './adapters/google.js'
export * from './adapters/anthropic.js'
export * from './adapters/openai.js'
export * from './server.js'

// Direct execution entrypoint
import { fileURLToPath } from 'node:url'
import { GatewayServer } from './server.js'

const isMainModule =
  process.env['NUTAI_GATEWAY_STANDALONE'] === 'true' ||
  (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) ||
  process.argv[1]?.includes('apps/gateway') ||
  process.argv[1]?.includes('apps\\gateway')

if (isMainModule) {
  const server = new GatewayServer()
  void server.start()
}
