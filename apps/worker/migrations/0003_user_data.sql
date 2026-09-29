-- Phase 2: what an account's devices sync. Written only through POST /api/sync.

CREATE TABLE account_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  routine TEXT,                              -- JSON Routine (shared schema); NULL before onboarding
  tz TEXT,
  locale TEXT CHECK (locale IN ('en', 'fr')),
  theme TEXT,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL
);

-- Products the person added by hand: other brands, medications, foods.
CREATE TABLE user_products (
  id TEXT PRIMARY KEY,                       -- 'u_' + UUID, created on the device
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL CHECK (product_type IN ('nhp', 'medication', 'food', 'other')),
  brand TEXT,                                -- required except for medications (company, optional)
  name TEXT NOT NULL,
  upc TEXT,                                  -- digits only, valid check digit (UPC-A, EAN-13, EAN-8)
  npn TEXT,                                  -- 8 digits, natural health products
  din TEXT,                                  -- 8 digits, medications
  strength TEXT,                             -- medications, e.g. '50 mcg'
  form TEXT NOT NULL CHECK (form IN ('capsule', 'tablet', 'softgel', 'powder', 'liquid', 'other')),
  dose_unit TEXT NOT NULL,                   -- 'capsule', 'drop', 'ml', 'g', 'scoop', … (unitLabel vocabulary)
  units_per_dose REAL NOT NULL CHECK (units_per_dose > 0),
  doses_per_day INTEGER NOT NULL CHECK (doses_per_day BETWEEN 1 AND 4),
  package_quantity REAL,                     -- 30, 50, 300…
  package_unit TEXT CHECK (package_unit IN ('unit', 'ml', 'g')),
  timing TEXT NOT NULL DEFAULT '[]',         -- JSON: 'WITH_FOOD','WITHOUT_FOOD','MORNING','EVENING','BEDTIME'
  ingredients TEXT NOT NULL DEFAULT '[]',    -- JSON: [{ ingredientId|null, name, amount|null, unit|null }]
  directions TEXT,
  warnings TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX user_products_account_rev ON user_products(account_id, rev);
CREATE INDEX user_products_upc ON user_products(upc);

CREATE TABLE stack_items (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,                  -- catalogue id, or user_products.id ('u_…')
  doses_per_day INTEGER NOT NULL CHECK (doses_per_day BETWEEN 1 AND 4),
  pins TEXT NOT NULL DEFAULT '[]',           -- JSON: chosen anchor per dose index, null = engine decides
                                             --   e.g. ["bedtime"]; anchors: wake, breakfast, lunch, dinner, bedtime
  dismissed TEXT NOT NULL DEFAULT '[]',      -- JSON: dismissed suggestions, e.g. ["SUGGEST_BEDTIME"]
  units_per_dose REAL,                       -- only when the label gives none
  variant_upc TEXT,                          -- the size they have, when known
  inv_remaining REAL,                        -- units or servings left; NULL = not tracked
  inv_unit TEXT CHECK (inv_unit IN ('unit', 'serving')),
  inv_package_size REAL,                     -- full bottle; default refill amount
  low_flagged_at INTEGER,                    -- flagged "running low" for this bottle
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev INTEGER NOT NULL,
  PRIMARY KEY (account_id, product_id)
);
CREATE INDEX stack_items_account_rev ON stack_items(account_id, rev);

CREATE TABLE shopping_items (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('low', 'manual', 'alternative')),
  replaces_product_id TEXT,                  -- 'alternative': the other-brand product it would replace
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,                        -- removed or refilled
  rev INTEGER NOT NULL,
  PRIMARY KEY (account_id, product_id)
);
CREATE INDEX shopping_items_account_rev ON shopping_items(account_id, rev);

-- Today's check marks, so two devices agree. Deleted by the daily cron after 3 days.
CREATE TABLE dose_checks (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                         -- local date, YYYY-MM-DD
  product_id TEXT NOT NULL,
  dose_index INTEGER NOT NULL,
  units REAL NOT NULL DEFAULT 0,             -- taken off the bottle; restored when unticked
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,                        -- unticked
  rev INTEGER NOT NULL,
  PRIMARY KEY (account_id, day, product_id, dose_index)
);
CREATE INDEX dose_checks_account_rev ON dose_checks(account_id, rev);
