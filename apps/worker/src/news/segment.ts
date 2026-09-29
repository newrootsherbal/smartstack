/**
 * The audience of a news campaign as SQL (§4.12): a pure builder, unit-tested against SQLite.
 * Everyone who opted in is `users.news_opt_in = 1` for every device, guest or account. A segment
 * also needs the device's account to have a live health profile with targeting consent (C5)
 * that matches every part given: ORs inside a part (any of the conditions…), ANDs between
 * parts. Lists are validated by the shared schema (each code at most once), so a segment binds
 * at most 51 parameters and a whole statement stays under D1's 100.
 */
import type { NewsAudience } from '@smartstack/shared'

export interface SqlFragment {
  /** Uses anonymous `?` placeholders: `params` are in textual order. */
  sql: string
  params: (string | number)[]
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/** A JSON array column, read as '[]' when it isn't valid JSON (json_each would throw). */
function jsonArray(column: string): string {
  return `CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END`
}

/**
 * The device filter for a query over `users u`. `year` is the current year in Toronto: an age is
 * "this year minus the year of birth", so ageMin..ageMax is birth_year in
 * [year − ageMax, year − ageMin]; a profile without a year of birth never matches an age range.
 */
export function audienceFilter(audience: NewsAudience, year: number): SqlFragment {
  if (audience.type === 'all') return { sql: 'u.news_opt_in = 1', params: [] }

  const where = [
    'hp.account_id = u.account_id',
    'hp.deleted_at IS NULL',
    'hp.targeting_consent_at IS NOT NULL',
  ]
  const params: (string | number)[] = []
  const anyOf = (column: string, values: readonly string[] | undefined) => {
    if (!values?.length) return
    where.push(
      `EXISTS (SELECT 1 FROM json_each(${jsonArray(column)}) AS je WHERE je.value IN (${placeholders(values.length)}))`,
    )
    params.push(...values)
  }
  const oneOf = (column: string, values: readonly string[] | undefined) => {
    if (!values?.length) return
    where.push(`${column} IN (${placeholders(values.length)})`)
    params.push(...values)
  }

  anyOf('hp.conditions', audience.conditions)
  anyOf('hp.goals', audience.goals)
  oneOf('hp.gender', audience.genders)
  oneOf('hp.pregnancy', audience.pregnancy)
  if (audience.ageMax !== undefined) {
    where.push('hp.birth_year >= ?')
    params.push(year - audience.ageMax)
  }
  if (audience.ageMin !== undefined) {
    where.push('hp.birth_year <= ?')
    params.push(year - audience.ageMin)
  }

  return {
    sql: `u.news_opt_in = 1 AND u.account_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM health_profiles hp WHERE ${where.join(' AND ')})`,
    params,
  }
}

/** Migration 0004 (health profiles) isn't applied yet: segments can't be counted or sent. */
export function isMissingHealthProfiles(err: unknown): boolean {
  return err instanceof Error && /no such table: health_profiles/i.test(err.message)
}
