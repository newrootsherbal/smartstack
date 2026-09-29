/**
 * Linking rules (§5.5) as a pure function returning a plan, then the statements that carry it
 * out. The web callback uses it today; a native id-token route (Capacitor, later) can reuse it
 * unchanged.
 *
 * 1. (provider, subject) already known → that account.
 * 2. intent "link" (signed in) → attach to the current account; 409 if the identity belongs to
 *    another account.
 * 3. An account has the same email: provider says verified → attach (and if that account's
 *    email was never verified, drop its password and sessions, then mark it verified); provider
 *    says unverified → email_in_use_unverified.
 * 4. Otherwise create the account (verified when the provider verified the email).
 * ACCOUNTS_MODE "staff" refuses any account outside STAFF_EMAIL_DOMAINS (accounts_not_open).
 */
import { accountsOpenTo, type AccountsMode, type OAuthProviderId } from '@smartstack/shared'
import type { Locale } from '../env'
import type { Statement } from '../logic'
import { insertAccountStatement, newAccountRow } from './account'

export interface LinkAccount {
  id: string
  email: string
  emailVerified: boolean
}

export interface LinkingInput {
  intent: 'login' | 'link'
  /** What the provider reported (email normalized). */
  profile: { email: string; emailVerified: boolean }
  /** The account that already owns (provider, subject), if any. */
  identityAccount: LinkAccount | null
  /** intent "link": the signed-in account that started the flow. */
  currentAccount: LinkAccount | null
  /** The account whose email equals the provider's email, if any. */
  emailAccount: LinkAccount | null
  mode: AccountsMode
  staffDomains: readonly string[]
}

export type LinkingRefusal =
  'identity_in_use' | 'email_in_use_unverified' | 'accounts_not_open' | 'link_session_missing'

export type LinkingPlan =
  | { action: 'use_identity'; accountId: string }
  | { action: 'link_current'; accountId: string }
  | { action: 'attach_email'; accountId: string; takeover: boolean }
  | { action: 'create'; emailVerified: boolean }
  | { action: 'refuse'; error: LinkingRefusal }

export function resolveOAuthIdentity(input: LinkingInput): LinkingPlan {
  const open = (email: string) => accountsOpenTo(input.mode, email, input.staffDomains)
  const { identityAccount, currentAccount, emailAccount, profile } = input

  if (input.intent === 'link') {
    if (!currentAccount) return { action: 'refuse', error: 'link_session_missing' }
    if (identityAccount && identityAccount.id !== currentAccount.id) {
      return { action: 'refuse', error: 'identity_in_use' }
    }
    if (!open(currentAccount.email)) return { action: 'refuse', error: 'accounts_not_open' }
    return identityAccount
      ? { action: 'use_identity', accountId: currentAccount.id }
      : { action: 'link_current', accountId: currentAccount.id }
  }

  if (identityAccount) {
    if (!open(identityAccount.email)) return { action: 'refuse', error: 'accounts_not_open' }
    return { action: 'use_identity', accountId: identityAccount.id }
  }

  if (emailAccount) {
    if (!open(emailAccount.email)) return { action: 'refuse', error: 'accounts_not_open' }
    if (!profile.emailVerified) return { action: 'refuse', error: 'email_in_use_unverified' }
    return {
      action: 'attach_email',
      accountId: emailAccount.id,
      takeover: !emailAccount.emailVerified,
    }
  }

  if (!open(profile.email)) return { action: 'refuse', error: 'accounts_not_open' }
  return { action: 'create', emailVerified: profile.emailVerified }
}

/** The three reads the rules need, in one DB.batch: identity owner, current account, same email. */
export function linkingReadStatements(
  provider: OAuthProviderId,
  subject: string,
  linkAccountId: string | null,
  email: string,
): Statement[] {
  return [
    {
      sql: `SELECT a.id, a.email, a.email_verified_at FROM auth_identities i
            JOIN accounts a ON a.id = i.account_id WHERE i.provider = ?1 AND i.subject = ?2`,
      params: [provider, subject],
    },
    {
      sql: `SELECT id, email, email_verified_at FROM accounts WHERE id = ?1`,
      params: [linkAccountId ?? ''],
    },
    { sql: `SELECT id, email, email_verified_at FROM accounts WHERE email = ?1`, params: [email] },
  ]
}

export function toLinkAccount(
  row: { id: string; email: string; email_verified_at: number | null } | undefined,
): LinkAccount | null {
  return row
    ? { id: row.id, email: row.email, emailVerified: row.email_verified_at !== null }
    : null
}

export interface PlanContext {
  provider: OAuthProviderId
  subject: string
  profile: { email: string; emailVerified: boolean; name: string | null }
  state: string
  locale: Locale
  now: number
  /** Used only when the plan creates an account. */
  newAccountId: string
}

export interface PlanResult {
  statements: Statement[]
  accountId: string
  isNew: boolean
}

function insertIdentity(ctx: PlanContext, accountId: string): Statement {
  return {
    sql: `INSERT INTO auth_identities (provider, subject, account_id, email, created_at, last_used_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    params: [ctx.provider, ctx.subject, accountId, ctx.profile.email, ctx.now],
  }
}

function touchIdentity(ctx: PlanContext): Statement {
  return {
    sql: `UPDATE auth_identities SET last_used_at = ?3, email = ?4 WHERE provider = ?1 AND subject = ?2`,
    params: [ctx.provider, ctx.subject, ctx.now, ctx.profile.email],
  }
}

/** The attempt becomes claimable; only a still-pending attempt moves (a replayed callback doesn't). */
export function attemptReadyStatement(state: string, accountId: string, isNew: boolean): Statement {
  return {
    sql: `UPDATE oauth_attempts SET status = 'ready', account_id = ?2, is_new_account = ?3
          WHERE state = ?1 AND status = 'pending'`,
    params: [state, accountId, isNew ? 1 : 0],
  }
}

export function attemptFailedStatement(state: string, error: string): Statement {
  return {
    sql: `UPDATE oauth_attempts SET status = 'failed', error = ?2 WHERE state = ?1 AND status = 'pending'`,
    params: [state, error],
  }
}

/** Statements for a non-refusal plan, ending with the attempt marked ready. */
export function planStatements(
  plan: Exclude<LinkingPlan, { action: 'refuse' }>,
  ctx: PlanContext,
): PlanResult {
  switch (plan.action) {
    case 'use_identity':
      return {
        statements: [touchIdentity(ctx), attemptReadyStatement(ctx.state, plan.accountId, false)],
        accountId: plan.accountId,
        isNew: false,
      }
    case 'link_current':
      return {
        statements: [
          insertIdentity(ctx, plan.accountId),
          attemptReadyStatement(ctx.state, plan.accountId, false),
        ],
        accountId: plan.accountId,
        isNew: false,
      }
    case 'attach_email': {
      const statements: Statement[] = []
      if (plan.takeover) {
        // Someone may have pre-registered this address with a password: the provider just
        // proved who owns it, so that password, its sessions and its consent go.
        statements.push(
          {
            sql: `UPDATE accounts SET password_hash = NULL, password_salt = NULL, kdf_version = NULL,
                    consent_version = NULL, consent_at = NULL, age_confirmed_at = NULL,
                    email_verified_at = ?2, updated_at = ?2
                  WHERE id = ?1 AND email_verified_at IS NULL`,
            params: [plan.accountId, ctx.now],
          },
          { sql: `DELETE FROM sessions WHERE account_id = ?1`, params: [plan.accountId] },
          {
            sql: `UPDATE email_tokens SET used_at = ?2 WHERE account_id = ?1 AND used_at IS NULL`,
            params: [plan.accountId, ctx.now],
          },
        )
      }
      statements.push(
        insertIdentity(ctx, plan.accountId),
        attemptReadyStatement(ctx.state, plan.accountId, false),
      )
      return { statements, accountId: plan.accountId, isNew: false }
    }
    case 'create': {
      const row = newAccountRow({
        id: ctx.newAccountId,
        email: ctx.profile.email,
        locale: ctx.locale,
        displayName: ctx.profile.name,
        now: ctx.now,
        emailVerified: plan.emailVerified,
        consentVersion: null, // consent step (/auth/consent) comes next
        password: null,
      })
      return {
        statements: [
          insertAccountStatement(row),
          insertIdentity(ctx, row.id),
          attemptReadyStatement(ctx.state, row.id, true),
        ],
        accountId: row.id,
        isNew: true,
      }
    }
  }
}
