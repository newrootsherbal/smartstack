// News notifications (Phase 2, M9): contracts for PUT /api/me/news and /api/admin/*, the push
// payload, and the helpers both sides need (title prefix, counters, Toronto time, the sending
// window). Validated by the Worker, reused by the web client. Kept free of imports from './index'
// (index.ts re-exports this file, so importing back would create a cycle).
import { z } from 'zod'
import { Locale } from './auth'
import {
  GENDERS,
  HEALTH_CONDITIONS,
  HEALTH_GOALS,
  PREGNANCY_STATUSES,
  type HealthCondition,
} from './user-data'

// ---------------------------------------------------------------------------
// Guardrails (docs/smartstack-phase2-prompt.md §4.12, §15.2)
// ---------------------------------------------------------------------------

export const NEWS_TIME_ZONE = 'America/Toronto'
/** Sending window, Toronto wall-clock minutes since midnight, both ends included: 11:00–19:00. */
export const NEWS_WINDOW_START_MINUTES = 11 * 60
export const NEWS_WINDOW_END_MINUTES = 19 * 60
/** A segment must reach at least this many devices to be scheduled (no singling anyone out). */
export const NEWS_MIN_SEGMENT_DEVICES = 10
/** A device gets at most one news notification per 24 hours. */
export const NEWS_CAP_MS = 24 * 60 * 60 * 1000
/** Title limit, the "New Roots Herbal: " prefix included (N10). */
export const NEWS_TITLE_MAX = 60
export const NEWS_BODY_MAX = 100
export const NEWS_NAME_MAX = 80
export const NEWS_URL_MAX = 1000

/** N10 in docs/privacy/consent-texts.md (French: no-break space before the colon). */
export const NEWS_TITLE_PREFIX = {
  en: 'New Roots Herbal: ',
  fr: 'New Roots Herbal : ',
} as const satisfies Record<Locale, string>

/** The tracking tags the Worker adds to a campaign link when they are absent. */
export const NEWS_UTM_SOURCE = 'smartstack'
export const NEWS_UTM_MEDIUM = 'push'

// ---------------------------------------------------------------------------
// Text helpers (the composer's counters use the same functions as the Worker)
// ---------------------------------------------------------------------------

/** Characters as people count them (code points, so an emoji counts once). */
export function newsTextLength(text: string): number {
  return Array.from(text).length
}

/** "New Roots Herbal:", "new roots herbal :", with any spacing, at the start of a title. */
const PREFIX_RE = /^New Roots Herbal\s*:\s*/i

/** The title without its prefix (what the composer's text field edits). */
export function stripNewsPrefix(title: string): string {
  return title.trim().replace(PREFIX_RE, '').trim()
}

/** The full title as stored and sent: the locale's prefix, then the text. */
export function withNewsPrefix(locale: Locale, title: string): string {
  return NEWS_TITLE_PREFIX[locale] + stripNewsPrefix(title)
}

/** Characters left for the text after the prefix: 42 in English, 41 in French. */
export function newsTitleRoom(locale: Locale): number {
  return NEWS_TITLE_MAX - newsTextLength(NEWS_TITLE_PREFIX[locale])
}

function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** utm_campaign value: lowercase ASCII letters, digits and dashes ("Vitamin D webinar" → "vitamin-d-webinar"). */
export function campaignSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'news'
}

// ---------------------------------------------------------------------------
// Toronto time and the sending window (DST-safe, through Intl)
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** The wall-clock date and time of an instant in a time zone. */
export function zonedParts(epochMs: number, timeZone: string = NEWS_TIME_ZONE): ZonedParts {
  const parts: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    if (part.type in parts) parts[part.type as keyof ZonedParts] = Number(part.value)
  }
  if (parts.hour === 24) parts.hour = 0
  return parts
}

function offsetAt(epochMs: number, timeZone: string): number {
  const seconds = Math.floor(epochMs / 1000) * 1000
  const p = zonedParts(seconds, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - seconds
}

/**
 * The instant of a wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in a time zone
 * (America/Toronto by default). null when the input is malformed or the time doesn't exist
 * (the spring-forward gap); an ambiguous fall-back time gives the earlier instant.
 */
export function zonedTimeToEpoch(
  date: string,
  time: string,
  timeZone: string = NEWS_TIME_ZONE,
): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!d || !t) return null
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  const calendar = new Date(asUtc)
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null
  const first = offsetAt(asUtc, timeZone)
  let epoch = asUtc - first
  const second = offsetAt(epoch, timeZone)
  if (second !== first) epoch = asUtc - second
  const p = zonedParts(epoch, timeZone)
  const roundTrip =
    p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute
  return roundTrip ? epoch : null
}

/** True from 11:00 to 19:00 (inclusive, to the minute) Toronto time. */
export function inNewsWindow(epochMs: number): boolean {
  const { hour, minute } = zonedParts(epochMs, NEWS_TIME_ZONE)
  const minutes = hour * 60 + minute
  return minutes >= NEWS_WINDOW_START_MINUTES && minutes <= NEWS_WINDOW_END_MINUTES
}

/** The current year in Toronto: ages in segments are "this year minus the year of birth". */
export function torontoYear(epochMs: number): number {
  return zonedParts(epochMs, NEWS_TIME_ZONE).year
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

function noDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

const DUPLICATES = 'each value at most once'

const ConditionList = z
  .array(z.enum(HEALTH_CONDITIONS as [HealthCondition, ...HealthCondition[]]))
  .max(HEALTH_CONDITIONS.length)
  .refine(noDuplicates, DUPLICATES)
const GoalList = z
  .array(z.enum(HEALTH_GOALS))
  .max(HEALTH_GOALS.length)
  .refine(noDuplicates, DUPLICATES)
const GenderList = z.array(z.enum(GENDERS)).max(GENDERS.length).refine(noDuplicates, DUPLICATES)
const PregnancyList = z
  .array(z.enum(PREGNANCY_STATUSES))
  .max(PREGNANCY_STATUSES.length)
  .refine(noDuplicates, DUPLICATES)
const Age = z.number().int().min(0).max(120)

export const NewsAudienceAll = z.object({ type: z.literal('all') })

/**
 * Accounts whose health profile has targeting consent (C5) and matches every part given: any of
 * the conditions, any of the goals, one of the genders, one of the pregnancy statuses, an age
 * (this year minus the year of birth) within [ageMin, ageMax]. An empty list counts as absent;
 * at least one part is required. Lists hold each code at most once, so a segment binds at most
 * 51 SQL parameters.
 */
export const NewsSegment = z
  .object({
    type: z.literal('segment'),
    conditions: ConditionList.optional(),
    goals: GoalList.optional(),
    genders: GenderList.optional(),
    ageMin: Age.optional(),
    ageMax: Age.optional(),
    pregnancy: PregnancyList.optional(),
  })
  .refine((s) => s.ageMin === undefined || s.ageMax === undefined || s.ageMin <= s.ageMax, {
    message: 'ageMin must not be above ageMax',
    path: ['ageMax'],
  })
  .refine((s) => segmentHasCriteria(s), {
    message: 'a segment needs at least one condition, goal, gender, pregnancy status or age',
  })
export type NewsSegment = z.infer<typeof NewsSegment>

export const NewsAudience = z.discriminatedUnion('type', [NewsAudienceAll, NewsSegment])
export type NewsAudience = z.infer<typeof NewsAudience>

export function segmentHasCriteria(s: {
  conditions?: readonly string[] | undefined
  goals?: readonly string[] | undefined
  genders?: readonly string[] | undefined
  pregnancy?: readonly string[] | undefined
  ageMin?: number | undefined
  ageMax?: number | undefined
}): boolean {
  return (
    Boolean(s.conditions?.length) ||
    Boolean(s.goals?.length) ||
    Boolean(s.genders?.length) ||
    Boolean(s.pregnancy?.length) ||
    s.ageMin !== undefined ||
    s.ageMax !== undefined
  )
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** PUT /api/me/news (device bearer): C6, per device, off by default. */
export const PutNewsBody = z.object({ optIn: z.boolean() })
export type PutNewsBody = z.infer<typeof PutNewsBody>

/** A title with or without the N10 prefix; the prefix is added, then the whole is ≤ 60. */
function newsTitle(locale: Locale) {
  return z
    .string()
    .max(400)
    .transform((raw) => withNewsPrefix(locale, raw))
    .refine((title) => stripNewsPrefix(title).length > 0, 'the title needs text after the prefix')
    .refine(
      (title) => newsTextLength(title) <= NEWS_TITLE_MAX,
      `at most ${NEWS_TITLE_MAX} characters, "${NEWS_TITLE_PREFIX[locale].trim()}" included`,
    )
    .refine((title) => !hasControlCharacters(title), 'no line breaks or control characters')
}

const NewsBodyText = z
  .string()
  .trim()
  .min(1)
  .refine((body) => newsTextLength(body) <= NEWS_BODY_MAX, `at most ${NEWS_BODY_MAX} characters`)
  .refine((body) => !hasControlCharacters(body), 'no line breaks or control characters')

/**
 * POST /api/admin/campaigns and PUT /api/admin/campaigns/:id (a full replacement). Titles may
 * be sent with or without the prefix: the stored title always starts with it. The link must be
 * https on a host in the Worker's NEWS_URL_HOSTS; the Worker adds
 * utm_source=smartstack&utm_medium=push&utm_campaign=<campaignSlug(name)> when absent.
 */
export const CampaignInput = z.object({
  name: z.string().trim().min(1).max(NEWS_NAME_MAX),
  titleEn: newsTitle('en'),
  titleFr: newsTitle('fr'),
  bodyEn: NewsBodyText,
  bodyFr: NewsBodyText,
  url: z
    .string()
    .trim()
    .max(NEWS_URL_MAX)
    .pipe(z.url({ protocol: /^https$/ })),
  audience: NewsAudience,
})
export type CampaignInput = z.input<typeof CampaignInput>
export type CampaignFields = z.output<typeof CampaignInput>

/** POST /api/admin/campaigns/:id/schedule: an instant (epoch ms) within 11:00–19:00 Toronto. */
export const ScheduleCampaignBody = z.object({ sendAt: z.number().int().positive() })
export type ScheduleCampaignBody = z.infer<typeof ScheduleCampaignBody>

/** POST /api/admin/audience-estimate */
export const AudienceEstimateBody = z.object({ audience: NewsAudience })
export type AudienceEstimateBody = z.infer<typeof AudienceEstimateBody>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] as const
export const CampaignStatus = z.enum(CAMPAIGN_STATUSES)
export type CampaignStatus = z.infer<typeof CampaignStatus>

/** One campaign as the admin API returns it (list, create, edit, schedule, cancel, duplicate). */
export const CampaignView = z.object({
  id: z.string(),
  name: z.string(),
  /** Full titles, prefix included. */
  titleEn: z.string(),
  titleFr: z.string(),
  bodyEn: z.string(),
  bodyFr: z.string(),
  /** As stored: UTM tags included. */
  url: z.string(),
  audience: NewsAudience,
  sendAt: z.number().nullable(),
  status: CampaignStatus,
  sentCount: z.number(),
  failedCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().nullable(),
  /** Scheduled or sending, and another scheduled or sending campaign is less than 24 h away. */
  closeToAnother: z.boolean(),
})
export type CampaignView = z.infer<typeof CampaignView>

/** GET /api/admin/campaigns (newest first). */
export const CampaignListResponse = z.object({ campaigns: z.array(CampaignView) })
export type CampaignListResponse = z.infer<typeof CampaignListResponse>

/** Create, edit, schedule, cancel and duplicate answer the campaign. */
export const CampaignResponse = z.object({ campaign: CampaignView })
export type CampaignResponse = z.infer<typeof CampaignResponse>

/**
 * POST /api/admin/audience-estimate. Devices that opted in (and match the segment) with at least
 * one push subscription. Under 10: `devices: null, tooSmall: true` ("fewer than 10").
 * `canSchedule` is false for a segment under 10 (an "everyone" audience can always be scheduled).
 * `etaMinutes`: the delivery time at the full per-minute budget (reminders go first, and
 * delivery pauses outside 11:00–19:00 Toronto, so it can take longer).
 */
export const AudienceEstimate = z.object({
  devices: z.number().nullable(),
  tooSmall: z.boolean(),
  canSchedule: z.boolean(),
  etaMinutes: z.number(),
})
export type AudienceEstimate = z.infer<typeof AudienceEstimate>

/** POST /api/admin/campaigns/:id/test: pushes to the admin's own linked devices. */
export const TestSendResult = z.object({
  devices: z.number(),
  sent: z.number(),
  failed: z.number(),
})
export type TestSendResult = z.infer<typeof TestSendResult>

/** PUT /api/me/news */
export const PutNewsResponse = z.object({ ok: z.literal(true), optIn: z.boolean() })
export type PutNewsResponse = z.infer<typeof PutNewsResponse>

/**
 * What the service worker receives for a news notification (campaigns and admin tests alike).
 * `kind: 'news'` tells it apart from a reminder (`{ title, body, tag, url }`); `lang` is the
 * device's language, for the Android "Turn off news" action label.
 */
export const NewsPushPayload = z.object({
  title: z.string(),
  body: z.string(),
  /** 'news:<campaignId>' */
  tag: z.string(),
  url: z.string(),
  kind: z.literal('news'),
  campaignId: z.string(),
  lang: Locale,
})
export type NewsPushPayload = z.infer<typeof NewsPushPayload>

/** `error` codes of the news routes, besides the generic ones (invalid_json, invalid_body…). */
export const NEWS_ERROR_CODES = [
  'forbidden',
  'url_host_not_allowed',
  'invalid_status',
  'send_at_past',
  'outside_sending_window',
  'audience_too_small',
  'segments_unavailable',
  'no_devices',
  'push_not_configured',
] as const
export type NewsErrorCode = (typeof NEWS_ERROR_CODES)[number]
