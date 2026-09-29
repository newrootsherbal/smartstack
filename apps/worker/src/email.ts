/**
 * Account emails (§5.6): four templates in the account's language (plain text plus minimal
 * inline-styled HTML) and one sender. EMAIL_MODE "log" prints the link in the wrangler console
 * (local only); "smtp2go" posts to SMTP2GO's HTTP API. Logs never contain the address.
 */
import type { Env, Locale } from './env'
import { emailMode, isLocalOrigin } from './config'

export const SMTP2GO_SEND_URL = 'https://api.smtp2go.com/v3/email/send'

export type EmailKind = 'verify_email' | 'reset_password' | 'password_changed' | 'inactive_warning'

export interface EmailMessage {
  kind: EmailKind
  to: string
  subject: string
  text: string
  html: string
  /** The action link (printed in log mode). */
  link: string | null
}

interface Template {
  subject: string
  before: string[]
  button: { label: string; href: string } | null
  after: string[]
}

const COMMON: Record<Locale, { greeting: string; footer: string }> = {
  en: {
    greeting: 'Hello,',
    footer: 'This is an automatic message about your New Roots SmartStack account.',
  },
  fr: {
    greeting: 'Bonjour,',
    footer: 'Ceci est un message automatique concernant votre compte New Roots SmartStack.',
  },
}

const SIGNATURE = 'New Roots Herbal'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const P = 'margin:0 0 16px'

function render(kind: EmailKind, locale: Locale, to: string, t: Template): EmailMessage {
  const { greeting, footer } = COMMON[locale]
  const textParts = [greeting, ...t.before]
  if (t.button) textParts.push(t.button.href)
  textParts.push(...t.after, SIGNATURE, `--\n${footer}`)

  const html = [
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(t.subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#ffffff;color:#1f2933;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">`,
    `<div style="max-width:560px">`,
    `<p style="${P}">${escapeHtml(greeting)}</p>`,
    ...t.before.map((p) => `<p style="${P}">${escapeHtml(p)}</p>`),
    t.button
      ? `<p style="margin:0 0 24px"><a href="${escapeHtml(t.button.href)}" style="display:inline-block;padding:12px 20px;background:#2f6b3a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">${escapeHtml(t.button.label)}</a></p>` +
        `<p style="${P};font-size:13px;color:#52606d;word-break:break-all">${escapeHtml(t.button.href)}</p>`
      : '',
    ...t.after.map((p) => `<p style="${P}">${escapeHtml(p)}</p>`),
    `<p style="${P}">${escapeHtml(SIGNATURE)}</p>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#52606d">${escapeHtml(footer)}</p>`,
    `</div></body></html>`,
  ].join('')

  return {
    kind,
    to,
    subject: t.subject,
    text: textParts.join('\n\n') + '\n',
    html,
    link: t.button?.href ?? null,
  }
}

export function verifyEmailMessage(locale: Locale, to: string, link: string): EmailMessage {
  const t: Record<Locale, Template> = {
    en: {
      subject: 'Confirm your email address for SmartStack',
      before: ['Please confirm the email address of your New Roots SmartStack account.'],
      button: { label: 'Confirm my email', href: link },
      after: [
        'This link expires in 48 hours. If you didn’t create a SmartStack account, you can ignore this email.',
      ],
    },
    fr: {
      subject: 'Confirmez votre adresse courriel pour SmartStack',
      before: ['Veuillez confirmer l’adresse courriel de votre compte New Roots SmartStack.'],
      button: { label: 'Confirmer mon adresse courriel', href: link },
      after: [
        'Ce lien expire dans 48 heures. Si vous n’avez pas créé de compte SmartStack, vous pouvez ignorer ce courriel.',
      ],
    },
  }
  return render('verify_email', locale, to, t[locale])
}

export function resetPasswordMessage(locale: Locale, to: string, link: string): EmailMessage {
  const t: Record<Locale, Template> = {
    en: {
      subject: 'Reset your SmartStack password',
      before: [
        'We received a request to reset the password of your New Roots SmartStack account. To choose a new password, use this link:',
      ],
      button: { label: 'Choose a new password', href: link },
      after: [
        'This link expires in 1 hour and works only once. If you didn’t ask for this, you can ignore this email: your password stays the same.',
      ],
    },
    fr: {
      subject: 'Réinitialisez votre mot de passe SmartStack',
      before: [
        'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte New Roots SmartStack. Pour choisir un nouveau mot de passe, utilisez ce lien :',
      ],
      button: { label: 'Choisir un nouveau mot de passe', href: link },
      after: [
        'Ce lien expire dans 1 heure et ne fonctionne qu’une fois. Si vous n’avez pas fait cette demande, vous pouvez ignorer ce courriel : votre mot de passe reste le même.',
      ],
    },
  }
  return render('reset_password', locale, to, t[locale])
}

export function passwordChangedMessage(
  locale: Locale,
  to: string,
  appOrigin: string,
): EmailMessage {
  const t: Record<Locale, Template> = {
    en: {
      subject: 'Your SmartStack password was changed',
      before: [
        'The password of your New Roots SmartStack account was just changed, and your other devices were logged out.',
        'If you made this change, there’s nothing else to do. If you didn’t, reset your password right away with “Forgot password?” on the app’s login screen.',
      ],
      button: { label: 'Open SmartStack', href: appOrigin },
      after: [],
    },
    fr: {
      subject: 'Le mot de passe de votre compte SmartStack a été modifié',
      before: [
        'Le mot de passe de votre compte New Roots SmartStack vient d’être modifié, et vos autres appareils ont été déconnectés.',
        'Si vous avez fait cette modification, vous n’avez rien d’autre à faire. Sinon, réinitialisez votre mot de passe sans tarder avec « Mot de passe oublié? » à l’écran de connexion de l’application.',
      ],
      button: { label: 'Ouvrir SmartStack', href: appOrigin },
      after: [],
    },
  }
  return render('password_changed', locale, to, t[locale])
}

/** "October 29, 2029" / "29 octobre 2029" (Toronto calendar day). */
export function formatDeletionDate(locale: Locale, at: number): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    dateStyle: 'long',
    timeZone: 'America/Toronto',
  }).format(new Date(at))
}

/** N8 (subject) and N9 (body) of docs/privacy/consent-texts.md; sent by the M10 cleanup. */
export function inactiveWarningMessage(
  locale: Locale,
  to: string,
  deletionAt: number,
  appOrigin: string,
): EmailMessage {
  const date = formatDeletionDate(locale, deletionAt)
  const t: Record<Locale, Template> = {
    en: {
      subject: 'Your SmartStack account will be deleted in 30 days',
      before: [
        `You haven’t used SmartStack for almost 3 years, so we’ll delete your account and everything in it on ${date}. To keep it, just open the app and log in.`,
      ],
      button: { label: 'Open SmartStack', href: appOrigin },
      after: [],
    },
    fr: {
      subject: 'Votre compte SmartStack sera supprimé dans 30 jours',
      before: [
        `Vous n’avez pas utilisé SmartStack depuis près de 3 ans. Nous supprimerons donc votre compte et tout son contenu le ${date}. Pour le conserver, il suffit d’ouvrir l’application et de vous connecter.`,
      ],
      button: { label: 'Ouvrir SmartStack', href: appOrigin },
      after: [],
    },
  }
  return render('inactive_warning', locale, to, t[locale])
}

export interface Smtp2goPayload {
  sender: string
  to: string[]
  subject: string
  text_body: string
  html_body: string
  custom_headers?: { header: string; value: string }[]
}

export function smtp2goPayload(
  sender: string,
  replyTo: string,
  message: EmailMessage,
): Smtp2goPayload {
  const payload: Smtp2goPayload = {
    sender,
    to: [message.to],
    subject: message.subject,
    text_body: message.text,
    html_body: message.html,
  }
  if (replyTo.trim()) payload.custom_headers = [{ header: 'Reply-To', value: replyTo.trim() }]
  return payload
}

/** SMTP2GO: HTTP 200 with data.succeeded === 1. */
export function smtp2goSucceeded(status: number, body: unknown): boolean {
  if (status !== 200 || typeof body !== 'object' || body === null) return false
  const data = (body as { data?: { succeeded?: unknown } }).data
  return data?.succeeded === 1
}

export type EmailResult = 'sent' | 'logged' | 'not_configured' | 'failed'

export type EmailEnv = Pick<
  Env,
  'EMAIL_MODE' | 'EMAIL_FROM' | 'EMAIL_REPLY_TO' | 'SMTP2GO_API_KEY' | 'APP_ORIGIN'
>

export async function sendEmail(
  env: EmailEnv,
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailResult> {
  const mode = emailMode(env)
  if (mode === 'log') {
    if (!isLocalOrigin(env.APP_ORIGIN)) {
      console.error(`EMAIL_MODE=log is for local development only: ${message.kind} email not sent`)
      return 'not_configured'
    }
    // Local only: the link (with its token) is what a developer needs to continue the flow.
    console.log(`[email:log] ${message.kind} (${message.subject}) ${message.link ?? ''}`.trim())
    return 'logged'
  }
  if (mode === 'invalid') {
    console.error(`EMAIL_MODE must be "smtp2go" or "log": ${message.kind} email not sent`)
    return 'not_configured'
  }
  const sender = env.EMAIL_FROM?.trim() ?? ''
  const apiKey = env.SMTP2GO_API_KEY?.trim() ?? ''
  if (!sender || !apiKey) {
    const missing = [!sender && 'EMAIL_FROM', !apiKey && 'SMTP2GO_API_KEY'].filter(Boolean)
    console.error(
      `email not configured (${missing.join(' and ')} missing): ${message.kind} not sent`,
    )
    return 'not_configured'
  }
  try {
    const response = await fetchImpl(SMTP2GO_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Smtp2go-Api-Key': apiKey,
      },
      body: JSON.stringify(smtp2goPayload(sender, env.EMAIL_REPLY_TO ?? '', message)),
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (smtp2goSucceeded(response.status, body)) return 'sent'
    const code = (body as { data?: { error_code?: unknown } } | null)?.data?.error_code
    console.error(
      `smtp2go ${message.kind} failed: HTTP ${response.status}${typeof code === 'string' ? ` ${code}` : ''}`,
    )
    return 'failed'
  } catch {
    console.error(`smtp2go ${message.kind} failed: network error`)
    return 'failed'
  }
}
