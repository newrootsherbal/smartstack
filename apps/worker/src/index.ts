import { Hono } from 'hono'

export interface Env {
  ASSETS: Fetcher
  VAPID_PUBLIC_KEY: string
  VAPID_SUBJECT: string
  MAX_PUSHES_PER_TICK: string
  BETA_KEY: string
}

// /api/* is handled by hono; everything else is a static asset (or the SPA
// fallback) served by the assets binding. Routes are filled in during the
// Worker milestone.
const api = new Hono<{ Bindings: Env }>().basePath('/api')

api.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }))

api.notFound((c) => c.json({ error: 'not_found' }, 404))

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return api.fetch(request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
