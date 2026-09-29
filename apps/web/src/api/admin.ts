/** /api/admin/… (staff admins, §4.12, §7): news campaigns. Session bearer; counts only. */
import {
  AudienceEstimate,
  CampaignListResponse,
  CampaignResponse,
  TestSendResult,
  type CampaignInput,
  type NewsAudience,
} from '@smartstack/shared'
import { request } from './client'

const campaign = async (promise: Promise<unknown>) => CampaignResponse.parse(await promise).campaign

export const adminApi = {
  campaigns: async (session: string) =>
    CampaignListResponse.parse(await request(session, 'GET', '/api/admin/campaigns')).campaigns,
  create: (session: string, body: CampaignInput) =>
    campaign(request(session, 'POST', '/api/admin/campaigns', body)),
  update: (session: string, id: string, body: CampaignInput) =>
    campaign(request(session, 'PUT', `/api/admin/campaigns/${encodeURIComponent(id)}`, body)),
  schedule: (session: string, id: string, sendAt: number) =>
    campaign(
      request(session, 'POST', `/api/admin/campaigns/${encodeURIComponent(id)}/schedule`, {
        sendAt,
      }),
    ),
  cancel: (session: string, id: string) =>
    campaign(request(session, 'POST', `/api/admin/campaigns/${encodeURIComponent(id)}/cancel`)),
  duplicate: (session: string, id: string) =>
    campaign(request(session, 'POST', `/api/admin/campaigns/${encodeURIComponent(id)}/duplicate`)),
  test: async (session: string, id: string) =>
    TestSendResult.parse(
      await request(session, 'POST', `/api/admin/campaigns/${encodeURIComponent(id)}/test`),
    ),
  estimate: async (session: string, audience: NewsAudience) =>
    AudienceEstimate.parse(
      await request(session, 'POST', '/api/admin/audience-estimate', { audience }),
    ),
}
