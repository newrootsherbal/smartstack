/**
 * /api/auth/… and /api/account/… (Phase 2 accounts, docs/smartstack-phase2-prompt.md §5, §7).
 * The session token in `Authorization: Bearer` is the credential here; `/api/me/*` keeps the
 * device UUID. Everything answers 404 while ACCOUNTS_MODE is "off"; "staff" refuses sign-up and
 * login for addresses outside STAFF_EMAIL_DOMAINS. Logs: counts, codes and ids only.
 */
import {
  ChangePasswordBody,
  ConsentBody,
  DeviceLinkBody,
  ForgotPasswordBody,
  LoginBody,
  OAuthClaimBody,
  OAuthProviderId,
  OAuthStartBody,
  ResetPasswordBody,
  SignupBody,
  VerifyEmailBody,
  type Locale,
} from '@smartstack/shared'
import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import {
  accountByEmailStatement,
  accountByIdStatement,
  accountView,
  buildAccountExport,
  canDisconnect,
  deleteAccountStatement,
  disconnectIdentityStatement,
  exportFileName,
  exportStatements,
  insertAccountStatement,
  linkDeviceStatement,
  newAccountRow,
  recordConsentStatement,
  setPasswordStatement,
  unlinkDeviceStatement,
  type ExportRows,
} from './auth/account'
import { randomToken, tokenHash } from './auth/crypto'
import {
  attemptFailedStatement,
  linkingReadStatements,
  planStatements,
  resolveOAuthIdentity,
  toLinkAccount,
} from './auth/linking'
import {
  attemptByStateStatement,
  authDoneLocation,
  claimAttemptStatement,
  claimFailure,
  insertAttemptStatement,
  OAuthError,
  oauthProviderFor,
  providerErrorCode,
  type OAuthProfile,
} from './auth/oauth'
import {
  decodePasswordKey,
  needsRehash,
  newStoredPassword,
  usablePepper,
  verifyPasswordKey,
} from './auth/password'
import {
  createSessionStatements,
  deleteSessionStatement,
  endOtherSessionsStatement,
  newSession,
  sessionIdFromHeader,
  sessionLookupStatement,
  sessionNeedsSlide,
  slideStatements,
} from './auth/session'
import {
  THROTTLE,
  combineVerdicts,
  throttleHitStatement,
  throttleKey,
  throttleMessage,
  throttleReadStatement,
  verdictAfterHit,
  verdictBeforeAttempt,
  type ThrottleRule,
  type ThrottleVerdict,
} from './auth/throttle'
import {
  consumeEmailTokenStatement,
  emailTokenLink,
  insertEmailTokenStatement,
  liveEmailTokenStatement,
  markEmailVerifiedStatement,
  newEmailToken,
  retireEmailTokensStatement,
} from './auth/tokens'
import { accountsMode, consentVersion, signInRefusal, staffEmailDomains } from './config'
import {
  passwordChangedMessage,
  resetPasswordMessage,
  sendEmail,
  verifyEmailMessage,
  type EmailMessage,
} from './email'
import type { AccountWithProviders, Env, OAuthAttemptRow, ThrottleRow } from './env'
import { defer, isUniqueViolation, parseJsonBody, prepare, prepareAll } from './http'

interface SessionAuth {
  sessionId: string
  account: AccountWithProviders
}

type AuthEnv = { Bindings: Env; Variables: { auth: SessionAuth } }
type Ctx = Context<AuthEnv>

export const accountApi = new Hono<AuthEnv>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientIp(c: Ctx): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown'
}

function betaKeyOk(c: Ctx): boolean {
  return Boolean(c.env.BETA_KEY) && c.req.header('x-beta-key') === c.env.BETA_KEY
}

function asLocale(value: string): Locale {
  return value === 'fr' ? 'fr' : 'en'
}

function pepperOrError(c: Ctx): string | Response {
  const pepper = usablePepper(c.env.AUTH_PEPPER)
  if (pepper) return pepper
  console.error(
    'AUTH_PEPPER is missing or shorter than 32 characters: password routes are disabled. ' +
      'Set it with `npx wrangler secret put AUTH_PEPPER` (local: apps/worker/.dev.vars).',
  )
  return c.json({ error: 'server_misconfigured' }, 500)
}

function consentVersionOrError(c: Ctx): string | Response {
  const version = consentVersion(c.env)
  if (version) return version
  console.error('CONSENT_VERSION is not set: consent cannot be recorded')
  return c.json({ error: 'server_misconfigured' }, 500)
}

function limitedResponse(c: Ctx, verdict: ThrottleVerdict): Response | null {
  if (verdict.allowed) return null
  c.header('Retry-After', String(verdict.retryAfter))
  return c.json({ error: 'rate_limited', detail: throttleMessage(verdict.retryAfter) }, 429)
}

/** Counts one hit; a 429 response once the window's limit is exceeded. */
async function throttleHit(
  c: Ctx,
  rule: ThrottleRule,
  value: string,
  now: number,
): Promise<Response | null> {
  const key = await throttleKey(rule, value)
  const row = await prepare(c.env.DB, throttleHitStatement(key, rule, now)).first<ThrottleRow>()
  return limitedResponse(c, verdictAfterHit(row, rule, now))
}

interface FailureKeys {
  emailKey: string
  ipKey: string
}

async function failureKeys(c: Ctx, email: string): Promise<FailureKeys> {
  return {
    emailKey: await throttleKey(THROTTLE.loginEmail, email),
    ipKey: await throttleKey(THROTTLE.loginIp, clientIp(c)),
  }
}

/** Failed logins: refused once 5 per email or 30 per IP are recorded in the window. */
async function checkFailures(c: Ctx, keys: FailureKeys, now: number): Promise<Response | null> {
  const { results } = await prepare(
    c.env.DB,
    throttleReadStatement([keys.emailKey, keys.ipKey]),
  ).all<ThrottleRow>()
  const find = (key: string) => results.find((r) => r.key === key) ?? null
  return limitedResponse(
    c,
    combineVerdicts([
      verdictBeforeAttempt(find(keys.emailKey), THROTTLE.loginEmail, now),
      verdictBeforeAttempt(find(keys.ipKey), THROTTLE.loginIp, now),
    ]),
  )
}

async function recordFailure(c: Ctx, keys: FailureKeys, now: number): Promise<void> {
  await c.env.DB.batch(
    prepareAll(c.env.DB, [
      throttleHitStatement(keys.emailKey, THROTTLE.loginEmail, now),
      throttleHitStatement(keys.ipKey, THROTTLE.loginIp, now),
    ]),
  )
}

function sendLater(c: Ctx, message: EmailMessage): void {
  defer(c, sendEmail(c.env, message))
}

/**
 * The session behind the bearer token, sliding it at most once a day (after the response).
 * The staff gate applies when a session is created (sign-up, login, OAuth), not here: an existing
 * session can always log out, export and delete its account.
 */
async function authenticate(c: Ctx): Promise<SessionAuth | Response> {
  const sessionId = await sessionIdFromHeader(c.req.header('authorization'))
  if (!sessionId) return c.json({ error: 'unauthorized' }, 401)
  const now = Date.now()
  const row = await prepare(c.env.DB, sessionLookupStatement(sessionId, now)).first<
    AccountWithProviders & { session_id: string; session_last_used_at: number }
  >()
  if (!row) return c.json({ error: 'unauthorized' }, 401)
  if (sessionNeedsSlide(row.session_last_used_at, now)) {
    defer(c, c.env.DB.batch(prepareAll(c.env.DB, slideStatements(sessionId, row.id, now))))
  }
  return { sessionId, account: row }
}

const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
  const auth = await authenticate(c)
  if (auth instanceof Response) return auth
  c.set('auth', auth)
  await next()
})

// ---------------------------------------------------------------------------
// Launch gate and session requirement
// ---------------------------------------------------------------------------

const accountsGate = createMiddleware<AuthEnv>(async (c, next) => {
  if (accountsMode(c.env) === 'off') return c.json({ error: 'not_found' }, 404)
  await next()
})

// Sub-app paths are mounted under /api; '/account/*' also matches '/account'.
accountApi.use('/auth/*', accountsGate)
accountApi.use('/account/*', accountsGate)
accountApi.use('/account/*', requireSession)

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------

accountApi.post('/auth/signup', async (c) => {
  if (!betaKeyOk(c)) return c.json({ error: 'beta_key_required' }, 403)
  const body = await parseJsonBody(c, SignupBody)
  if (!body.ok) return body.response
  const { email, locale, platform } = body.data
  const refusal = signInRefusal(c.env, email)
  if (refusal) return c.json({ error: refusal }, 403)
  const pepper = pepperOrError(c)
  if (pepper instanceof Response) return pepper
  const version = consentVersionOrError(c)
  if (version instanceof Response) return version
  const key = decodePasswordKey(body.data.key)
  if (!key) return c.json({ error: 'invalid_body', detail: ['key: expected 32 bytes'] }, 400)

  const now = Date.now()
  const limited = await throttleHit(c, THROTTLE.signupIp, clientIp(c), now)
  if (limited) return limited
  const existing = await c.env.DB.prepare('SELECT id FROM accounts WHERE email = ?1')
    .bind(email)
    .first()
  if (existing) return c.json({ error: 'email_in_use' }, 409)

  const account = newAccountRow({
    id: crypto.randomUUID(),
    email,
    locale,
    displayName: body.data.name?.trim() || null,
    now,
    emailVerified: false,
    consentVersion: version,
    password: await newStoredPassword(pepper, key),
  })
  const session = await newSession()
  const verify = await newEmailToken()
  try {
    await c.env.DB.batch(
      prepareAll(c.env.DB, [
        insertAccountStatement(account),
        ...createSessionStatements(session.id, account.id, platform ?? null, now),
        insertEmailTokenStatement(verify.id, account.id, 'verify_email', email, now),
      ]),
    )
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: 'email_in_use' }, 409)
    throw err
  }
  console.log(`signup: account ${account.id}`)
  sendLater(
    c,
    verifyEmailMessage(
      locale,
      email,
      emailTokenLink(c.env.APP_ORIGIN, 'verify_email', verify.token),
    ),
  )
  return c.json(
    { token: session.token, account: accountView({ ...account, last_login_at: now }, version) },
    201,
  )
})

accountApi.post('/auth/login', async (c) => {
  const body = await parseJsonBody(c, LoginBody)
  if (!body.ok) return body.response
  const { email, platform } = body.data
  const refusal = signInRefusal(c.env, email)
  if (refusal) return c.json({ error: refusal }, 403)
  const pepper = pepperOrError(c)
  if (pepper instanceof Response) return pepper
  const key = decodePasswordKey(body.data.key)
  if (!key) return c.json({ error: 'invalid_body', detail: ['key: expected 32 bytes'] }, 400)

  const now = Date.now()
  const keys = await failureKeys(c, email)
  const limited = await checkFailures(c, keys, now)
  if (limited) return limited

  const account = await prepare(
    c.env.DB,
    accountByEmailStatement(email),
  ).first<AccountWithProviders>()
  const ok =
    account?.password_hash && account.password_salt
      ? await verifyPasswordKey(pepper, account.password_salt, account.password_hash, key)
      : false
  if (!account || !ok) {
    await recordFailure(c, keys, now)
    return c.json({ error: 'invalid_credentials' }, 401)
  }

  const session = await newSession()
  await c.env.DB.batch(
    prepareAll(c.env.DB, createSessionStatements(session.id, account.id, platform ?? null, now)),
  )
  const view = accountView({ ...account, last_login_at: now }, consentVersion(c.env))
  return c.json({
    token: session.token,
    account: view,
    ...(needsRehash(account.kdf_version) ? { rehash: true } : {}),
  })
})

accountApi.post('/auth/logout', requireSession, async (c) => {
  await prepare(c.env.DB, deleteSessionStatement(c.get('auth').sessionId)).run()
  return c.body(null, 204)
})

accountApi.post('/auth/verify-email', async (c) => {
  const body = await parseJsonBody(c, VerifyEmailBody)
  if (!body.ok) return body.response
  const id = await tokenHash(body.data.token)
  if (!id) return c.json({ error: 'invalid_token' }, 400)
  const now = Date.now()
  const used = await prepare(c.env.DB, consumeEmailTokenStatement(id, 'verify_email', now)).first<{
    account_id: string
    email: string
  }>()
  if (!used) return c.json({ error: 'invalid_token' }, 400)
  await c.env.DB.batch(
    prepareAll(c.env.DB, [
      markEmailVerifiedStatement(used.account_id, used.email, now),
      retireEmailTokensStatement(used.account_id, now, 'verify_email'),
    ]),
  )
  return c.json({ ok: true })
})

accountApi.post('/auth/verify-email/resend', requireSession, async (c) => {
  const { account } = c.get('auth')
  if (account.email_verified_at !== null) return c.json({ error: 'already_verified' }, 409)
  const now = Date.now()
  const limited = await throttleHit(c, THROTTLE.resendEmail, account.email, now)
  if (limited) return limited
  const verify = await newEmailToken()
  await prepare(
    c.env.DB,
    insertEmailTokenStatement(verify.id, account.id, 'verify_email', account.email, now),
  ).run()
  const result = await sendEmail(
    c.env,
    verifyEmailMessage(
      account.locale,
      account.email,
      emailTokenLink(c.env.APP_ORIGIN, 'verify_email', verify.token),
    ),
  )
  if (result === 'sent' || result === 'logged') return c.json({ ok: true })
  return c.json({ error: 'email_failed' }, 503)
})

accountApi.post('/auth/password/forgot', async (c) => {
  const body = await parseJsonBody(c, ForgotPasswordBody)
  if (!body.ok) return body.response
  const { email } = body.data
  const now = Date.now()
  const limited = await throttleHit(c, THROTTLE.forgotEmail, email, now)
  if (limited) return limited
  // Same answer, and the same timing, whether or not the account exists: the lookup, the token
  // and the email all happen after the response.
  if (!signInRefusal(c.env, email)) {
    defer(
      c,
      (async () => {
        const account = await prepare(
          c.env.DB,
          accountByEmailStatement(email),
        ).first<AccountWithProviders>()
        if (!account) return
        const reset = await newEmailToken()
        await prepare(
          c.env.DB,
          insertEmailTokenStatement(reset.id, account.id, 'reset_password', account.email, now),
        ).run()
        await sendEmail(
          c.env,
          resetPasswordMessage(
            account.locale,
            account.email,
            emailTokenLink(c.env.APP_ORIGIN, 'reset_password', reset.token, account.email),
          ),
        )
      })(),
    )
  }
  return c.json({ ok: true })
})

accountApi.post('/auth/password/reset', async (c) => {
  const body = await parseJsonBody(c, ResetPasswordBody)
  if (!body.ok) return body.response
  const pepper = pepperOrError(c)
  if (pepper instanceof Response) return pepper
  const key = decodePasswordKey(body.data.key)
  const id = await tokenHash(body.data.token)
  if (!key || !id) return c.json({ error: 'invalid_token' }, 400)
  const now = Date.now()
  const used = await prepare(
    c.env.DB,
    consumeEmailTokenStatement(id, 'reset_password', now, body.data.email),
  ).first<{
    account_id: string
    email: string
  }>()
  if (!used) {
    // A key derived with another address as its salt would lock the person out: the token is
    // kept for a retry with the right address.
    const live = await prepare(c.env.DB, liveEmailTokenStatement(id, 'reset_password', now)).first()
    return c.json({ error: live ? 'email_mismatch' : 'invalid_token' }, 400)
  }
  // A reset proves the address, so it also verifies it; every session ends (except the caller's,
  // if the request carries one of this account's sessions).
  const keep = await sessionIdFromHeader(c.req.header('authorization'))
  const password = await newStoredPassword(pepper, key)
  const [updated] = await c.env.DB.batch<{ email: string; locale: Locale }>(
    prepareAll(c.env.DB, [
      setPasswordStatement(used.account_id, password, now, { verifyEmail: true }),
      endOtherSessionsStatement(used.account_id, keep),
      retireEmailTokensStatement(used.account_id, now),
    ]),
  )
  const account = updated?.results[0]
  if (account) {
    sendLater(c, passwordChangedMessage(asLocale(account.locale), account.email, c.env.APP_ORIGIN))
  }
  console.log(`password reset: account ${used.account_id}`)
  return c.json({ ok: true })
})

accountApi.post('/auth/password/change', requireSession, async (c) => {
  const body = await parseJsonBody(c, ChangePasswordBody)
  if (!body.ok) return body.response
  const pepper = pepperOrError(c)
  if (pepper instanceof Response) return pepper
  const { sessionId, account } = c.get('auth')
  if (!account.password_hash || !account.password_salt) {
    return c.json({ error: 'no_password' }, 409)
  }
  const currentKey = decodePasswordKey(body.data.currentKey)
  const newKey = decodePasswordKey(body.data.newKey)
  if (!currentKey || !newKey) return c.json({ error: 'invalid_body' }, 400)
  const now = Date.now()
  const keys = await failureKeys(c, account.email)
  const limited = await checkFailures(c, keys, now)
  if (limited) return limited
  const ok = await verifyPasswordKey(
    pepper,
    account.password_salt,
    account.password_hash,
    currentKey,
  )
  if (!ok) {
    await recordFailure(c, keys, now)
    return c.json({ error: 'invalid_credentials' }, 401)
  }
  const password = await newStoredPassword(pepper, newKey)
  await c.env.DB.batch(
    prepareAll(c.env.DB, [
      setPasswordStatement(account.id, password, now, { verifyEmail: false }),
      endOtherSessionsStatement(account.id, sessionId),
      retireEmailTokensStatement(account.id, now, 'reset_password'),
    ]),
  )
  sendLater(c, passwordChangedMessage(account.locale, account.email, c.env.APP_ORIGIN))
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// OAuth: start → provider → callback → claim (§5.4)
// ---------------------------------------------------------------------------

accountApi.post('/auth/oauth/start', async (c) => {
  if (!betaKeyOk(c)) return c.json({ error: 'beta_key_required' }, 403)
  const body = await parseJsonBody(c, OAuthStartBody)
  if (!body.ok) return body.response
  const { provider: providerId, intent, claimHash, locale } = body.data
  const lookup = oauthProviderFor(c.env, providerId)
  if (!lookup.ok) return c.json({ error: lookup.error }, lookup.status)
  let linkAccountId: string | null = null
  if (intent === 'link') {
    const auth = await authenticate(c)
    if (auth instanceof Response) return auth
    linkAccountId = auth.account.id
  }
  const now = Date.now()
  const limited = await throttleHit(c, THROTTLE.oauthStartIp, clientIp(c), now)
  if (limited) return limited
  const state = randomToken()
  const codeVerifier = randomToken()
  const nonce = randomToken()
  await prepare(
    c.env.DB,
    insertAttemptStatement({
      state,
      provider: providerId,
      intent,
      linkAccountId,
      codeVerifier,
      nonce,
      claimHash,
      locale,
      now,
    }),
  ).run()
  const url = lookup.provider.authorizationUrl({ state, codeVerifier, nonce, locale })
  return c.json({ url: url.toString(), state })
})

accountApi.get('/auth/oauth/google/callback', async (c) => {
  const state = c.req.query('state') ?? null
  const done = (error: string | null) => c.redirect(authDoneLocation(state, error), 303)
  if (!state) return done('invalid_state')
  const now = Date.now()
  const attempt = await prepare(
    c.env.DB,
    attemptByStateStatement(state, 'google'),
  ).first<OAuthAttemptRow>()
  if (!attempt || attempt.status !== 'pending' || attempt.expires_at <= now) {
    return done('invalid_state')
  }
  const fail = async (error: string) => {
    await prepare(c.env.DB, attemptFailedStatement(state, error)).run()
    console.log(`oauth callback failed: ${error}`)
    return done(error)
  }
  const providerError = c.req.query('error')
  const code = c.req.query('code')
  if (providerError || !code) return fail(providerErrorCode(providerError ?? ''))
  const lookup = oauthProviderFor(c.env, 'google')
  if (!lookup.ok) return fail('provider_unavailable')

  let profile: OAuthProfile
  try {
    profile = await lookup.provider.exchangeCode({
      code,
      codeVerifier: attempt.code_verifier,
      nonce: attempt.nonce,
      now,
    })
  } catch (err) {
    return fail(err instanceof OAuthError ? err.code : 'exchange_failed')
  }

  type LinkRow = { id: string; email: string; email_verified_at: number | null }
  const [identity, current, byEmail] = await c.env.DB.batch<LinkRow>(
    prepareAll(
      c.env.DB,
      linkingReadStatements('google', profile.subject, attempt.link_account_id, profile.email),
    ),
  )
  const plan = resolveOAuthIdentity({
    intent: attempt.intent,
    profile,
    identityAccount: toLinkAccount(identity?.results[0]),
    currentAccount: attempt.link_account_id ? toLinkAccount(current?.results[0]) : null,
    emailAccount: toLinkAccount(byEmail?.results[0]),
    mode: accountsMode(c.env),
    staffDomains: staffEmailDomains(c.env),
  })
  if (plan.action === 'refuse') return fail(plan.error)
  const result = planStatements(plan, {
    provider: 'google',
    subject: profile.subject,
    profile,
    state,
    locale: asLocale(attempt.locale),
    now,
    newAccountId: crypto.randomUUID(),
  })
  try {
    await c.env.DB.batch(prepareAll(c.env.DB, result.statements))
  } catch (err) {
    console.error('oauth callback write failed:', err instanceof Error ? err.message : String(err))
    return fail('internal')
  }
  console.log(`oauth callback: ${plan.action} account ${result.accountId}`)
  return done(null)
})

accountApi.post('/auth/oauth/claim', async (c) => {
  const now = Date.now()
  const limited = await throttleHit(c, THROTTLE.claimIp, clientIp(c), now)
  if (limited) return limited
  const body = await parseJsonBody(c, OAuthClaimBody)
  if (!body.ok) return body.response
  const { state, claimSecret, platform } = body.data
  const claimHash = await tokenHash(claimSecret)
  if (!claimHash) return c.json({ error: 'invalid_claim' }, 403)
  const claimed = await prepare(c.env.DB, claimAttemptStatement(state, claimHash, now)).first<{
    account_id: string
    is_new_account: number
  }>()
  if (!claimed) {
    const attempt = await c.env.DB.prepare(
      'SELECT status, claim_hash, error, expires_at FROM oauth_attempts WHERE state = ?1',
    )
      .bind(state)
      .first<Pick<OAuthAttemptRow, 'status' | 'claim_hash' | 'error' | 'expires_at'>>()
    const failure = claimFailure(attempt, claimHash, now)
    return c.json({ error: failure.error }, failure.status)
  }
  const account = await prepare(
    c.env.DB,
    accountByIdStatement(claimed.account_id),
  ).first<AccountWithProviders>()
  if (!account) return c.json({ error: 'unknown_state' }, 404)
  const session = await newSession()
  await c.env.DB.batch(
    prepareAll(c.env.DB, createSessionStatements(session.id, account.id, platform ?? null, now)),
  )
  return c.json({
    token: session.token,
    account: accountView({ ...account, last_login_at: now }, consentVersion(c.env)),
    isNew: claimed.is_new_account === 1,
  })
})

// ---------------------------------------------------------------------------
// /api/account (session)
// ---------------------------------------------------------------------------

accountApi.get('/account', (c) => {
  return c.json(accountView(c.get('auth').account, consentVersion(c.env)))
})

accountApi.post('/account/consent', async (c) => {
  const body = await parseJsonBody(c, ConsentBody)
  if (!body.ok) return body.response
  const version = consentVersionOrError(c)
  if (version instanceof Response) return version
  const { account } = c.get('auth')
  const now = Date.now()
  await prepare(c.env.DB, recordConsentStatement(account.id, version, now)).run()
  return c.json(
    accountView(
      { ...account, consent_version: version, consent_at: now, age_confirmed_at: now },
      version,
    ),
  )
})

accountApi.post('/account/device', async (c) => {
  const body = await parseJsonBody(c, DeviceLinkBody)
  if (!body.ok) return body.response
  const result = await prepare(
    c.env.DB,
    linkDeviceStatement(c.get('auth').account.id, body.data.deviceId),
  ).run()
  if ((result.meta.changes ?? 0) === 0) return c.json({ error: 'unknown_device' }, 404)
  return c.json({ ok: true })
})

accountApi.delete('/account/device', async (c) => {
  const body = await parseJsonBody(c, DeviceLinkBody)
  if (!body.ok) return body.response
  await prepare(c.env.DB, unlinkDeviceStatement(c.get('auth').account.id, body.data.deviceId)).run()
  return c.body(null, 204)
})

accountApi.delete('/account/identity/:provider', async (c) => {
  const provider = OAuthProviderId.safeParse(c.req.param('provider'))
  if (!provider.success) return c.json({ error: 'not_found' }, 404)
  const { account } = c.get('auth')
  const check = canDisconnect(account, provider.data)
  if (check === 'not_connected') return c.json({ error: 'not_connected' }, 404)
  if (check === 'last_sign_in_method') return c.json({ error: 'last_sign_in_method' }, 409)
  // Later, for Apple: revoke its refresh token here (best effort).
  await prepare(c.env.DB, disconnectIdentityStatement(account.id, provider.data)).run()
  return c.body(null, 204)
})

accountApi.get('/account/export', async (c) => {
  const { account } = c.get('auth')
  const now = Date.now()
  const [accounts, identities, sessions, devices] = await c.env.DB.batch(
    prepareAll(c.env.DB, exportStatements(account.id)),
  )
  const accountRow = accounts?.results[0] as ExportRows['account'] | undefined
  if (!accountRow) return c.json({ error: 'unauthorized' }, 401)
  const data = buildAccountExport(
    {
      account: accountRow,
      identities: (identities?.results ?? []) as ExportRows['identities'],
      sessions: (sessions?.results ?? []) as ExportRows['sessions'],
      devices: (devices?.results ?? []) as ExportRows['devices'],
    },
    now,
  )
  return c.body(JSON.stringify(data, null, 2), 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${exportFileName(now)}"`,
  })
})

accountApi.delete('/account', async (c) => {
  const { account } = c.get('auth')
  // Later: revoke the Apple refresh token first (best effort).
  await prepare(c.env.DB, deleteAccountStatement(account.id)).run()
  console.log(`account deleted: ${account.id}`)
  return c.body(null, 204)
})
