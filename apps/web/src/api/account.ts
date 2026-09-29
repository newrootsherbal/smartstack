/** /api/auth/… and /api/account/… (build prompt §7). Responses are validated with the shared schemas. */
import {
  AccountView,
  AuthResponse,
  SyncResponse,
  type SyncRequestBody,
  OAuthClaimResponse,
  OAuthStartResponse,
  type ChangePasswordBody,
  type ForgotPasswordBody,
  type LoginBody,
  type OAuthClaimBody,
  type OAuthProviderId,
  type OAuthStartBody,
  type ResetPasswordBody,
  type SignupBody,
} from '@smartstack/shared'
import { ApiError, BETA_HEADER, request } from './client'

export const accountApi = {
  signup: async (body: SignupBody) =>
    AuthResponse.parse(await request(null, 'POST', '/api/auth/signup', body, BETA_HEADER)),
  login: async (body: LoginBody) =>
    AuthResponse.parse(await request(null, 'POST', '/api/auth/login', body)),
  logout: (token: string) => request(token, 'POST', '/api/auth/logout'),
  verifyEmail: (token: string) => request(null, 'POST', '/api/auth/verify-email', { token }),
  resendVerification: (session: string) =>
    request(session, 'POST', '/api/auth/verify-email/resend'),
  forgotPassword: (body: ForgotPasswordBody) =>
    request(null, 'POST', '/api/auth/password/forgot', body),
  resetPassword: (body: ResetPasswordBody) =>
    request(null, 'POST', '/api/auth/password/reset', body),
  changePassword: (session: string, body: ChangePasswordBody) =>
    request(session, 'POST', '/api/auth/password/change', body),
  oauthStart: async (body: OAuthStartBody, session: string | null) =>
    OAuthStartResponse.parse(
      await request(session, 'POST', '/api/auth/oauth/start', body, BETA_HEADER),
    ),
  oauthClaim: async (body: OAuthClaimBody) =>
    OAuthClaimResponse.parse(await request(null, 'POST', '/api/auth/oauth/claim', body)),
  getAccount: async (session: string) =>
    AccountView.parse(await request(session, 'GET', '/api/account')),
  consent: async (session: string) =>
    AccountView.parse(await request(session, 'POST', '/api/account/consent', { age14: true })),
  linkDevice: (session: string, deviceId: string) =>
    request(session, 'POST', '/api/account/device', { deviceId }),
  unlinkDevice: (session: string, deviceId: string) =>
    request(session, 'DELETE', '/api/account/device', { deviceId }),
  disconnect: (session: string, provider: OAuthProviderId) =>
    request(session, 'DELETE', `/api/account/identity/${provider}`),
  deleteAccount: (session: string) => request(session, 'DELETE', '/api/account'),
  /** Push the outbox and pull what changed since `since` (§8.2). */
  sync: async (session: string, body: SyncRequestBody) =>
    SyncResponse.parse(await request(session, 'POST', '/api/sync', body)),
  /** The account's data as a file the browser saves (Law 25 portability). */
  async exportData(session: string): Promise<Blob> {
    const res = await fetch('/api/account/export', {
      headers: { Authorization: `Bearer ${session}` },
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!res.ok) throw new ApiError(res.status, 'export_failed')
    return res.blob()
  },
}
