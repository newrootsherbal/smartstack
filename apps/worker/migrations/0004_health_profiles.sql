-- Phase 2: optional health profile (sensitive information, express consent, §4.11).

CREATE TABLE health_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  birth_year INTEGER CHECK (birth_year BETWEEN 1900 AND 2100),
  gender TEXT CHECK (gender IN ('woman', 'man', 'non_binary', 'another', 'prefer_not')),
  pregnancy TEXT CHECK (pregnancy IN ('pregnant', 'breastfeeding', 'trying', 'none', 'prefer_not')),
  conditions TEXT NOT NULL DEFAULT '[]',     -- JSON array of codes from HEALTH_CONDITIONS (packages/shared)
  goals TEXT NOT NULL DEFAULT '[]',          -- JSON array of codes from HEALTH_GOALS
  diet TEXT NOT NULL DEFAULT '[]',           -- JSON array: vegan, vegetarian, gluten_free, dairy_free, low_carb
  avoids TEXT NOT NULL DEFAULT '[]',         -- JSON array: soy, dairy, gluten, nuts, fish_shellfish, eggs
  activity TEXT CHECK (activity IN ('low', 'moderate', 'high')),
  storage_consent_at INTEGER NOT NULL,       -- express consent to store the profile
  targeting_consent_at INTEGER,              -- NULL = never use it to target news (the default)
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev INTEGER NOT NULL
);
