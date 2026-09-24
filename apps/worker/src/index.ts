import { api } from './api'
import { runTick } from './cron'
import type { Env } from './env'

export type { Env }

// /api/* is handled by hono; everything else is a static asset (or the SPA
// fallback) served by the assets binding.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return api.fetch(request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },

  async scheduled(_controller, env, ctx) {
    // Wall clock captured once, here (not controller.scheduledTime).
    const now = Date.now()
    ctx.waitUntil(runTick(env, now))
  },
} satisfies ExportedHandler<Env>
