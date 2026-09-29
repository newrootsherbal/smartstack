import { describe, expect, it } from 'vitest'
import { api } from '../api'
import type { Env } from '../env'

// Only the paths that answer before touching D1: the launch gate and the missing session.
const env = (mode: string) => ({ ACCOUNTS_MODE: mode }) as unknown as Env

describe('/api/lookup routes', () => {
  it.each(['/api/lookup/npn/80000001', '/api/lookup/din/02172062'])(
    'answer 404 while ACCOUNTS_MODE is off (%s)',
    async (path) => {
      const res = await api.request(path, {}, env('off'))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
      expect(res.headers.get('cache-control')).toBe('no-store')
    },
  )

  it('require a session', async () => {
    const res = await api.request('/api/lookup/npn/80000001', {}, env('public'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})
