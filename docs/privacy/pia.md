# SmartStack — Privacy Impact Assessment (EFVP)

| | |
| --- | --- |
| **Project** | SmartStack Phase 2: accounts, server sync, other-brand products and medications, bottle tracking, health profile, news notifications |
| **Organization** | New Roots Herbal Inc., 3405 Rue F.-X.-Tessier, Vaudreuil-Dorion, QC J7V 5V5 |
| **Person in charge of the protection of personal information** | Peter Wilkes, Privacy Officer — hosts@newrootsherbal.com · 1 800 268-9486 |
| **Prepared by** | Draft prepared with Claude (AI assistant) from the system design (`docs/smartstack-phase2-prompt.md`) and the code, for review and completion by the Privacy Officer |
| **Version / date** | 0.1 draft, 2026-09-29 |
| **Status** | **Draft — not approved.** Sections marked [To confirm] need an answer before sign-off |
| **Method** | Commission d'accès à l'information, *Guide d'accompagnement — Réaliser une évaluation des facteurs relatifs à la vie privée*, v3.0 (2023): https://www.cai.gouv.qc.ca/uploads/pdfs/CAI_GU_EFVP.pdf |

A French version can be produced from this one once it is approved.

## 1. Summary

SmartStack is a free app that schedules a person's supplements around their day. Phase 1 (live
since 2026-09-24) keeps everything on the device. Phase 2 adds optional accounts that store the
person's stack on New Roots Herbal's servers, an optional health profile, the ability to add other
brands' products and medications, and opt-in news notifications that can be targeted using the
health profile.

The project handles **sensitive personal information** (supplements and medications taken, health
conditions, pregnancy) and stores it **outside Quebec** (Cloudflare, SMTP2GO). Both facts make this
assessment mandatory (s. 3.3 and s. 17 of the *Act respecting the protection of personal
information in the private sector*, "the Act").

**Conclusion (proposed):** with the measures in section 8 in place, the residual risk is **low to
moderate** and the information stored outside Quebec receives **adequate protection** within the
meaning of s. 17. Launch to the public is conditional on the action plan in section 9.

## 2. Is an assessment required?

| Trigger | Applies? |
| --- | --- |
| Acquisition, development or overhaul of an information system or electronic service delivery involving personal information (s. 3.3) | **Yes**: new account and sync system |
| Communication of personal information outside Quebec, including entrusting its storage to a provider outside Quebec (s. 17) | **Yes**: Cloudflare (database, hosting), SMTP2GO (email) |
| Sensitive information (s. 12: medical or otherwise intimate) | **Yes**: stack, medications, health profile |
| Profiling (s. 8.1) | **Yes**: optional use of the health profile to target news |

The assessment is proportionate to the sensitivity, purpose, quantity, distribution and medium of
the information (s. 3.3).

## 3. Project description

- **Purpose**: help people take their supplements at the right time (label directions, spacing
  between ingredients such as iron and calcium), remind them, track bottles, and let New Roots
  Herbal inform interested people about products and webinars.
- **Users**: the public in Canada, 14 and older. Staff "admins" compose news notifications.
- **Channels**: a web app (PWA) at schedule.flourishbodyandmind.com, installable on phones; later
  the same app in the App Store and Google Play.
- **Modes**:
  - *Guest* (default, no account): all data on the device. The server receives only what's needed
    for reminders or news if the person turns them on.
  - *Account* (opt-in): data synced to the server. Sign-in by email and password or Google (Apple
    later).
- **Architecture**: one Cloudflare Worker (application and API) with a Cloudflare D1 database;
  SMTP2GO for account emails; Web Push through the browser vendors' push services; Health Canada's
  public databases for product lookups.
- **Not included**: advertising, analytics or tracking tools, sale of data, artificial
  intelligence, medication interaction checking, medical advice.

## 4. Personal information inventory

| # | Information | Source | Purpose | Sensitive | Stored | Retention |
| - | ----------- | ------ | ------- | --------- | ------ | --------- |
| 1 | Random device identifier, time zone, device type, app language | Device | Reminders and news delivery | No | D1 | Until "Delete my data", account deletion, or 12 months without use |
| 2 | Push subscription (endpoint, public keys) | Browser | Deliver notifications | No | D1 | Same as 1; deleted when the push service reports it gone |
| 3 | Reminder rows: time, product ids, notification text (names hidden by default) | Device | Reminders | Moderate (reveals supplement use when names are shown) | D1 | 7 days after the reminder time |
| 4 | News opt-in flag and on/off timestamps; last news time | Person | News; proof of consent | No | D1 | Same as 1 |
| 5 | Email address, first name (optional), language | Person | Account, emails | No | D1 | Until deletion; 3 years without use |
| 6 | Password-derived hash and salt (password itself never received) | Device | Sign-in | No (security-critical) | D1 | Until changed or account deleted |
| 7 | Google account identifier and email | Google | Sign-in | No | D1 | Until disconnected or account deleted |
| 8 | Consent records (policy version, timestamps, 14+ confirmation) | Person | Proof of consent | No | D1 | As long as the account |
| 9 | Session records (hashed token, device type, timestamps) | System | Stay signed in | No | D1 | Until logout or 90 days unused |
| 10 | Email tokens (hashed), OAuth attempts, throttle counters (hashed email/IP) | System | Verification, reset, abuse prevention | No | D1 | ≤ 48 hours / ≤ 1 day |
| 11 | Routine times, theme | Person | Schedule | Low | D1 | Until deletion |
| 12 | Stack: products, doses, chosen times, dismissed suggestions, bottle counts, shopping list | Person | Schedule, bottles, shopping list | **Yes** (health-related) | D1 | Until deletion (deleted items 30 days) |
| 13 | Other-brand products and **medications** (name, brand, barcode, NPN/DIN, strength, dose, ingredients, directions, warnings, free-text notes) | Person | Schedule; anonymous catalogue statistics | **Yes** | D1 | Until deletion (30 days) |
| 14 | Doses ticked | Person | Bottle counts, sync | **Yes** | D1 | 3 days |
| 15 | Health profile: year of birth, gender, pregnancy, conditions, goals, diet, foods avoided, activity | Person | Targeted news only, with consent C5 | **Yes** | D1 | Until the profile or account is deleted |
| 16 | Campaigns (content, audience criteria, author's account id) | Staff | News | No (criteria aren't about a person) | D1 | Kept for the record |
| 17 | Request metadata in service logs (URL, time, possibly IP address) | System | Operation, debugging | Low | Cloudflare Workers Logs | 3 days |
| 18 | All of the above in database backups | System | Recovery | As above | D1 Time Travel | 7 days (always on, can't be disabled) |

**Necessity (s. 4–5).** Each item serves a feature the person chose. Items not collected on
purpose: full birth date (year only), free-text health conditions, location, contacts, analytics,
advertising identifiers, dose history beyond 3 days. **Residual concern:** free-text fields on
other-brand products (notes, directions, warnings) could receive more health detail than needed;
see risk R6.

## 5. Information flows

1. **Device → Cloudflare Worker → D1** (HTTPS): sync, reminders, news opt-in, account operations.
   Guests send nothing unless they turn on reminders or news.
2. **Worker → SMTP2GO** (HTTPS): recipient email address, name, message (verification, reset,
   password changed, inactive-account warning). No stack or health information.
3. **Device ↔ Google** (HTTPS, only for "Continue with Google"): standard OAuth sign-in. The Worker
   receives the Google identifier, email, email-verified flag and name.
4. **Worker → push services** (Google FCM, Apple, Mozilla): the notification payload is encrypted
   end to end (RFC 8291); the push service sees only the endpoint and timing.
5. **Worker → Health Canada** (on request): only the NPN or DIN; responses cached a week. No
   personal information.
6. **Staff admin → Worker**: campaign content and audience criteria; staff see only device counts,
   and segments under 10 devices are hidden and can't be scheduled.
7. **Anonymous statistics**: counts of other-brand products (brand, name, barcode) without account
   identifiers, run by the product team with a SQL query; medications excluded.

## 6. Communication outside Quebec (s. 17)

| Provider | Role | Information | Location | Contract | Assessment |
| --- | --- | --- | --- | --- | --- |
| Cloudflare, Inc. (US) | Hosting, database, delivery | All of section 4 | D1 primary in Eastern North America (location hint "enam"; the country isn't guaranteed and may be the US); edge network worldwide | Cloudflare Data Processing Addendum v6.4 (effective 2026-04-03), part of the self-serve agreement: https://www.cloudflare.com/cloudflare-customer-dpa/ | Encryption in transit (TLS) and at rest (AES-256-GCM, per Cloudflare's D1 documentation); processor terms; SOC 2 / ISO 27001 certified provider. Acceptable |
| SMTP2GO (New Zealand company) | Transactional email | Email address, name, message | Data centre set by the account's region (USA, EU or Australia) [To confirm: our account's region] | SMTP2GO DPA, in the dashboard under Settings → Display Settings → Data Processing Agreement → Review Agreement | Only contact information; TLS; certified data centres. Acceptable |
| Google LLC (US) | Sign-in provider, chosen by the person | Google identifier, email, name | Google data centres | Google's terms and privacy policy; the person has their own relationship with Google | Acceptable: minimal, person's choice |
| Push services (Google, Apple, Mozilla) | Notification transport | Encrypted payload, endpoint | Their data centres | Browser vendors' terms | Content unreadable by them. Acceptable |

**Factors considered (s. 17):** sensitivity (high for items 12–15), purposes (limited to running
the service), protection measures (section 8, contracts above), and the legal framework of the
destination. The United States has no general federal privacy law comparable to the Act, and US
authorities can compel providers to disclose data (e.g. the CLOUD Act). Mitigations: minimization
(no full birth date, no free-text conditions, no dose history), encryption in transit and at rest,
contractual processor terms, and transparency in the privacy policy (section 9 of the policy).
**Proposed conclusion:** adequate protection, in light of generally recognized principles.
Canadian-only hosting isn't available on the free plan (D1 offers EU and FedRAMP jurisdictions,
not Canada).

## 7. Compliance analysis

| Principle (the Act) | How SmartStack complies | Status |
| --- | --- | --- |
| Person in charge, published (s. 3.1) | Peter Wilkes, published on newrootsherbal.com/privacy and in the app policy | Done |
| Governance policies (s. 3.2) | Company policies; add SmartStack to their scope [To confirm] | Company |
| Purpose identified before collection (s. 4, 8) | Privacy policy sections 1–4; notices at each collection point | Built |
| Necessity (s. 5) | Section 4 inventory; optional fields; guest mode | Built |
| Express consent for sensitive information (s. 12) | C1 (account), C4 (health profile), C5 (profiling), separate and unticked | Built |
| Transparency, policy published (s. 8, 8.2) | `/privacy` in English and French, linked at every consent | Drafted |
| Profiling off by default, informed (s. 8.1) | C5 off by default, explains "profiling" | Built |
| Privacy by default (s. 9.1) | News off, profiling off, reminder names hidden, guest mode sends nothing | Built |
| Automated processing (s. 12.1) | Schedule is a suggestion the person can change; "More info" explains each placement; policy section 5 | Built |
| Minors under 14 (s. 4.1) | C2 "14 or older"; policy section 13 | Built |
| Commercial prospection (s. 22) | News identifies New Roots Herbal; opt-out in the app and in the notification (Android) | Built |
| Security (s. 10) | Section 8 | Built |
| Retention and destruction (s. 23) | Retention column above; daily cleanup job; inactive accounts deleted after 3 years with warning | Built |
| Anonymized information (s. 23) | Other-brand statistics aggregated without identifiers; medications excluded | Built |
| Access, correction, portability (s. 27, 28) | Everything visible and editable; "Download my data" (JSON) | Built |
| Deletion, de-indexation (s. 28, 28.1) | Delete product / health profile / account / guest data | Built |
| Response within 30 days (s. 32) | Privacy Officer procedure [To confirm] | Company |
| Processors, written agreements (s. 17, 18.3) | Section 6 | Download and file copies |
| Confidentiality incidents (s. 3.5–3.8) | `docs/privacy/incident-response.md` + company register | Company |

## 8. Risks and measures

Likelihood and impact: L = low, M = medium, H = high.

| # | Risk | Before (L/I) | Measures | After (L/I) |
| - | ---- | ------------ | -------- | ----------- |
| R1 | Database breach exposes stacks, medications, health profiles | L/H | Encryption at rest; no passwords stored; hashed tokens; access limited to named staff with 2FA on Cloudflare [To confirm]; minimization; 7-day backup horizon | L/M |
| R2 | Account takeover (password reuse, guessing) | M/H | Client-side stretching (PBKDF2 600,000) + server HMAC with a secret pepper; throttling of failed logins; generic error messages; sessions revoked on password change; Google sign-in option | L/M |
| R3 | Pre-registration hijack (someone creates an account with a victim's email) | L/M | Linking rules: an unverified password account loses its password when the verified owner signs in with Google | L/L |
| R4 | Foreign authorities' access to data held by US providers | L/M | Minimization, encryption, transparency; no free-text health data | L/M |
| R5 | Unexpected use of health data for marketing | M/H | Profiling off by default (C5), separate from the profile consent (C4); staff see counts only; segments under 10 devices blocked | L/M |
| R6 | Free-text fields on products or notes receive detailed health information | M/M | Length limits; hint text "Don't enter information about other people or details you don't need"; excluded from statistics; deleted with the product | L/M |
| R7 | Lock-screen notifications reveal supplements or medications to people nearby | M/M | Product names hidden by default (N4); the person can opt in to names | L/L |
| R8 | Shared or lost device shows the stack | M/M | Log out clears the device; sessions expire after 90 days unused; guest data deletable | M/L |
| R9 | XSS steals a session token stored in the browser | L/H | Strict Content-Security-Policy, no third-party scripts, React escaping, tokens revocable | L/M |
| R10 | Staff misuse of the admin tool (targeting sensitive segments, excessive messages) | L/M | Admin role granted by database command only; frequency cap 1/day; sending window; counts only; campaigns kept for the record | L/L |
| R11 | Children under 14 create accounts | L/M | 14+ confirmation; deletion on request | L/L |
| R12 | Loss of the secret pepper makes every password unusable | L/M | Stored in the company password manager; recovery by password reset | L/L |
| R13 | Logs retain IP addresses or tokens | M/L | Tokens never in URLs (fragments); OAuth codes single-use; logs kept 3 days; invocation logs switched off after launch tuning | L/L |
| R14 | Health Canada lookups reveal what a person takes | L/L | Worker makes the call (not the device); only the number is sent; no account data | L/L |

## 9. Action plan (conditions for public launch)

| # | Action | Owner | Status |
| - | ------ | ----- | ------ |
| A1 | Review this assessment; answer the [To confirm] items; sign section 10 | Privacy Officer | Open |
| A2 | Download and file Cloudflare's DPA (v6.4) and SMTP2GO's DPA; note SMTP2GO's data region | Privacy Officer / web team | Open |
| A3 | Approve the privacy policy and terms (`docs/privacy/`), fill in the effective date | Privacy Officer / counsel | Open |
| A4 | Approve the consent and notice texts (`docs/privacy/consent-texts.md`) | Privacy Officer | Open |
| A5 | Confirm Cloudflare account access is limited to named staff with two-factor authentication | Web team | Open |
| A6 | Add SmartStack to the company's confidentiality incident register and procedure | Privacy Officer | Open |
| A7 | Build and verify the measures marked "Built" (milestones M1–M10) | Web team | In progress |
| A8 | Re-assess before: the App Store / Google Play release, any new use of the health profile, any new provider, or Apple sign-in | Privacy Officer | Later |

## 10. Approval

| | |
| --- | --- |
| Reviewed and approved by | Peter Wilkes, Privacy Officer |
| Signature | |
| Date | |
| Next review | Before the app-store release, or within 12 months |
