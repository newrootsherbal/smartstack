# SmartStack — confidentiality incident runbook

The company procedure and register (Law 25, s. 3.5–3.8 and the *Regulation respecting
confidentiality incidents*) apply. This page adds what is specific to SmartStack: how to contain
an incident technically, and what to record. **Tell the Privacy Officer (Peter Wilkes,
hosts@newrootsherbal.com, 1 800 268-9486) as soon as an incident is suspected.**

A confidentiality incident is any unauthorized access, use or communication of personal
information, or its loss. Examples: a leaked Cloudflare token, a bug that shows one person's stack
to another, a staff member querying health profiles without a reason, a lost laptop with
`.dev.vars`.

## 1. Contain (web team, first hour)

Run from `D:\Websites\smartstack\apps\worker`; add `--env staging` for staging.

| Situation | Action |
| --- | --- |
| Cloudflare API token or account leaked | Cloudflare dashboard → My Profile → API Tokens → roll or delete the token; update the GitHub secret. Review Audit Logs (Manage Account → Audit Log). Change the account password; check two-factor on every member |
| Sessions possibly stolen | Log everyone out: `npx wrangler d1 execute smartstack --remote --command "DELETE FROM sessions"` |
| `GOOGLE_CLIENT_SECRET` leaked | Google Auth Platform → Clients → add a new secret, `npx wrangler secret put GOOGLE_CLIENT_SECRET`, delete the old secret |
| `SMTP2GO_API_KEY` leaked | SMTP2GO → API Keys → delete the key, create a new one, `npx wrangler secret put SMTP2GO_API_KEY` |
| `VAPID_PRIVATE_KEY` leaked | Only lets someone send notifications to subscribed devices. Rotate only if abused: every device must turn reminders on again |
| `AUTH_PEPPER` leaked **together with** the database | Passwords remain protected by the 600,000-iteration stretching, but treat accounts as at risk: rotate the pepper (`npx wrangler secret put AUTH_PEPPER`), which invalidates every password, and email everyone to reset it |
| Bug exposing data between accounts | Switch accounts off with `ACCOUNTS_MODE=off` in `wrangler.toml` (or roll back the deploy in Cloudflare → Workers → smartstack → Deployments), then fix |
| Admin misuse | `UPDATE accounts SET role = 'user' WHERE email = '…'`; cancel pending campaigns |

Keep evidence: export the relevant Workers Logs (they last only 3 days) and note the D1 Time
Travel bookmark (`npx wrangler d1 time-travel info smartstack`) before changing data.

## 2. Assess (Privacy Officer, promptly)

Decide whether there is a **risk of serious injury** (s. 3.7), considering:

- the sensitivity of the information: stacks, medications and health profiles are sensitive;
  email addresses alone are less so;
- the foreseeable consequences of its use (discrimination, embarrassment, phishing…);
- the likelihood it will be misused (encrypted? who got it? was it recovered?).

Useful queries (counts only; don't export people's data):

```bash
npx wrangler d1 execute smartstack --remote --command "SELECT COUNT(*) FROM accounts"
npx wrangler d1 execute smartstack --remote --command "SELECT COUNT(*) FROM health_profiles WHERE deleted_at IS NULL"
```

## 3. Notify (Privacy Officer)

If there is a risk of serious injury: notify the **Commission d'accès à l'information** (form on
www.cai.gouv.qc.ca) and the **people concerned**, promptly. For people concerned, the web team can
send the notice through SMTP2GO from the Worker (a one-off script reviewed by the Privacy Officer).

## 4. Record (always, even without serious injury)

Add an entry to the company's incident register: description of the information involved,
circumstances, dates of the incident and of its discovery, number of people concerned, the
serious-injury assessment, the notices sent (dates), and the measures taken. Keep entries at least
5 years after the enterprise became aware of the incident.

## 5. Learn

Fix the cause, add a test when it was a bug, and update the privacy impact assessment
(`docs/privacy/pia.md`) if the risk picture changed.
