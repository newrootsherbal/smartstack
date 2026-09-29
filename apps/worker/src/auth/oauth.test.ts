import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64urlEncode, sha256Hex, utf8 } from './crypto'
import {
  authDoneLocation,
  callbackUrl,
  checkGoogleIdTokenClaims,
  claimAttemptStatement,
  claimFailure,
  createGoogleProvider,
  insertAttemptStatement,
  OAuthError,
  oauthProviderFor,
  OAUTH_ATTEMPT_TTL_MS,
  providerErrorCode,
} from './oauth'

const NOW = Date.UTC(2026, 9, 1, 14, 0, 0)
const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const config = {
  clientId: CLIENT_ID,
  clientSecret: 'test-secret',
  redirectUri: 'https://schedule.example/api/auth/oauth/google/callback',
}
// RFC 7636 appendix B
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  azp: CLIENT_ID,
  sub: '110169484474386276334',
  email: 'Test.One@Example.com',
  email_verified: true,
  name: 'Test One',
  nonce: 'NONCE',
  iat: NOW / 1000 - 5,
  exp: NOW / 1000 + 3600,
  ...overrides,
})

function idToken(payload: object): string {
  const part = (o: object) => base64urlEncode(utf8(JSON.stringify(o)))
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(payload)}.c2lnbmF0dXJl`
}

describe('Google authorization URL', () => {
  it('asks for a code with PKCE S256, state, nonce and the account chooser', () => {
    const url = createGoogleProvider(config).authorizationUrl({
      state: 'STATE',
      codeVerifier: VERIFIER,
      nonce: 'NONCE',
      locale: 'fr',
    })
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = url.searchParams
    expect(p.get('response_type')).toBe('code')
    expect(p.get('client_id')).toBe(CLIENT_ID)
    expect(p.get('redirect_uri')).toBe(config.redirectUri)
    expect(p.get('scope')).toBe('openid email profile')
    expect(p.get('state')).toBe('STATE')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toBe(CHALLENGE)
    expect(p.get('nonce')).toBe('NONCE')
    expect(p.get('prompt')).toBe('select_account')
    expect(p.has('client_secret')).toBe(false)
  })

  it('builds the registered redirect URI from APP_ORIGIN', () => {
    expect(callbackUrl('http://localhost:5173/', 'google')).toBe(
      'http://localhost:5173/api/auth/oauth/google/callback',
    )
  })
})

describe('ID token claims', () => {
  const expected = { clientId: CLIENT_ID, nonce: 'NONCE', now: NOW }

  it('maps a valid token to a normalized profile', () => {
    expect(checkGoogleIdTokenClaims(claims(), expected)).toEqual({
      subject: '110169484474386276334',
      email: 'test.one@example.com',
      emailVerified: true,
      name: 'Test One',
    })
    expect(checkGoogleIdTokenClaims(claims({ iss: 'accounts.google.com' }), expected).subject).toBe(
      '110169484474386276334',
    )
  })

  it('reads email_verified (boolean or "true"), never assumes it', () => {
    const verified = (v: unknown) =>
      checkGoogleIdTokenClaims(claims({ email_verified: v }), expected).emailVerified
    expect(verified(true)).toBe(true)
    expect(verified('true')).toBe(true)
    expect(verified(false)).toBe(false)
    expect(verified(undefined)).toBe(false)
  })

  const invalid: [string, Record<string, unknown>][] = [
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['wrong audience', { aud: 'someone-else' }],
    ['audience list without azp', { aud: [CLIENT_ID, 'other'], azp: undefined }],
    ['expired', { exp: NOW / 1000 }],
    ['missing exp', { exp: undefined }],
    ['wrong nonce', { nonce: 'REPLAYED' }],
    ['missing nonce', { nonce: undefined }],
    ['missing subject', { sub: '' }],
  ]
  it.each(invalid)('rejects: %s', (_name, overrides) => {
    expect(() => checkGoogleIdTokenClaims(claims(overrides), expected)).toThrow(
      expect.objectContaining({ code: 'invalid_id_token' }),
    )
  })

  it('accepts an audience list when azp is our client', () => {
    expect(() =>
      checkGoogleIdTokenClaims(claims({ aud: [CLIENT_ID, 'other'], azp: CLIENT_ID }), expected),
    ).not.toThrow()
  })

  it('needs an email', () => {
    expect(() => checkGoogleIdTokenClaims(claims({ email: undefined }), expected)).toThrow(
      expect.objectContaining({ code: 'email_missing' }),
    )
  })

  it('trims and caps the display name', () => {
    expect(checkGoogleIdTokenClaims(claims({ name: '  ' }), expected).name).toBeNull()
    expect(checkGoogleIdTokenClaims(claims({ name: 'x'.repeat(80) }), expected).name).toHaveLength(
      60,
    )
  })
})

describe('code exchange (mocked fetch; no request leaves the test)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the code and verifier with client credentials, then checks the ID token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken(claims()) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const profile = await createGoogleProvider(config).exchangeCode({
      code: 'CODE',
      codeVerifier: VERIFIER,
      nonce: 'NONCE',
      now: NOW,
    })
    expect(profile.email).toBe('test.one@example.com')
    const request = fetchMock.mock.calls[0]![0] as Request
    expect(request.url).toBe('https://oauth2.googleapis.com/token')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toMatch(/^Basic /)
    const body = new URLSearchParams(await request.text())
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('CODE')
    expect(body.get('code_verifier')).toBe(VERIFIER)
    expect(body.get('redirect_uri')).toBe(config.redirectUri)
  })

  it('maps a refused exchange to exchange_failed', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(
      createGoogleProvider(config).exchangeCode({
        code: 'X',
        codeVerifier: VERIFIER,
        nonce: 'N',
        now: NOW,
      }),
    ).rejects.toEqual(new OAuthError('exchange_failed'))
  })

  it('rejects an ID token minted for another nonce', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken(claims()) }),
    )
    await expect(
      createGoogleProvider(config).exchangeCode({
        code: 'X',
        codeVerifier: VERIFIER,
        nonce: 'OTHER',
        now: NOW,
      }),
    ).rejects.toEqual(new OAuthError('invalid_id_token'))
  })
})

describe('provider availability', () => {
  const env = {
    APP_ORIGIN: 'https://schedule.example',
    APPLE_ENABLED: 'false',
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'secret',
  }

  it('serves Google when configured', () => {
    const lookup = oauthProviderFor(env, 'google')
    expect(lookup.ok && lookup.provider.id).toBe('google')
  })

  it('answers 503 while the Google client is not configured', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(oauthProviderFor({ ...env, GOOGLE_CLIENT_SECRET: '' }, 'google')).toEqual({
      ok: false,
      status: 503,
      error: 'provider_not_configured',
    })
    vi.restoreAllMocks()
  })

  it('answers 404 provider_disabled for Apple until APPLE_ENABLED is "true"', () => {
    expect(oauthProviderFor(env, 'apple')).toEqual({
      ok: false,
      status: 404,
      error: 'provider_disabled',
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(oauthProviderFor({ ...env, APPLE_ENABLED: 'true' }, 'apple')).toMatchObject({
      ok: false,
      status: 501,
    })
    vi.restoreAllMocks()
  })
})

describe('attempts and claims', () => {
  it('stores the attempt for 10 minutes', () => {
    const s = insertAttemptStatement({
      state: 'S',
      provider: 'google',
      intent: 'login',
      linkAccountId: null,
      codeVerifier: 'V',
      nonce: 'N',
      claimHash: 'H',
      locale: 'en',
      now: NOW,
    })
    expect(s.params).toEqual([
      'S',
      'google',
      'login',
      null,
      'V',
      'N',
      'H',
      'en',
      NOW,
      NOW + 600_000,
    ])
    expect(OAUTH_ATTEMPT_TTL_MS).toBe(600_000)
  })

  it('claims once: only a ready, unexpired attempt with the matching hash', () => {
    const s = claimAttemptStatement('S', 'H', NOW)
    expect(s.sql).toMatch(/status = 'ready' AND expires_at > \?3/)
    expect(s.sql).toMatch(/SET status = 'claimed'/)
    expect(s.params).toEqual(['S', 'H', NOW])
  })

  it('explains a failed claim', async () => {
    const hash = await sha256Hex('x')
    const attempt = (status: 'pending' | 'ready' | 'claimed' | 'failed', extra = {}) => ({
      status,
      claim_hash: hash,
      error: null,
      expires_at: NOW + 1,
      ...extra,
    })
    expect(claimFailure(null, hash, NOW)).toEqual({ status: 404, error: 'unknown_state' })
    expect(claimFailure(attempt('ready'), 'other', NOW)).toEqual({
      status: 403,
      error: 'invalid_claim',
    })
    expect(claimFailure(attempt('claimed'), hash, NOW)).toEqual({
      status: 409,
      error: 'already_claimed',
    })
    expect(claimFailure(attempt('failed', { error: 'identity_in_use' }), hash, NOW)).toEqual({
      status: 400,
      error: 'identity_in_use',
    })
    expect(claimFailure(attempt('ready', { expires_at: NOW }), hash, NOW)).toEqual({
      status: 410,
      error: 'expired',
    })
    expect(claimFailure(attempt('pending'), hash, NOW)).toEqual({ status: 409, error: 'not_ready' })
  })

  it('redirects to /auth/done with the state and an optional error', () => {
    expect(authDoneLocation('abc-_', null)).toBe('/auth/done?state=abc-_')
    expect(authDoneLocation('abc', 'identity_in_use')).toBe(
      '/auth/done?state=abc&error=identity_in_use',
    )
    expect(authDoneLocation(null, 'invalid_state')).toBe('/auth/done?error=invalid_state')
    expect(providerErrorCode('access_denied')).toBe('cancelled')
    expect(providerErrorCode('server_error')).toBe('provider_error')
  })
})
