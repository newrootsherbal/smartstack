-- Phase 2: accounts, sign-in methods, sessions. Devices (users) can belong to an account.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,                       -- crypto.randomUUID()
  email TEXT NOT NULL UNIQUE,                -- trimmed + lowercased by the Worker
  email_verified_at INTEGER,
  password_hash TEXT,                        -- base64url HMAC (§5.2); NULL = no password (Google/Apple only)
  password_salt TEXT,                        -- base64url, 16 random bytes
  kdf_version INTEGER,                       -- client stretching parameters; 1 = PBKDF2-SHA256 600k
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fr')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),  -- admin: granted by SQL only
  consent_version TEXT,                      -- NULL until the person consents (§5.8)
  consent_at INTEGER,
  age_confirmed_at INTEGER,                  -- "I am 14 or older"
  rev INTEGER NOT NULL DEFAULT 0,            -- sync revision (§8)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  last_active_at INTEGER NOT NULL,           -- login or sync; written at most once a day
  inactivity_warned_at INTEGER               -- 3-year inactivity warning sent (§8.6)
);

CREATE TABLE auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  subject TEXT NOT NULL,                     -- the provider's stable user id ("sub")
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT,                                -- as the provider reported it (may be an Apple relay)
  apple_refresh_token TEXT,                  -- Apple only (later): needed to revoke on deletion
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX auth_identities_account ON auth_identities(account_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                       -- hex SHA-256 of the bearer token; the token is never stored
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT CHECK (platform IN ('ios', 'android', 'desktop')),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,                       -- hex SHA-256 of the emailed token
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  email TEXT NOT NULL,                       -- the address it was sent to
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX email_tokens_account ON email_tokens(account_id, purpose);

CREATE TABLE oauth_attempts (
  state TEXT PRIMARY KEY,                    -- random, round-trips through the provider
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  link_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,               -- PKCE
  nonce TEXT NOT NULL,
  claim_hash TEXT NOT NULL,                  -- SHA-256 of the secret only the starting app holds
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'claimed', 'failed')),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  is_new_account INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE auth_throttle (
  key TEXT PRIMARY KEY,                      -- e.g. 'login:email:<sha256>', 'signup:ip:<sha256>'
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Phase 1's anonymous users are devices; a signed-in device points at its account.
ALTER TABLE users ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
CREATE INDEX users_account ON users(account_id);
