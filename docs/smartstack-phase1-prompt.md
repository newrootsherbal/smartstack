# New Roots SmartStack — Phase 1 build prompt

> Paste everything below the line as the first message of a new Claude Code session opened in `D:\Websites\smartstack`. It is long on purpose: it records every decision already made so the new session can plan and build without re-researching or asking.

---

I'm building **New Roots SmartStack**, a supplement-scheduling app for New Roots Herbal (a Quebec-based Canadian natural-health-products company). Read the pitch document first: `docs/New Roots SmartStack.pdf` (a plain-text export is at `docs/New Roots SmartStack.txt` if the PDF can't be read directly). Then read this whole prompt. Every decision below is final (verified on 2026-09-24); don't re-open them. Start with a short plan, then build.

## 1. Who I am and my constraints

- Web developer at New Roots Herbal. Windows 11, no Mac. I own an Android phone; I can occasionally borrow an iPhone.
- Working folder: `D:\Websites\smartstack` (exists, contains `docs/`). Not a git repository yet: initialize one.
- Node 22.14 and npm 11 are installed. pnpm and yarn are also present; **do not use them.**
- **Budget during testing is $0.** No Apple Developer Program, no Google Play fee, no paid services. Free tiers only.
- Things I do myself, when you tell me: create the free Cloudflare account, run `wrangler login`, run `npx web-push generate-vapid-keys` (one-off CLI use only), run `wrangler secret put VAPID_PRIVATE_KEY`. Everything else that is free is pre-approved: `git init`, `wrangler d1 create`, applying migrations, `wrangler deploy`. Never sign up for a service on my behalf.

## 2. What the app does

Scan a New Roots product barcode → product identified → user builds their "stack" (supplements + doses per day) → enters their daily routine (wake, coffee, breakfast, lunch, dinner, exercise, bedtime) → a **rules engine** generates a personalized daily schedule (iron separated from calcium, fish oil with a meal, magnesium at bedtime…) → **reminders** at those times → every placement has a tappable **"Why?"** with a severity level → "I'm running late" shifts today → duplicate-ingredient detection across products.

### Non-negotiable principles (from the PDF)

1. **The engine is deterministic code driven by a rules database. It is not AI.** Every rule has fields for evidence source, last-reviewed date and reviewer.
2. **The app never says a dose is unsafe.** It says "Review recommended" and points to a healthcare professional.
3. Severity levels are exactly the PDF's five, with its sub-labels and colours: **Important** (red, "Action required"), **Timing conflict** (orange, "Action recommended"), **Consideration** (yellow), **Product instruction** (blue), **Informational** (outline).

### Sample-data rule (applies to all of Phase 1)

We have no reviewed product or rule data yet. So:

- Show a persistent, non-dismissable banner on every screen: *"Sample data — not reviewed, not medical advice. Rules and product details are placeholders for testing. Talk to a healthcare professional about your supplements."*
- Every seed product and rule has `reviewStatus: 'unreviewed'`, `reviewedBy: null`, `lastReviewed: null`. The Why? sheet renders these as "Not yet reviewed", never a name, team or date.
- `evidenceUrl` is either a real public URL you are certain exists (e.g. an NIH Office of Dietary Supplements fact sheet) or `null`, rendered as "Source: to be added". **Never fabricate a citation.**
- Sample products have `brand: 'Sample'`, "(sample)" in the display name, and obviously placeholder directions/warnings ("Sample directions — replace with label text"). Never write label-like sentences attributed to New Roots ("New Roots recommends…").
- Seed rules may only use **Timing conflict, Consideration and Informational**. No seed rule may be *Product instruction* (that means "copied from the real label") or *Important* (that's for medication interactions, out of scope). Keep all five in the types and show all five badges on a `/dev/styleguide` page.

### Not in Phase 1 (don't build, don't stub, don't ask)

Missed-dose guidance ("I missed my 8 AM dose"); medications and `SEPARATE_FROM_SPECIFIC_MEDICATIONS`; label-photo OCR or any AI; the PDF's section-14 "Why am I taking this?" product pages and any *Benefits* text (health claims need Health Canada review); cross-selling, product discovery, store links, pricing or subscriptions; the real 50–100-product database (the product team supplies it later; you build the template and importer); user accounts; analytics. Rule of thumb: if the PDF describes it and this prompt doesn't list it as a screen, endpoint or data file, it's out of scope.

## 3. Architecture

**PWA first, app stores later.** Ships now as an installable web app with zero store fees. When the company pays Apple ($99/yr) and Google ($25), the *same* web build gets wrapped with **Capacitor 8**. Nothing in Phase 1 may make that harder.

| Layer | Decision |
|---|---|
| Front end | React 19 + Vite + TypeScript; `vite-plugin-pwa` with `strategies: 'injectManifest'` and a hand-written `src/sw.ts` |
| Routing / UI | `react-router` v7 (declarative mode), routes `/today` (default), `/onboarding`, `/add`, `/stack`, `/reminders`, `/settings`, plus `/dev/barcodes` and `/dev/styleguide`. Plain CSS: tokens in `src/styles/tokens.css`, CSS Modules per screen. No Tailwind, no component library. |
| State | One React context + `useReducer` (`userId`, `routine`, `stack`, `todayOverride`, `checks`, `pushState`, `lastSync`), persisted through a typed `src/storage.ts` on localStorage. No IndexedDB, no Zustand/Redux. |
| Strings | `src/i18n/en.json` + typed `t()` helper; create `fr.json` with the same keys (values may be empty). No i18n library. Times via `Intl.DateTimeFormat`. |
| Rules engine | `packages/engine`: pure TypeScript, zone-free, no DOM/Cloudflare imports, Vitest-tested |
| Hosting + API | **One Cloudflare Worker** (free plan) that serves `apps/web/dist` as static assets (`[assets] directory = "../web/dist"`, `binding = "ASSETS"`, `not_found_handling = "single-page-application"`), handles `/api/*`, and runs a **Cron Trigger every minute**. One origin, so no CORS. Do not propose Cloudflare Pages or a separate API origin. |
| Database | **D1** (free). Not KV (1,000 writes/day). |
| Push | Standard Web Push with VAPID from the Worker using `@block65/webcrypto-web-push` v2. Fallback `@pushforge/builder` (the bare name `pushforge` is not on npm). If neither works, implement RFC 8291/8292 with WebCrypto in `apps/worker/src/webpush.ts` (~150 lines). **Never the `web-push` npm package at runtime.** |
| Repo | npm workspaces: `apps/web`, `apps/worker`, `packages/engine`, `packages/shared` (types + zod schemas). `packages/*` are `"type": "module"` and export TypeScript source (`"exports": {".": "./src/index.ts"}`), no build step. Root `vitest.config.ts` with `projects`. Worker tests are plain unit tests on pure functions (no `@cloudflare/vitest-pool-workers`). `.nvmrc` = 22, `"engines": {"node": ">=22"}`. |

**Rejected, don't propose:** Brevo, Supabase (free tier pauses after ~a week and would silently kill reminders), Netlify DB, Firebase, Expo / React Native for Web, Workers KV for reminders, Cloudflare Pages.

### Platform abstraction

Install `@capacitor/core` now (only for `Capacitor.isNativePlatform()` / `getPlatform()`); do **not** run `npx cap add`. Every device feature lives behind a small module with a web implementation now and an obvious slot for native later:

- `src/platform/scanner.ts` — prefer native `window.BarcodeDetector` when present and it supports our formats (Android Chrome); otherwise the `barcode-detector` **ponyfill** (`barcode-detector/ponyfill`, ZXing WASM). **Bundle the WASM from our origin**: `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'` and `prepareZXingModule({ overrides: { locateFile: () => wasmUrl } })` before first use; precache it in the service worker; never load it from jsDelivr. Lazy-load on the Scan screen only. Formats: EAN-13, UPC-A, UPC-E, Code 128, QR. Normalize: a 13-digit code starting with `0` equals the 12-digit UPC-A. Later native: `@capacitor-mlkit/barcode-scanning`.
- `src/platform/reminders.ts` — web: Web Push subscription synced to the Worker. Later native: `@capacitor/local-notifications` with `on: {hour, minute}` repeats (note for later: Android 13 `POST_NOTIFICATIONS`, Android 14 exact-alarm permission).

### Where data lives, identity, privacy

- **The browser's localStorage is the source of truth** for routine, stack and schedule. D1 is a delivery mirror only; there are no GET endpoints in Phase 1. If local storage is wiped, the user re-onboards.
- The server stores the minimum needed to deliver: `users(id, tz, platform, created_at, last_seen_at)`, `push_subscriptions`, `reminders`. **Routine and stack are never sent to the server** (the reminder rows carry product ids and the notification text, nothing more).
- No accounts, no passwords, no email. On first launch create `crypto.randomUUID()`, store it locally, send it as `Authorization: Bearer <uuid>` on every request to `/api/me/...`. The Worker treats it as the only credential; unknown ids get 401 (except `PUT /api/me`, which creates). Bake a `VITE_BETA_KEY` into the web build and require it as `X-Beta-Key` on `PUT /api/me` (compared against the Worker's `BETA_KEY` var, see §5): a speed bump, not security.
- **The app makes no network call until the user taps "Turn on reminders."** Afterwards it syncs on every change and on app open, and retries on the next open if offline.
- This is health-adjacent personal data. No analytics, no third-party scripts, no third-party CDN loads. Settings has **"Delete my data"** → `DELETE /api/me` (cascades) and clears local storage. Logs may contain counts, status codes and reminder ids, never a user id together with product names or notification text. README gets a privacy section: what is stored (anonymous id, time zone, platform, push endpoint, reminder rows), where (Cloudflare D1, retained 7 days after sending), how to delete, and that **PIPEDA and Quebec Law 25 review including a privacy impact assessment is needed before the employee beta**, not only before consumer release.

### i18n contract

Phase 1 ships English only, but New Roots is bilingual and French must exist before anything consumer-facing. So: **the engine's code and output contain no user-facing text.** `packages/engine/src` returns only ids, structured reasons (`{ ruleId, severity, params: { anchor, separationMinutes, otherIngredient } }`) and adjustment codes; the UI turns them into sentences through `apps/web/src/i18n/en.json`. The catalogue JSON in `packages/engine/data/` may carry text only inside `{ en: string; fr?: string }` fields (`name`, `directions`, `warnings`, `explanation`); the UI looks those up by id and renders them through the same locale switch; the engine never copies them into its output. Push titles/bodies are composed in the browser from the same strings and sent to the Worker as text.

## 4. Web Push facts to bake into the code (verified)

**iPhone (iOS 16.4+)**

- Push works **only** for a web app added to the Home Screen, never from a Safari tab. Manifest `"display": "standalone"`.
- **A Home Screen web app on iOS has its own storage, separate from Safari.** So on iOS when not in standalone mode (`display-mode` media query / `navigator.standalone`), the "Share → Add to Home Screen" instruction gate is the **first screen, before onboarding**; onboarding runs inside the installed app. (Android Chrome shares storage between tab and installed app, so its install button can live on the Reminders screen.)
- iOS shows no install prompt; we show our own instructions.
- Permission may only be requested right after a user tap. Call `Notification.requestPermission()` synchronously in the click handler with **no network `await` before it**; subscribe and register with the Worker afterwards. The VAPID public key comes from `VITE_VAPID_PUBLIC_KEY` at build time (decode base64url to `Uint8Array` for `applicationServerKey`; Safari is strict). `reminders.ts` must tolerate an empty `VITE_VAPID_PUBLIC_KEY` (the Reminders screen then shows "Reminders are not configured in this build"); decode the key only inside the Turn-on-reminders handler.
- **Every push must show a visible notification.** Three "silent" pushes and Safari revokes permission. In `sw.ts`, always `event.waitUntil(self.registration.showNotification(...))`, even when `event.data` is null or JSON parsing fails (fallback title "SmartStack reminder").
- iOS never fires `pushsubscriptionchange`. On every app open, compare `PushManager.getSubscription()` with what was last registered and re-register if different. The subscription is tied to that Home Screen icon; delete + re-add means re-subscribe.
- If `Notification.permission === 'denied'`, show "Re-enable in Settings → Notifications → SmartStack" instead of the button.
- iOS notifications are text-only and use the site icon. Keep title/body short: title "Iron — 9:30 AM", body ≤ 100 chars.

**Android (Chrome)**

- Capture `beforeinstallprompt` and show an "Install" button. Add `description` and `screenshots` to the manifest for the richer dialog. Push is delivered with Chrome closed. README note: Samsung/Xiaomi battery optimizers can delay pushes.

**Service worker rules (`src/sw.ts`)**

`/// <reference lib="webworker" />`, `declare let self: ServiceWorkerGlobalScope`, `lib` includes `WebWorker`. Must call `precacheAndRoute(self.__WB_MANIFEST)` (build fails otherwise). `registerType: 'autoUpdate'`, `self.skipWaiting()` + `clientsClaim()`. `NavigationRoute` fallback to `index.html` with `denylist: [/^\/api\//]`. **Never add runtime caching for `/api`.** `notificationclick`: focus an existing window or `clients.openWindow('/today')`. `devOptions: { enabled: true, type: 'module' }`. Icons: generate 192/512/maskable + 180 px `apple-touch-icon` from a single `public/icon.svg` with `@vite-pwa/assets-generator`; add `<link rel="apple-touch-icon">` and `theme-color` in `index.html`.

## 5. Cloudflare free-plan limits and Worker decisions

Limits: 100,000 requests/day (static asset requests don't count; cron runs do, 1,440/day is fine); 5 Cron Triggers per account; every-minute cron allowed; **10 ms CPU per invocation** (the binding constraint: each push costs ECDH + HKDF + AES-GCM, plus an ES256 JWT); **50 subrequests per invocation** (D1 statements count too); 6 concurrent outbound connections. D1 free: 5 M row reads / 100 k row writes per day, 5 GB. Web Push itself is free; Apple's and Google's push services need no developer account with VAPID.

- **Framework:** `hono` for routing and typed bindings. Bodies validated with zod schemas in `packages/shared`, reused by the client. `/api/*` handled by hono; everything else `env.ASSETS.fetch(request)`.
- **Timestamps:** INTEGER epoch milliseconds written by JS, everywhere. Never SQLite `datetime('now')` strings. Capture `Date.now()` once at the top of the cron handler (not `event.scheduledTime`).
- **Migrations:** `apps/worker/migrations/0001_init.sql`; `[[d1_databases]] binding = "DB", database_name = "smartstack", migrations_dir = "migrations"`; local `wrangler d1 migrations apply smartstack --local`, prod `--remote`. A placeholder `database_id` works for `wrangler dev --local` only; `wrangler deploy` rejects it, so run `wrangler d1 create smartstack` (pre-approved) and paste the real id before any deploy that includes the binding.
- **Cron claim, one statement:** `UPDATE reminders SET status='sending', claimed_at=?now, attempts=attempts+1 WHERE id IN (SELECT id FROM reminders WHERE (status='pending' OR (status='sending' AND claimed_at < ?now-300000)) AND scheduled_at <= ?now AND scheduled_at > ?now-1800000 AND attempts < 3 ORDER BY scheduled_at LIMIT ?batch) RETURNING *`. Same tick: one UPDATE marks as `expired` every `pending` row older than 30 min and every `sending` row whose `claimed_at` is older than 30 min, so nothing stays `sending` forever and nothing is sent late. `MAX_REMINDERS_PER_TICK` var, start at **8**: pushes per tick = claimed reminders × their subscriptions (≤ 5 each) plus ~4 D1 statements; keep the product under 45, and raise the var only after the dashboard shows a full batch under ~6 ms CPU. After `Promise.allSettled`, write all results in one `env.DB.batch([...])`.
- **Send options:** `ttl: 1800` (a reminder not deliverable within 30 min is dropped, never delivered late), `urgency: 'high'`, `topic` = ≤ 32-char id from the reminder row so a retry replaces rather than duplicates. Cache one VAPID JWT per push-service origin (`new URL(endpoint).origin`) in a module-level Map for ~12 h. If the chosen library signs a fresh JWT per message and offers no way to pass a token in, build the ES256 JWT and the `Authorization: vapid t=…, k=…` header yourself once per origin with WebCrypto and hand it to the library or to the hand-written `webpush.ts`; per-push signing is not acceptable.
- **Responses:** 404/410 → delete that subscription. **401/403 → do NOT delete** (VAPID/key problem): log loudly, mark the row failed. 429/5xx → write the row back to `pending` (the claim's `attempts < 3` and the 30-min window bound the retries). A claimed row whose user has no subscription left is `failed`. Every claimed row ends the tick as `sent`, `failed` or `pending`.
- **Observability:** `[observability] enabled = true`; read `cpuTimeMs` in the dashboard's Workers Logs (there is no in-handler CPU API). `console.log` wall time and sent/failed counts only.
- **Retention:** the 03:00 UTC tick deletes every reminder row with `scheduled_at < now − 7 days`, whatever its status.
- **Rate limits in D1:** `test-reminder` at most once per 2 min per user; ≤ 200 active reminders and ≤ 5 subscriptions per user.
- **VAPID:** generate **once** with `npx web-push generate-vapid-keys`; store the pair in the company password manager (if the keys change, every phone must re-subscribe). Private key: `wrangler secret put VAPID_PRIVATE_KEY` (prod) and `apps/worker/.dev.vars` (gitignored, local). Public key: plain `vars` entry `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY` in `apps/web/.env` (committed; it's public). `VAPID_SUBJECT = "mailto:<I'll give you the address>"`, dev placeholder `mailto:smartstack@example.com`.
- **Beta key:** `BETA_KEY` is a plain `[vars]` entry with the same value as `VITE_BETA_KEY` in `apps/web/.env` (both committed; it is not a secret). `PUT /api/me` returns 403 when `X-Beta-Key` doesn't match.
- **Local dev:** `vite dev` on 5173 with `server.proxy` forwarding `/api` to `http://localhost:8787` (`wrangler dev`), so the browser sees one origin. Fire the cron locally with `wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`. Test push end-to-end first in desktop Chrome on `http://localhost:5173` (localhost is a secure context), then on phones against the deployed Worker. For local phone testing: `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` on the Android.

## 6. Data

### Catalogue = static data in the engine (Phase 1)

The catalogue is **JSON files in `packages/engine/data/`**: `products.json`, `ingredients.json`, `rules.json` (there is no separate product-ingredients file; each product carries its own `ingredients` array), typed from `packages/shared`, validated by zod via `npm run data:validate`, bundled into the web app, never fetched. **Do not create catalogue tables in D1 or a `GET /api/products` endpoint.** Also ship `docs/data-template.md` and a CSV template with one column per PDF field (SKU, UPC, NPN, ingredients, dose, directions, warnings, timing rules, interaction rules, evidence sources, last reviewed, reviewer) so the product team can hand me real data without touching code.

- **products:** `id`, `sku`, `upc`, `npn`, `brand`, `name {en, fr?}`, `form`, `servingSize`, `dosesPerDayDefault`, `directions {en}`, `warnings {en}`, `ingredients: Array<{ ingredientId, amountPerDose }>` (amount in the ingredient's unit), `labelVersion`, `reviewStatus: 'unreviewed' | 'reviewed'` (same enum on rules; every seed row is `'unreviewed'`; `brand: 'Sample'` is what marks a sample product), `lastReviewed`, `reviewedBy`, `ruleOverrides?`.
  - Seed ~10: Iron Bisglycinate, Calcium-Magnesium (contains calcium, magnesium, vitamin D), Magnesium Bisglycinate, Multivitamin (contains calcium and vitamin D, **not iron**), Vitamin D3, Omega-3 Fish Oil, Probiotic, Zinc, Vitamin C, B-Complex.
  - `npn: 'SAMPLE-NPN-0001'` (never 8 digits). **`upc` must be scannable by a real camera:** EAN-13 in the GS1 restricted-circulation range, i.e. starts with `200` (`200000000000` + computed check digit, then `200000000001`+check…), which is never assigned to retail products. `sku: 'SAMPLE-0001'`. Scanning any other barcode → "Product not found — sample catalogue only."
- **ingredients:** `id`, `name {en, fr?}`, `unit: 'mg' | 'mcg' | 'IU'` (canonical; no unit conversion in Phase 1; sample vitamin D in mcg).
- **product ingredients** (the `ingredients` array inside each product): sample `amountPerDose` values must be round, obviously placeholder numbers (covered by the banner).
- **rules:** `id`, `attribute` (WITH_FOOD, WITHOUT_FOOD, WITH_FAT, MORNING, EVENING, BEDTIME, SEPARATE_FROM_CALCIUM, SEPARATE_FROM_IRON, SEPARATE_FROM_COFFEE_TEA, TAKE_WITH_WATER, REFRIGERATE), `appliesTo: { ingredientId } | { productId }`, `severity`, `separationMinutes?`, `preferredAnchors?`, `explanation {en, fr?}`, `evidenceUrl | null`, `reviewStatus`, `lastReviewed`, `reviewedBy`. Rules attach to ingredients or products via `appliesTo`: `{ ingredientId }` rules apply to every product whose ingredient list contains that ingredient. Conflict targets of SEPARATE_FROM_X are also matched by ingredient: iron's SEPARATE_FROM_CALCIUM conflicts with every placed product containing calcium, including the Multi. A product's `ruleOverrides` may add rules or suppress inherited ones by rule id.

### Server tables (D1)

- `users` — `id TEXT PK`, `tz`, `platform ('ios'|'android'|'desktop')`, `created_at`, `last_seen_at`.
- `push_subscriptions` — `id`, `user_id`, `endpoint UNIQUE`, `p256dh`, `auth`, `created_at`, `last_success_at`, `failures`.
- `reminders` — `id TEXT PK` = `crypto.randomUUID().replace(/-/g, '')` (32 hex chars, generated by the Worker on insert; also the push `topic`), `user_id`, `kind ('schedule'|'test')`, `scheduled_at`, `slot_key`, `product_ids` (JSON), `title`, `body`, `status ('pending'|'sending'|'sent'|'failed'|'expired')`, `attempts DEFAULT 0`, `claimed_at`, `sent_at`, `UNIQUE(user_id, scheduled_at, slot_key)`.
- Indexes: `reminders(status, scheduled_at)`, `reminders(user_id, kind, status)`, `push_subscriptions(user_id)`.

## 7. Engine specification (`packages/engine`)

**Zone-free.** Works in minutes-since-midnight and returns local `HH:MM` slots; tests must pass regardless of the machine's zone. Only the browser sync layer converts, per calendar day, with `new Date(y, m, d, hh, mm).getTime()` (never by adding 86,400,000 ms to today: DST ends in Quebec on 2026-11-01, mid-beta). Send `Intl.DateTimeFormat().resolvedOptions().timeZone` and re-sync if it differs from the stored value. The Worker never converts; it compares epoch ms only.

**Routine.** In the engine's `Routine` type only `bedtime` and at least one meal are required; `wake`, `coffee`, `exercise` and the other meals are optional (no Phase 1 rule reads `wake` or `exercise`). The onboarding form additionally requires `wake` and offers "I don't…" toggles for the optional ones. Anchor mapping: MORNING = breakfast, EVENING = dinner, BEDTIME = bedtime, WITH_FOOD = breakfast unless the rule has `preferredAnchors`. If a preferred anchor is missing, fall back breakfast → lunch → dinner. No coffee → SEPARATE_FROM_COFFEE_TEA emits no reason. Exercise is stored but no Phase 1 rule uses it.

**Seed rules (all `reviewStatus: 'unreviewed'`):**

| Rule | `appliesTo` | Severity / options |
|---|---|---|
| WITH_FOOD + MORNING | `{ productId: 'multivitamin' }` | both Consideration |
| TAKE_WITH_WATER | `{ ingredientId: 'iron' }` | Informational |
| SEPARATE_FROM_CALCIUM | `{ ingredientId: 'iron' }` | Timing conflict, `separationMinutes: 120` |
| SEPARATE_FROM_COFFEE_TEA | `{ ingredientId: 'iron' }` | Consideration, `separationMinutes: 120` |
| WITH_FOOD | `{ ingredientId: 'calcium' }` | Consideration |
| EVENING | `{ productId: 'calcium-magnesium' }` | Consideration |
| BEDTIME | `{ productId: 'magnesium-bisglycinate' }` | Consideration |
| WITH_FAT | `{ ingredientId: 'omega-3' }` | Consideration, `preferredAnchors: [lunch, dinner, breakfast]` |
| WITH_FOOD | `{ ingredientId: 'probiotic' }` | Informational, `preferredAnchors: [lunch]` |
| WITH_FAT | `{ ingredientId: 'vitamin-d' }` | Consideration, `preferredAnchors: [breakfast, lunch, dinner]` |

**Algorithm.** (1) Every product starts at breakfast (or the first available meal): this is the baseline for adjustments. (2) Apply fixed-anchor rules (MORNING/EVENING/BEDTIME/`preferredAnchors`). If a product accumulates more than one fixed anchor, a product-level rule wins over an ingredient-level one; among equals, the first in `rules.json` order wins. The losing rule still appears in `reasons[]` but does not move the product. Also place extra doses now (see `dosesPerDay` below). (3) Separation, after every dose of every product is placed. For each product with SEPARATE_FROM_X rules: conflict times are every placed dose of every product containing X (for COFFEE_TEA: the coffee anchor). A conflict exists when |t − conflictTime| < `separationMinutes` (a gap of exactly `separationMinutes` is fine). Walk the 15-minute grid upward from the product's current time and take the first time with no conflict. (4) Emit one adjustment code per product whose final time differs from baseline, worded by the highest-severity rule that contributed to the move (Timing conflict > Consideration > Informational; ties by `rules.json` order). **`dosesPerDay = N`** → N placements: the first follows steps 1–2; each extra dose goes to the next unused meal anchor in the order dinner, lunch, breakfast; if none remains, bedtime; if bedtime is used too, drop the dose and emit `NO_SLOT_AVAILABLE` with the product id. Every dose obeys step (3). Cap N at 4. One reminder per placement time; products sharing a time share one push.

**Output per placement:** `time` (HH:MM), `anchor` (`breakfast|lunch|dinner|bedtime|null`), `productIds`, `reasons[]` (`ruleId`, `severity`, `params`), plus a global `adjustments[]` (codes with params). The Today screen groups by anchor and labels anchor-less placements by time.

**Duplicate ingredients:** for every ingredient in ≥ 2 stack products, list each product's amount (× doses/day) and the sum. Trigger on **product count alone**, never on amount. Never compare to RDA/UL, never colour it red, never use "unsafe / excessive / overdose / toxic".

**First Vitest test (the PDF's section-5 example).** Routine: coffee 07:00, breakfast 07:30, lunch 12:00, dinner 18:00, bed 22:00 (no wake/exercise needed for the test). Stack, all `dosesPerDay: 1`: iron, calcium, magnesium, multivitamin, fish oil, probiotic. Assert times, product ids, anchor and rule ids:

- 07:30 breakfast — multivitamin
- 09:30 (no anchor) — iron, reasons include SEPARATE_FROM_CALCIUM and SEPARATE_FROM_COFFEE_TEA (coffee alone would give 09:00; the Multi's calcium at 07:30 is what pushes iron to 09:30; assert 09:30 exactly)
- 12:00 lunch — fish oil, probiotic
- 18:00 dinner — calcium
- 22:00 bedtime — magnesium
- `adjustments` **contains** (superset, count not asserted) the codes rendered as "Iron moved away from calcium", "Fish oil moved to a meal", "Magnesium moved to bedtime".

The engine test asserts ids, codes and params only (e.g. `{ code: 'MOVED_AWAY_FROM', productId: 'iron', ingredientId: 'calcium' }`) and never imports `en.json`. A separate `apps/web` test renders those three codes through `t()` and checks the English with `toContain`, not equality. The PDF's section-13 mock-up is a **layout reference only**; its times and placements are not a second expected output (the two PDF mock-ups intentionally differ; don't reconcile them).

## 8. Screens (mobile-first, works at 375 px, English, neutral placeholder palette, no New Roots logo yet)

0. **iOS install gate** — shown first on iOS when not standalone (see §4).
1. **Onboarding** — routine with section-8 defaults: wake 07:00, coffee 07:30, breakfast 08:00, lunch 12:00, dinner 18:00, exercise 17:30, bed 22:30; optional toggles; time zone auto-detected. "Build my schedule" = the engine call.
2. **Add supplement** — camera scan (lazy-loaded scanner) + manual UPC entry + pick from the sample list. Confirm product, choose doses/day (default from product). Unknown barcode → "Product not found — sample catalogue only."
3. **My stack** — list, remove, duplicate-ingredient summary using the PDF text verbatim: heading *"Your stack contains overlapping nutrients."*, per ingredient the per-product amounts and *"Your total daily intake from these products is X."*, then *"Review recommended — You're taking multiple products containing this nutrient. Consider discussing your total intake with a healthcare professional."*
4. **Today** — section-13 layout (Morning / 9:30 / Lunch / Evening / Bedtime headers, checkable rows, warning lines under a row). Checkbox state in localStorage keyed `${localDate}:${productId}:${doseIndex}`, survives re-runs, discarded for past dates. Editing the stack or routine re-runs the engine immediately and re-syncs. **"Optimize my stack"** is the same engine call; the button re-runs it and opens the "N adjustments were made" sheet. **"I'm running late"** opens a sheet with +30 min / +1 h / +2 h that shifts every anchor still in the future by that amount for today only (`todayOverride` with the local date, expires at local midnight, triggers re-run + re-sync).
5. **Why? sheet** — the explanation (e.g. "Calcium may interfere with iron absorption. We've scheduled these at different times."), severity badge with sub-label, then "Learn more" with exactly the PDF's four rows: Evidence/source (link or "Source: to be added"), Product information (the product's directions and warnings, marked sample), Last reviewed, Reviewed by ("Not yet reviewed").
6. **Reminders** — Android install button, **"Turn on reminders"** (permission → subscribe → `PUT /api/me` → `POST /api/me/push-subscription` → schedule sync), status of the subscription, denied-state instructions, and **"Send me a test reminder in 2–3 minutes"** (the cron rounds up to the next minute). Banner when `lastSync` is older than 5 days.
7. **Settings** — time zone, language (EN now, FR placeholder), "Delete my data", version, link to the privacy section.

## 9. API (`/api/me/...`, bearer UUID)

- `PUT /api/me` — create or update `{ tz, platform }` (requires `X-Beta-Key`).
- `DELETE /api/me` — delete user, subscriptions and reminders.
- `POST /api/me/push-subscription` — upsert `{ endpoint, keys }`; `DELETE /api/me/push-subscription` — remove.
- `PUT /api/me/schedule` — body: a **rolling 7-day window** of reminders `{ scheduledAt (epoch ms), slotKey, productIds, title, body }` computed per local calendar day, omitting anything earlier than now + 2 min. The Worker deletes this user's rows where `kind='schedule' AND status='pending' AND scheduled_at > now`, then `INSERT OR IGNORE` the payload (never touches `sending`, `sent`, or `kind='test'` rows). The browser re-sends only when a hash of the computed window differs from the last synced hash.
- `POST /api/me/test-reminder` — inserts one `kind='test'` reminder 2 min out (rate-limited).
- `scheduled()` — §5.

Accepted Phase 1 limitation (README): only the browser runs the engine, so if the app isn't opened for 7 days reminders stop; `notificationclick` opens the app so every tap refreshes the window. Later the Worker can run `packages/engine` to roll the window server-side.

## 10. Milestones (in order; tests pass before each commit; commit after each)

1. **Scaffold** — git init, workspaces, the four packages, ESLint/Prettier, Vitest projects, README with this architecture and the privacy section, `.claude/launch.json` so the web app can be previewed in the browser pane.
2. **Engine** — types, seed JSON + validator + data template, scheduler, reasons, adjustments, doses > 1, duplicate totals, tests (the section-5 test first).
3. **Web app, offline** — all screens against the engine with localStorage only; PWA manifest, icons, service worker; install flows; `/dev/barcodes` (renders every sample EAN-13 as SVG with `bwip-js` or `jsbarcode` so I can scan them off my monitor) and `/dev/styleguide`. **End this milestone with a first `wrangler deploy` of the assets-only Worker** so I can test scanning, install and the engine on my Android before the API exists. For this deploy `apps/worker/wrangler.toml` contains only `name`, `compatibility_date`, `[assets]` and `[observability]`: no `main`, no `[[d1_databases]]`, no `[triggers]`. Milestone 4 adds `main`, the D1 binding (after `wrangler d1 create smartstack`) and the every-minute cron.
4. **Worker** — D1 schema/migrations, hono routes, cron sender, `wrangler dev` with local D1, unit tests for the claim/expiry/response logic.
5. **Connect + deploy** — Reminders screen wired end-to-end; desktop Chrome test on localhost first; deploy; secrets; note that push subscriptions are tied to the origin, so switch to `smartstack.newrootsherbal.com` before employees install.
6. **Device checklist in the README** — Android Chrome: install, allow, test reminder, lock the phone, reminder arrives. iPhone Safari: Add to Home Screen, open from icon, onboarding, allow, test reminder.

**Milestones 1–3 are the PDF's Phase 1 MVP** ("Scan product → Add to stack → Enter schedule → Generate schedule") and must be demoable on their own, fully offline, with the sample banner. Milestones 4–6 are my extension toward the employee beta; if anything has to slip, they slip, not 1–3.

## 11. How I want you to work

- Read the PDF and this prompt, then give me a short plan and the exact list of what I must do myself (Cloudflare account, `wrangler login`, VAPID keys, secret). Ask before anything paid or irreversible; everything free listed in §1 is pre-approved.
- Small commits with clear messages. Tests must pass before each commit.
- Do not invent product facts, NPNs, UPCs, citations or health claims. Everything product- or rule-related is sample data, labelled as such in code and UI (§2).
- No AI features, no analytics, no third-party scripts or CDN loads in Phase 1.
- When unsure about a supplement-timing rule, add it as `unreviewed` with a plain explanation and move on; the product team reviews rules later.
- If something in this prompt turns out to be impossible or contradictory, tell me which line and propose the smallest change; don't silently do something else.
