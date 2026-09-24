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
   three.
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
| Catalogue     | Static JSON in `packages/engine/data/` (products, ingredients, rules), bundled into the web app, never fetched                     |

One origin for the app and the API, so there is no CORS. In development Vite (5173)
proxies `/api` to `wrangler dev` (8787).

### Repository layout

```
apps/web         React PWA
apps/worker      Cloudflare Worker (hono routes, cron sender, D1 migrations)
packages/engine  Rules engine + seed data + data validator
packages/shared  Types and zod schemas
docs/            Pitch PDF, Phase 1 prompt, data template for the product team
```

`packages/*` export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`);
there is no build step for them.

### Where data lives

- **The browser's localStorage is the source of truth** for routine, stack and schedule. If it
  is wiped, the user re-onboards.
- The server stores only what is needed to deliver reminders. **Routine and stack are never
  sent to the server.** Reminder rows carry product ids and the notification text, nothing more.
- The app makes **no network call** until the user taps "Turn on reminders."

## Development

Requirements: Node 22 (`.nvmrc`), npm 11. Do not use pnpm or yarn.

```bash
npm install
npm run dev            # web app on http://localhost:5173
npm run dev:worker     # Worker on http://localhost:8787 (wrangler dev --test-scheduled)
npm test               # all Vitest projects
npm run check          # typecheck + lint + prettier + tests
npm run data:validate  # validate packages/engine/data/*.json against the zod schemas
```

Fire the cron locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Android phone against the local dev server:

```bash
adb reverse tcp:5173 tcp:5173
```

then open `http://localhost:5173` on the phone.

### Environment

| File                        | Committed | Contents                                                                           |
| --------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `apps/web/.env`             | yes       | `VITE_VAPID_PUBLIC_KEY` (public), `VITE_BETA_KEY` (speed bump, not security)       |
| `apps/worker/wrangler.toml` | yes       | `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `MAX_PUSHES_PER_TICK`, `BETA_KEY`, D1 binding |
| `apps/worker/.dev.vars`     | **no**    | `VAPID_PRIVATE_KEY` for local `wrangler dev`                                       |
| Cloudflare secret           | n/a       | `wrangler secret put VAPID_PRIVATE_KEY`                                            |

Generate the VAPID pair **once** with `npx web-push generate-vapid-keys` and store it in the
company password manager. If the keys change, every phone must re-subscribe. The `web-push`
npm package is never used at runtime.

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

**Where:** Cloudflare D1. Sent, failed and expired reminder rows are deleted 7 days after
their scheduled time by the 03:00 UTC cron tick. Logs contain counts, status codes and reminder
ids, never a user id together with product names or notification text.

**How to delete:** Settings → "Delete my data" calls `DELETE /api/me`, which deletes the user,
their subscriptions and their reminders, then clears local storage.

**Before any employee beta** (not only before consumer release), a privacy review under
**PIPEDA** and **Quebec Law 25**, including a **privacy impact assessment**, is required.

## Sample-data rule (all of Phase 1)

- Every seed product and rule has `reviewStatus: 'unreviewed'`, `reviewedBy: null`,
  `lastReviewed: null`; the UI renders "Not yet reviewed".
- `evidenceUrl` is a real public URL that is known to exist, or `null` ("Source: to be added").
  Citations are never invented.
- Sample products are `brand: 'Sample'`, named "(sample)", with placeholder directions and
  warnings. UPCs are EAN-13 codes in the GS1 restricted-circulation range (prefix `200`), which
  is never assigned to retail products. NPNs look like `SAMPLE-NPN-0001`.
- Seed rules may only be _Timing conflict_, _Consideration_ or _Informational_.

## Out of scope for Phase 1

Missed-dose guidance, medications, label OCR or any AI, product "benefits" pages, cross-selling,
pricing, user accounts, analytics, the real product database (the product team supplies it
later through `docs/data-template.md`).
