-- Phase 2: news notifications (opt-in per device, campaigns composed by staff admins).

ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';   -- the device's app language
ALTER TABLE users ADD COLUMN news_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN news_opt_in_at INTEGER;              -- last time it was turned on
ALTER TABLE users ADD COLUMN news_opt_out_at INTEGER;             -- last time it was turned off
ALTER TABLE users ADD COLUMN last_news_at INTEGER;                -- frequency cap: 1 per 24 h

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                        -- internal
  title_en TEXT NOT NULL,
  title_fr TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_fr TEXT NOT NULL,
  url TEXT NOT NULL,                         -- https, allowlisted host, UTM included
  audience TEXT NOT NULL,                    -- JSON: {"type":"all"} or {"type":"segment","conditions":[…],
                                             --   "goals":[…],"genders":[…],"ageMin":…,"ageMax":…,"pregnancy":[…]}
  send_at INTEGER,                           -- NULL while draft
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  cursor INTEGER NOT NULL DEFAULT 0,         -- last push_subscriptions.id processed
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX campaigns_status_send ON campaigns(status, send_at);
CREATE INDEX users_news ON users(news_opt_in);
