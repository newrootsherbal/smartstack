/**
 * The Health Canada calls behind /api/lookup/…: at most three upstream requests per lookup
 * (free plan: 50 subrequests per invocation), each with a timeout and cached a week in the
 * Cache API under a synthetic key per upstream URL. Only the number and the language leave the
 * Worker; the person's IP, session and account never do.
 */
import type { LookupLang, ProductPrefill } from '@smartstack/shared'
import {
  HC_TIMEOUT_MS,
  HC_USER_AGENT,
  hcCacheKey,
  hcCacheSeconds,
  hcUrls,
  mapDinPrefill,
  mapNpnPrefill,
  pickDrugProduct,
  pickLicence,
} from './health-canada'

export class LookupError extends Error {
  override name = 'LookupError'
}

export interface LookupDeps {
  /** `caches.default`, or null where there is none (tests). */
  cache: Cache | null
  /** The app's origin, for the synthetic cache keys. */
  origin: string
  /** Runs the cache write after the response (ctx.waitUntil). */
  waitUntil: (work: Promise<unknown>) => void
  fetch?: typeof fetch
  timeoutMs?: number
}

/** One upstream JSON answer, from the cache when there; throws LookupError on any failure. */
export async function getHcJson(url: string, deps: LookupDeps): Promise<unknown> {
  const key = hcCacheKey(url, deps.origin)
  const cached = await deps.cache?.match(key).catch(() => undefined)
  if (cached) {
    try {
      return await cached.json()
    } catch {
      // A damaged entry: fetch again below.
    }
  }
  let body: string
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      headers: { 'User-Agent': HC_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? HC_TIMEOUT_MS),
    })
    if (!res.ok) throw new LookupError(`upstream ${res.status}`)
    body = await res.text()
  } catch (err) {
    throw err instanceof LookupError ? err : new LookupError('upstream unreachable')
  }
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new LookupError('upstream answered something other than JSON')
  }
  if (deps.cache) {
    const entry = new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${hcCacheSeconds(data)}`,
      },
    })
    deps.waitUntil(deps.cache.put(key, entry))
  }
  return data
}

/** A follow-up answer, or null when that call failed (the prefill is then partial). */
async function optional(url: string, deps: LookupDeps): Promise<unknown | null> {
  try {
    return await getHcJson(url, deps)
  } catch {
    return null
  }
}

/** Null when Health Canada knows no such NPN; throws LookupError when it can't be reached. */
export async function lookupNpn(
  npn: string,
  lang: LookupLang,
  deps: LookupDeps,
): Promise<ProductPrefill | null> {
  const licences = await getHcJson(hcUrls.npnLicence(npn, lang), deps)
  const licence = pickLicence(licences, npn)
  if (!licence) return null
  const [ingredients, doses] = await Promise.all([
    optional(hcUrls.npnIngredients(licence.lnhpd_id, lang), deps),
    optional(hcUrls.npnDose(licence.lnhpd_id, lang), deps),
  ])
  return mapNpnPrefill(npn, licences, ingredients, doses)
}

/** Null when Health Canada knows no such DIN; throws LookupError when it can't be reached. */
export async function lookupDin(
  din: string,
  lang: LookupLang,
  deps: LookupDeps,
): Promise<ProductPrefill | null> {
  const products = await getHcJson(hcUrls.dinProduct(din, lang), deps)
  const product = pickDrugProduct(products, din)
  if (!product) return null
  const [ingredients, forms] = await Promise.all([
    optional(hcUrls.dinIngredients(product.drug_code, lang), deps),
    optional(hcUrls.dinForm(product.drug_code, lang), deps),
  ])
  return mapDinPrefill(din, products, ingredients, forms)
}
