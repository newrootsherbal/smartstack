# SmartStack — Law 25 compliance package

Everything needed for Quebec's private-sector privacy act (as amended by Law 25) for SmartStack
Phase 2, drafted on 2026-09-29 for the Privacy Officer, **Peter Wilkes** (hosts@newrootsherbal.com,
1 800 268-9486; the same person as on https://newrootsherbal.com/privacy). These are drafts
prepared with Claude (an AI assistant), not legal advice: the Privacy Officer, and counsel if
needed, review and approve them.

## Files

| File | What it is | Used by |
| --- | --- | --- |
| `pia.md` | Privacy impact assessment (EFVP), incl. the s. 17 assessment for storage outside Quebec | Privacy Officer: review, complete, sign |
| `privacy-policy.en.md`, `privacy-policy.fr.md` | The app's privacy policy | The app's `/privacy` page |
| `terms.en.md`, `terms.fr.md` | Terms of use | The app's `/terms` page |
| `consent-texts.md` | Every consent and privacy notice, English and French | The app's i18n dictionaries |
| `incident-response.md` | Technical containment and recording steps for SmartStack | Web team and Privacy Officer |

## Status

| # | Obligation | Where it's handled | Status |
| - | ---------- | ------------------ | ------ |
| 1 | Person in charge, title and contact published (s. 3.1) | newrootsherbal.com/privacy; app policy §16 | Done |
| 2 | Governance policies (s. 3.2) | Company policies: add SmartStack to their scope | Privacy Officer |
| 3 | Privacy impact assessment (s. 3.3, s. 17) | `pia.md` | Draft → review and sign |
| 4 | Written agreements with processors (s. 17, 18.3) | Cloudflare DPA, SMTP2GO DPA (`pia.md` §6) | Download and file |
| 5 | Privacy policy in clear terms (s. 8.2) | `privacy-policy.*.md` | Draft → approve |
| 6 | Express consent for sensitive information (s. 12) | `consent-texts.md` C1, C4 | Built in M4/M8 |
| 7 | Profiling off by default, explained (s. 8.1) | C5 | Built in M8 |
| 8 | Privacy by default (s. 9.1) | News off, profiling off, reminder names hidden | Built in M2/M9 |
| 9 | Automated processing disclosed (s. 12.1) | Policy §5; "More info" | Built in M1 |
| 10 | Minors under 14 (s. 4.1) | C2 | Built in M4 |
| 11 | Prospection: identify, opt-out (s. 22) | News notifications | Built in M9 |
| 12 | Access, correction, portability, deletion (s. 27, 28, 28.1) | Export, edit, delete | Built in M4/M5/M8 |
| 13 | Retention and destruction (s. 23) | Daily cleanup; 3-year inactive accounts; 12-month inactive devices | Built in M5/M10 |
| 14 | Confidentiality incidents: register, notices (s. 3.5–3.8) | Company register + `incident-response.md` | Privacy Officer |
| 15 | Answer requests within 30 days (s. 32) | Company procedure | Privacy Officer |

## For the Privacy Officer (about half a day)

1. Read `pia.md`, answer the **[To confirm]** items (search for "To confirm"), and sign section 10.
2. File copies of the two data processing agreements:
   - Cloudflare: https://www.cloudflare.com/cloudflare-customer-dpa/ (v6.4, effective
     2026-04-03; it's part of the self-serve agreement, so there's nothing to sign; save a PDF).
   - SMTP2GO: in the SMTP2GO dashboard, **Settings → Display Settings → Data Processing
     Agreement → Review Agreement**. Note the account's data region (USA, EU or Australia) and put
     it in the policy's table (§9) and `pia.md` §6.
3. Approve the privacy policy and terms (both languages) and set the effective date. The policy
   version (`2026-10`) must equal the app's `CONSENT_VERSION`.
4. Approve `consent-texts.md`.
5. Add SmartStack to the company's incident register procedure and governance policies.
6. Tell the web team to switch accounts to public (`ACCOUNTS_MODE=public`).

## Noticed on newrootsherbal.com/privacy (outside this project)

The website's own policy names the Privacy Officer, but it has no date, doesn't explain how to
exercise access, correction or deletion rights or the 30-day answer time, and doesn't mention the
right to complain to the Commission d'accès à l'information. Worth a separate update; the app's
policy (§12 and §16) can serve as a model.
