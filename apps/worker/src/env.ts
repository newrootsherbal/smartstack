export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  VAPID_PUBLIC_KEY: string
  /** Secret (wrangler secret / .dev.vars). Undefined until configured. */
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT: string
  MAX_PUSHES_PER_TICK: string
  BETA_KEY: string
}

export interface UserRow {
  id: string
  tz: string
  platform: 'ios' | 'android' | 'desktop'
  created_at: number
  last_seen_at: number
}

export interface PushSubscriptionRow {
  id: number
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: number
  last_success_at: number | null
  failures: number
}

export type ReminderStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'expired'

export interface ReminderRow {
  id: string
  user_id: string
  kind: 'schedule' | 'test'
  scheduled_at: number
  slot_key: string
  product_ids: string
  title: string
  body: string
  status: ReminderStatus
  attempts: number
  claimed_at: number | null
  sent_at: number | null
}
