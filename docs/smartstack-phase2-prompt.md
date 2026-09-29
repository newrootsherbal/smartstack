# New Roots SmartStack — Phase 2 build prompt

> Paste everything below the line as the first message of a new Claude Code session opened in
> `D:\Websites\smartstack`. It records every decision already made so the new session can plan
> and build without re-researching. The human steps (Google, SMTP2GO, Cloudflare staging,
> secrets, Law 25, admin access, Apple later) are in `docs/smartstack-phase2-setup.md`;
> section 12 says when each one is needed. The Law 25 package (privacy policy, terms, consent
> texts, impact assessment, incident runbook) is in `docs/privacy/`.

---

I'm continuing **New Roots SmartStack** for New Roots Herbal. Phase 1 is live. Read `README.md`
(what exists today), `docs/smartstack-phase1-prompt.md` (the original principles, which still hold
unless this prompt changes them), this whole prompt, and `docs/smartstack-phase2-setup.md` (the
steps I do myself). Decisions below are final; section 15 lists the few defaults I may still
adjust. Start with a short plan for M0–M1, then build.

## 1. Where things stand (2026-09-29)

- Live at `https://schedule.flourishbodyandmind.com`: one Cloudflare Worker on the **free plan**
  serves the PWA, `/api/*` and an every-minute push cron. D1 database `smartstack` (ENAM).
- GitHub `newrootsherbal/smartstack` (public). `main` is protected: work on a branch, push it and
  give me the compare URL; merging deploys (`.github/workflows/deploy.yml`). **deploy.yml does
  not apply D1 migrations** (M0 changes that).
- Guest-only today: `localStorage` key `smartstack:v1` is the source of truth. The server keeps an
  anonymous device UUID, time zone, push subscriptions and reminder rows, nothing else.
- Catalogue: 392 New Roots Herbal products bundled in `packages/engine/data/`, refreshed weekly
  by a GitHub Actions PR. Variants carry their UPC and size (`"120"`, `"50 ml"`, `"300 g"`…).
- Bilingual (English / Quebec French). Every string lives in both `apps/web/src/i18n/en.json` and
  `fr.json`; a test fails on any missing key.
- `apps/web/public/NRH Logo.png` (800×735, untracked) is the logo for the new welcome screen.
  Rename it `nrh-logo.png` (no spaces) and ship a resized, optimized copy.

## 2. What Phase 2 delivers

1. **"More info ›"** replaces the "Why?" link and is available on every dose, stack item and
   shopping-list item.
2. **Magnesium** is no longer moved to bedtime automatically; the app suggests the evening
   instead, without any health claim.
3. **Bottle tracking**: new or opened bottle, pills left, decreases when a dose is ticked, refill,
   edit.
4. **Shopping list** tab: products with 5 days or less left are added automatically, with a popup.
5. **Accounts**: email + password and Google now; **Sign in with Apple later** (after the company
   joins the Apple Developer Program), with everything built to accept it. "Continue without an
   account" keeps today's local-only app.
6. **Server storage and sync** for account users ("Back up & sync").
7. **Other-brand products** (accounts only): natural health products (NPN, prefilled from Health
   Canada), medications (DIN, prefilled from Health Canada), foods and anything else. Added from a
   tab or from a popup when a scanned barcode isn't in the catalogue.
8. **New Roots Herbal alternatives**, offered when an other-brand product is running out.
9. **Health profile** (accounts only): age, gender, pregnancy, conditions (high blood pressure,
   IBS…), goals, diet. Used only to target news, and only with separate consent.
10. **News notifications**: staff compose push notifications (new product, webinar…) with a
    link, schedule them, and target everyone who opted in or a health-profile segment. Opt in and
    out in the Notifications screen.

Out of scope: native apps, push for low stock, a product database shared between users,
analytics, AI of any kind, payments, marketing email, changing an account's email address,
2FA/passkeys, medication interaction checking.

## 3. Principles

Unchanged from Phase 1: the engine is deterministic code driven by a rules database, not AI; the
app never says a dose is unsafe; the five severity levels; bilingual; no analytics, no
third-party scripts, no CDN loads (Google sign-in uses plain OAuth redirects, never Google's
JavaScript); device features stay behind `apps/web/src/platform/*` for Capacitor later.

New:

- **Guest mode is exactly today's app**: no network call until the person turns on reminders or
  news, or chooses to create an account / log in. Bottle tracking and the shopping list work for
  guests too.
- **Accounts are opt-in and minimal**: store only what a feature needs. No dose history beyond
  3 days on the server.
- **Privacy by default** (Law 25): news notifications and health-profile targeting are off until
  the person turns them on. The health profile never changes the schedule and is never presented
  as advice.
- **Launch gate**: `ACCOUNTS_MODE` (Worker) and `VITE_ACCOUNTS_MODE` (web build) are `off`,
  `staff` or `public`. Local and staging: `public`. Production: `staff` (only addresses in
  `STAFF_EMAIL_DOMAINS`, e.g. `newrootsherbal.com`, can sign up or log in; the public UI shows no
  account features) until the Law 25 launch checklist (setup doc, part F) is done, then `public`.
  M1, M2 and guest news opt-in ship to production regardless.
- **Free plan: 10 ms of CPU per request** and per cron run, 50 subrequests per invocation. Nothing
  CPU-heavy runs in the Worker (hence passwords stretched in the browser, §5.2); pushes are sent a
  few dozen per minute.
- **Regulatory review happens before any app-store submission**, not now. Keep product copy
  factual anyway.

## 4. Features and screens

### 4.1 Navigation

Bottom nav, five items: **Today · My stack · Add · Shopping · Profile**.

- **Profile** holds, top to bottom: the account card (guest: "Back up & sync"), the health
  profile card, then everything that was in Settings (Notifications, Routine, Time zone,
  Language, Theme, Privacy & data, Developer, and Admin for staff admins).
- The Reminders screen becomes **Notifications** (`/notifications`; `/reminders` and `/settings`
  redirect): dose reminders as today, plus the news toggles (§4.12).
- Today shows a dismissible "Turn on reminders" card while reminders are off. The Shopping tab
  shows a count badge.

### 4.2 Welcome, auth screens, "Back up & sync"

- `/welcome`, shown while `auth.mode === 'unset'` (new installs, and existing Phase 1 users once;
  their local data is untouched whatever they choose). Logo, "SmartStack by New Roots Herbal", one
  line of value ("Your supplements, scheduled around your day"). Buttons: **Continue with
  Google**, **Continue with email** (→ `/signup`), "I already have an account" (→ `/login`), and a
  quieter **Continue without an account** with the note "Your stack stays on this device. You can
  back it up later from your profile." A **Continue with Apple** button exists in the code but only
  renders when `VITE_APPLE_ENABLED=true`. When accounts are `off` or `staff`, the welcome screen is
  skipped and the mode is `guest` (staff reach `/login` by URL or from Profile → Developer).
  On iOS the install gate still comes first (the Home Screen app has its own storage).
- Guests are invited to sign in exactly where an account matters: Profile → **Back up & sync**
  ("Keep your stack safe and use it on your other devices"), the Other brand tab, the
  unknown-barcode popup (§4.8) and the health profile card. Each leads to `/signup` or `/login` and
  back to where they were.
- `/signup`: email, password (show/hide, 8–128 characters, no composition rules), first name
  (optional), the consent checkbox and "I am 14 or older" (§5.8), plus the Google button. Then:
  verification email sent (non-blocking banner "Confirm your email · Send again"), the data step
  (§8.4), onboarding if there is no routine, else Today.
- `/login`: email, password, "Forgot password?", Google. One generic error: "Email or password is
  incorrect."
- `/forgot-password`: always answers "If an account exists for that email, we sent a link. It
  expires in 1 hour."
- `/reset-password#token=…` and `/verify-email#token=…`: the token is in the fragment (never sent
  to the server in the URL); read it, strip it with `history.replaceState`, POST it. On an iPhone
  these links open in Safari, whose storage is separate from the Home Screen app: never assume the
  app's session there; finish with "Password changed. Open the app and log in." / "Email
  confirmed. You can return to the app."
- `/auth/done?state=…`: OAuth landing page (§5.4). `/auth/consent`: consent step for accounts
  created through Google (§5.8).
- `/privacy` and `/terms`: bilingual static pages rendered from `docs/privacy/privacy-policy.{en,fr}.md`
  and `docs/privacy/terms.{en,fr}.md` (convert them at build time with a tiny script, or by hand;
  no runtime Markdown library; drop the HTML comments). They are drafts until the Privacy Officer
  approves them; show a "Draft" line at the top until `CONSENT_VERSION` is marked final.
- Every consent and privacy notice uses the exact wording of `docs/privacy/consent-texts.md`
  (IDs C1–C7, N1–N10); name the i18n keys after those IDs so they're easy to audit.
- Charter of the French language: terms are a contract of adhesion, so the sign-up line C3 links
  **both** versions, French first ("Conditions d'utilisation · Terms of Use"), whatever the app
  language.
- Provider buttons follow Google's (and later Apple's) branding guidelines: official logos as
  inline SVG, "Continue with Google" / « Continuer avec Google ».

### 4.3 "More info ›"

- Today currently shows a "Why?" link only when a dose has reasons (`Today.tsx`, `common.why`).
  Replace it with a **More info** button followed by a chevron (inline SVG, `aria-hidden`) on
  **every** dose row, every My stack item and every Shopping list item. Accessible name "More info
  about {product}". French « Plus d'infos ». Delete `common.why`.
- Rename `WhySheet` → `ProductInfoSheet`, titled with the product's short name. Sections, each only
  when it has content:
  1. **Timing**: every reason with its explanation, severity badge and "Learn more" details
     (today's content); the evening suggestion (§4.4); the person's chosen time with "Move back".
  2. **Your bottle**: left, days left, [Refill] [Edit count] (§4.5).
  3. **Suggested use**, **Warnings**, **Label facts** (as today).
  4. For other-brand products: "Have you considered New Roots Herbal's {product}?" (§4.9). For
     medications: the medication note (§4.7).
  5. Product page link and the review status line.
- The short reason lines under each dose row stay.

### 4.4 Magnesium: an evening suggestion, not a move

- Today the curated ingredient rule `rule-magnesium-bedtime` (attribute `BEDTIME`) puts these 8
  products at bedtime: `ata-mgsupsup-magnesium-acetyl-taurate`, `magnesium-bisglycinate`,
  `magnesium-bisglycinate-capsules`, `magnesium-bisglycinate-plus`,
  `magnesium-citrate-plus-taurine`, `magnesium8`, `pure-magnesium-bisglycinate-115-mg-taurine`,
  `pure-magnesium-bisglycinate-130-mg-elemental-magnesium`. Multis, cal-mags and other combos
  already switch it off through the `ruleOverrides.disable` the importer writes
  (`packages/engine/src/import/product.ts`); `sleep8` is at bedtime by its own label rule and must
  stay there.
- Add a rule attribute **`SUGGEST_BEDTIME`** that never moves a dose. Keep the rule id
  `rule-magnesium-bedtime` (so the importer's overrides keep working) and change its attribute to
  `SUGGEST_BEDTIME`, severity `informational`. Wording states a habit, not a benefit:
  en "Many people prefer to take magnesium in the evening. Move it to bedtime?",
  fr « Plusieurs personnes préfèrent prendre leur magnésium le soir. Le déplacer au coucher? »
  The 8 products then land where the other rules put them (breakfast, or their label's meal).
- Today: under that dose, an informational card with the text and **[Move to bedtime]**
  **[No thanks]**. Move sets the stack item's bedtime pin (§10); No thanks adds `SUGGEST_BEDTIME`
  to the item's `dismissed` list (the card disappears; More info still offers the move). Once
  moved, the reason line reads "You moved this to bedtime" and More info offers "Move back".
- Add flow: for a product with this rule, an unticked checkbox "Take it at bedtime".
- Keep the `BEDTIME` attribute and the sample-fixture tests (sleep8 and melatonin still use it).
  Update `packages/engine/data/rules.json`, the "magnesium products" test in `catalogue.test.ts`,
  the validator (`SUGGEST_BEDTIME` only with `informational`), the README engine paragraph and
  `docs/data-template.md`.

### 4.5 Bottle tracking (guests and accounts)

- **Add flow**, after the times-per-day card, a "Your bottle" card: **[New bottle]**
  **[Already opened]** **[Don't track]** (New is preselected).
  - New: the full-bottle quantity comes from the scanned variant (the UPC tells which size). When
    the product was browsed or typed and has several sizes, show size chips ("120", "240"). When
    the size is unknown or not countable, ask "How many in a full bottle?".
  - Opened: "How many {units} are left?" (decimals allowed for servings).
  - Units: capsules, softgels, tablets (and unit labels such as caplet, gummy, lozenge) are counted
    as units. Liquids and powders are counted in **servings**: from the variant text when it says
    "= N doses / portions", else size ÷ serving amount when both are in ml or g (`"300 g"` with a
    serving of `"(30 g)"` → 10), else ask. Put this in a pure `parsePackageSize()` tested against
    every variant size string in `products.json` (576 today: 413 plain counts, 80 "N ml", 34 "N g",
    the rest mention doses or portions) with the parse rate printed by the test.
- Daily use = doses per day × units per dose (or doses per day, in servings). When the label gives
  no units per dose, ask "How many per dose?" (default 1) and store it on the stack item.
- **Ticking** a dose on Today subtracts that dose's units (never below 0); unticking restores
  exactly what was subtracted (store the amount with the check). An unticked dose subtracts
  nothing.
- **My stack** shows "68 capsules left · about 34 days" or "Not tracked · Track this bottle". Keep
  rows clean with a per-item **Manage** sheet: Refill, Edit count, Add to shopping list, Move to…
  (wake-up/breakfast/lunch/dinner/bedtime/automatic), More info, Remove.
- **Refill**: "How many did you add?", default the full-bottle size, shows the sum ("5 + 30 = 35");
  remaining += added; clears the low flag; removes the product from the shopping list.
- **Edit count** sets the exact number left.
- **Running low**: after any decrease, when left ≤ 5 × daily use (`LOW_STOCK_DAYS = 5`) and the
  bottle isn't flagged yet: add the product to the shopping list (reason `low`), set
  `lowFlaggedAt`, and show a sheet once per bottle (the flag clears on refill or when the count is
  edited back above the threshold):
  - **New Roots Herbal product, or no alternative found**: "You're almost out of {product}. About
    {days} days left ({count} {units}). We added it to your shopping list." [View shopping list]
    [OK].
  - **Other-brand product with an alternative** (§4.9): "You're almost out of {product}! Have you
    considered New Roots Herbal's {alternative}?" **[Add to shopping list]** (adds the
    alternative to the list as a replacement for the current product, which leaves the list)
    **[Refill current product]** (opens the refill sheet for the current product, for people who
    already have the new bottle; closing it without refilling leaves the current product on the
    list).
  - Days left = floor(left ÷ daily use); 0 shows "Empty".

### 4.6 Shopping list (`/shopping`)

- One entry per product: name and brand, "8 capsules left · about 4 days" when tracked, a chip
  "Running low", "Added by you" or "Instead of {other product}". Actions: **Refill** (same sheet as
  above), **More info ›**, **Remove** (with an undo toast).
- **Every item can be removed**, whatever put it there. Removing an automatically added item keeps
  the bottle's low flag, so it doesn't come back until the next bottle runs low. Removing an
  "Instead of" item puts the other-brand product it replaced back on the list if that product is
  still running low.
- New Roots Herbal products: a "Buy online ›" link to the product page (`sourceUrl`) with
  `utm_source=smartstack&utm_medium=app&utm_campaign=shopping_list`.
- Other-brand products with an alternative: the line "Have you considered New Roots Herbal's
  {alternative}?" with [Add to shopping list].
- **Replacement bought**: tapping Refill on an item that replaces an other-brand product asks
  "Add {alternative} to your stack? It replaces {other product}." [Replace] [Keep both] and runs
  the normal add flow (dose, bottle = new).
- Empty state: "Nothing to buy. Products with 5 days or less left appear here."
- Adding by hand: My stack → Manage → Add to shopping list.

### 4.7 Other-brand products (accounts only)

- Add screen tabs: **Scan · Enter code** (renamed from "Enter UPC") **· Browse · Other brand**
  (new). Guests who open Other brand see why an account is needed and [Create an account]
  [Log in].
- The form (`/add?mode=other`, optional `&upc=`) starts with **"What kind of product is it?"**:
  **Natural health product** (has an NPN) · **Medication** (prescription or over the counter; has
  a DIN) · **Food, drink or other** (no number).
- **Natural health product / Food, drink or other**:
  1. **Product**: Brand\*, Product name\*, Barcode (optional: type it or [Scan] in a sheet; check
     digit validated; prefilled from the unknown-barcode popup), NPN (8 digits, natural health
     products only) with **[Fill from Health Canada]**.
  2. **Format**: Form\* (capsule, tablet, softgel, liquid, powder, other) and Bottle size\*
     (number + capsules/tablets/softgels, ml or g: "30 capsules", "50 ml").
  3. **Dose**: amount per dose\* + unit\* (capsule, tablet, softgel, drop, ml, g, scoop, teaspoon,
     tablespoon, gummy, other; reuse the `unitLabel` vocabulary), times per day\* (1–4).
  4. **From the label** (optional checkboxes): With food · On an empty stomach · In the morning ·
     In the evening · At bedtime.
  5. **Medicinal ingredients** (optional, encouraged: "Add the ingredients so we can check timing
     with the rest of your stack"): repeatable rows of ingredient (autocomplete over
     `ingredients.json` in the current language, free text allowed), amount, unit (mg, mcg, IU,
     CFU, g, ml).
  6. Suggested use, Warnings, Notes (free text, optional).
- **Medication**: Name\*, Company (optional), Barcode (optional), DIN (8 digits) with
  **[Fill from Health Canada]**, Form\*, Strength (optional, e.g. "50 mcg"), Bottle size, amount
  per dose\*, times per day\*, and **"When do you take it?"\*** — one time per dose, chosen from the
  routine (wake-up, breakfast, lunch, dinner, bedtime). The engine never moves a medication (§10);
  supplements can move away from it. A permanent note in the form and in More info: "SmartStack
  doesn't check medication interactions. Follow your doctor's or pharmacist's instructions, and ask
  your pharmacist whether your supplements should be taken apart from this medication."
  Medications never get label-rule checkboxes and never get alternatives.
- Then the bottle card (§4.5) and **Add to my stack**.
- **Fill from Health Canada**: the Worker proxies Health Canada's public APIs (free, no key; keeps
  our CSP at `connect-src 'self'` and the person's IP away from a third party), accounts only,
  cached a week with the Cache API. Prefill, then the person reviews everything before saving;
  never block the form on these calls.
  - NPN (Licensed Natural Health Products Database, verified live 2026-09-29 with NPN 80000001):
    `GET https://health-products.canada.ca/api/natural-licences/productlicence/?id=<NPN>&lang=<en|fr>&type=json`
    gives the licence with its `lnhpd_id`, product and company names; then
    `medicinalingredient/?id=<lnhpd_id>` (quantities and units, wrapped in `{ metadata, data }`)
    and `productdose/?id=<lnhpd_id>` (dose quantity and frequency, a bare array).
  - DIN (Drug Product Database, from its documentation; test it live first):
    `GET https://health-products.canada.ca/api/drug/drugproduct/?din=<DIN>&lang=<en|fr>&type=json`
    gives `brand_name`, `company_name` and `drug_code`; then
    `https://health-products.canada.ca/api/drug/activeingredient/?id=<drug_code>` gives
    `ingredient_name`, `strength`, `strength_unit`.
- Stored as a `UserProduct` (§9) with id `u_<uuid>`. Listed under "Your products" in Browse;
  editable and deletable from the Manage sheet (deleting also removes it from the stack and the
  list). A scanned barcode that matches one of the person's products selects it like a catalogue
  product.
- Ingredient amounts convert to the canonical unit when possible (g → mg → mcg; vitamin D IU →
  mcg ÷ 40, as the importer does; reuse `packages/engine/src/import/ingredients.ts`). Anything
  that can't be converted stays a free-text ingredient: shown, but not used by rules or duplicates.
- Label checkboxes become product-level rules built on the device: id
  `user:{productId}:{attribute}`, severity `product_instruction` (copied from the label),
  explanation "From your label: take with food." (both languages), `evidenceUrl: null`,
  `reviewStatus: 'unreviewed'`. `WITHOUT_FOOD` stays informational (the scheduler doesn't place by
  it today).

### 4.8 Unknown barcode popup

- A scanned or typed code found neither in the catalogue nor in the person's products opens a
  sheet (pause the scanner while it is open: add a `paused` prop to `ScanView`, which today
  re-reports the same code every 3 seconds):
  - **Account**: "We don't know this product yet" + the code; [Add it manually] (opens the form
    with the barcode filled in) [Scan again].
  - **Guest** (accounts `public`): "This product isn't in the New Roots Herbal catalogue. Create a
    free account to add products from other brands." [Create account] [Log in] [Not now].
  - **Accounts `off` or `staff`**, for the public: today's "Product not found" notice.

### 4.9 New Roots Herbal alternatives

- Pure engine function `suggestAlternatives(userProduct, catalogue, curated, stack)` returning at
  most 2 catalogue products, each with the facts that explain the match. **Never for
  medications.**
  1. **Curated first**: `packages/engine/data/alternatives.json`, entries
     `{ match: { upc } | { brand, name }, productId, reviewStatus, lastReviewed, reviewedBy }`
     (brand/name match case- and accent-insensitively, name as "contains"). Validated by
     `npm run data:validate` (product exists, not topical). Starts empty; the product team fills it
     from the other-brand report (setup doc, part H).
  2. **Computed**: candidates are catalogue products of kind `nhp` or `food`, not already in the
     stack. Score = Σ over shared canonical ingredients of min(daily a, daily b) ÷ max(daily a,
     daily b), divided by the number of canonical ingredients in either product; +0.15 for the same
     form; +0.1 for each shared distinctive name word from a short list (bisglycinate, citrate,
     glycinate, d3, k2, omega, epa, dha, probiotic, b12, methylcobalamin…), capped at 1. Keep
     results scoring ≥ 0.5 that share at least one canonical ingredient. Ties: closer total amount,
     then name.
  3. No match → show nothing.
- Copy: "Have you considered New Roots Herbal's {name}?" with an optional factual line ("Also
  magnesium, 200 mg per capsule") and [Add to shopping list] / [View product ›]. No "same as",
  "equivalent" or "better".
- Shown in the running-low sheet (§4.5), the shopping list (§4.6) and the product's More info
  sheet. Not at the moment the product is added.

### 4.10 Profile: account and data

- Guest: the "Back up & sync" card [Create account] [Log in]. "Delete my data" works as today.
- Account: name and email, email status (Send the confirmation again), sign-in methods (Password: Change;
  Google: Connected / Connect; Apple row only when enabled), [Download my data] (JSON),
  [Log out], [Delete my account].
- **Log out**: confirm ("Your data stays in your account. This device will be cleared.") → delete
  the session, empty this device's reminder window, unlink the device, clear local state (keep
  theme and language) → `/welcome`.
- **Delete my account**: explicit confirmation → `DELETE /api/account` → clear local state →
  `/welcome`.

### 4.11 Health profile (accounts only)

- Profile → **Health profile** (`/profile/health`). Guests see a locked card: "Create an account to
  build your health profile." Every question is optional and has "Prefer not to say".
- First visit: the storage consent (§5.8) before any field is saved.
- Fields (codes in `packages/shared`, labels in both dictionaries; the product team may edit the
  lists later, §15):
  - **Year of birth** (age computed; no full birth date).
  - **Gender**: woman, man, non-binary, another gender, prefer not to say.
  - **Pregnancy**: pregnant, breastfeeding, trying to conceive, none, prefer not to say (hidden
    when gender is "man").
  - **Health conditions**, grouped checklist: heart and circulation (high blood pressure, high
    cholesterol, heart disease); metabolism (type 2 diabetes, prediabetes, thyroid condition);
    digestion (IBS, acid reflux / GERD, Crohn's or colitis, celiac disease); bones and joints
    (osteoporosis / osteopenia, arthritis); mind and sleep (anxiety, depression, trouble sleeping);
    other (migraine, iron-deficiency anemia, kidney disease, liver disease, PCOS, menopause,
    asthma, eczema / psoriasis, autoimmune condition). No free text (it can't be targeted and it
    invites details we don't need).
  - **Goals and interests**: sleep, stress, energy, immunity, digestion, heart health, joints and
    bones, brain and focus, skin / hair / nails, sports and fitness, weight management, healthy
    aging, women's health, men's health, prenatal.
  - **Diet and sensitivities**: vegan, vegetarian, gluten-free, dairy-free, keto / low-carb;
    avoids soy, dairy, gluten, nuts, fish / shellfish, eggs.
  - **Activity level**: low, moderate, high.
- A switch **"Use my health profile to send me relevant news"** (webinars, new products), off by
  default, with a one-line explanation that this is profiling and can be turned off any time
  (Law 25 s. 8.1). It only matters when news notifications are on for a device (§4.12).
- Footer: "Your health profile doesn't change your schedule and isn't medical advice."
  [Delete my health profile] (deletes the row; the account stays).
- Synced like the other entities (§8), stored in `health_profiles` (§6).

### 4.12 News notifications

**For people** (Notifications screen, guests and accounts):

- Dose reminders section gains a switch **"Show product names in reminders"** (N4), **off by
  default** (privacy by default: notifications show on lock screens). When off, reminders read
  "Time for 3 products — 9:30 AM" / « 3 produits à prendre — 9 h 30 » and the server's reminder rows
  hold no product names. Existing Phase 1 devices switch to the new default at the v1 → v2
  migration. Ships in M2.
- Section "News from New Roots Herbal": a switch **"New products, webinars and offers"**, off by
  default. Turning it on subscribes the device to push if it isn't yet (same permission flow as
  reminders, synchronous in the click on iOS) and calls `PUT /api/me/news { optIn: true }`.
  Reminders and news are independent: either can be on alone.
- After someone turns on dose reminders, ask once: "Also get news about new products and
  webinars? You can turn this off any time." [Yes] [No thanks].
- For accounts with a health profile: the targeting switch from §4.11 is repeated here.
- Every news notification is clearly from New Roots Herbal (title starts with "New Roots Herbal:"
  or the body says so). On Android, add a notification action "Turn off news" that opens
  `/notifications?news=off`, which switches it off. Everywhere: the switch in Notifications.
- Tapping a news notification opens its link. The service worker only opens `https:` URLs on an
  allowlist (`newrootsherbal.com`, `www.newrootsherbal.com`, our own origin); anything else opens
  the app. UTM parameters are added by the composer.

**For staff** (admin, accounts with `role = 'admin'`, granted by SQL, setup doc part I):

- Profile → Admin → **News** (`/admin/news`, lazy-loaded like `/dev/*`; the Worker enforces the
  role on every `/api/admin/*` route; admins must have a verified email).
- Campaign fields: internal name; title and body in English and French (title ≤ 60 characters
  including the "New Roots Herbal:" prefix, body ≤ 100, counters shown); link (https, allowlisted
  host; the form appends `utm_source=smartstack&utm_medium=push&utm_campaign=<slug>`); audience:
  **Everyone who opted in** or **Health-profile segment** (any of these conditions, any of these
  goals, genders, age range, pregnancy status; only people who switched on health-profile news);
  send date and time in America/Toronto.
- Actions: Save draft, **Send a test to my devices**, Schedule (shows the audience estimate
  "about 1,240 devices"), Cancel, Duplicate. List with status and sent/failed counts.
- Admins only ever see counts. A segment that matches fewer than 10 devices shows "fewer than 10"
  and can't be scheduled (so a narrow segment can't single anyone out).
- Guardrails: sending times limited to 11:00–19:00 Toronto time (so 8:00–16:00 in Vancouver); a
  device gets at most one news notification per 24 hours; the scheduled list warns when two
  campaigns are less than a day apart.
- **Delivery** (cron): reminders keep priority. Each tick, whatever is left of
  `MAX_PUSHES_PER_TICK` goes to the oldest campaign in `sending` (a `scheduled` campaign whose time
  has come becomes `sending`). Fan-out uses a cursor, not per-delivery rows (D1 writes are the
  scarce resource): select the next subscriptions with `push_subscriptions.id > campaign.cursor`
  whose device opted in, didn't get news in the last 24 h and (for a segment) whose account
  matches; send with the text in the device's language; one `DB.batch` updates the cursor, the
  counts and `users.last_news_at`. `404/410` delete the subscription as for reminders; other
  failures count as failed, no retry. Fewer rows than the budget → `sent`.
- Throughput on the free plan: about 20 devices a minute, so roughly 1,000 an hour. Show the
  estimate ("about 2 hours to reach everyone") on the schedule screen. The Workers paid plan
  ($5 USD/month) would raise the ceiling a lot; not now.
- The segment filter is a pure SQL builder (tested) using `json_each` on the profile's JSON
  arrays, within the 100-bound-parameter limit.

## 5. Authentication design

### 5.1 Identity model

- `accounts` are people. The existing `users` table stays what it is in practice: **devices**
  (the Phase 1 anonymous UUID, still used for push). A new nullable `users.account_id` links a
  device to the signed-in account (`POST /api/account/device`). Reminders and news opt-in stay per
  device.
- Two bearer credentials on separate prefixes: `/api/me/*` keeps the device UUID; `/api/account/*`,
  `/api/sync`, `/api/admin/*`, `/api/lookup/*` and the signed-in `/api/auth/*` routes take the
  session token.

### 5.2 Passwords, free and within 10 ms of CPU

- The browser stretches the password: `key = PBKDF2-HMAC-SHA256(password NFC-normalized,
  salt = UTF-8 "smartstack/v1/" + lowercase(trimmed email), 600 000 iterations, 32 bytes)` with
  WebCrypto, and sends `base64url(key)`. The password itself never leaves the device.
  `kdf_version = 1` records those parameters.
- The Worker stores `HMAC-SHA256(key = AUTH_PEPPER secret, message = per-account random 16-byte
  salt ‖ key)` and compares in constant time. That costs microseconds.
- Why it holds: whoever steals the database still needs 600 000 PBKDF2 iterations per guess per
  account, and the pepper. This is Bitwarden's model. The alternative doesn't fit: production
  Workers cap WebCrypto PBKDF2 at 100 000 iterations (local `wrangler dev` doesn't enforce the cap,
  so it only fails once deployed), which is already below current guidance, and even that would
  very likely exceed the free plan's 10 ms CPU limit (error 1102). Explain this in the README.
- `kdf_version` allows raising the iteration count later (login answers `rehash: true`, the client
  sends a new key).
- The email is part of the salt, so changing the email address isn't offered (out of scope).

### 5.3 Sessions

- Token: 32 random bytes, base64url. D1 keeps only its SHA-256. Sent as `Authorization: Bearer`.
  Expires after 90 days of inactivity (slide `expires_at` at most once a day to save D1 writes).
  Stored in `localStorage` under its own key `smartstack:session`, outside the state blob.
- Log out deletes the row; password reset or change deletes every other session.
- Not cookies: an iPhone Home Screen app (and a Capacitor webview later) doesn't share cookies
  with the browser context that finishes the OAuth dance, and the app already calls the API with
  bearer auth and `credentials: 'omit'`. The CSP (§5.10) is the XSS defence.

### 5.4 Google now, Apple later (plain OAuth redirects, no provider scripts)

The flow is **start → provider → callback → claim**. On an iPhone Home Screen app, the provider's
redirect back to our origin is reported both ways: closing the in-app browser and loading in the
app (Firtman's iOS 12.2 write-up), or staying stranded in a Safari sheet with separate storage
(2026 reports). Nothing authoritative covers iOS 18/26, so the design works in both cases, and the
iPhone test on staging is mandatory:

1. The app creates `claimSecret` (32 random bytes), saves `{ provider, claimSecret, state }` in
   `localStorage` key `smartstack:oauth`, and calls `POST /api/auth/oauth/start { provider, intent:
   'login' | 'link', claimHash: sha256(claimSecret), locale }` (with `X-Beta-Key`; with the session
   bearer when linking). The Worker stores an `oauth_attempts` row (state, PKCE verifier, nonce,
   claim hash, 10-minute expiry) and returns `{ url, state }`. The app does `location.assign(url)`.
2. Google: `https://accounts.google.com/o/oauth2/v2/auth`, `response_type=code`,
   `scope=openid email profile`, PKCE S256, `state`, `nonce`, `prompt=select_account`.
3. Callback `GET /api/auth/oauth/google/callback`: find the pending attempt by `state`, exchange
   the code at Google's token endpoint with the client secret, read the ID token from the token
   response (it came straight from the token endpoint over TLS, so OIDC allows skipping the
   signature check; still check `iss`, `aud`, `exp`, `nonce`, `email_verified`). Apply the linking
   rules (§5.5), mark the attempt `ready` with the account id, and `303` to
   `/auth/done?state=…` (errors: attempt `failed`, redirect with `&error=code`).
4. `/auth/done`: if this browsing context holds the claim secret for that state, it calls
   `POST /api/auth/oauth/claim { state, claimSecret }` → `{ token, account, isNew }` (single use;
   the session is created now). Otherwise (the Safari sheet on iPhone) it shows "You're signed in.
   Return to the SmartStack app." The original app window claims when it becomes visible again
   (`visibilitychange`/`focus`) using its saved attempt. On Android the custom tab shares storage
   with the installed app; a second claim gets `409 already_claimed` and the app re-reads the
   session from `localStorage`.

- Write the provider layer as an interface (`authorizationUrl`, `exchangeCode` →
  `{ subject, email, emailVerified, name }`, optional `revoke`) with Google as the only
  implementation. Use `arctic` (small OAuth client library on WebCrypto) if its current version
  runs in workerd: check its docs through context7 first; otherwise write it by hand. Never
  Google's JavaScript.
- **Apple-ready, not Apple-built.** The schema, the linking rules, the start/claim flow, the
  account screen and the delete flow all accept `provider = 'apple'` already: `auth_identities`
  allows it and has `apple_refresh_token`; `/api/auth/oauth/start` answers `404
  provider_disabled` for Apple while `APPLE_ENABLED` isn't `"true"`; the Apple button component
  exists behind `VITE_APPLE_ENABLED`. Don't write the Apple-specific parts yet. For the record,
  they are: `https://appleid.apple.com/auth/authorize` with `response_mode=form_post` (required
  for name/email scopes) and `scope=name email`; `POST /api/auth/oauth/apple/callback` reading the
  form body (and the `user` field with the name, sent only on the first authorization); a client
  secret that is an ES256 JWT signed with the `.p8` key (`iss` team id, `sub` services id, `aud`
  `https://appleid.apple.com`); keeping Apple's refresh token and calling
  `https://appleid.apple.com/auth/revoke` at account deletion (Apple requires it); registering our
  sending address for Apple's private email relay. Apple refuses `localhost`, so it is tested on
  staging.
- Later, for Capacitor: `POST /api/auth/oauth/id-token` verifying a native SDK's ID token against
  the provider's JWKS. Don't build it; keep the linking logic in a function it can reuse.

### 5.5 Linking rules (`resolveOAuthIdentity`, unit-tested as a table)

1. `(provider, subject)` already known → that account.
2. `intent = 'link'` (signed in) → attach to the current account (`409` if the identity belongs to
   another account).
3. An account with the same email exists: if the provider says the email is verified, attach it.
   If that account's email was never verified, delete its password hash and all its sessions
   (defence against someone pre-registering a victim's email) and mark the email verified. If the
   provider says it is not verified → `email_in_use_unverified` ("Log in with your password, then
   connect Google in your profile").
4. Otherwise create the account (`email_verified_at` = now when the provider verified it), return
   `isNew`, then the consent step.

`ACCOUNTS_MODE = 'staff'` refuses sign-up and login (password or Google) for any email outside
`STAFF_EMAIL_DOMAINS` with `403 accounts_not_open`.

### 5.6 Email verification and password reset (SMTP2GO)

- Tokens: 32 random bytes, stored hashed, single use; verify-email expires in 48 h, reset in 1 h.
  Links: `${APP_ORIGIN}/verify-email#token=…`, `${APP_ORIGIN}/reset-password#token=…`.
- A reset proves ownership of the address, so it also verifies the email.
- `apps/worker/src/email.ts` with `EMAIL_MODE = 'log'` (local: print the link in the wrangler
  console) or `'smtp2go'`: SMTP2GO's HTTP API, not SMTP (a Worker can't use the SMTP username and
  password conveniently): `POST https://api.smtp2go.com/v3/email/send`, header
  `X-Smtp2go-Api-Key: <SMTP2GO_API_KEY>`, JSON `{ sender, to: [address], subject, text_body,
  html_body }`; success is HTTP 200 with `data.succeeded === 1`. The sender must be a verified
  sender in the SMTP2GO account (`EMAIL_FROM`). Four templates, plain text plus minimal
  inline-styled HTML, in the account's language: verify email, reset password, password changed,
  and the inactive-account warning (N8/N9, §8.6).
- Forgot-password answers the same whether or not the account exists.

### 5.7 Throttling

D1 table `auth_throttle` (fixed windows, SHA-256 of the key, IP from `CF-Connecting-IP`):
failed logins 5 per email and 30 per IP per 15 min; sign-ups 5 per IP per hour; forgot-password
and resend 3 per email per hour; OAuth start 20 per IP per 15 min; claims 10 per IP per 15 min;
Health Canada lookups 30 per account per hour. Answer `429` with `Retry-After` and a friendly
message. Keep requiring `X-Beta-Key` on sign-up and OAuth start during the employee beta.
(Workers' `[[ratelimits]]` binding is GA but only offers 10- or 60-second periods and no official
statement confirms it on the free plan, so D1 it is.)

### 5.8 Consent (Quebec Law 25: express consent for health-related information)

The wording below is summarized; the exact English and French texts are in
`docs/privacy/consent-texts.md` (C1–C7) and win over this section.

- **Account** (email sign-up: two required, unticked checkboxes; Google: the `/auth/consent`
  screen before anything syncs):
  - "I agree that New Roots Herbal stores my supplements, medications, routine and bottle counts
    in my account so I can use them on my devices. I have read the Privacy Policy." (link)
  - "I am 14 or older."
  The Worker answers `403 consent_required` on `/api/sync` until `POST /api/account/consent`.
  Declining on `/auth/consent` deletes the just-created account.
- **Health profile** (first visit): "I agree that New Roots Herbal stores my health profile in my
  account." Nothing is saved before it.
- **Health-profile news** (§4.11): its own switch, off by default.
- **News notifications** (§4.12): the device switch, off by default. Store when it was turned on
  and off (proof of consent; also what anti-spam rules expect).
- Store `consent_version` (Worker var `CONSENT_VERSION`, e.g. `2026-10`) with each consent
  timestamp. When the version changes, ask again at the next open. I'll confirm the final wording
  with the privacy policy; build with this text.

### 5.9 Deletion and export

- `DELETE /api/account`: (later: revoke the Apple token, best effort), then delete the account
  row; `ON DELETE CASCADE` removes identities, sessions, tokens, settings, products, stack, list,
  checks, health profile, linked devices and, through them, push subscriptions and reminders.
  `204`.
- `GET /api/account/export`: every row of the account (health profile included) as JSON, as a
  download (Law 25 portability).
- Guests keep today's "Delete my data" (device row, subscriptions, reminders, local state).

### 5.10 Security headers

- `apps/web/public/_headers` (Workers static assets read this file; confirm in the current docs,
  otherwise set the headers in the Worker): `Content-Security-Policy: default-src 'self';
  script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:
  blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self';
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.
- `index.html`'s inline theme script must move to a small external file (or get a hash) to pass
  the CSP. The ZXing WASM needs `'wasm-unsafe-eval'`. API responses: `Cache-Control: no-store`.
- The production build must show zero CSP violations (scan, install, push, OAuth round trip).

## 6. Database (D1)

Timestamps are INTEGER epoch milliseconds written by JS, as in `0001_init.sql`. D1 enforces
foreign keys. Never edit an applied migration. Four new migrations, applied in the milestone that
needs them.

D1 free-plan limits (checked 2026-09-29): 5 million rows read and **100 000 rows written per
day** (errors until 00:00 UTC once exceeded), 500 MB per database, **50 queries per Worker
invocation**, 100 bound parameters per query. Row writes are the scarce resource: batch them,
slide sessions at most once a day, never write on reads. Phase 1 already chunks multi-row inserts
under the 100-parameter limit (`scheduleStatements` in `apps/worker/src/logic.ts`).

### `apps/worker/migrations/0002_accounts.sql` (M3)

```sql
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
```

### `apps/worker/migrations/0003_user_data.sql` (M5)

Every synced row carries `updated_at` (device clock, last-write-wins), `deleted_at` (tombstone)
and `rev` (the account revision that last wrote it, §8). `user_products` is created here (sync
must know it) and filled from M6.

```sql
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
```

### `apps/worker/migrations/0004_health_profiles.sql` (M8)

```sql
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
```

### `apps/worker/migrations/0005_news.sql` (M9)

```sql
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
```

`PUT /api/me` starts sending the device's `locale` (and on every language change).

## 7. API

All JSON, zod-validated with schemas in `packages/shared`, errors `{ error, detail? }` as today.
Account routes answer `404` while `ACCOUNTS_MODE` is `off`.

| Route                                  | Auth             | Purpose                                                                                       |
| -------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup`                | beta key         | `{ email, key, name?, locale, consent: true, age14: true }` → `{ token, account }`           |
| `POST /api/auth/login`                 | —                | `{ email, key }` → `{ token, account, rehash? }`; `401 invalid_credentials`, `429`            |
| `POST /api/auth/logout`                | session          | Deletes this session                                                                          |
| `POST /api/auth/verify-email`          | —                | `{ token }`                                                                                   |
| `POST /api/auth/verify-email/resend`   | session          | New verify email (throttled)                                                                  |
| `POST /api/auth/password/forgot`       | —                | `{ email }` → always `200`                                                                    |
| `POST /api/auth/password/reset`        | —                | `{ token, key }`; ends other sessions; verifies the email                                     |
| `POST /api/auth/password/change`       | session          | `{ currentKey, newKey }`; ends other sessions                                                 |
| `POST /api/auth/oauth/start`           | beta key (+sess) | `{ provider, intent, claimHash, locale }` → `{ url, state }`; Apple → `404` until enabled     |
| `GET /api/auth/oauth/google/callback`  | —                | Code exchange → `303 /auth/done?state=…`                                                      |
| `POST /api/auth/oauth/claim`           | —                | `{ state, claimSecret }` → `{ token, account, isNew }`; single use                            |
| `GET /api/account`                     | session          | `{ id, email, emailVerified, name, locale, role, providers, hasPassword, consentNeeded }`     |
| `POST /api/account/consent`            | session          | `{ age14: true }`; records `CONSENT_VERSION`                                                  |
| `POST /api/account/device`             | session          | `{ deviceId }` → links the Phase 1 device row; `DELETE` unlinks                               |
| `DELETE /api/account/identity/:p`      | session          | Disconnect Google (refused if it's the only sign-in method)                                   |
| `GET /api/account/export`              | session          | All the account's data as a JSON download                                                     |
| `DELETE /api/account`                  | session          | Delete everything (§5.9)                                                                      |
| `POST /api/sync`                       | session+consent  | `{ since, changes }` → `{ rev, changes }` (§8)                                                |
| `GET /api/lookup/npn/:npn`             | session          | Health Canada natural-product prefill (§4.7), cached a week                                   |
| `GET /api/lookup/din/:din`             | session          | Health Canada drug prefill (§4.7), cached a week                                              |
| `PUT /api/me/news`                     | device           | `{ optIn }` → sets `news_opt_in` and the matching timestamp                                   |
| `GET /api/admin/campaigns`             | admin            | List                                                                                          |
| `POST /api/admin/campaigns`            | admin            | Create a draft; `PUT /api/admin/campaigns/:id` edits a draft or scheduled campaign           |
| `POST /api/admin/campaigns/:id/schedule` | admin          | `{ sendAt }` → `scheduled` (11:00–19:00 Toronto enforced)                                     |
| `POST /api/admin/campaigns/:id/cancel` | admin            | `scheduled`/`sending` → `cancelled`                                                           |
| `POST /api/admin/campaigns/:id/test`   | admin            | Sends it now to the admin's own linked devices                                                |
| `POST /api/admin/audience-estimate`    | admin            | `{ audience }` → `{ devices }`                                                                |

Existing `/api/me/*` device routes are otherwise unchanged (`PUT /api/me` gains `locale`).

## 8. Sync

### 8.1 Entities

| Entity     | Key                                | Table              |
| ---------- | ---------------------------------- | ------------------ |
| `settings` | the account                        | `account_settings` |
| `health`   | the account                        | `health_profiles`  |
| `product`  | `id`                               | `user_products`    |
| `stack`    | `productId`                        | `stack_items`      |
| `shopping` | `productId`                        | `shopping_items`   |
| `check`    | `day` + `productId` + `doseIndex`  | `dose_checks`      |

Each carries `updatedAt` (device epoch ms) and `deletedAt`. Last write wins by `updatedAt`; on a
tie the server's copy wins.

### 8.2 One endpoint

`POST /api/sync { since, changes: { settings?, health?, products[], stack[], shopping[], checks[] } }`
returns `{ rev, changes }` with every row whose `rev > since` (tombstones included). An empty
`changes` is a pull. When there are changes, one `DB.batch` (a single transaction: all or
nothing) runs `UPDATE accounts SET rev = rev + 1 WHERE id = ?1`, then **one upsert per table**,
then the selects. Each upsert takes that table's rows as a single JSON parameter so the request
stays far below the free plan's 50 queries per invocation and 100 bound parameters per query:

```sql
INSERT INTO stack_items (account_id, product_id, doses_per_day, …, updated_at, deleted_at, rev)
SELECT ?1, json_extract(value, '$.productId'), json_extract(value, '$.dosesPerDay'), …,
       json_extract(value, '$.updatedAt'), json_extract(value, '$.deletedAt'),
       (SELECT rev FROM accounts WHERE id = ?1)
FROM json_each(?2) WHERE true            -- "WHERE true" lets SQLite parse the ON CONFLICT
ON CONFLICT (account_id, product_id) DO UPDATE SET
  doses_per_day = excluded.doses_per_day, …, rev = excluded.rev
WHERE excluded.updated_at > stack_items.updated_at;
```

Build the statements in pure, tested functions (like `logic.ts`). Limits: 500 rows and 512 KB per
request, 200 user products and 60 stack items per account. The `health` entity is refused
(`403 consent_required`) until the profile's storage consent is set.

### 8.3 Client

- `sync.outbox`: keys of entities changed since the last successful push; the reducer marks them
  when `auth.mode === 'account'`. Deleted entities keep a tombstone until pushed.
- An `AccountSync` component next to `SyncManager`: push/pull 1.5 s after a change (debounced), on
  open, when the app becomes visible, and on `online`. Clear an outbox key only if the entity's
  `updatedAt` didn't change during the request. Apply incoming rows by last-write-wins.
- `401`: the session expired; keep local data, show "Log in again". Offline: retry silently.
- Changes pulled from another device flow into the reminder sync automatically (it already reacts
  to routine/stack changes).

### 8.4 First sign-in on a device ("Back up & sync")

- Nothing local (no routine, empty stack) → pull everything.
- Account empty (`rev` 0) → push everything local (this is the backup).
- Both have data → sheet "This account already has a stack": **[Combine both]** (recommended:
  push local, last-write-wins, union by product) or **[Use my account's data]** (discard local,
  pull).

### 8.5 Known limitation

Bottle counts are last-write-wins. Two devices ticking doses of the same product while offline can
lose one decrease; the person can edit the count. Document it in the README.

### 8.6 Daily cleanup

The existing 03:00 UTC cron tick also deletes expired sessions, used or expired email tokens,
OAuth attempts older than a day, throttle rows older than a day, `dose_checks` older than 3 days
and tombstones older than 30 days. Cleanup statements are pure and tested.

Retention promised in the privacy policy (§10 of `docs/privacy/privacy-policy.en.md`), also in
that tick:

- **Inactive accounts**: `last_active_at` older than 3 years − 30 days and not yet warned → send
  the warning email (N8/N9) and set `inactivity_warned_at` (a few per tick, within the email and
  CPU budget). Warned and still inactive 30 days later → delete the account (same path as
  `DELETE /api/account`). Any login or sync clears `inactivity_warned_at`.
- **Devices without an account**: `users` rows with no `account_id` and `last_seen_at` older than
  12 months → delete (subscriptions and reminders cascade).

## 9. Client state v2 (`apps/web/src/storage.ts`)

- Keep the key `smartstack:v1`; bump `version` to `2`; `loadState` migrates v1 → v2 (checks `true`
  → `{ units: 0, at }`, `auth.mode = 'unset'`, stack items get `addedAt`/`updatedAt`, empty new
  collections). Test the migration with a real v1 blob.
- Additions:

```ts
auth: {
  mode: 'unset' | 'guest' | 'account'
  accountId: string | null
  email: string | null
  name: string | null
  role: 'user' | 'admin'
  emailVerified: boolean
  providers: ('password' | 'google' | 'apple')[]
  consentNeeded: boolean
}
stack: StackEntry[]      // productId, dosesPerDay, pins: (Anchor | null)[], dismissed[], unitsPerDose?,
                         // variantUpc?, inventory?: { remaining, unit: 'unit' | 'serving', packageSize,
                         // lowFlaggedAt }, addedAt, updatedAt
userProducts: UserProduct[]
shopping: { productId, reason: 'low' | 'manual' | 'alternative', replacesProductId?, addedAt, updatedAt }[]
healthProfile: HealthProfile | null
newsOptIn: boolean       // this device
checks: Record<string, { units: number; at: number }>
tombstones: Record<string, number>   // entity key → deletedAt, until pushed
sync: { rev: number; outbox: string[]; lastSyncAt: number | null; error: string | null }
```

- The session token (`smartstack:session`) and the pending OAuth attempt (`smartstack:oauth`) live
  in their own keys.
- `packages/shared`: `StackItem` gains optional `pins` (the engine reads it); new schemas
  `StackEntry`, `UserProduct`, `ShoppingItem`, `HealthProfile` (with `HEALTH_CONDITIONS`,
  `HEALTH_GOALS`… code lists), `Campaign`, `Audience`, sync, auth and admin request/response bodies
  (the Worker validates with them).

## 10. Engine changes (`packages/engine`, pure and tested)

- `RULE_ATTRIBUTES` += `SUGGEST_BEDTIME`: never places a dose; yields an informational reason only
  when the dose isn't already at bedtime and the stack item hasn't dismissed it.
- **Pins** (`StackItem.pins[doseIndex]`): the person's chosen anchor for that dose beats every
  placement rule. Pins may also use `wake` (a new anchor value for pins only; the engine never
  places anything at wake-up on its own). A pinned dose never moves for a separation rule; the other
  product moves. Two pinned, conflicting doses both stay and the later one gets a
  `timing_conflict` reason. New adjustment code `MOVED_BY_YOU` with its strings.
- `Product.kind` += `'medication'` (user products only): every dose must be pinned; no rules apply
  to it; its canonical ingredients still count as conflicts for other products' separation rules
  (so a calcium supplement moves away from an iron medication, never the reverse); excluded from
  duplicates' "review recommended" wording and from alternatives.
- `ProductStatus` += `'user'`. `upc`, `sku` and `labelVersion` become optional in the `Product`
  schema, but `validateCatalogue` still requires them for bundled data.
- `toEngineProduct(userProduct)` and `userRules(userProduct)`; a web hook `useCatalogue()` merges
  the bundled catalogue with the person's products and rules (memoized). Every web call to
  `getProduct`, `getRule`, `getIngredient`, `findProductByBarcode`, `searchProducts`,
  `buildSchedule` and `findDuplicateIngredients` passes it (today: `WhySheet.tsx`,
  `i18n/render.ts`, `schedule.ts`, `StackScreen.tsx`, `Today.tsx`, `sync.ts`,
  `AddSupplement.tsx`).
- `inventory.ts`: `parsePackageSize`, `dailyUse`, `daysLeft`, `applyTick`, `undoTick`, `isLow`.
- `alternatives.ts` + `data/alternatives.json` + validator (§4.9).

## 11. Environments and configuration

|                  | Local                                   | Staging                                            | Production                                  |
| ---------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| URL              | `http://localhost:5173` (Vite → 8787)   | `https://schedule-staging.flourishbodyandmind.com` | `https://schedule.flourishbodyandmind.com`  |
| Deploy           | `wrangler dev`                          | `wrangler deploy --env staging`                    | deploy.yml on merge                         |
| D1               | local                                   | `smartstack-staging` (new)                         | `smartstack`                                |
| `ACCOUNTS_MODE`  | `public`                                | `public`                                           | `staff`, then `public` after the checklist  |
| Email            | `log`                                   | `smtp2go`                                          | `smtp2go`                                   |
| Apple            | off                                     | off until enrolled                                 | off until enrolled                          |
| Cron             | `--test-scheduled`                      | every minute (to test news; low volume)            | every minute                                |

- Worker vars (`wrangler.toml [vars]`, redeclared under `[env.staging]` because vars and bindings
  are not inherited): `APP_ORIGIN`, `ACCOUNTS_MODE`, `STAFF_EMAIL_DOMAINS`, `APPLE_ENABLED`,
  `GOOGLE_CLIENT_ID`, `EMAIL_MODE`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `CONSENT_VERSION`,
  `NEWS_URL_HOSTS`, plus the existing ones. Apple's `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`,
  `APPLE_KEY_ID` come later.
- Secrets (`npx wrangler secret put NAME`, add `--env staging` for staging; local values in
  `apps/worker/.dev.vars`): `AUTH_PEPPER`, `GOOGLE_CLIENT_SECRET`, `SMTP2GO_API_KEY`, the existing
  `VAPID_PRIVATE_KEY` (staging reuses the same VAPID pair; subscriptions are per origin anyway), and
  later `APPLE_PRIVATE_KEY`. Update `.dev.vars.example`, `env.ts` and the README environment table.
- Web build flags: `VITE_ACCOUNTS_MODE`, `VITE_APPLE_ENABLED` in `apps/web/.env` (production
  values) and `apps/web/.env.staging` (`vite build --mode staging`).
- Staging is one level below the zone (`schedule-staging.…`, not `staging.schedule.…`) so the free
  Universal SSL certificate covers it.
- Logs: Workers Logs keep 3 days on the free plan; invocation logs include request metadata. Keep
  them while tuning `MAX_PUSHES_PER_TICK`, then at M10 set `[observability.logs] invocation_logs =
  false` in production (console logs stay: counts, status codes and ids only, never emails, product
  names or profile data). D1 Time Travel keeps 7 days of history and can't be switched off; the
  privacy policy says so.
- deploy.yml: apply migrations before deploying (`npx wrangler d1 migrations apply smartstack
  --remote`) once the API token has D1 Edit (setup doc, part B). Every migration must be additive
  so the running code keeps working between migration and deploy. Add a manual
  `deploy-staging.yml` (`workflow_dispatch`).

## 12. Milestones

Each milestone is a branch and a PR with small commits inside; `npm run check` passes before every
commit; I merge. **M1 and M2 need nothing from me: start there** while I do the setup.

| #   | Milestone                  | Contents                                                                                                                                                                                                                         | Needs from me (setup doc)                      |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| M0  | Groundwork                 | These two docs and `docs/privacy/` (already on `main` if the docs PR was merged; otherwise commit them); `ACCOUNTS_MODE` plumbing; `_headers` + CSP; logo asset; staging env in wrangler.toml, `wrangler d1 create smartstack-staging`, first staging deploy; migration step in deploy.yml                         | B                                              |
| M1  | More info + magnesium      | `ProductInfoSheet`, More info on Today and My stack, `SUGGEST_BEDTIME`, pins + `MOVED_BY_YOU` (incl. `wake`), Add-flow bedtime checkbox, strings, tests. Ships to production                                                     | —                                              |
| M2  | Bottles + shopping + nav   | State v2 + migration, `inventory.ts`, bottle card in Add, Manage sheet, tick decrease, running-low sheet, `/shopping`, the Profile tab (Settings moved in, Reminders → Notifications), "Show product names in reminders" (off by default), strings, tests. Ships to production | —                                              |
| M3  | Accounts backend           | Migration 0002; password, session, OAuth (Google; Apple-ready interface), email (SMTP2GO), throttle modules; `ACCOUNTS_MODE`; routes; cleanup; unit tests; local end-to-end with `EMAIL_MODE=log`                                | A, C                                           |
| M4  | Accounts frontend          | Welcome, sign-up/login/forgot/reset/verify/done/consent, Back up & sync card and the other sign-in prompts, account section of Profile, log out, delete, export, `/privacy` + `/terms` placeholders; Google locally and on staging | C (test users), D                              |
| M5  | Server storage + sync      | Migration 0003, `/api/sync`, `AccountSync`, first-sign-in choice, device link; two-device test on staging                                                                                                                         | —                                              |
| M6  | Other-brand products       | Other brand tab and form (natural health product, medication, food/other), NPN and DIN prefill, unknown-barcode sheet (scanner pause), medication kind in the engine, `useCatalogue()` merge, user rules                          | —                                              |
| M7  | Alternatives               | Scoring, `alternatives.json` + validator, running-low sheet with [Add to shopping list] / [Refill current product], replacement flow, shopping list and More info lines, other-brand report query in the README                   | H                                              |
| M8  | Health profile             | Migration 0004, `/profile/health`, consents, targeting switch, delete profile, sync entity, export                                                                                                                                | H (lists)                                      |
| M9  | News notifications         | Migration 0005, device opt-in (guests too, ships to production), Notifications screen section, SW link allowlist and Android action, admin role checks, `/admin/news` composer, cron fan-out with cursor, segment SQL builder    | I                                              |
| M10 | Launch accounts            | Approved privacy policy and terms from `docs/privacy/` (effective date, "Draft" line removed), `CONSENT_VERSION` final, inactive-account and inactive-device cleanup, invocation logs off, production migrations, `ACCOUNTS_MODE=public` after my go-ahead, README privacy section rewritten, device checklist extended | F, G                                           |
| —   | Sign in with Apple (later) | The Apple parts listed in §5.4, once the company is enrolled                                                                                                                                                                      | E                                              |

## 13. Tests

- Engine: the 8 magnesium products no longer at bedtime but carrying the suggestion; `sleep8` and
  melatonin still at bedtime; multis unchanged; pins (including `wake`) and the separation cases;
  medications never moved, their ingredients still pushing supplements away, never in
  alternatives; `parsePackageSize` over every variant (print the parse rate; ≥ 95 % of countable
  sizes); inventory math (5 + 30 = 35, untick restores, floor of days, threshold once per bottle);
  `toEngineProduct`/`userRules`; unit conversions; `suggestAlternatives` fixtures (an other-brand
  "Magnesium Bisglycinate 200 mg" → `magnesium-bisglycinate-capsules` first; a D3 1000 IU → a New
  Roots D3; an EPA/DHA fish oil → a Wild Omega-3; a herbal blend with no canonical ingredient →
  none; products already in the stack excluded); validator for `alternatives.json` and
  `SUGGEST_BEDTIME`.
- Shared: the new zod schemas.
- Worker (pure functions, as `logic.test.ts` does): password hash/verify vectors, token hashing,
  throttle windows, the linking-rules table, staff-mode refusal, OAuth URL building, sync statement
  builders (last-write-wins condition, rev), cleanup statements, consent gates, Health Canada
  response mapping (fixtures), the campaign fan-out step (budget after reminders, cursor, 24 h cap,
  language, `404/410` handling), the segment SQL builder, the 11:00–19:00 rule.
- Web: v1 → v2 migration, reducer (tick decrease and undo, refill, low flag once, replacement),
  sync merge (last-write-wins, outbox clearing), service-worker link allowlist, French mirror for
  every new key.
- Manual on staging before M10: Android installed app and desktop Chrome: email sign-up, verify
  link, log out/in, Google, reset password, two devices in sync, other-brand product with NPN
  prefill, health profile, news opt-in and a test campaign, export, delete. iPhone Home Screen
  app: Google sign-in through the claim flow, news notification.

## 14. How I want you to work

- One branch per milestone from the latest `origin/main`. If another session is working in this
  checkout (files changing under you, work in progress in `git status`), create a sibling worktree
  (`git worktree add -b <branch> D:/Websites/smartstack-<name> origin/main`, then `npm ci`) and
  commit there. No `gh` CLI: push the branch and give me the compare URL.
- Tests pass before each commit. `npm run check | grep … | head` hides the exit code; check
  `${PIPESTATUS[0]}`.
- Every new string in `en.json` and `fr.json`. Insert keys as text; never re-serialize the files
  with `JSON.stringify`. Quebec French: typographic apostrophe, no-break space before « : » and
  inside « », no space before ? ; !. Run `prettier --check`.
- Bash tool quirks: a single command over ~10 KB fails; heredocs unescape backslashes; put
  ES-module scripts in the scratchpad as `.mjs` files.
- The built-in browser pane blocks the camera and notifications and often times out on
  screenshots: drive it with `javascript_tool`, seed `localStorage`, read with `get_page_text`.
- Secrets never go in chat or committed files. When one is needed, tell me the exact
  `wrangler secret put` command to run. Subagents that call outside APIs use a generic User-Agent
  and never include my email or any account data.
- Never edit an applied migration. Apply new ones to local and staging first; production
  migrations run from deploy.yml after the PR is merged (or by me before merging, until the token
  has D1 Edit).
- Pre-approved (free): `wrangler d1 create smartstack-staging`, migrations on local and staging,
  `wrangler deploy --env staging`. Ask before anything paid or irreversible, and before anything
  touching production data.
- Don't invent product facts, NPNs, DINs, UPCs, citations or health claims. New rules are
  `unreviewed`.
- If something here turns out to be impossible or contradicts the code, tell me which line and
  propose the smallest change.

## 15. Decided, and adjustable defaults

Decided on 2026-09-29: the five tabs with Profile; the welcome screen asks to log in or sign up on
first open (with "Continue without an account"); "Refill current product" as in §4.5; every
shopping-list item can be removed (§4.6).

Defaults you can use without asking; I may adjust them later:

1. **Health profile lists** (conditions, goals, diet): §4.11 until the product team edits them.
2. **News guardrails**: 11:00–19:00 Toronto sending window, 1 news notification per device per
   24 hours, segments of at least 10 devices.
3. **Staff domain** for pre-launch accounts: `newrootsherbal.com`.
4. **Retention**: sessions 90 days of inactivity; dose history 3 days; accounts deleted after
   3 years unused (warning 30 days before); guest devices after 12 months unused.
5. **Privacy texts**: the drafts in `docs/privacy/` until the Privacy Officer approves them.
