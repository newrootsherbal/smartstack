-- New Roots SmartStack — delivery mirror only.
-- Timestamps are INTEGER epoch milliseconds written by JS. Never datetime('now').
-- Routine and stack never reach this database.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tz TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'desktop')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_success_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('schedule', 'test')),
  scheduled_at INTEGER NOT NULL,
  slot_key TEXT NOT NULL,
  product_ids TEXT NOT NULL, -- JSON array of product ids
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  sent_at INTEGER,
  UNIQUE (user_id, scheduled_at, slot_key)
);

CREATE INDEX reminders_status_scheduled ON reminders(status, scheduled_at);
CREATE INDEX reminders_user_kind_status ON reminders(user_id, kind, status);
