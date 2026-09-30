# New Roots SmartStack

Supplement-scheduling app for New Roots Herbal. Scan a product barcode, build your
"stack", enter your daily routine, and a deterministic rules engine generates a
personalized daily schedule with reminders and a "More info" sheet for every product.

> **Phase 1 status: sample data only.** Every product and rule in this repository is a
> placeholder for testing. Nothing here is reviewed, and nothing is medical advice. The app
> shows a permanent banner saying so.

## Principles

1. **The engine is deterministic code driven by a rules database. It is not AI.** Every rule
   carries an evidence source, a last-reviewed date and a reviewer (all `unreviewed` / `null`
   in Phase 1).
2. **The app never says a dose is unsafe.** It says "Review recommended" and points to a
   healthcare professional.
3. Five severity levels, exactly as in the pitch: **Important** (red, "Action required"),
   **Timing conflict** (orange, "Action recommended"), **Consideration** (yellow),
   **Product instruction** (blue), **Informational** (outline). Seed rules use only the middle
   three. All five are shown on `/dev/styleguide`.
4. Accounts are optional (guest mode works as in Phase 1). No analytics, no third-party
   scripts, no third-party CDN loads.
5. Bilingual: no user-facing string lives in the engine; all copy is in
   `apps/web/src/i18n/en.json` and `fr.json` (same keys, checked by a test), catalogue text
   carries `{ en, fr }`, and Profile → Language switches the language (picked from the browser's
   preferred languages on first launch).

## Architecture

**PWA first, app stores later.** Phase 1 ships as an installable web app with zero store
fees. The same web build is later wrapped with Capacitor 8; nothing in Phase 1 may make that
harder (device features live behind `apps/web/src/platform/*`).

| Layer         | Decision                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Front end     | React 19 + Vite + TypeScript, `vite-plugin-pwa` (`injectManifest`, hand-written `src/sw.ts`), react-router v7, plain CSS           |
| State         | One React context + `useReducer`, persisted to localStorage through a typed `src/storage.ts`                                       |
| Rules engine  | `packages/engine`: pure, zone-free TypeScript, Vitest-tested, no DOM / Cloudflare imports                                          |
| Shared        | `packages/shared`: types + zod schemas used by the engine, the web app and the Worker                                              |
| Hosting + API | **One Cloudflare Worker** (free plan): serves `apps/web/dist` as static assets, handles `/api/*`, runs a Cron Trigger every minute |
| Database      | Cloudflare D1 (free). Delivery mirror only: users, push subscriptions, reminder rows                                               |
| Push          | Standard Web Push with VAPID, sent from the Worker with `@block65/webcrypto-web-push`                                              |
| Catalogue     | Static JSON in `packages/engine/data/`, generated from newrootsherbal.com by `npm run data:import:website`, bundled, never fetched |
| Scanner       | Native `BarcodeDetector` when it supports our formats (Android Chrome), else the ZXing WASM ponyfill served from our origin        |

One origin for the app and the API, so there is no CORS. In development Vite (5173)
proxies `/api` to `wrangler dev` (8787).

### Repository layout

```
apps/web         React PWA (screens, platform adapters, sync layer, service worker)
apps/worker      Cloudflare Worker (hono routes, cron sender, D1 migrations)
packages/engine  Rules engine + seed data + validator + CSV importer
packages/shared  Types and zod schemas (catalogue, routine, engine output, API bodies)
docs/            Pitch PDF, Phase 1 prompt, data template for the product team
```

`packages/*` export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`);
there is no build step for them.

### Where data lives

- **The browser's localStorage is the source of truth** for guests: routine, stack, bottle
  counts, shopping list and today's check marks (`smartstack:v1`, a versioned blob; version 2
  since Phase 2, migrated from version 1 on load by `src/storage.ts`). If it is wiped, the user
  re-onboards.
- For guests, the server stores only what is needed to deliver reminders. **A guest's routine
  and stack are never sent to the server** (an account syncs them: see [Sync](#sync-apisync)).
  Reminder rows carry the notification text; by default that text only says how many products
  to take ("Time for 3 products — 9:30 AM") and no product id is sent.
  Notifications → "Show product names in reminders" puts the names (and ids) back.
- The app makes **no network call** until the user taps "Turn on reminders." Afterwards it
  syncs a rolling 7-day window on every change and on every app open, and retries on the next
  open if offline.

### Bottles and the shopping list

Five tabs: Today, My stack, Add, Shopping, Profile (Profile holds what Settings held, and
Notifications replaced the Reminders screen; `/settings` and `/reminders` redirect). Adding a
product asks about the bottle: **New bottle** (the scanned barcode, or a size chip, says how much
it holds), **Already opened** ("How many are left?") or **Don't track**. Capsules, softgels and
tablets are counted one by one; liquids and powders in servings (`parsePackageSize` in
`packages/engine/src/inventory.ts` reads "= 32 doses", "/ 50 portions", "30 × 4.2 g", or divides
the bottle by the serving when both are in ml or g; a liquid serving given only as a household
measure counts as 5 ml a teaspoon, 15 ml a tablespoon and 20 drops per ml; otherwise the app
asks, for example a teaspoon of powder without its weight). Ticking a dose
on Today takes one dose off the bottle and unticking gives it back. At 5 days of use or less the
product joins the shopping list once per bottle with a "running low" sheet; Refill ("5 + 30 =
35") clears it. My stack's **Manage** sheet holds times per day, Refill, Edit count, Move to…
(a pin), Add to shopping list, More info and Remove. Bottles and the list work for guests too.

### Other brands, medications and foods

Accounts can add products that aren't in the catalogue (Add → Other brand, or "Add it manually"
from the unknown-barcode sheet): a natural health product (NPN), a medication (DIN) or a food,
drink or anything else. "Fill from Health Canada" prefills the form through the Worker
(`/api/lookup/…`); the person reviews every field. They are stored as `UserProduct`s (`u_…`)
in the device state, synced to `user_products`, and merged into the catalogue by
`useCatalogue()` / `catalogueFor()` (`apps/web/src/catalogue.ts`), so the scheduler, the
reminders, the bottles and the duplicates treat them like any other product. A medication's
doses are pinned to the times the person chose, never moved, and its ingredients still push
supplements away (a calcium supplement moves away from an iron medication); the form and More
info show N3 (SmartStack doesn't check medication interactions).

### Engine in one paragraph

Every product starts at breakfast (or the first available meal). Fixed-anchor rules move it
(`BEDTIME` > `EVENING` > `MORNING` > meal preference > plain `WITH_FOOD`). A time the person
picked (a pin, `StackItem.pins`: wake-up, breakfast, lunch, dinner or bedtime) beats every rule.
Then, for every product with `SEPARATE_FROM_*` rules, if a conflicting product (or the coffee
time) is within the separation window, the dose moves to the earliest time ≥ conflict +
separation that clears every conflict, rounded up to 15 minutes. A pinned dose never moves: the
other product moves instead, and when both are pinned they stay and the later one carries a
timing-conflict reason. `SUGGEST_BEDTIME` (magnesium) never moves anything: it offers "Move to
bedtime" on the day's last dose until the person accepts (a bedtime pin) or says no thanks. One
adjustment code per product whose final time differs from its baseline (`MOVED_BY_YOU` for a
pin). Extra doses take dinner, then lunch, then breakfast, then bedtime.
Rules attach to ingredients; a product may disable inherited rules (`ruleOverrides.disable`).
Duplicate ingredients are listed whenever two or more stack products contain the same
ingredient, with amounts and the sum, never compared to any reference intake.

The person's own products (other brands, medications, foods; accounts only) are `UserProduct`s
turned into engine products on the device: `mergeCatalogue(catalogue, userProducts)` appends
`toEngineProduct` (id `u_…`, status `user`, the person's doses as label defaults, ingredients
recognized by id or name and converted to canonical units as the importer does; anything else
stays free text) and `userRules` (the label checkboxes as product-level `product_instruction`
rules `user:{id}:{attribute}`). The web hook memoizes the merge and passes it to every lookup,
`buildSchedule` and `findDuplicateIngredients`. A **medication** has no rules and is never
moved: its doses stay at the times the person gave (an unpinned dose stays where it lands, at
the first meal), it carries no reasons or adjustment, and it is left out of duplicates and
alternatives, but the separation rules its ingredients carry move the other products away (an
iron medication moves a calcium supplement, never the reverse). `suggestAlternatives` offers
at most two New Roots Herbal products for another brand's product: curated entries from
`data/alternatives.json` first, then a score over shared canonical ingredients (daily amounts,
same form, distinctive name words), each with the facts behind it.

## Development

Requirements: Node 22 (`.nvmrc`), npm 11. Do not use pnpm or yarn.

```bash
npm install
npm run dev            # web app on http://localhost:5173 (proxies /api to 8787)
npm run dev:worker     # Worker on http://localhost:8787 (wrangler dev --test-scheduled, local D1)
npm test               # all Vitest projects (shared, engine, worker, web)
npm run check          # typecheck + lint + prettier + tests
npm run data:validate  # validate packages/engine/data/*.json
npm run build          # production build of the web app into apps/web/dist
```

First time only, create the local D1 tables (and again after pulling a new migration):

```bash
npm run db:migrate:local -w apps/worker
```

Accounts need `AUTH_PEPPER` in `apps/worker/.dev.vars` (generate it as `.dev.vars.example`
says). `npm run dev:worker` runs with `EMAIL_MODE=log`: verification and reset emails are not
sent, their links are printed in the wrangler console instead.

Fire the cron locally (the Worker must be running with `--test-scheduled`):

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Inspect the local database:

```bash
npx wrangler d1 execute smartstack --local --command "SELECT kind, status, attempts, slot_key FROM reminders"
```

Android phone against the local dev server (USB debugging on):

```bash
adb reverse tcp:5173 tcp:5173
```

then open `http://localhost:5173` on the phone. `localhost` is a secure context, so the
camera and Web Push work without HTTPS.

Regenerate icons (from `apps/web/public/icon.svg`) and the placeholder manifest screenshots:

```bash
npm run assets -w apps/web
```

### Product data

The app ships the real New Roots Herbal catalogue, generated from the website's public,
price-free AI catalog (`https://newrootsherbal.com/llms.txt`):

```bash
npm run data:import:website              # uses packages/engine/data/.cache/website, fetches what is missing
npm run data:import:website -- --refresh # re-downloads every record
```

The importer (`packages/engine/scripts/import-website.ts`, parsers in
`packages/engine/src/import/`) keeps every product that has a valid barcode, then writes:

- `data/products.json`: one product per website record with EN/FR name, subtitle, suggested
  use, warnings, every variant's SKU and UPC, canonical ingredient amounts, the label's default
  times per day and units per dose, `status: 'draft'` and `reviewStatus: 'unreviewed'`.
- `data/ingredients.json`: canonical nutrient ids (`iron`, `vitamin-d`, `epa`, `probiotic`…)
  with fixed units and EN/FR names; other ingredients keep the label's own words, with the
  French words when the French facts line up. Vitamin D given in IU is converted to mcg;
  probiotic strains are summed as CFU.
- `data/rules.generated.json`: product-level rules read from the label's suggested use ("with
  food", "at bedtime", "with water"…) and the refrigeration flag, each quoting the label sentence
  and linking the product page as its source.

Hand-curated ingredient-level rules stay in `data/rules.json`. The importer writes
`data/import-report.md` (skipped records such as essential oils and foods, parser warnings) and
writes nothing if the merged catalogue fails validation. The original ten-product sample
catalogue lives in `data/sample/` as a test fixture. `docs/data-template.md` remains for
products the website does not list.

`data/alternatives.json` holds the product team's New Roots Herbal alternatives for other
brands' products (`[]` until filled): `{ match: { upc } | { brand, name }, productId,
reviewStatus, lastReviewed, reviewedBy }`. `npm run data:validate` checks it (the product
exists and is not topical, check digits, review fields, repeats). The monthly other-brand report
that feeds it is a D1 query in `docs/smartstack-phase2-setup.md`, part H (counts only, no
account ids, medications excluded).

#### Keeping the catalogue current

The catalogue is bundled at build time, so it changes only when the importer runs and the app
is redeployed. Three GitHub Actions workflows in `.github/workflows/` take care of that:

- `ci.yml`: typecheck, lint, format, tests and build on every push to `main` and on every
  pull request.
- `refresh-catalogue.yml`: every Monday at 05:17 Montreal time (and on demand from the Actions
  tab) re-downloads every product record, runs the importer, validates, tests and builds with
  the new data, then opens or updates a pull request on the `catalogue/refresh` branch with
  `data/import-report.md` as its description. When nothing changed it does nothing. If the
  checks fail on the new data (a test pins a product fact that the website changed), the pull
  request is still opened, flagged "checks failed", and the run goes red. The importer refuses a
  catalogue more than 10% smaller than the committed one unless the manual run is started with
  the `allow_shrink` input; it also refuses a partial download. GitHub may delay scheduled runs
  by minutes or, rarely, hours; a manual run is always available.
- `deploy.yml`: on every push to `main` (so merging that pull request ships the data) runs the
  checks, builds, applies new D1 migrations (`wrangler d1 migrations apply --remote`) and runs
  `wrangler deploy`. Every migration must be additive, so the running code keeps working
  between the two steps.
- `deploy-staging.yml`: manual (Actions → Deploy staging → Run workflow, any branch): the same
  checks, a staging build, staging migrations and `wrangler deploy --env staging`.

One-time setup, all in the GitHub repository settings once the code is pushed there:

1. Actions → General → Workflow permissions: tick "Allow GitHub Actions to create and approve
   pull requests" (otherwise `gh pr create` is refused). Add a branch protection rule on `main`
   (require a pull request), since the refresh job holds a token that can push.
2. Secrets and variables → Actions: add `CLOUDFLARE_API_TOKEN` (an API token on the
   newrootsherbal account with Account → Workers Scripts → Edit and Account → D1 → Edit, so
   the deploy can apply migrations) and `CLOUDFLARE_ACCOUNT_ID` (shown by `wrangler whoami`).

Because the pull request is opened with the workflow's own token, GitHub holds `ci.yml` on it
until someone clicks "Approve and run"; the refresh job runs the same full check before opening
it, so the data is validated either way. In a public repository GitHub disables schedules after
60 days without commits (private repositories are not affected); a manual run re-enables them.

### Themes

Profile → Theme offers seven colour themes: Rooted (the default), Fresh, Blush, Bold, Ice,
Energy and Wild. Each is one block of CSS custom properties in `apps/web/src/styles/themes.css`,
selected by `data-theme` on `<html>`; the choice is stored with the rest of the local state
and never leaves the device. `index.html` applies the stored theme inline before the first
paint, and the theme-color meta tag follows the theme's background.

### Developer pages

- `/dev/barcodes` renders any product's UPC-A (one per size) large enough to scan off a monitor,
  plus the sample fixtures' EAN-13 codes (GS1 prefix `200`, never assigned to retail products).
- `/dev/styleguide` shows the five severity badges, buttons, notices, inputs and tokens.

Both are reachable from Profile → Developer. Scanning a barcode that is not a New Roots
Herbal natural health product shows "Product not found."

### Environment

| File                        | Committed | Contents                                                                                                                                                                                                                                                                                                                |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env`             | yes       | Production build: `VITE_VAPID_PUBLIC_KEY` (public), `VITE_BETA_KEY` (speed bump), `VITE_ACCOUNTS_MODE`, `VITE_APPLE_ENABLED`                                                                                                                                                                                            |
| `apps/web/.env.development` | yes       | `vite` dev server overrides (`VITE_ACCOUNTS_MODE=public`)                                                                                                                                                                                                                                                               |
| `apps/web/.env.staging`     | yes       | `vite build --mode staging` overrides                                                                                                                                                                                                                                                                                   |
| `apps/web/.env.local`       | **no**    | Optional override of `VITE_VAPID_PUBLIC_KEY` for local testing                                                                                                                                                                                                                                                          |
| `apps/worker/wrangler.toml` | yes       | Vars (`VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `MAX_PUSHES_PER_TICK`, `BETA_KEY`, `APP_ORIGIN`, `ACCOUNTS_MODE`, `STAFF_EMAIL_DOMAINS`, `APPLE_ENABLED`, `GOOGLE_CLIENT_ID`, `EMAIL_MODE`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `CONSENT_VERSION`, `NEWS_URL_HOSTS`), D1 binding, cron; `[env.staging]` repeats them for staging |
| `apps/worker/.dev.vars`     | **no**    | Local secrets for `wrangler dev`: `VAPID_PRIVATE_KEY` (and optionally `VAPID_PUBLIC_KEY`), `AUTH_PEPPER`, `GOOGLE_CLIENT_SECRET`, optionally `SMTP2GO_API_KEY` (see `.dev.vars.example`)                                                                                                                                |
| Cloudflare secret           | n/a       | `wrangler secret put NAME` for `VAPID_PRIVATE_KEY`, `AUTH_PEPPER`, `GOOGLE_CLIENT_SECRET`, `SMTP2GO_API_KEY` (add `--env staging` for staging)                                                                                                                                                                          |

**Accounts launch gate.** `ACCOUNTS_MODE` (Worker) and `VITE_ACCOUNTS_MODE` (web build) are
`off`, `staff` or `public`; anything else counts as `off`. Local (`npm run dev`,
`npm run dev:worker`) and staging use `public`. Production uses `staff` (only addresses in
`STAFF_EMAIL_DOMAINS` can sign up or log in, and the public UI shows no account features) until
the Law 25 launch checklist in `docs/smartstack-phase2-setup.md` (part F) is done.

Generate the real VAPID pair **once** with `npx web-push generate-vapid-keys` and store it in
the company password manager. If the keys change, every phone must re-subscribe. The
`web-push` npm package is never used at runtime. Until the public key is filled in, the
"Turn on reminders" button is disabled and says so.

For local experiments a throwaway pair can live in `.dev.vars` and `.env.local` (both
gitignored). Never put a throwaway public key in the committed `.env`: a subscription made
against one public key is useless with another.

## Worker and API

Two bearer credentials on separate prefixes. `/api/me/…` takes
`Authorization: Bearer <anonymous uuid>` (the Phase 1 device id): unknown ids get `401`, except
`PUT /api/me`, which creates the device and requires `X-Beta-Key`. `/api/auth/…`,
`/api/account/…`, `/api/sync` and `/api/lookup/…` take the **session token**
(`Authorization: Bearer <token>`). Every request body is validated with the shared zod schemas
(`packages/shared/src/index.ts`, `auth.ts`, `sync.ts`, `lookup.ts`); errors are `{ error, detail? }`,
and every API response has `Cache-Control: no-store`.

| Route                              | Purpose                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/me`                      | Create or update `{ tz, platform, locale? }` (`locale`: `en` or `fr`, the app language; absent = unchanged)          |
| `DELETE /api/me`                   | Delete the user, subscriptions and reminders                                                                         |
| `POST /api/me/push-subscription`   | Upsert `{ endpoint, keys }` (≤ 5 per user)                                                                           |
| `DELETE /api/me/push-subscription` | Remove one endpoint                                                                                                  |
| `PUT /api/me/schedule`             | Replace the pending, future `schedule` rows with the browser's 7-day window (≤ 200); never touches sent              |
| `POST /api/me/test-reminder`       | One `test` reminder 2 minutes out, at most once per 2 minutes                                                        |
| `PUT /api/me/news`                 | `{ optIn }` → `{ ok, optIn }`: news on this device (C6); stamps `news_opt_in_at` / `news_opt_out_at` when it changes |

### Accounts (`/api/auth/…`, `/api/account/…`)

All of these answer `404` while `ACCOUNTS_MODE` is `off`. In `staff` mode, sign-up, login and
Google sign-in (at the callback, once the address is known) answer `403 accounts_not_open` for
addresses outside `STAFF_EMAIL_DOMAINS` (an existing session can still log out, export and
delete its account). Throttled routes answer `429 rate_limited` with `Retry-After`. Code: `apps/worker/src/account-api.ts`
(routes), `apps/worker/src/auth/*` (pure, unit-tested parts), `apps/worker/src/email.ts`.

| Route                                 | Auth              | Body → answer                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup`               | `X-Beta-Key`      | `{ email, key, name?, locale, consent: true, age14: true, platform? }` → `201 { token, account }`; `409 email_in_use`; sends the verify email; 5 per IP per hour                                                                                                                                |
| `POST /api/auth/login`                | —                 | `{ email, key, platform? }` → `{ token, account, rehash? }`; `401 invalid_credentials`; 5 failures per email and 30 per IP per 15 min                                                                                                                                                           |
| `POST /api/auth/logout`               | session           | `204`, deletes this session                                                                                                                                                                                                                                                                     |
| `POST /api/auth/verify-email`         | —                 | `{ token }` → `{ ok }`; `400 invalid_token` (unknown, used or older than 48 h)                                                                                                                                                                                                                  |
| `POST /api/auth/verify-email/resend`  | session           | `{ ok }`; `409 already_verified`; `503 email_failed`; 3 per email per hour                                                                                                                                                                                                                      |
| `POST /api/auth/password/forgot`      | —                 | `{ email }` → always `{ ok }` (lookup and email happen after the response); 3 per email per hour                                                                                                                                                                                                |
| `POST /api/auth/password/reset`       | —                 | `{ token, key, email }` → `{ ok }`; verifies the email, ends every session; `400 invalid_token` (older than 1 h or used); `400 email_mismatch` (token kept)                                                                                                                                     |
| `POST /api/auth/password/change`      | session           | `{ currentKey, newKey }` → `{ ok }`; ends the other sessions; `401 invalid_credentials`; `409 no_password`                                                                                                                                                                                      |
| `POST /api/auth/oauth/start`          | `X-Beta-Key`      | `{ provider, intent, claimHash, locale }` (+ session for `link`) → `{ url, state }`; Apple `404 provider_disabled`; `503 provider_not_configured`; 20 per IP per 15 min                                                                                                                         |
| `GET /api/auth/oauth/google/callback` | —                 | `303 /auth/done?state=…` (`&error=code` on failure: `cancelled`, `invalid_state`, `identity_in_use`, `email_in_use_unverified`, `accounts_not_open`…)                                                                                                                                           |
| `POST /api/auth/oauth/claim`          | —                 | `{ state, claimSecret, platform? }` → `{ token, account, isNew }`; single use: `409 already_claimed`, `409 not_ready`, `403 invalid_claim`, `410 expired`; 10 per IP per 15 min                                                                                                                 |
| `GET /api/account`                    | session           | `{ id, email, emailVerified, name, locale, role, providers, hasPassword, consentNeeded }`                                                                                                                                                                                                       |
| `POST /api/account/consent`           | session           | `{ age14: true }` → the account; records `CONSENT_VERSION`                                                                                                                                                                                                                                      |
| `POST /api/account/device`            | session           | `{ deviceId }` → `{ ok }`; links the Phase 1 device row; `404 unknown_device`. `DELETE` with the same body unlinks (`204`)                                                                                                                                                                      |
| `DELETE /api/account/identity/:p`     | session           | `204`; `409 last_sign_in_method` when it is the only way to sign in; `404 not_connected`                                                                                                                                                                                                        |
| `GET /api/account/export`             | session           | JSON download (`Content-Disposition: attachment`): account (no password hash or salt), sign-in methods, sessions' platform and dates, linked devices, and the synced data (settings, products, stack, shopping list, check marks; tombstones included, dates in ISO form)                       |
| `DELETE /api/account`                 | session           | `204`; deletes the account row, `ON DELETE CASCADE` removes the rest (linked devices, their subscriptions and reminders included)                                                                                                                                                               |
| `POST /api/sync`                      | session + consent | `{ since, changes }` → `{ rev, changes }` ([Sync](#sync-apisync)); `403 consent_required` (`detail: ["account"]` until the account accepts `CONSENT_VERSION`, `["health"]` for the health profile until M8); `413 payload_too_large` / `too_many_rows`; `409 limit_reached`; `400 invalid_body` |

**Passwords.** The password never leaves the device. The browser derives
`key = PBKDF2-HMAC-SHA256(password NFC, "smartstack/v1/" + lowercased email, 600 000 iterations,
32 bytes)` with WebCrypto and sends `base64url(key)` (`KDF_*` constants in
`packages/shared/src/auth.ts`). The Worker stores `HMAC-SHA256(AUTH_PEPPER, 16-byte random salt ‖
key)` and compares in constant time, which costs microseconds. Stretching happens in the browser
because the Worker can't do it: production Workers cap WebCrypto PBKDF2 at 100 000 iterations
(`wrangler dev` doesn't enforce the cap, so it would only fail once deployed), already below
current guidance, and even that would very likely exceed the free plan's 10 ms of CPU per request.
Whoever steals the database still needs 600 000 PBKDF2 iterations per guess per account, and the
pepper (Bitwarden's model). `kdf_version` records the parameters; raising them later makes login
answer `rehash: true` so the client sends a new key. The email is part of the salt, so changing an
address isn't offered. Never change the production `AUTH_PEPPER` once accounts exist: every
password would stop working. Without it (or shorter than 32 characters) the password routes
answer `500 server_misconfigured` and log why; everything else keeps working.

**Sessions** are 32 random bytes (base64url); D1 keeps only the hex SHA-256. They end after 90 days
without use; `expires_at`, `last_used_at` and the account's `last_active_at` slide at most once a
day. Emailed tokens (verify 48 h, reset 1 h) are hashed the same way, single use, and travel in the
link's fragment (`/verify-email#token=…`). A reset link also carries the address
(`/reset-password#token=…&email=…`): the browser needs it to derive the new key, and the Worker
only consumes the token when the address matches, so a typo can't lock anyone out. Throttling uses fixed windows in D1 (`auth_throttle`,
keys are hashes of the email or IP).

**Google sign-in** is a plain OAuth redirect (no Google script): start → Google → callback → claim
(`docs/smartstack-phase2-prompt.md` §5.4), PKCE S256, state, nonce, `prompt=select_account`, built
with `arctic`. The ID token comes straight from Google's token endpoint over TLS; `iss`, `aud`,
`exp` and `nonce` are checked and `email_verified` read. The redirect URI is
`${APP_ORIGIN}/api/auth/oauth/google/callback` and must be registered on the Google client.
The linking rules are `resolveOAuthIdentity` in `apps/worker/src/auth/linking.ts`. Sign in with
Apple is accepted by the schema and answers `404 provider_disabled` until it is built and
`APPLE_ENABLED` is `"true"`.

**Emails** (verify, reset, password changed, and the inactive-account warning N8/N9 for later)
are plain text plus minimal HTML in the account's language. `EMAIL_MODE=smtp2go` posts to
SMTP2GO's HTTP API (`SMTP2GO_API_KEY`, sender `EMAIL_FROM`, optional `EMAIL_REPLY_TO`); with no
sender or key the email is skipped and an error without the address is logged. `EMAIL_MODE=log`
(local only, refused for a non-localhost `APP_ORIGIN`) prints the link in the wrangler console.

`consentNeeded` is true until the account consents to the current `CONSENT_VERSION` (email
sign-up records it; Google accounts consent on `/auth/consent`); `consentNeeded()` in
`apps/worker/src/auth/account.ts` is the gate `/api/sync` uses.

### Sync (`/api/sync`)

An account's devices share their settings (routine, time zone, language, theme), their own
products, the stack with its bottles, the shopping list and today's check marks (migration
`0003_user_data.sql`; wire format in `packages/shared/src/sync.ts`, statements in
`apps/worker/src/sync.ts`). One endpoint does both directions:

- **Request** `{ since, changes: { settings?, products[], stack[], shopping[], checks[] } }`.
  `since` is the last `rev` the device applied (0 the first time). Empty `changes` = a pull.
- Every entity carries `updatedAt` (the device's `Date.now()`) and `deletedAt`. A deletion is a
  **tombstone**: the key, `updatedAt` and `deletedAt` only; the server clears the rest of the row.
- **Last write wins** by `updatedAt`; on a tie the server's copy wins. A push bumps
  `accounts.rev` and runs in **one `DB.batch`** (a transaction): the bump, one upsert per table
  (the table's rows travel as one JSON parameter read with `json_each`, so a request never
  approaches D1's 100 bound parameters or 50 queries; about 11 queries at most), then the reads.
- **Answer** `{ rev, changes }`: every row whose revision is newer than `since` (tombstones
  included), except what this request pushed: a pushed row comes back only when it lost, as the
  server's copy. The device stores `rev` as its next `since`; `rev` 0 means the account is empty.
- **Limits**: 512 KB and 500 rows per request (`413`), 200 own products and 60 stack items per
  account, counted as live rows after the push would apply (`409 limit_reached`, checked before
  the batch; deletions alone are never refused).
- **Consent**: `403 consent_required` until the account has accepted the current
  `CONSENT_VERSION`. The health profile syncs from M8; until then sending `health` answers `403`.
- The language lives in `account_settings.locale` only; account emails keep using
  `accounts.locale` (chosen at sign-up). `accounts.last_active_at` slides with the session, at
  most once a day; a pull writes nothing.
- **Retention** (03:00 UTC tick): check marks older than 3 days (by the person's local date; the
  cutoff is the UTC date 12 hours back, minus 3 days, so no time zone loses its last 3 days) and
  tombstones deleted more than 30 days ago. `GET /api/account/export` includes all of it.

**Known limitations.** Bottle counts are last-write-wins: two devices ticking the same product
offline can lose one decrease; edit the count. A device offline for more than 30 days misses
deletions whose tombstones were cleaned up, and could bring such an item back by editing it.
`updatedAt` comes from the device clock: a clock far ahead wins until it's corrected.

**In the app** (`apps/web/src/auth/`, `src/screens/auth/`): `/welcome` is the first screen
while accounts are public and the person hasn't chosen yet (Google, email, "I already have an
account", or "Continue without an account", which keeps today's local-only app). `/signup`,
`/login`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/done` (the OAuth
landing, which claims the session when this browsing context started the attempt and otherwise
says "Return to the SmartStack app"; the app window claims when it becomes visible again) and
`/auth/consent`. The session token lives in `localStorage['smartstack:session']` and a pending
OAuth attempt in `smartstack:oauth`, outside the state blob. Consent and notice texts are the i18n
keys `consent.C1`… and `notice.N1`… copied word for word from `docs/privacy/consent-texts.md`.
Profile shows "Back up & sync" to guests, or the account (email status, sign-in methods,
Download my data, Log out, Delete my account). A 401 on the account keeps local data and shows
"Log in again". While `ACCOUNTS_MODE` is `staff`, the public app shows none of this and staff
find "Staff sign-in" under Profile → Developer.

`/privacy` and `/terms` render `docs/privacy/{privacy-policy,terms}.{en,fr}.md`, converted at build
time into `apps/web/src/legal/content.json` by `npm run legal -w apps/web` (a test fails when it is
stale; `?lang=fr|en` picks a version). They show a "Draft" line until `VITE_LEGAL_DRAFT=false`.

**Trying accounts locally.** Apply the migrations (`npm run db:migrate:local -w apps/worker`),
put a throwaway `AUTH_PEPPER` (any 43-character base64url string) in
`apps/worker/.dev.vars.e2e` (gitignored), run the Worker with
`npm run dev -w apps/worker -- --env-file .dev.vars.e2e` (the `worker-accounts` entry in
`.claude/launch.json`) and the web app with `npm run dev`. Emails are printed in the wrangler
console (`EMAIL_MODE=log`).

### Health Canada lookups (`/api/lookup/…`)

"Fill from Health Canada" in the Other brand form. Session required, `404` while
`ACCOUNTS_MODE` is `off`, 30 lookups per account per hour (`429` with `Retry-After`). The Worker
calls Health Canada's public APIs itself (no key; the app's CSP stays `connect-src 'self'` and
the person's IP never reaches a third party), sending only the number, the language and a generic
User-Agent. Each upstream answer is cached a week in the Cache API (`caches.default`, a synthetic
key per upstream URL on the app's origin; "not found" a day). At most three upstream calls per
lookup, 4 seconds each.

| Route                      | Answer                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/lookup/npn/:npn` | `?lang=en\|fr` → `ProductPrefill` (LNHPD: licence, medicinal ingredients, dose) |
| `GET /api/lookup/din/:din` | `?lang=en\|fr` → `ProductPrefill` (DPD: product, active ingredients, form)      |

Both answer `400 invalid_number` (not 8 digits), `401` without a session, `404 not_found` (no
such number, or accounts off), `429 rate_limited` and `502 lookup_failed` (Health Canada
unreachable, slow or answering garbage); nothing is ever cached on an error.

`ProductPrefill` (`packages/shared/src/lookup.ts`) is `{ source, npn, din, name, brand, form,
strength, dose: { amount, unit, frequency } | null, ingredients: [{ name, amount, unit }],
partial }`; `partial` means a follow-up call failed and the ingredients, dose or form may be
missing. Ingredient amounts are per dosage unit, units mapped to mg, mcg, IU, CFU, g or ml. Which
upstream field maps where is documented in `apps/worker/src/lookup/health-canada.ts`; the tests
use real answers saved in `apps/worker/src/lookup/fixtures/`.

### News notifications (`/api/admin/…`, M9)

Staff admins compose push notifications (new product, webinar…) that reach every device that
turned news on (Notifications → "New products, webinars and offers", C6), or a health-profile
segment. Code: `apps/worker/src/admin-api.ts` (routes), `apps/worker/src/news/*` (pure,
unit-tested parts), contracts in `packages/shared/src/news.ts`.

**Admins** are accounts with `accounts.role = 'admin'` **and** a verified email. The role is only
granted by SQL (`docs/smartstack-phase2-setup.md`, part I):
`npx wrangler d1 execute smartstack --remote --command "UPDATE accounts SET role = 'admin' WHERE email = 'name@newrootsherbal.com'"`
(staging: `smartstack-staging --env staging --remote`; local: `--local`). Every `/api/admin/*`
route takes the session bearer and answers `401` without a session, `403 forbidden` for anyone
else, and `404` while `ACCOUNTS_MODE` is `off`. Admins only ever see counts.

**The composer** is Profile → Admin → News (`/admin/news`, lazy-loaded; the card only shows for a
verified admin, and the Worker checks the role on every call anyway). Code:
`apps/web/src/screens/admin/News.tsx`, the pure form logic in `apps/web/src/admin/newsForm.ts`
(tested). Titles are typed without the "New Roots Herbal:" prefix and counted with it; the link
field shows the tracking tags the Worker will add; the date and time are Toronto wall-clock. Save
draft, Send a test to my devices, Schedule (disabled for a segment under 10 devices or a time
outside 11:00–19:00), Cancel, Duplicate. The device's language reaches the Worker with
`PUT /api/me` (`locale`) when push is set up and whenever the language changes, so each device
gets the campaign in its language.

| Route                                     | Body → answer                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/campaigns`                | `{ campaigns: CampaignView[] }`, newest first (200 at most), with status, `sentCount`, `failedCount` and `closeToAnother`                                                                                                      |
| `POST /api/admin/campaigns`               | `CampaignInput` → `201 { campaign }` (a draft); `400 invalid_body`, `400 url_host_not_allowed`                                                                                                                                 |
| `PUT /api/admin/campaigns/:id`            | `CampaignInput` (full replacement) → `{ campaign }`; drafts and scheduled campaigns only (`409 invalid_status`); a scheduled segment must still reach 10 devices                                                               |
| `POST /api/admin/campaigns/:id/schedule`  | `{ sendAt }` (epoch ms) → `{ campaign }` (`scheduled`); `400 send_at_past`, `400 outside_sending_window`, `409 audience_too_small`, `409 invalid_status`                                                                       |
| `POST /api/admin/campaigns/:id/cancel`    | → `{ campaign }` (`cancelled`); from `scheduled` or `sending` only (`409 invalid_status`)                                                                                                                                      |
| `POST /api/admin/campaigns/:id/duplicate` | → `201 { campaign }`: a new draft "<name> (copy)" with the same texts, link and audience                                                                                                                                       |
| `POST /api/admin/campaigns/:id/test`      | → `{ devices, sent, failed }`: sends it now to the admin's own linked devices (at most 10 subscriptions), in each device's language, whatever their opt-in or cap; counts nothing; `409 no_devices`, `503 push_not_configured` |
| `POST /api/admin/audience-estimate`       | `{ audience }` → `{ devices, tooSmall, canSchedule, etaMinutes }`; under 10 devices `devices: null` ("fewer than 10"); `409 segments_unavailable` before migration 0004                                                        |

**A campaign** (`CampaignInput`): `name` (internal, ≤ 80), `titleEn`/`titleFr`, `bodyEn`/`bodyFr`,
`url`, `audience`. Titles are ≤ 60 characters **including** the N10 prefix ("New Roots Herbal: ",
French « New Roots Herbal : » with a no-break space): the API **adds the prefix when it is missing**
(and normalizes one typed by hand), so the composer can edit only the text after it
(`stripNewsPrefix`, `newsTitleRoom`: 42 characters in English, 41 in French). Bodies ≤ 100.
Characters are counted as code points (`newsTextLength`). No line breaks. The link must be
`https` on a host listed in `NEWS_URL_HOSTS` (exact host names, no port); the Worker appends
`utm_source=smartstack&utm_medium=push&utm_campaign=<slug of the name>`, each only when absent, and
stores the result.

**Audience**: `{ "type": "all" }` is every device with news on (`users.news_opt_in = 1`), guest or
account. `{ "type": "segment", conditions?, goals?, genders?, ageMin?, ageMax?, pregnancy? }` also
needs the device to be linked to an account whose health profile exists (not deleted), has
targeting consent (C5, `targeting_consent_at`) and matches every part given: any of the
conditions, any of the goals (`json_each` over the profile's arrays), one of the genders, one of
the pregnancy statuses, and an age (the current year in Toronto minus the year of birth) within
the range; a profile without a year of birth never matches an age range. Codes come from
`packages/shared/src/user-data.ts`; each appears at most once, so a segment binds at most 51 SQL
parameters. A segment needs at least one part.

**Guardrails.** `sendAt` must fall between 11:00 and 19:00 America/Toronto (both included, to the
minute; DST-safe helpers `zonedTimeToEpoch` and `inNewsWindow` in the shared package), and not
more than a minute in the past. A segment under 10 devices can't be scheduled ("everyone" always
can). A device gets at most one news notification per 24 hours (`users.last_news_at`). The list
flags scheduled or sending campaigns less than 24 hours apart (`closeToAnother`).

**Delivery** (cron, after the reminders): each tick, news gets what the reminders left of
`MAX_PUSHES_PER_TICK` (a reminder push counts once per device). Scheduled campaigns whose time has
come become `sending`; the oldest `sending` one takes the budget. The fan-out walks
`push_subscriptions` by id after `campaigns.cursor` (no per-delivery rows): opted-in devices
without news in the last 24 hours (and, for a segment, whose account matches), `LIMIT` the budget,
the text in the device's `users.locale`. One `DB.batch` then moves the cursor, adds to
`sent_count`/`failed_count` and stamps `last_news_at` on the devices that got it. `404/410`
delete the subscription (and count as failed); every other failure counts as failed and is never
retried. Fewer rows than the budget → `sent` with `finished_at`. Delivery only runs during the
11:00–19:00 Toronto window: a campaign that isn't finished by 19:00 continues at 11:00 the next
day. Push options: `TTL: 7200`, `Urgency: normal`, `Topic` = the campaign id. Payload
`{ title, body, tag: 'news:<id>', url, kind: 'news', campaignId, lang }` (`kind` lets the service
worker add the Android "Turn off news" action; `lang` labels it).

**Throughput on the free plan**: about 20 devices a minute (`MAX_PUSHES_PER_TICK = 20`, minus the
reminders of that minute), so roughly 1,000 an hour; `etaMinutes` in the estimate assumes the
whole budget. The Workers paid plan would raise the ceiling a lot.

### Reminder cron

**Cron (every minute).** `Date.now()` is captured once. Pending rows more than 30 minutes past
due are marked `expired` (never sent late). One `UPDATE … RETURNING *` claims up to
`MAX_PUSHES_PER_TICK` reminders (pending, or `sending` for more than 5 minutes, fewer than 3
attempts). At most six pushes are in flight at once. Responses: `404/410` delete the
subscription; `401/403` keep it, fail the row and log loudly (VAPID/key problem); `429/5xx` and
network errors leave the row for the next tick. All result writes go in one `DB.batch`. The
03:00 UTC tick deletes `sent/failed/expired` rows older than 7 days and, in a separate batch,
expired sessions, used or expired email tokens, OAuth attempts and throttle rows older than a
day, and, in a third batch, check marks older than 3 days and sync tombstones older than 30.
Last, the inactivity step (`inactivity.ts`): at 03:00 it deletes accounts warned 30 days
earlier and devices without an account unused for 12 months; from 03:00 to 03:09 it emails up
to 3 inactivity warnings per tick (see [Privacy](#privacy)). Logs contain counts, status codes
and ids only.

`MAX_PUSHES_PER_TICK` counts reminders claimed per tick; a user with several devices
multiplies pushes. News notifications use whatever the reminders leave of it (see above). Start at 20 and raise toward 45 only after Workers Logs (`cpuTimeMs`)
show a full batch under ~6 ms.

Push options: `TTL: 1800`, `Urgency: high`, `Topic` = the row id (so a retry replaces rather
than duplicates), payload `{ title, body, tag, url }`. The VAPID JWT is cached per push-service
origin for about 11 hours.

## Deploy (Cloudflare free plan)

One-time, by a human with access to the newrootsherbal Cloudflare account:

```bash
npx wrangler login
```

Then, from `apps/worker`:

```bash
npx wrangler d1 create smartstack        # paste the database_id into wrangler.toml
npx wrangler d1 migrations apply smartstack --remote
npx wrangler secret put VAPID_PRIVATE_KEY
```

Fill in `VAPID_PUBLIC_KEY` (wrangler.toml) and `VITE_VAPID_PUBLIC_KEY` (`apps/web/.env`),
then from the repository root:

```bash
npm run deploy
```

which builds the web app and runs `wrangler deploy`. Production is
`https://schedule.flourishbodyandmind.com`, a Worker custom domain declared in `wrangler.toml`
(the zone is on Cloudflare in the same account; wrangler manages the DNS record and the
certificate, and switches the `workers.dev` URL off). **Push subscriptions are tied to the origin**, so keep the custom domain stable once
employees install.

### Staging

`https://schedule-staging.flourishbodyandmind.com` is a second Worker (`smartstack-staging`,
`[env.staging]` in `wrangler.toml`) with its own D1 database `smartstack-staging` (ENAM) and
`ACCOUNTS_MODE = "public"`. It sits one level below the zone so the free Universal SSL
certificate covers it. From the repository root:

```bash
npm run db:migrate:staging -w apps/worker   # apply new migrations to the staging database
npm run deploy:staging                      # staging build of the web app + wrangler deploy --env staging
```

Staging secrets are set separately (`npx wrangler secret put NAME --env staging`).

### Security headers

`apps/web/public/_headers` gives every page and asset a Content-Security-Policy
(`default-src 'self'`, scripts only from our origin plus `'wasm-unsafe-eval'` for the ZXing
WASM, `connect-src 'self'`, `frame-ancestors 'none'`…), `Referrer-Policy`,
`X-Content-Type-Options` and `Permissions-Policy` (camera for our origin only). Workers static
assets apply that file to asset responses and the SPA fallback; `/api/*` responses come from the
Worker, which adds `Cache-Control: no-store`. There is no inline script: `index.html` loads the
pre-paint theme from `public/theme-init.js`.

## Web Push facts baked into the code

**iPhone (iOS 16.4+)**

- Push works only for a web app added to the Home Screen, never from a Safari tab. A Home
  Screen web app has its own storage, separate from Safari, so on iOS the install gate is the
  first screen and onboarding runs inside the installed app.
- Permission is requested synchronously in the click handler, before any network call.
- Every push shows a visible notification, even with a missing or malformed payload (three
  silent pushes and Safari revokes permission).
- iOS never fires `pushsubscriptionchange`; on every app open the current subscription is
  compared with the registered one and re-registered when different. Deleting and re-adding
  the icon means re-subscribing.
- Denied permission shows "Re-enable in Settings → Notifications → SmartStack".
- Titles are short ("Iron — 9:30 AM"), bodies ≤ 100 characters.

**Android (Chrome)**

- `beforeinstallprompt` is captured and an Install button is shown on the Notifications screen;
  the manifest carries a description and screenshots for the richer dialog.
- Pushes arrive with Chrome closed. Samsung and Xiaomi battery optimizers can delay them;
  exclude SmartStack/Chrome from battery optimization when testing.

## Accepted Phase 1 limitations

- Only the browser runs the engine, so the reminder window is rolled forward only when the app
  is opened. If it is not opened for 7 days, reminders stop. Tapping a notification opens the
  app, which refreshes the window. Later the Worker can run `packages/engine` to roll the window
  server-side.
- Product data is imported from the website and marked _draft / not reviewed_; timing rules
  derived from label text are heuristics until the product team reviews them.
- No accounts: routine, stack and check marks live only in that browser or installed app.
  They never expire, but clearing site data, removing the app (on iOS, deleting the Home Screen
  icon) or switching devices starts over. The app asks for persistent storage so the browser
  does not evict it under disk pressure. Accounts and server-side storage are a later phase
  and need the privacy review first.
- A Worker custom domain needs the zone's DNS on Cloudflare. `newrootsherbal.com` stays on
  the company VPS, so the app lives at `schedule.flourishbodyandmind.com`. Changing the origin
  later means every phone re-subscribes to push.
- French covers the interface, label text, rule explanations, notifications and most
  ingredient names. Canonical nutrients have fixed French names
  (`packages/engine/src/import/ingredients.ts`); the other ingredients take theirs from the
  French supplement facts when those list the same amounts as the English ones
  (`packages/engine/src/import/french-facts.ts`), and stay English otherwise. The import
  report counts both.
- The manifest screenshots are generated placeholders (`apps/web/scripts/screenshots.mjs`).

## Device checklist

**Android Chrome**

1. Open the deployed URL in Chrome. Onboarding → Add (scan a code from `/dev/barcodes` on a
   monitor, or pick from the sample list) → Today shows the schedule.
2. Profile → Notifications → Install app (or Chrome menu → Add to Home screen). Open from the icon.
3. Profile → Notifications → Turn on reminders → Allow. Status shows "Reminders are on for this device."
4. Send me a test reminder in 2–3 minutes → lock the phone → the notification arrives; tapping
   it opens Today.
5. Change the routine or stack → Notifications shows a fresh "Schedule synced" time.

**iPhone Safari**

1. Open the deployed URL in Safari. The install gate appears: Share → Add to Home Screen.
2. Open SmartStack from the Home Screen icon (not Safari). Onboarding → Add → Today.
3. Profile → Notifications → Turn on reminders → Allow.
4. Send me a test reminder in 2–3 minutes → lock the phone → the notification arrives.
5. Profile → Delete my data removes the server rows and returns to onboarding.

**Accounts and news** (staging first; production once accounts are public). Android installed
app, iPhone Home Screen app and desktop Chrome:

1. Sign up with email → the verification email arrives → the link confirms. Log out, log in,
   forgot password → the new password works and the old one doesn't.
2. Continue with Google. On the iPhone Home Screen app, you end up signed in inside the app (a
   Safari sheet may stay open: close it; the app signs in when it comes back).
3. Two devices on one account: a change on one appears on the other; tick a dose → the bottle
   count follows.
4. Other brand with its NPN or DIN → "Fill from Health Canada" fills the form.
5. Health profile: consent → answers → the "relevant news" switch (also in Notifications) →
   delete it.
6. Notifications → news on. An admin sends a test from Profile → Admin → News → it arrives in the
   device's language and opens the link. On Android, "Turn off news" switches news off.
7. Switch the app to French → the next test arrives in French.
8. Profile → Your account → Download my data → a JSON file. Delete my account → the welcome
   screen, and signing in again fails.

The full list, with the expected emails, is in `docs/smartstack-phase2-setup.md` (Test checklist).

## Privacy

SmartStack handles health-adjacent personal information, so it keeps as little as it can, and
the rules below are enforced in code. The public texts are in `docs/privacy/`: privacy policy and
terms in English and French, the consent texts (C1–C7) and notices (N1–N10), the privacy impact
assessment and the incident runbook. They stay drafts, with a "Draft" line in the app
(`VITE_LEGAL_DRAFT`), until the Privacy Officer approves them (setup doc, part F); until then
production runs `ACCOUNTS_MODE=staff`.

**Guests** (no account, the default). Routine, stack, bottles, shopping list and check marks stay
in the browser. The server hears from a guest's device only once reminders or news are turned on,
and then stores:

| Data                                                                     | Why                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Anonymous device id (`crypto.randomUUID()`)                              | The device's only credential                                |
| Time zone, platform, app language                                        | Reminder times; news in the device's language               |
| News on or off, when it was last turned on and off, last news received   | Proof of consent (C6); at most 1 news notification per 24 h |
| Push subscription (endpoint, `p256dh`, `auth`)                           | To deliver Web Push                                         |
| Reminder rows (time, title, body; product ids only when names are shown) | The rolling 7-day delivery window                           |

**Accounts** (optional) also store what the person chose to back up:

| Data                                                                                                                 | Why                                                       |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Email, whether it is verified, optional name, language, role                                                         | Sign-in and account emails                                |
| HMAC(`AUTH_PEPPER`, salt ‖ key), the key being the password stretched in the browser (PBKDF2-SHA256, 600,000 rounds) | Sign-in; the password never leaves the device             |
| Google account id and email, only after "Continue with Google"                                                       | Sign-in with Google                                       |
| Sessions (SHA-256 of the token, platform, dates)                                                                     | Staying signed in                                         |
| Consent version and date, "14 or older" date                                                                         | Proof of consent (Law 25)                                 |
| Routine, time zone, theme, stack, other-brand products, bottles, shopping list, check marks                          | Sync between the person's devices ([Sync](#sync-apisync)) |
| Health profile with its storage consent (C4) and targeting consent (C5, off by default)                              | Only to choose news, and only while C5 is on              |
| Which devices belong to the account                                                                                  | That person's reminders and news                          |

Never stored: the password, location, contacts, photos, analytics or advertising identifiers.
Admins composing news (`/admin/news`) only ever see counts, and a health-profile segment under 10
devices can't be scheduled.

**Retention** (the 03:00 UTC cron tick: `apps/worker/src/auth/cleanup.ts`, `sync.ts`,
`inactivity.ts`, all tested; the privacy policy, §10, promises the same):

| Data                                | Kept                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| An account and everything in it     | Until "Delete my account"; unused for 3 years → deleted, after a warning email (N8/N9) 30 days before |
| A device without an account         | Until "Delete my data"; 12 months without use → deleted with its subscriptions and reminders          |
| Health profile                      | Until "Delete my health profile" (the answers are cleared at once) or the account                     |
| Check marks                         | 3 days                                                                                                |
| Deleted items (sync tombstones)     | 30 days                                                                                               |
| Sessions                            | Until "Log out", or 90 days without use                                                               |
| Email links                         | Until used or expired (48 h to verify, 1 h to reset), then deleted within a day                       |
| OAuth attempts, throttle counters   | 1 day                                                                                                 |
| Reminder rows                       | 7 days after their time                                                                               |
| D1 Time Travel (Cloudflare backups) | 7 days; it can't be switched off                                                                      |
| Workers Logs                        | 3 days. Console logs hold counts, status codes and ids only; production has invocation logs off       |

Inactivity is measured by `accounts.last_active_at` (a login or a sync, written at most once a
day); any login or sync clears the warning. Warnings go out from 03:00 to 03:09 UTC, 3 per tick,
and an account is only marked warned once its email was sent, so a missing email setup never
leads to a deletion without notice.

**Where:** Cloudflare Workers and D1 (database `smartstack` in ENAM, Eastern North America;
encrypted at rest). Processors: Cloudflare; SMTP2GO (account emails: the address and the message);
Google (only after "Continue with Google"); the browsers' push services (the payload is
encrypted). Health Canada lookups send only the NPN or DIN, from the Worker.

**Rights:** Profile → Your account → **Download my data** (`GET /api/account/export`: the
account, its sign-in methods, sessions, devices with their language and news consent, and every
synced row, as JSON) and **Delete my account** (`DELETE /api/account`; foreign keys cascade to
everything above). Guests: Profile → **Delete my data** (`DELETE /api/me`), which deletes the
device, its subscriptions and its reminders, then clears local storage.

## Sample-data rule (all of Phase 1)

- Every seed product and rule has `reviewStatus: 'unreviewed'`, `reviewedBy: null`,
  `lastReviewed: null`; More info shows a rule's reviewer and date only once they are set (the
  banner says the rules aren't reviewed yet).
- `evidenceUrl` is a real public URL that is known to exist (NIH Office of Dietary Supplements
  fact sheets, checked on 2026-09-24), or `null` ("Source: to be added"). Citations are never
  invented.
- Sample products are `brand: 'Sample'`, named "(sample)", with placeholder directions and
  warnings. UPCs are EAN-13 codes in the GS1 restricted-circulation range (prefix `200`), which
  is never assigned to retail products. NPNs look like `SAMPLE-NPN-0001`.
- Seed rules may only be _Timing conflict_, _Consideration_ or _Informational_.
- `npm run data:validate` enforces all of the above plus referential integrity.

## Out of scope for Phase 1

Missed-dose guidance, medications, label OCR or any AI, product "benefits" pages, cross-selling,
pricing, user accounts, analytics, the real product database (the product team supplies it
later through `docs/data-template.md` and `packages/engine/scripts/import-csv.ts`).
