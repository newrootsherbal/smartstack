import { describe, expect, it } from 'vitest'
import dinSynthroidEn from './fixtures/din-02172062-en.json'
import npnMagnesiumEn from './fixtures/npn-80085063-en.json'
import { HC_USER_AGENT, hcUrls, mapNpnPrefill } from './health-canada'
import { getHcJson, LookupError, lookupDin, lookupNpn, type LookupDeps } from './service'

const ORIGIN = 'https://schedule.example.com'

/** Cache API stand-in: what `caches.default` does for match/put, in memory. */
class MemoryCache {
  entries = new Map<string, { body: string; headers: Headers }>()
  async match(key: string) {
    const entry = this.entries.get(key)
    return entry ? new Response(entry.body, { headers: entry.headers }) : undefined
  }
  async put(key: string, response: Response) {
    this.entries.set(key, { body: await response.text(), headers: response.headers })
  }
}

interface Call {
  url: string
  headers: Headers
}

function setup(answers: Record<string, unknown | number>) {
  const calls: Call[] = []
  const pending: Promise<unknown>[] = []
  const cache = new MemoryCache()
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: new Headers(init?.headers) })
    const answer = answers[url]
    if (answer === undefined) throw new Error(`unexpected ${url}`)
    if (typeof answer === 'number') return new Response('error', { status: answer })
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer))
  }) as typeof fetch
  const deps: LookupDeps = {
    cache: cache as unknown as Cache,
    origin: ORIGIN,
    waitUntil: (work) => pending.push(work),
    fetch: fetchStub,
  }
  return { calls, cache, deps, settle: () => Promise.all(pending) }
}

const magnesiumAnswers = {
  [hcUrls.npnLicence('80085063', 'en')]: npnMagnesiumEn.licence,
  [hcUrls.npnIngredients(9264801, 'en')]: npnMagnesiumEn.ingredients,
  [hcUrls.npnDose(9264801, 'en')]: npnMagnesiumEn.dose,
}

describe('lookupNpn / lookupDin', () => {
  it('asks Health Canada three times with only the number, the language and a generic User-Agent', async () => {
    const { calls, deps } = setup(magnesiumAnswers)
    const prefill = await lookupNpn('80085063', 'en', deps)
    expect(prefill).toEqual(
      mapNpnPrefill(
        '80085063',
        npnMagnesiumEn.licence,
        npnMagnesiumEn.ingredients,
        npnMagnesiumEn.dose,
      ),
    )
    expect(calls.map((c) => c.url)).toEqual(Object.keys(magnesiumAnswers))
    for (const call of calls) {
      expect([...call.headers.keys()].sort()).toEqual(['accept', 'user-agent'])
      expect(call.headers.get('user-agent')).toBe(HC_USER_AGENT)
    }
  })

  it('answers from the cache for a week after the first lookup', async () => {
    const { calls, cache, deps, settle } = setup(magnesiumAnswers)
    await lookupNpn('80085063', 'en', deps)
    await settle()
    expect(cache.entries.size).toBe(3)
    for (const [key, entry] of cache.entries) {
      expect(key.startsWith(`${ORIGIN}/__cache/health-canada/natural-licences/`)).toBe(true)
      expect(entry.headers.get('cache-control')).toBe('public, max-age=604800')
    }
    calls.length = 0
    expect(await lookupNpn('80085063', 'en', deps)).toMatchObject({
      name: 'Magnesium Bisglycinate 200 mg',
    })
    expect(calls).toEqual([])
  })

  it('returns null for an unknown number after one call, cached for a day', async () => {
    const { calls, cache, deps, settle } = setup({
      [hcUrls.npnLicence('00000000', 'en')]: [],
      [hcUrls.dinProduct('00000000', 'fr')]: [],
    })
    expect(await lookupNpn('00000000', 'en', deps)).toBeNull()
    expect(await lookupDin('00000000', 'fr', deps)).toBeNull()
    await settle()
    expect(calls).toHaveLength(2)
    for (const entry of cache.entries.values()) {
      expect(entry.headers.get('cache-control')).toBe('public, max-age=86400')
    }
  })

  it('is partial when a follow-up call fails, and fails when the first one does', async () => {
    const { deps } = setup({ ...magnesiumAnswers, [hcUrls.npnIngredients(9264801, 'en')]: 503 })
    expect(await lookupNpn('80085063', 'en', deps)).toMatchObject({
      ingredients: [],
      dose: { amount: 1 },
      partial: true,
    })
    const down = setup({ [hcUrls.dinProduct('02172062', 'en')]: 500 })
    await expect(lookupDin('02172062', 'en', down.deps)).rejects.toBeInstanceOf(LookupError)
  })

  it('maps a DIN from three calls', async () => {
    const { calls, deps } = setup({
      [hcUrls.dinProduct('02172062', 'en')]: dinSynthroidEn.product,
      [hcUrls.dinIngredients(19588, 'en')]: dinSynthroidEn.ingredients,
      [hcUrls.dinForm(19588, 'en')]: dinSynthroidEn.form,
    })
    expect(await lookupDin('02172062', 'en', deps)).toMatchObject({
      name: 'SYNTHROID',
      form: 'tablet',
      strength: '25 mcg',
      partial: false,
    })
    expect(calls).toHaveLength(3)
  })
})

describe('getHcJson', () => {
  const url = hcUrls.npnLicence('80085063', 'en')

  it('gives up after the timeout', async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof fetch
    const deps: LookupDeps = {
      cache: null,
      origin: ORIGIN,
      waitUntil: () => {},
      fetch: hanging,
      timeoutMs: 20,
    }
    await expect(getHcJson(url, deps)).rejects.toBeInstanceOf(LookupError)
  })

  it('refuses an answer that is not JSON, and never caches it', async () => {
    const { cache, deps, settle } = setup({ [url]: '<html>maintenance</html>' })
    await expect(getHcJson(url, deps)).rejects.toThrow(/other than JSON/)
    await settle()
    expect(cache.entries.size).toBe(0)
  })

  it('works without a cache', async () => {
    const { deps } = setup({ [url]: npnMagnesiumEn.licence })
    expect(await getHcJson(url, { ...deps, cache: null })).toEqual(npnMagnesiumEn.licence)
  })
})
