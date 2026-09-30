# New Roots SmartStack — Phase 2 setup (the human steps)

Everything in Phase 2 that Claude can't or shouldn't do: creating accounts, generating and
storing secrets, DNS, legal, admin access. Facts were checked on 2026-09-29; consoles change, so
if a screen doesn't match, follow the closest equivalent and tell Claude.

The build prompt (`docs/smartstack-phase2-prompt.md`) says which milestone needs which part.
**Milestones M1 and M2 need nothing from this document**, so you can work through it while
they're being built.

## Overview

| Part | What                                      | Cost   | Your time     | Needed by                       |
| ---- | ----------------------------------------- | ------ | ------------- | ------------------------------- |
| A    | Password pepper secret                    | $0     | 5 min         | M3 (local), M0 (staging)        |
| B    | Cloudflare: staging, token, migrations    | $0     | 15 min        | M0                              |
| C    | Google sign-in client                     | $0     | 20 min        | M3/M4                           |
| D    | SMTP2GO API key (verify and reset emails) | $0     | 15 min        | M4 (staging)                    |
| E    | Sign in with Apple                        | 99 USD/year | 1 h + days | **later**, after enrolling      |
| F    | Law 25: review and sign the drafts        | internal | ½ day (Privacy Officer) | before accounts go public |
| G    | Publish the Google consent screen         | $0     | 20 min        | M10                             |
| H    | Product team                              | internal | ongoing     | M7, M8                          |
| I    | Admin access for news notifications       | $0     | 5 min         | M9                              |

**You can start the build before doing any of this.** M0 only needs wrangler to be logged in on
this computer (it already is), and M1–M2 need nothing. Do A and C before M3 starts, D before M4,
and send `docs/privacy/` to the Privacy Officer (F) early, since it involves someone else.

### Where commands run

Open a terminal in the worker folder (PowerShell or the app's terminal):

```bash
cd D:\Websites\smartstack\apps\worker
```

Check you are logged in to the right Cloudflare account (it should show hosts@newrootsherbal.com
and account id `e260676f72b0b18314b868f136ed72ae`):

```bash
npx wrangler whoami
```

If it says you are not logged in, run `npx wrangler login` and approve in the browser.

`npx wrangler secret put NAME` prompts "Enter a secret value": paste and press Enter. Nothing is
echoed. List what's set (names only, never values) with `npx wrangler secret list` (add
`--env staging` for staging).

### Local secrets file

`apps/worker/.dev.vars` (gitignored, already holds `VAPID_PRIVATE_KEY`) is where local secrets go.
By the end of Part C it looks like this:

```
VAPID_PRIVATE_KEY=…already there…
AUTH_PEPPER=…Part A…
GOOGLE_CLIENT_SECRET=…Part C…
# SMTP2GO_API_KEY=…optional: without it, local dev prints emails in the wrangler console
```

Never paste a secret in the chat with Claude. Public values (client IDs, addresses) are fine to
paste.

---

## Part A — Password pepper (`AUTH_PEPPER`)

A random secret mixed into every stored password hash. If the database ever leaked without it,
the hashes would be useless. (Passwords are also "stretched" on the phone before they are sent:
that's what keeps password security strong on Cloudflare's free plan. It costs nothing.)

> **Never change the production pepper once people have accounts.** Changing it invalidates every
> password (everyone would have to reset). Losing it has the same effect. Keep it in the password
> manager.

1. Generate three values (local, staging, production), running this three times:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. **Local**: add `AUTH_PEPPER=<first value>` to `apps/worker/.dev.vars`.
3. **Staging** (after Claude's first staging deploy in M0):

   ```bash
   npx wrangler secret put AUTH_PEPPER --env staging
   ```

4. **Production** (any time before M3 ships):

   ```bash
   npx wrangler secret put AUTH_PEPPER
   ```

5. Save the production value in the company password manager as "SmartStack AUTH_PEPPER
   (production)". The local and staging values don't need saving.

## Part B — Cloudflare

### B1. Staging environment

Claude creates it in M0 (pre-approved, free): a second Worker at
`https://schedule-staging.flourishbodyandmind.com` with its own D1 database `smartstack-staging`.
wrangler creates the DNS record and certificate on the first deploy. You only need to be logged
in (see "Where commands run").

### B2. Let GitHub Actions apply database migrations

Today the deploy workflow doesn't touch the database, so every PR with a migration needs a manual
step. Adding one permission to the existing token fixes that.

1. Go to https://dash.cloudflare.com → left menu **Manage account** → **Account API tokens**. (An
   older token may instead be under your avatar → **My Profile** → **API Tokens**.)
2. Open the token used by GitHub Actions for deploys (`smartstack-github-deploy`; it has "Workers
   Scripts" permission) → edit it.
3. Under **Permission policies**, click **+ Add policy** → leave **Entire Account** → in the
   permission search box type **D1** (the list only shows names matching the search) → tick
   **Edit** on the **D1** row. Clicking **+N more** on an existing policy shows whether D1 is
   already there.
4. **Review token** → confirm the update. The token's value doesn't change, so the GitHub secret
   `CLOUDFLARE_API_TOKEN` stays as it is.

If you can't tell which token it is, create a new one instead: **Create Token** → **Create Custom
Token** → name "GitHub deploy SmartStack" → permissions **Account · Workers Scripts · Edit** and
**Account · D1 · Edit** → Account Resources: include the newrootsherbal account → **Continue** →
**Create Token** → copy it. Then GitHub → `newrootsherbal/smartstack` → **Settings** → **Secrets
and variables** → **Actions** → `CLOUDFLARE_API_TOKEN` → **Update** → paste. Delete the old token
in Cloudflare afterwards.

**Until B2 is done**, before merging a PR that adds a migration, apply it to production yourself
(Claude will say when):

```bash
npm run db:migrate:remote
```

### B3. Staging secrets (after M0's first staging deploy)

Run each when you have the value (Google after Part C, SMTP2GO after Part D). The VAPID key is the
same one production uses (from the password manager), so push works on staging too:

```bash
npx wrangler secret put AUTH_PEPPER --env staging
npx wrangler secret put VAPID_PRIVATE_KEY --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put SMTP2GO_API_KEY --env staging
```

---

## Part C — Google sign-in (free)

Use a **company-controlled Google account** (not a personal Gmail) and add a second owner, so the
project survives staff changes.

1. Open https://console.cloud.google.com → project picker (top bar) → **New project** → name
   "New Roots SmartStack" → **Create** → make sure it's selected.
2. Search bar → **Google Auth Platform** → **Get started**:
   - App name: **New Roots SmartStack**. User support email: a monitored address (e.g.
     hosts@newrootsherbal.com).
   - Audience: **External**.
   - Contact information: your email.
   - Agree to the Google API Services User Data Policy → **Create**.
3. **Branding** (left menu):
   - Application home page: `https://schedule.flourishbodyandmind.com`
   - Privacy policy: `https://schedule.flourishbodyandmind.com/privacy`
   - Terms of service: `https://schedule.flourishbodyandmind.com/terms`
   - Authorized domains: `flourishbodyandmind.com`
   - Skip the logo for now (Part G). **Save**.
4. **Data Access** → **Add or remove scopes** → tick `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` → **Update** → **Save**. These are non-sensitive: no Google review
   needed.
5. **Audience** → **Test users** → **+ Add users** → the Google addresses of everyone who will
   test (100 maximum). Leave the status on **Testing** until launch. In Testing mode a tester's
   sign-in grant expires after 7 days; they simply sign in again.
6. **Clients** → **+ Create client** → Application type **Web application** → name "SmartStack
   web" → **Authorized redirect URIs** (add all three, exactly):

   ```
   http://localhost:5173/api/auth/oauth/google/callback
   https://schedule-staging.flourishbodyandmind.com/api/auth/oauth/google/callback
   https://schedule.flourishbodyandmind.com/api/auth/oauth/google/callback
   ```

   Leave "Authorized JavaScript origins" empty (the app uses redirects, not Google's script).
   **Create**.
7. The dialog shows the **Client ID** and **Client secret**. **Download the JSON now** and store
   both in the password manager as "SmartStack Google OAuth client": Google doesn't let you view an
   existing secret again (you would have to add a new one).
8. Give the values to the app:
   - **Client ID** (public, ends in `.apps.googleusercontent.com`): paste it to Claude; it goes in
     `wrangler.toml` for every environment.
   - **Client secret**: local `.dev.vars` line `GOOGLE_CLIENT_SECRET=…`, then

     ```bash
     npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
     npx wrangler secret put GOOGLE_CLIENT_SECRET
     ```

Redirect URI changes can take from 5 minutes to a few hours to apply. A `redirect_uri_mismatch`
error means the URI in step 6 differs from what the app sends by even one character.

---

## Part D — SMTP2GO (verification and password-reset emails)

The app uses SMTP2GO's **HTTP API with an API key**, not the SMTP username and password you
already have (a Cloudflare Worker can't conveniently speak SMTP). Keep the SMTP password private;
the app never needs it.

1. Log in at https://app.smtp2go.com with the company account those credentials belong to.
2. **Verified senders**: open **Sending → Verified Senders** and look at the sender domains.
   - If `newrootsherbal.com` (or the domain you want the emails to come from) is listed as
     verified, you're done with this step. Pick the address, e.g. `no-reply@newrootsherbal.com`.
   - If not, add the domain there. SMTP2GO shows a few DNS records (CNAMEs) to add **where that
     domain's DNS is managed**: `newrootsherbal.com` is on the company VPS/registrar, not
     Cloudflare; `flourishbodyandmind.com` is on Cloudflare (dashboard → the domain → **DNS** →
     **Add record**, Proxy status **DNS only**). Then click verify in SMTP2GO.
3. **API key**: **Sending → API Keys** → **Add API Key** → description "SmartStack". If it lets you
   choose permissions, allow only sending email (the `/email/send` endpoint). Copy the key (it
   starts with `api-`) into the password manager.
4. Give it to the Worker:

   ```bash
   npx wrangler secret put SMTP2GO_API_KEY --env staging
   npx wrangler secret put SMTP2GO_API_KEY
   ```

5. Tell Claude two addresses: the **sender** (e.g. `New Roots SmartStack <no-reply@newrootsherbal.com>`,
   must be on a verified domain) and the **reply-to** people should reach (a monitored support
   mailbox).
6. Check your plan's monthly and hourly limits in the SMTP2GO dashboard. Verification and reset
   emails are low volume, but a big sign-up day counts.

---

## Part E — Sign in with Apple (later)

Decided: **wait until the company joins the Apple Developer Program** (99 USD a year; also needed
for the iPhone app, and the App Store requires Sign in with Apple, or an equivalent private login,
in an iOS app that offers Google login). The app is built to accept Apple without rework. When
you're ready:

1. **D-U-N-S number** (free) for the legal entity: look it up at
   https://developer.apple.com/enroll/duns-lookup/ . If there is none, request one from that page
   (Dun & Bradstreet can take several business days).
2. **Enrol** at https://developer.apple.com/programs/enroll/ with an Apple Account on a company
   email (two-factor on) → **Organization** → legal entity name exactly as registered, D-U-N-S,
   website, work phone. The person enrolling must be able to bind the company legally. Pay the
   99 USD. Apple verifies (days, sometimes a phone call).
3. After approval, open https://developer.apple.com/account :
   1. **Membership details**: copy the **Team ID** (10 characters).
   2. **Certificates, Identifiers & Profiles** → **Identifiers** → **+** → **App IDs** →
      **Continue** → **App** → **Continue** → Description "SmartStack", Bundle ID **Explicit**
      `com.newrootsherbal.smartstack` → under Capabilities tick **Sign in with Apple** (Enable as a
      primary App ID) → **Continue** → **Register**. (The future iPhone app reuses this ID.)
   3. **Identifiers** → **+** → **Services IDs** → **Continue** → Description "SmartStack Web",
      Identifier `com.newrootsherbal.smartstack.web` → **Continue** → **Register**. Open it → tick
      **Sign in with Apple** → **Configure** → Primary App ID **SmartStack** →
      - Domains and Subdomains: `schedule.flourishbodyandmind.com`,
        `schedule-staging.flourishbodyandmind.com`
      - Return URLs:
        `https://schedule.flourishbodyandmind.com/api/auth/oauth/apple/callback`,
        `https://schedule-staging.flourishbodyandmind.com/api/auth/oauth/apple/callback`
      - **Next** → **Done** → **Continue** → **Save**.
      No verification file is needed any more. Apple refuses `localhost`, so Apple sign-in is only
      testable on staging.
   4. **Keys** → **+** → Key Name "SmartStack Sign in with Apple" → tick **Sign in with Apple** →
      **Configure** → Primary App ID **SmartStack** → **Save** → **Continue** → **Register** →
      **Download**. The `AuthKey_XXXXXXXXXX.p8` file can be **downloaded only once**. Note the
      **Key ID**.
   5. Store the `.p8` file, Key ID, Team ID and Services ID in the password manager
      ("SmartStack Sign in with Apple").
4. **Email relay** (people who choose "Hide My Email"): **Certificates, Identifiers & Profiles** →
   **Services** → **Sign in with Apple for Email Communication** → **Configure** → add the SMTP2GO
   sender address from Part D → **Register**. Apple checks the domain's SPF record. Without this,
   our emails to `@privaterelay.appleid.com` addresses bounce.
5. Give the values to the app:
   - Team ID, Key ID and Services ID (public): paste them to Claude.
   - Private key, in PowerShell from `apps\worker` (adjust the path):

     ```powershell
     Get-Content -Raw "$env:USERPROFILE\Downloads\AuthKey_XXXXXXXXXX.p8" | npx wrangler secret put APPLE_PRIVATE_KEY --env staging
     ```

     then the same line without `--env staging` for production. Not needed locally.
   - Delete the `.p8` from Downloads once it's in the password manager.
6. Ask Claude to build the Apple parts (build prompt §5.4), test on staging, then enable it in
   production.

---

## Part F — Law 25 (drafts ready for the Privacy Officer)

**Status: drafted.** Everything Claude could prepare is in `docs/privacy/` (start with
`docs/privacy/README.md`): the app's privacy policy and terms in English and French, the exact
consent texts, the privacy impact assessment (including the assessment required before storing
data outside Quebec) and an incident runbook. The Privacy Officer is **Peter Wilkes**
(hosts@newrootsherbal.com), the same as on newrootsherbal.com/privacy.

A privacy policy and a delete button are only two of about fifteen obligations, but most of the
others are built into the app (consents, profiling off by default, export, deletion, 14+ check,
retention clean-up) or are already company-wide (the Privacy Officer, the incident register).
Nothing is filed with or approved by the Commission d'accès à l'information. Development doesn't
wait: production runs in "staff" mode (only @newrootsherbal.com accounts) until the Privacy
Officer signs off, then switches to public.

**What's left for people (about half a day for the Privacy Officer):**

1. Review `docs/privacy/pia.md`, answer the **[To confirm]** items and sign it.
2. File copies of the two data processing agreements:
   - Cloudflare: https://www.cloudflare.com/cloudflare-customer-dpa/ (part of the self-serve
     agreement; save a PDF).
   - SMTP2GO: in its dashboard, **Settings → Display Settings → Data Processing Agreement →
     Review Agreement**. Note the account's data region (USA, EU or Australia) for the policy and
     the assessment.
3. Approve the privacy policy, the terms and the consent texts (both languages); set the effective
   date.
4. Add SmartStack to the company's governance policies and incident register.
5. Confirm that only named staff can access the Cloudflare account, with two-factor
   authentication on.
6. Tell the web team to switch accounts to public.

Claude isn't a lawyer: these are drafts for the Privacy Officer, and counsel if needed.

## Part G — Publish the Google consent screen (at launch, M10)

While in Testing, only the listed test users can sign in with Google.

1. **Verify the domain** in Google Search Console with the same Google account that owns the
   Cloud project: https://search.google.com/search-console → **Add property** → **Domain** →
   `flourishbodyandmind.com` → it shows a TXT value. Cloudflare dashboard →
   `flourishbodyandmind.com` → **DNS** → **Add record** → Type `TXT`, Name `@`, Content the
   `google-site-verification=…` value → **Save** → back in Search Console → **Verify**.
2. The privacy policy (Part F) must be live at `/privacy`.
3. Google Auth Platform → **Audience** → **Publish app** → **Confirm**. With only openid, email and
   profile, there is no scope review.
4. Optional, recommended: **brand verification**. Without it, Google's consent screen shows the
   domain instead of "New Roots SmartStack" and no logo. **Branding** → upload a 120×120 logo →
   submit for verification (Google reviews it; allow a few business days).

## Part H — Product team

1. Before M8: review the health profile lists (conditions, goals, diet) in build prompt §4.11. The
   codes stay stable; labels can change any time.
2. After M7: the **other-brand report**, monthly. It counts people per product and shows no
   account ids:

   ```bash
   npx wrangler d1 execute smartstack --remote --command "SELECT product_type, upc, brand, name, COUNT(DISTINCT account_id) AS people FROM user_products WHERE deleted_at IS NULL AND product_type <> 'medication' GROUP BY COALESCE(upc, lower(brand) || '|' || lower(name)) ORDER BY people DESC LIMIT 100"
   ```

   Map the top products to their New Roots Herbal alternative. Send Claude the pairs; they go into
   `packages/engine/data/alternatives.json` through a PR, marked reviewed by the product team.
   Treat the report as internal. (Medications are excluded on purpose.)
3. Before any app-store submission: regulatory review of the in-app copy (the magnesium evening
   suggestion, "Have you considered New Roots Herbal's…", news notifications).
4. Still open from Phase 1: review the label-derived timing rules.

## Part I — Admin access for news notifications (M9)

Admins are ordinary accounts with an extra role that only a database command can grant.

1. After M9 is deployed, the staff member signs up in the production app with their
   @newrootsherbal.com address (staff mode allows it) and confirms their email.
2. Grant the role (replace the address):

   ```bash
   npx wrangler d1 execute smartstack --remote --command "UPDATE accounts SET role = 'admin' WHERE email = 'name@newrootsherbal.com'"
   ```

   On staging: `npx wrangler d1 execute smartstack-staging --env staging --remote --command "…"`.
   To remove it, run the same command with `role = 'user'`.
3. Sending news: Profile → **Admin** → **News** → **New**:
   - Title and message in English and French (the counters show the limits), the link (a
     newrootsherbal.com page; tracking tags are added for you), the audience (everyone who opted in,
     or a health-profile segment), date and time (11:00–19:00 Montreal time).
   - Turn on news on your own phone first, then **Send a test to my devices**.
   - **Schedule**. The screen shows how many devices will get it and roughly how long delivery
     takes (about 1,000 devices an hour on the free plan).
4. Good practice: at most one news notification a week, always a real, useful link, and nothing
   that reads like medical advice.

---

## Where every value goes

| Value                                   | Secret | Comes from | Local                    | Staging                               | Production                      | Password manager |
| --------------------------------------- | ------ | ---------- | ------------------------ | ------------------------------------- | ------------------------------- | ---------------- |
| `AUTH_PEPPER`                           | yes    | Part A     | `.dev.vars`              | `wrangler secret put … --env staging` | `wrangler secret put …`         | production only  |
| `GOOGLE_CLIENT_ID`                      | no     | C8         | `wrangler.toml` (Claude) | `wrangler.toml` (Claude)              | `wrangler.toml` (Claude)        | yes              |
| `GOOGLE_CLIENT_SECRET`                  | yes    | C8         | `.dev.vars`              | `wrangler secret put … --env staging` | `wrangler secret put …`         | yes              |
| `SMTP2GO_API_KEY`                       | yes    | D3         | optional `.dev.vars`     | `wrangler secret put … --env staging` | `wrangler secret put …`         | yes              |
| `EMAIL_FROM`, `EMAIL_REPLY_TO`          | no     | D5         | `wrangler.toml` (Claude) | `wrangler.toml` (Claude)              | `wrangler.toml` (Claude)        | —                |
| `VAPID_PRIVATE_KEY`                     | yes    | Phase 1    | `.dev.vars` (already)    | `wrangler secret put … --env staging` | already set                     | already          |
| `CLOUDFLARE_API_TOKEN`                  | yes    | B2         | —                        | —                                     | GitHub Actions secret (already) | yes              |
| `STAFF_EMAIL_DOMAINS`, `ACCOUNTS_MODE`… | no     | Claude     | `wrangler.toml` / `.env` | `wrangler.toml` / `.env.staging`      | `wrangler.toml` / `.env`        | —                |
| Apple team/key/services IDs (later)     | no     | E3         | —                        | `wrangler.toml` (Claude)              | `wrangler.toml` (Claude)        | yes              |
| `APPLE_PRIVATE_KEY` (later, the `.p8`)  | yes    | E3.4       | —                        | `wrangler secret put … --env staging` | `wrangler secret put …`         | yes (the file)   |

## Test checklist (staging, before M10)

On an Android phone (installed app), an iPhone (Home Screen app) and desktop Chrome:

1. Sign up with email → the verification email arrives from the SMTP2GO sender → the link confirms.
2. Log out → log in → forgot password → the reset email arrives → new password works → the old
   one doesn't.
3. Continue with Google (a listed test user) → a new account is created → the consent step
   appears → accept.
4. On the iPhone Home Screen app: Continue with Google → you end up signed in **inside the app**
   (if a Safari sheet stays open saying "Return to the SmartStack app", close it; the app signs in
   when it comes back). Report exactly what you see; this is the least predictable part.
5. Guest with a stack → Profile → Back up & sync → create an account → the stack is now in the
   account; on a second device, log in → the same stack appears. Tick a dose on one → the tick and
   the bottle count follow on the other.
6. Other brand: a natural health product with its NPN → "Fill from Health Canada" fills the form;
   a medication with its DIN → same, and the medication stays at the time you chose.
7. Let an other-brand bottle run low → "You're almost out of … Have you considered New Roots
   Herbal's …?" → both buttons do what they say.
8. Health profile: consent, fill it in, switch on "relevant news", delete it.
9. Notifications: switch on news → an admin sends a test → it arrives, opens the product page;
   switch news off → the next campaign doesn't arrive.
10. Profile → Download my data → a JSON file. Delete my account → back on the welcome screen, and
    signing in again fails.
11. Guest mode still works with no account, exactly as before.
