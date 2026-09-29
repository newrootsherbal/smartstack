/**
 * The health profile as a synced entity (M8, build prompt §4.11, §8.1): one row per account in
 * `health_profiles`, last write wins by `updatedAt` like the rest of /api/sync. A deletion is a
 * tombstone whose profile columns are cleared at once, so the sensitive answers don't wait 30
 * days for the cleanup. Pure statement builders, tested like sync.ts.
 */
import { isSyncTombstone, type HealthProfile, type SyncHealth } from '@smartstack/shared'
import type { Statement } from './logic'

export interface HealthProfileRow {
  birth_year: number | null
  gender: string | null
  pregnancy: string | null
  conditions: string
  goals: string
  diet: string
  avoids: string
  activity: string | null
  storage_consent_at: number
  targeting_consent_at: number | null
  updated_at: number
  deleted_at: number | null
  rev: number
}

const NEW_REV = '(SELECT rev FROM accounts WHERE id = ?1)'
const COLUMNS =
  'birth_year, gender, pregnancy, conditions, goals, diet, avoids, activity, ' +
  'storage_consent_at, targeting_consent_at, updated_at, deleted_at'

/** Push: insert or replace the profile when the pushed version is strictly newer. */
export function healthUpsertStatement(accountId: string, h: SyncHealth): Statement {
  const tombstone = isSyncTombstone(h)
  const p = tombstone ? null : (h as HealthProfile)
  return {
    sql: `INSERT INTO health_profiles (account_id, ${COLUMNS}, rev)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ${NEW_REV})
ON CONFLICT (account_id) DO UPDATE SET
  birth_year = excluded.birth_year, gender = excluded.gender, pregnancy = excluded.pregnancy,
  conditions = excluded.conditions, goals = excluded.goals, diet = excluded.diet,
  avoids = excluded.avoids, activity = excluded.activity,
  storage_consent_at = excluded.storage_consent_at,
  targeting_consent_at = excluded.targeting_consent_at, updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at, rev = excluded.rev
WHERE excluded.updated_at > health_profiles.updated_at`,
    params: [
      accountId,
      p?.birthYear ?? null,
      p?.gender ?? null,
      p?.pregnancy ?? null,
      JSON.stringify(p?.conditions ?? []),
      JSON.stringify(p?.goals ?? []),
      JSON.stringify(p?.diet ?? []),
      JSON.stringify(p?.avoids ?? []),
      p?.activity ?? null,
      // A tombstone keeps no consent: the NOT NULL column holds the deletion time.
      p ? p.storageConsentAt : h.updatedAt,
      p?.targetingConsentAt ?? null,
      h.updatedAt,
      tombstone ? (h.deletedAt as number) : null,
    ],
  }
}

/** Pull: the row when newer than `since`; after a push, only when the push lost. */
export function healthReadStatement(accountId: string, since: number, pushed: boolean): Statement {
  return {
    sql: `SELECT ${COLUMNS}, rev FROM health_profiles
WHERE account_id = ?1 AND ${pushed ? `rev <> ${NEW_REV}` : 'rev > ?2'}`,
    params: pushed ? [accountId] : [accountId, since],
  }
}

function list<T>(text: string): T[] {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

export function healthFromRow(row: HealthProfileRow): SyncHealth {
  if (row.deleted_at !== null) return { updatedAt: row.updated_at, deletedAt: row.deleted_at }
  return {
    birthYear: row.birth_year,
    gender: row.gender as HealthProfile['gender'],
    pregnancy: row.pregnancy as HealthProfile['pregnancy'],
    conditions: list(row.conditions),
    goals: list(row.goals),
    diet: list(row.diet),
    avoids: list(row.avoids),
    activity: row.activity as HealthProfile['activity'],
    storageConsentAt: row.storage_consent_at,
    targetingConsentAt: row.targeting_consent_at,
    updatedAt: row.updated_at,
    deletedAt: null,
  }
}

/** The daily cleanup: a deleted profile's row goes after 30 days, like other tombstones. */
export function healthCleanupStatement(tombstoneCutoff: number): Statement {
  return {
    sql: `DELETE FROM health_profiles WHERE deleted_at IS NOT NULL AND deleted_at < ?1`,
    params: [tombstoneCutoff],
  }
}

/** Export: the account's profile row (a tombstone included, with its cleared columns). */
export function healthExportStatement(accountId: string): Statement {
  return {
    sql: `SELECT ${COLUMNS}, rev FROM health_profiles WHERE account_id = ?1`,
    params: [accountId],
  }
}
