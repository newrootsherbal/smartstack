/**
 * The news composer's form (/admin/news, §4.12): a draft as the fields hold it, and the
 * conversions to and from the admin API. Pure, so it is tested without a browser.
 */
import {
  CampaignInput,
  NEWS_TIME_ZONE,
  NEWS_UTM_MEDIUM,
  NEWS_UTM_SOURCE,
  campaignSlug,
  inNewsWindow,
  newsTextLength,
  stripNewsPrefix,
  withNewsPrefix,
  zonedParts,
  zonedTimeToEpoch,
  type CampaignView,
  type GENDERS,
  type HealthCondition,
  type HealthGoal,
  type NewsAudience,
  type PREGNANCY_STATUSES,
} from '@smartstack/shared'

type Gender = (typeof GENDERS)[number]
type PregnancyStatus = (typeof PREGNANCY_STATUSES)[number]

export interface CampaignDraft {
  name: string
  /** Titles without the "New Roots Herbal:" prefix (always added). */
  titleEn: string
  titleFr: string
  bodyEn: string
  bodyFr: string
  /** Without our tracking tags (the Worker adds them for the campaign's current name). */
  url: string
  audienceType: 'all' | 'segment'
  conditions: HealthCondition[]
  goals: HealthGoal[]
  genders: Gender[]
  pregnancy: PregnancyStatus[]
  ageMin: string
  ageMax: string
  /** Toronto wall-clock date (YYYY-MM-DD) and time (HH:MM). */
  sendDate: string
  sendTime: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The Toronto date and time of an instant, as the date and time inputs hold them. */
export function torontoInputs(epochMs: number): { date: string; time: string } {
  const p = zonedParts(epochMs, NEWS_TIME_ZONE)
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

/** A new campaign: everyone, tomorrow at 11:00 Toronto time. */
export function emptyDraft(now: number): CampaignDraft {
  return {
    name: '',
    titleEn: '',
    titleFr: '',
    bodyEn: '',
    bodyFr: '',
    url: 'https://newrootsherbal.com/',
    audienceType: 'all',
    conditions: [],
    goals: [],
    genders: [],
    pregnancy: [],
    ageMin: '',
    ageMax: '',
    sendDate: torontoInputs(now + 24 * 60 * 60 * 1000).date,
    sendTime: '11:00',
  }
}

/** The link without the tracking tags we add (someone else's tags stay). */
export function withoutOurTags(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  const params = url.searchParams
  if (
    params.get('utm_source') !== NEWS_UTM_SOURCE ||
    params.get('utm_medium') !== NEWS_UTM_MEDIUM
  ) {
    return raw
  }
  params.delete('utm_source')
  params.delete('utm_medium')
  params.delete('utm_campaign')
  return url.toString()
}

/** The link as it will be sent: the tags the Worker adds when they are absent. null: not https. */
export function linkWithTags(raw: string, name: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const tags: [string, string][] = [
    ['utm_source', NEWS_UTM_SOURCE],
    ['utm_medium', NEWS_UTM_MEDIUM],
    ['utm_campaign', campaignSlug(name)],
  ]
  for (const [key, value] of tags) {
    if (!url.searchParams.has(key)) url.searchParams.append(key, value)
  }
  return url.toString()
}

export function draftFromCampaign(c: CampaignView, now: number): CampaignDraft {
  const segment = c.audience.type === 'segment' ? c.audience : null
  const when = torontoInputs(c.sendAt ?? now + 24 * 60 * 60 * 1000)
  return {
    name: c.name,
    titleEn: stripNewsPrefix(c.titleEn),
    titleFr: stripNewsPrefix(c.titleFr),
    bodyEn: c.bodyEn,
    bodyFr: c.bodyFr,
    url: withoutOurTags(c.url),
    audienceType: c.audience.type,
    conditions: segment?.conditions ?? [],
    goals: segment?.goals ?? [],
    genders: segment?.genders ?? [],
    pregnancy: segment?.pregnancy ?? [],
    ageMin: segment?.ageMin === undefined ? '' : String(segment.ageMin),
    ageMax: segment?.ageMax === undefined ? '' : String(segment.ageMax),
    sendDate: when.date,
    sendTime: c.sendAt === null ? '11:00' : when.time,
  }
}

function age(text: string): number | undefined {
  const n = Number.parseInt(text.trim(), 10)
  return Number.isFinite(n) ? n : undefined
}

export function audienceFromDraft(d: CampaignDraft): NewsAudience {
  if (d.audienceType === 'all') return { type: 'all' }
  const ageMin = age(d.ageMin)
  const ageMax = age(d.ageMax)
  return {
    type: 'segment',
    ...(d.conditions.length ? { conditions: d.conditions } : {}),
    ...(d.goals.length ? { goals: d.goals } : {}),
    ...(d.genders.length ? { genders: d.genders } : {}),
    ...(d.pregnancy.length ? { pregnancy: d.pregnancy } : {}),
    ...(ageMin === undefined ? {} : { ageMin }),
    ...(ageMax === undefined ? {} : { ageMax }),
  }
}

export function inputFromDraft(d: CampaignDraft): CampaignInput {
  return {
    name: d.name.trim(),
    titleEn: d.titleEn.trim(),
    titleFr: d.titleFr.trim(),
    bodyEn: d.bodyEn.trim(),
    bodyFr: d.bodyFr.trim(),
    url: d.url.trim(),
    audience: audienceFromDraft(d),
  }
}

/** Characters the full title takes, prefix included (the counter next to the field). */
export function titleLength(locale: 'en' | 'fr', text: string): number {
  return newsTextLength(withNewsPrefix(locale, text))
}

export type DraftField =
  'name' | 'titleEn' | 'titleFr' | 'bodyEn' | 'bodyFr' | 'url' | 'audience' | 'ageMin' | 'ageMax'

const ISSUE_FIELDS: Record<string, DraftField> = {
  name: 'name',
  titleEn: 'titleEn',
  titleFr: 'titleFr',
  bodyEn: 'bodyEn',
  bodyFr: 'bodyFr',
  url: 'url',
}

/** Fields the Worker would refuse (same schema), before anything is sent. */
export function draftProblems(d: CampaignDraft): Set<DraftField> {
  const problems = new Set<DraftField>()
  const parsed = CampaignInput.safeParse(inputFromDraft(d))
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [first, second] = issue.path
      if (first === 'audience') {
        problems.add(second === 'ageMin' || second === 'ageMax' ? second : 'audience')
      } else if (typeof first === 'string' && ISSUE_FIELDS[first]) {
        problems.add(ISSUE_FIELDS[first])
      }
    }
  }
  for (const field of ['ageMin', 'ageMax'] as const) {
    const text = d[field].trim()
    if (d.audienceType === 'segment' && text !== '' && !/^\d{1,3}$/.test(text)) problems.add(field)
  }
  return problems
}

export type SendAtProblem = 'invalid' | 'past' | 'window'

/** The sending instant, or why it can't be scheduled (the Worker checks the same). */
export function sendAtFromDraft(
  d: CampaignDraft,
  now: number,
): { ok: true; sendAt: number } | { ok: false; problem: SendAtProblem } {
  const sendAt = zonedTimeToEpoch(d.sendDate, d.sendTime, NEWS_TIME_ZONE)
  if (sendAt === null) return { ok: false, problem: 'invalid' }
  if (sendAt <= now) return { ok: false, problem: 'past' }
  if (!inNewsWindow(sendAt)) return { ok: false, problem: 'window' }
  return { ok: true, sendAt }
}

/** The delivery estimate in the largest unit that reads well: minutes under an hour, else hours. */
export function etaParts(minutes: number): { value: number; unit: 'minute' | 'hour' } {
  if (minutes < 60) return { value: Math.max(1, Math.ceil(minutes)), unit: 'minute' }
  return { value: Math.round((minutes / 60) * 10) / 10, unit: 'hour' }
}
