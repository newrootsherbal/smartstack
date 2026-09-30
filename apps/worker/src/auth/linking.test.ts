import { describe, expect, it } from 'vitest'
import {
  planStatements,
  resolveOAuthIdentity,
  type LinkAccount,
  type LinkingInput,
  type LinkingPlan,
  type PlanContext,
} from './linking'

const STAFF = ['newrootsherbal.com']
const acc = (id: string, email: string, emailVerified = true): LinkAccount => ({
  id,
  email,
  emailVerified,
})

const base: LinkingInput = {
  intent: 'login',
  profile: { email: 'test.one@example.com', emailVerified: true },
  identityAccount: null,
  currentAccount: null,
  emailAccount: null,
  mode: 'public',
  staffDomains: STAFF,
}

// Rule numbers refer to docs/smartstack-phase2-prompt.md §5.5.
const table: [string, Partial<LinkingInput>, LinkingPlan][] = [
  [
    '1: known identity → that account',
    { identityAccount: acc('A', 'test.one@example.com') },
    { action: 'use_identity', accountId: 'A' },
  ],
  [
    '1: known identity wins over an email match on another account',
    {
      identityAccount: acc('A', 'old@example.com'),
      emailAccount: acc('B', 'test.one@example.com'),
    },
    { action: 'use_identity', accountId: 'A' },
  ],
  [
    '2: link → attach to the signed-in account',
    { intent: 'link', currentAccount: acc('C', 'me@example.com') },
    { action: 'link_current', accountId: 'C' },
  ],
  [
    '2: link, identity already on this account → nothing new',
    {
      intent: 'link',
      currentAccount: acc('C', 'me@example.com'),
      identityAccount: acc('C', 'me@example.com'),
    },
    { action: 'use_identity', accountId: 'C' },
  ],
  [
    '2: link, identity belongs to another account → 409',
    {
      intent: 'link',
      currentAccount: acc('C', 'me@example.com'),
      identityAccount: acc('A', 'other@example.com'),
    },
    { action: 'refuse', error: 'identity_in_use' },
  ],
  [
    '2: link, the signed-in account is gone → refused',
    { intent: 'link', currentAccount: null },
    { action: 'refuse', error: 'link_session_missing' },
  ],
  [
    '2: link ignores an email match (the signed-in account decides)',
    {
      intent: 'link',
      currentAccount: acc('C', 'me@example.com'),
      emailAccount: acc('B', 'test.one@example.com'),
    },
    { action: 'link_current', accountId: 'C' },
  ],
  [
    '3: same email, provider verified, account verified → attach',
    { emailAccount: acc('B', 'test.one@example.com', true) },
    { action: 'attach_email', accountId: 'B', takeover: false },
  ],
  [
    '3: same email, provider verified, account never verified → attach and take over',
    { emailAccount: acc('B', 'test.one@example.com', false) },
    { action: 'attach_email', accountId: 'B', takeover: true },
  ],
  [
    '3: same email, provider did not verify it → email_in_use_unverified',
    {
      profile: { email: 'test.one@example.com', emailVerified: false },
      emailAccount: acc('B', 'test.one@example.com', true),
    },
    { action: 'refuse', error: 'email_in_use_unverified' },
  ],
  ['4: nobody → create, verified', {}, { action: 'create', emailVerified: true }],
  [
    '4: nobody → create, unverified when the provider says so',
    { profile: { email: 'test.one@example.com', emailVerified: false } },
    { action: 'create', emailVerified: false },
  ],
  [
    'staff: new non-staff address → accounts_not_open',
    { mode: 'staff' },
    { action: 'refuse', error: 'accounts_not_open' },
  ],
  [
    'staff: new staff address → create',
    { mode: 'staff', profile: { email: 'staff@newrootsherbal.com', emailVerified: true } },
    { action: 'create', emailVerified: true },
  ],
  [
    'staff: known identity on a non-staff account → accounts_not_open',
    { mode: 'staff', identityAccount: acc('A', 'test.one@example.com') },
    { action: 'refuse', error: 'accounts_not_open' },
  ],
  [
    'staff: known identity on a staff account, personal Google address → allowed',
    { mode: 'staff', identityAccount: acc('A', 'staff@newrootsherbal.com') },
    { action: 'use_identity', accountId: 'A' },
  ],
  [
    'staff: same email outside the staff domain → accounts_not_open',
    { mode: 'staff', emailAccount: acc('B', 'test.one@example.com') },
    { action: 'refuse', error: 'accounts_not_open' },
  ],
  [
    'staff: linking to a staff account → allowed',
    { mode: 'staff', intent: 'link', currentAccount: acc('C', 'staff@newrootsherbal.com') },
    { action: 'link_current', accountId: 'C' },
  ],
  [
    'off: nothing is open',
    { mode: 'off', identityAccount: acc('A', 'staff@newrootsherbal.com') },
    { action: 'refuse', error: 'accounts_not_open' },
  ],
]

describe('resolveOAuthIdentity (§5.5)', () => {
  it.each(table)('%s', (_name, overrides, expected) => {
    expect(resolveOAuthIdentity({ ...base, ...overrides })).toEqual(expected)
  })
})

describe('plan statements', () => {
  const NOW = Date.UTC(2026, 9, 1, 14, 0, 0)
  const ctx: PlanContext = {
    provider: 'google',
    subject: '1234567890',
    profile: { email: 'test.one@example.com', emailVerified: true, name: 'Test One' },
    state: 'STATE',
    locale: 'fr',
    now: NOW,
    newAccountId: 'NEW',
  }

  it('creates the account without consent, then the identity, then marks the attempt ready', () => {
    const r = planStatements({ action: 'create', emailVerified: true }, ctx)
    expect(r).toMatchObject({ accountId: 'NEW', isNew: true })
    expect(r.statements.map((s) => s.sql.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'INSERT INTO accounts',
      'INSERT INTO auth_identities',
      'UPDATE oauth_attempts SET',
    ])
    const insert = r.statements[0]!.params
    expect(insert.slice(0, 3)).toEqual(['NEW', 'test.one@example.com', NOW]) // verified now
    expect(insert.slice(3, 6)).toEqual([null, null, null]) // no password
    expect(insert.slice(6, 8)).toEqual(['Test One', 'fr'])
    expect(insert.slice(8, 11)).toEqual([null, null, null]) // consent step comes next
    expect(r.statements[2]!.params).toEqual(['STATE', 'NEW', 1])
    expect(r.statements[2]!.sql).toMatch(/status = 'pending'/)
  })

  it('takes over a never-verified account: password, sessions and consent go', () => {
    const r = planStatements({ action: 'attach_email', accountId: 'B', takeover: true }, ctx)
    const sql = r.statements.map((s) => s.sql).join('\n')
    expect(sql).toMatch(/password_hash = NULL, password_salt = NULL/)
    expect(sql).toMatch(/consent_version = NULL/)
    expect(sql).toMatch(/email_verified_at IS NULL/)
    expect(sql).toMatch(/DELETE FROM sessions WHERE account_id = \?1/)
    expect(r).toMatchObject({ accountId: 'B', isNew: false })
  })

  it('attaches to a verified account without touching it', () => {
    const r = planStatements({ action: 'attach_email', accountId: 'B', takeover: false }, ctx)
    expect(r.statements).toHaveLength(2)
    expect(r.statements[0]!.sql).toMatch(/INSERT INTO auth_identities/)
  })

  it('refreshes a known identity', () => {
    const r = planStatements({ action: 'use_identity', accountId: 'A' }, ctx)
    expect(r.statements[0]!.sql).toMatch(/UPDATE auth_identities SET last_used_at/)
    expect(r.statements[1]!.params).toEqual(['STATE', 'A', 0])
  })
})
