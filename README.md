# New Roots SmartStack

Supplement-scheduling app for New Roots Herbal. Scan a product barcode, build your
"stack", enter your daily routine, and a deterministic rules engine generates a
personalized daily schedule with reminders and a tappable "Why?" for every placement.

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
4. No accounts, no analytics, no third-party scripts, no third-party CDN loads.
5. English first, French-ready: no user-facing string lives in the engine; all copy is in
   `apps/web/src/i18n/en.json` (with `fr.json` mirroring the keys).

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

- **The browser's localStorage is the source of truth** for routine, stack and schedule. If it
  is wiped, the user re-onboards.
- The server stores only what is needed to deliver reminders. **Routine and stack are never
  sent to the server.** Reminder rows carry product ids and the notification text, nothing more.
- The app makes **no network call** until the user taps "Turn on reminders." Afterwards it
  syncs a rolling 7-day window on every change and on every app open, and retries on the next
  open if offline.

### Engine in one paragraph

Every product starts at breakfast (or the first available meal). Fixed-anchor rules move it
(`BEDTIME` > `EVENING` > `MORNING` > meal preference > plain `WITH_FOOD`). Then, for every
product with `SEPARATE_FROM_*` rules, if a conflicting product (or the coffee time) is within
the separation window, the dose moves to the earliest time ≥ conflict + separation that clears
every conflict, rounded up to 15 minutes. One adjustment code per product whose final time
differs from its baseline. Extra doses take dinner, then lunch, then breakfast, then bedtime.
Rules attach to ingredients; a product may disable inherited rules (`ruleOverrides.disable`).
Duplicate ingredients are listed whenever two or more stack products contain the same
ingredient, with amounts and the sum, never compared to any reference intake.

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

First time only, create the local D1 tables:

```bash
npm run db:migrate:local -w apps/worker
```

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
`packages/engine/src/import/`) keeps only licensed natural health products (8-digit NPN) with a
valid barcode and parsable supplement facts, then writes:

- `data/products.json`: one product per website record with EN/FR name, subtitle, suggested
  use, warnings, every variant's SKU and UPC, canonical ingredient amounts, the label's default
  times per day and units per dose, `status: 'draft'` and `reviewStatus: 'unreviewed'`.
- `data/ingredients.json`: canonical nutrient ids (`iron`, `vitamin-d`, `epa`, `probiotic`…)
  with fixed units. Vitamin D given in IU is converted to mcg; probiotic strains are summed as CFU.
- `data/rules.generated.json`: product-level rules read from the label's suggested use ("with
  food", "at bedtime", "with water"…) and the refrigeration flag, each quoting the label sentence
  and linking the product page as its source.

Hand-curated ingredient-level rules stay in `data/rules.json`. The importer report lists skipped
records (essential oils, foods, a few products whose facts it cannot parse) and parser warnings;
nothing is written if the merged catalogue fails validation. The original ten-product sample
catalogue lives in `data/sample/` as a test fixture. `docs/data-template.md` remains for
products the website does not list.

### Developer pages

- `/dev/barcodes` renders any product's UPC-A (one per size) large enough to scan off a monitor,
  plus the sample fixtures' EAN-13 codes (GS1 prefix `200`, never assigned to retail products).
- `/dev/styleguide` shows the five severity badges, buttons, notices, inputs and tokens.

Both are reachable from Settings → Developer. Scanning a barcode that is not a New Roots
Herbal natural health product shows "Product not found."

### Environment

| File                        | Committed | Contents                                                                                 |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `apps/web/.env`             | yes       | `VITE_VAPID_PUBLIC_KEY` (public), `VITE_BETA_KEY` (speed bump, not security)             |
| `apps/web/.env.local`       | **no**    | Optional override of `VITE_VAPID_PUBLIC_KEY` for local testing                           |
| `apps/worker/wrangler.toml` | yes       | `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `MAX_PUSHES_PER_TICK`, `BETA_KEY`, D1 binding, cron |
| `apps/worker/.dev.vars`     | **no**    | `VAPID_PRIVATE_KEY` (and optionally `VAPID_PUBLIC_KEY`) for local `wrangler dev`         |
| Cloudflare secret           | n/a       | `wrangler secret put VAPID_PRIVATE_KEY`                                                  |

Generate the real VAPID pair **once** with `npx web-push generate-vapid-keys` and store it in
the company password manager. If the keys change, every phone must re-subscribe. The
`web-push` npm package is never used at runtime. Until the public key is filled in, the
"Turn on reminders" button is disabled and says so.

For local experiments a throwaway pair can live in `.dev.vars` and `.env.local` (both
gitignored). Never put a throwaway public key in the committed `.env`: a subscription made
against one public key is useless with another.

## Worker and API

All routes live under `/api/me/…` and take `Authorization: Bearer <anonymous uuid>`. Unknown
ids get `401`, except `PUT /api/me`, which creates the user and requires `X-Beta-Key`.

| Route                              | Purpose                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PUT /api/me`                      | Create or update `{ tz, platform }`                                                                     |
| `DELETE /api/me`                   | Delete the user, subscriptions and reminders                                                            |
| `POST /api/me/push-subscription`   | Upsert `{ endpoint, keys }` (≤ 5 per user)                                                              |
| `DELETE /api/me/push-subscription` | Remove one endpoint                                                                                     |
| `PUT /api/me/schedule`             | Replace the pending, future `schedule` rows with the browser's 7-day window (≤ 200); never touches sent |
| `POST /api/me/test-reminder`       | One `test` reminder 2 minutes out, at most once per 2 minutes                                           |

**Cron (every minute).** `Date.now()` is captured once. Pending rows more than 30 minutes past
due are marked `expired` (never sent late). One `UPDATE … RETURNING *` claims up to
`MAX_PUSHES_PER_TICK` reminders (pending, or `sending` for more than 5 minutes, fewer than 3
attempts). At most six pushes are in flight at once. Responses: `404/410` delete the
subscription; `401/403` keep it, fail the row and log loudly (VAPID/key problem); `429/5xx` and
network errors leave the row for the next tick. All result writes go in one `DB.batch`. The
03:00 UTC tick deletes `sent/failed/expired` rows older than 7 days. Logs contain counts,
status codes and ids only.

`MAX_PUSHES_PER_TICK` counts reminders claimed per tick; a user with several devices
multiplies pushes. Start at 20 and raise toward 45 only after Workers Logs (`cpuTimeMs`)
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

which builds the web app and runs `wrangler deploy`. The first deploy (2026-09-24) is at
`https://smartstack.smartstack-worker.workers.dev`. **Push subscriptions are tied to the origin**: move to
`smartstack.newrootsherbal.com` (a custom domain on the Worker) _before_ employees install,
or every phone will have to re-subscribe.

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

- `beforeinstallprompt` is captured and an Install button is shown on the Reminders screen;
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
- English only; `fr.json` exists with empty values.
- The manifest screenshots are generated placeholders (`apps/web/scripts/screenshots.mjs`).

## Device checklist

**Android Chrome**

1. Open the deployed URL in Chrome. Onboarding → Add (scan a code from `/dev/barcodes` on a
   monitor, or pick from the sample list) → Today shows the schedule.
2. Reminders → Install app (or Chrome menu → Add to Home screen). Open from the icon.
3. Reminders → Turn on reminders → Allow. Status shows "Reminders are on for this device."
4. Send me a test reminder in 2–3 minutes → lock the phone → the notification arrives; tapping
   it opens Today.
5. Change the routine or stack → Reminders shows a fresh "Schedule synced" time.

**iPhone Safari**

1. Open the deployed URL in Safari. The install gate appears: Share → Add to Home Screen.
2. Open SmartStack from the Home Screen icon (not Safari). Onboarding → Add → Today.
3. Reminders → Turn on reminders → Allow.
4. Send me a test reminder in 2–3 minutes → lock the phone → the notification arrives.
5. Settings → Delete my data removes the server rows and returns to onboarding.

## Privacy

This is health-adjacent personal data. Phase 1 is designed to hold as little as possible.

**What is stored on the server**

| Data                                           | Why                                   |
| ---------------------------------------------- | ------------------------------------- |
| Anonymous id (`crypto.randomUUID()`)           | The only credential; no account       |
| Time zone (IANA name) and platform             | To interpret and debug reminder times |
| Push subscription (endpoint, `p256dh`, `auth`) | To deliver Web Push                   |
| Reminder rows (time, product ids, title, body) | The rolling 7-day delivery window     |

Not stored on the server: name, email, routine, stack, dose counts, checkbox history.

**Where:** Cloudflare D1, database `smartstack` in the ENAM (Eastern North America) region. Sent, failed and expired reminder rows are deleted 7 days after
their scheduled time by the 03:00 UTC cron tick. Logs contain counts, status codes and reminder
ids, never a user id together with product names or notification text.

**How to delete:** Settings → "Delete my data" calls `DELETE /api/me`, which deletes the user,
their subscriptions and their reminders, then clears local storage.

**Before any employee beta** (not only before consumer release), a privacy review under
**PIPEDA** and **Quebec Law 25**, including a **privacy impact assessment**, is required.

## Sample-data rule (all of Phase 1)

- Every seed product and rule has `reviewStatus: 'unreviewed'`, `reviewedBy: null`,
  `lastReviewed: null`; the UI renders "Not yet reviewed".
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
