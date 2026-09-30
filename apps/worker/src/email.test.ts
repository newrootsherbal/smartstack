import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatDeletionDate,
  inactiveWarningMessage,
  passwordChangedMessage,
  resetPasswordMessage,
  sendEmail,
  smtp2goPayload,
  smtp2goSucceeded,
  SMTP2GO_SEND_URL,
  verifyEmailMessage,
  type EmailEnv,
} from './email'

const TO = 'test.one@example.com'
const LINK = 'https://schedule.example/verify-email#token=abc'
const ORIGIN = 'https://schedule.example'

const env = (overrides: Partial<EmailEnv> = {}): EmailEnv => ({
  EMAIL_MODE: 'smtp2go',
  EMAIL_FROM: 'New Roots SmartStack <no-reply@example.com>',
  EMAIL_REPLY_TO: 'support@example.com',
  SMTP2GO_API_KEY: 'api-test-key',
  APP_ORIGIN: ORIGIN,
  ...overrides,
})

describe('templates', () => {
  it('writes the verify email in both languages, text and HTML', () => {
    const en = verifyEmailMessage('en', TO, LINK)
    expect(en.subject).toBe('Confirm your email address for SmartStack')
    expect(en.text).toContain(LINK)
    expect(en.text).toContain('48 hours')
    expect(en.html).toContain(`href="${LINK}"`)
    expect(en.html).toContain('<html lang="en">')
    expect(en.link).toBe(LINK)
    const fr = verifyEmailMessage('fr', TO, LINK)
    expect(fr.subject).toBe('Confirmez votre adresse courriel pour SmartStack')
    expect(fr.text).toContain('48 heures')
    expect(fr.html).toContain('<html lang="fr">')
  })

  it('writes the reset email with Quebec typography', () => {
    const fr = resetPasswordMessage('fr', TO, LINK)
    expect(fr.text).toContain('utilisez ce lien :')
    expect(fr.text).toContain('n’avez')
    expect(fr.text).not.toMatch(/ :|'/)
    expect(resetPasswordMessage('en', TO, LINK).text).toContain('expires in 1 hour')
  })

  it('writes the password-changed notice', () => {
    expect(passwordChangedMessage('en', TO, ORIGIN).text).toContain('other devices were logged out')
    expect(passwordChangedMessage('fr', TO, ORIGIN).text).toContain('« Mot de passe oublié? »')
  })

  it('uses N8/N9 for the inactive-account warning', () => {
    const at = Date.UTC(2029, 9, 29, 12)
    expect(formatDeletionDate('en', at)).toBe('October 29, 2029')
    expect(formatDeletionDate('fr', at)).toBe('29 octobre 2029')
    const en = inactiveWarningMessage('en', TO, at, ORIGIN)
    expect(en.subject).toBe('Your SmartStack account will be deleted in 30 days')
    expect(en.text).toContain(
      'You haven’t used SmartStack for almost 3 years, so we’ll delete your account and everything in it on October 29, 2029. To keep it, just open the app and log in.',
    )
    const fr = inactiveWarningMessage('fr', TO, at, ORIGIN)
    expect(fr.subject).toBe('Votre compte SmartStack sera supprimé dans 30 jours')
    expect(fr.text).toContain(
      'Vous n’avez pas utilisé SmartStack depuis près de 3 ans. Nous supprimerons donc votre compte et tout son contenu le 29 octobre 2029. Pour le conserver, il suffit d’ouvrir l’application et de vous connecter.',
    )
  })

  it('escapes HTML', () => {
    const msg = verifyEmailMessage('en', TO, 'https://x.example/?a=1&b="2"')
    expect(msg.html).toContain('href="https://x.example/?a=1&amp;b=&quot;2&quot;"')
  })
})

describe('SMTP2GO payload', () => {
  it('builds { sender, to: [address], subject, text_body, html_body } plus Reply-To', () => {
    const msg = verifyEmailMessage('en', TO, LINK)
    expect(smtp2goPayload('Sender <s@example.com>', 'support@example.com', msg)).toEqual({
      sender: 'Sender <s@example.com>',
      to: [TO],
      subject: msg.subject,
      text_body: msg.text,
      html_body: msg.html,
      custom_headers: [{ header: 'Reply-To', value: 'support@example.com' }],
    })
    expect(smtp2goPayload('s@example.com', '', msg)).not.toHaveProperty('custom_headers')
  })

  it('succeeds only on HTTP 200 with data.succeeded === 1', () => {
    expect(smtp2goSucceeded(200, { data: { succeeded: 1, failed: 0 } })).toBe(true)
    expect(smtp2goSucceeded(200, { data: { succeeded: 0, failed: 1 } })).toBe(false)
    expect(smtp2goSucceeded(400, { data: { error_code: 'E' } })).toBe(false)
    expect(smtp2goSucceeded(200, null)).toBe(false)
  })
})

describe('sendEmail (mocked fetch; nothing is ever sent)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('posts to SMTP2GO with the API key header', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ request_id: 'r', data: { succeeded: 1, failed: 0 } }),
    )
    const result = await sendEmail(env(), verifyEmailMessage('en', TO, LINK), fetchMock)
    expect(result).toBe('sent')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(SMTP2GO_SEND_URL)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['X-Smtp2go-Api-Key']).toBe('api-test-key')
    const body = JSON.parse(String(init?.body))
    expect(body.to).toEqual([TO])
    expect(body.sender).toBe('New Roots SmartStack <no-reply@example.com>')
  })

  it('reports failures without logging the address', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = vi.fn(async () =>
      Response.json({ data: { error_code: 'E_ApiResponseCodes.X' } }, { status: 400 }),
    )
    expect(await sendEmail(env(), verifyEmailMessage('en', TO, LINK), failing)).toBe('failed')
    const throwing = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await sendEmail(env(), verifyEmailMessage('en', TO, LINK), throwing)).toBe('failed')
    expect(errors.mock.calls.flat().join(' ')).not.toContain(TO)
  })

  it('does not send without a sender or API key, and says which is missing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
    expect(
      await sendEmail(env({ EMAIL_FROM: '' }), verifyEmailMessage('en', TO, LINK), fetchMock),
    ).toBe('not_configured')
    expect(
      await sendEmail(env({ SMTP2GO_API_KEY: '' }), verifyEmailMessage('en', TO, LINK), fetchMock),
    ).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
    const logged = errors.mock.calls.flat().join(' ')
    expect(logged).toContain('EMAIL_FROM')
    expect(logged).toContain('SMTP2GO_API_KEY')
    expect(logged).not.toContain(TO)
  })

  it('prints the link in log mode, and only for a local origin', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
    const local = env({ EMAIL_MODE: 'log', APP_ORIGIN: 'http://localhost:8790' })
    expect(await sendEmail(local, verifyEmailMessage('en', TO, LINK), fetchMock)).toBe('logged')
    expect(logs.mock.calls.flat().join(' ')).toContain(LINK)
    expect(logs.mock.calls.flat().join(' ')).not.toContain(TO)
    expect(
      await sendEmail(env({ EMAIL_MODE: 'log' }), verifyEmailMessage('en', TO, LINK), fetchMock),
    ).toBe('not_configured')
    expect(
      await sendEmail(env({ EMAIL_MODE: 'smtp' }), verifyEmailMessage('en', TO, LINK), fetchMock),
    ).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
