import { SyncRequest, type SyncChanges } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import {
  CHECKS_TABLE,
  PRODUCTS_TABLE,
  STACK_TABLE,
  checkFromRow,
  checkParam,
  checksCutoffDay,
  declaredTooLarge,
  describeIssues,
  limitViolations,
  liveCountAfter,
  productParam,
  rawRowCount,
  readStatement,
  settingsReadStatement,
  settingsUpsertStatement,
  stackFromRow,
  stackParam,
  syncCleanupStatements,
  syncParams,
  syncPlan,
  tablesToCheck,
  upsertStatement,
  type LimitRow,
  type StackItemRow,
} from './sync'

const ACCOUNT = 'acc-1'
const T = Date.UTC(2026, 9, 5, 12, 0, 0)

function changes(input: unknown): SyncChanges {
  return SyncRequest.parse({ since: 0, changes: input }).changes
}

const stackLive = {
  productId: 'magnesium',
  dosesPerDay: 2,
  pins: ['bedtime', null],
  inventory: { remaining: 60, unit: 'unit', packageSize: 90, lowFlaggedAt: null },
  addedAt: T,
  updatedAt: T,
}

describe('upsert statements (§8.2)', () => {
  it('binds every row of a table as ONE JSON parameter read with json_each', () => {
    const rows = [stackParam(changes({ stack: [stackLive] }).stack[0]!)]
    const s = upsertStatement(STACK_TABLE, ACCOUNT, rows)
    expect(s.params).toEqual([ACCOUNT, JSON.stringify(rows)])
    expect(s.sql).toContain('FROM json_each(?2) WHERE true')
    expect(s.sql).toContain(`json_extract(value, '$.product_id')`)
    expect(s.sql).toContain('ON CONFLICT (account_id, product_id) DO UPDATE SET')
    // Every data column is overwritten, and the row takes the account's (bumped) revision.
    for (const column of STACK_TABLE.data) expect(s.sql).toContain(`${column} = excluded.${column}`)
    expect(s.sql).toContain('rev = excluded.rev')
    expect(s.sql).toContain('(SELECT rev FROM accounts WHERE id = ?1)')
  })

  it('writes only a strictly newer row: on a tie the server keeps its copy', () => {
    const s = upsertStatement(STACK_TABLE, ACCOUNT, [])
    expect(s.sql).toMatch(/WHERE excluded\.updated_at > stack_items\.updated_at$/)
    expect(s.sql).not.toMatch(/>=/)
  })

  it("never lets an account overwrite another account's product (id is the whole key)", () => {
    const s = upsertStatement(PRODUCTS_TABLE, ACCOUNT, [])
    expect(s.sql).toContain('ON CONFLICT (id) DO UPDATE SET')
    expect(s.sql).toContain(
      'WHERE excluded.updated_at > user_products.updated_at AND user_products.account_id = excluded.account_id',
    )
  })

  it('stays far below 100 bound parameters and 50 queries', () => {
    const all = changes({
      settings: { routine: null, tz: 'UTC', locale: 'en', theme: 'rooted', updatedAt: T },
      stack: [stackLive],
      shopping: [{ productId: 'iron', reason: 'manual', addedAt: T, updatedAt: T }],
      checks: [{ day: '2026-10-05', productId: 'iron', doseIndex: 0, units: 1, updatedAt: T }],
      products: [{ id: 'u_0f8fad5b-d9cb-469f-a165-70867728950e', updatedAt: T, deletedAt: T }],
    })
    const plan = syncPlan(ACCOUNT, 4, syncParams(all))
    // bump + 5 upserts + 5 reads
    expect(plan.statements).toHaveLength(11)
    expect(plan.firstRead).toBe(6)
    expect(plan.statements[0]!.sql).toBe(
      'UPDATE accounts SET rev = rev + 1 WHERE id = ?1 RETURNING rev',
    )
    for (const s of plan.statements) {
      expect(s.params.length).toBeLessThanOrEqual(6)
      expect(s.params[0]).toBe(ACCOUNT)
    }
  })

  it('reads the settings with seven parameters, the routine as JSON text', () => {
    const settings = changes({
      settings: {
        routine: {
          wake: '06:30',
          bedtime: '22:30',
          coffee: null,
          breakfast: '07:00',
          lunch: null,
          dinner: null,
          exercise: null,
        },
        tz: 'America/Toronto',
        locale: 'fr',
        theme: 'wild',
        updatedAt: T,
      },
    }).settings!
    const s = settingsUpsertStatement(ACCOUNT, settings)
    expect(s.params).toEqual([
      ACCOUNT,
      JSON.stringify(settings.routine),
      'America/Toronto',
      'fr',
      'wild',
      T,
    ])
    expect(s.sql).toMatch(/WHERE excluded\.updated_at > account_settings\.updated_at$/)
  })
})

describe('pull (empty changes)', () => {
  it('reads the revision and every table, without writing', () => {
    const plan = syncPlan(ACCOUNT, 7, syncParams(changes({})))
    expect(plan.statements).toHaveLength(6)
    expect(plan.firstRead).toBe(1)
    expect(plan.statements[0]).toEqual({
      sql: 'SELECT rev FROM accounts WHERE id = ?1',
      params: [ACCOUNT],
    })
    for (const s of plan.statements) expect(s.sql).not.toMatch(/INSERT|UPDATE|DELETE/)
    expect(plan.statements[1]).toEqual(settingsReadStatement(ACCOUNT, 7, false))
    expect(plan.statements[3]!.sql).toMatch(/WHERE account_id = \?1 AND rev > \?2 ORDER BY rev$/)
    expect(plan.statements[3]!.params).toEqual([ACCOUNT, 7])
  })
})

describe('reads after a push', () => {
  it("answer newer rows, and the server's copy of a pushed key only when the push lost", () => {
    const rows = changes({
      checks: [
        { day: '2026-10-05', productId: 'iron', doseIndex: 1, units: 1, updatedAt: T },
        { day: '2026-10-05', productId: 'zinc', doseIndex: 0, updatedAt: T, deletedAt: T },
      ],
    }).checks.map(checkParam)
    const s = readStatement(CHECKS_TABLE, ACCOUNT, 3, rows)
    expect(s.params).toEqual([
      ACCOUNT,
      3,
      JSON.stringify([
        ['2026-10-05', 'iron', 1],
        ['2026-10-05', 'zinc', 0],
      ]),
    ])
    expect(s.sql).toContain(
      `CASE WHEN (day, product_id, dose_index) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?3))`,
    )
    // A pushed key that took the new revision won: it isn't echoed.
    expect(s.sql).toContain(
      'THEN rev <> (SELECT rev FROM accounts WHERE id = ?1) ELSE rev > ?2 END',
    )
    expect(settingsReadStatement(ACCOUNT, 3, true)).toEqual({
      sql: expect.stringMatching(
        /AND rev <> \(SELECT rev FROM accounts WHERE id = \?1\)$/,
      ) as string,
      params: [ACCOUNT],
    })
  })
})

describe('tombstones', () => {
  it('keep only the key and timestamps; the rest becomes neutral placeholders', () => {
    const tomb = changes({ stack: [{ ...stackLive, updatedAt: T + 1, deletedAt: T + 1 }] })
      .stack[0]!
    expect(stackParam(tomb)).toEqual({
      product_id: 'magnesium',
      doses_per_day: 1,
      pins: [],
      dismissed: [],
      units_per_dose: null,
      variant_upc: null,
      inv_remaining: null,
      inv_unit: null,
      inv_package_size: null,
      low_flagged_at: null,
      added_at: 0,
      updated_at: T + 1,
      deleted_at: T + 1,
    })
    const product = productParam({
      id: 'u_0f8fad5b-d9cb-469f-a165-70867728950e',
      updatedAt: T,
      deletedAt: T,
    })
    expect(product).toMatchObject({ name: '', brand: null, din: null, notes: null, deleted_at: T })
    // The placeholders satisfy the table's CHECK constraints.
    expect(product).toMatchObject({ product_type: 'other', form: 'other', units_per_dose: 1 })
    expect(
      checkParam({ day: '2026-10-05', productId: 'iron', doseIndex: 0, updatedAt: T, deletedAt: T })
        .units,
    ).toBe(0)
  })

  it('come back as key + timestamps; live rows as the device stores them', () => {
    const row: StackItemRow = {
      product_id: 'magnesium',
      doses_per_day: 2,
      pins: '["bedtime",null]',
      dismissed: '[]',
      units_per_dose: null,
      variant_upc: null,
      inv_remaining: 60,
      inv_unit: 'unit',
      inv_package_size: 90,
      low_flagged_at: null,
      added_at: T,
      updated_at: T,
      deleted_at: null,
      rev: 1,
    }
    // No unitsPerDose / variantUpc keys at all (StackEntry's optional fields are never null).
    expect(stackFromRow(row)).toEqual({ ...stackLive, dismissed: [], deletedAt: null })
    expect(stackFromRow({ ...row, deleted_at: T + 5 })).toEqual({
      productId: 'magnesium',
      updatedAt: T,
      deletedAt: T + 5,
    })
    expect(
      checkFromRow({
        day: '2026-10-05',
        product_id: 'iron',
        dose_index: 0,
        units: 0,
        updated_at: T,
        deleted_at: T,
        rev: 2,
      }),
    ).toEqual({ day: '2026-10-05', productId: 'iron', doseIndex: 0, updatedAt: T, deletedAt: T })
  })
})

describe('request limits', () => {
  it('counts raw rows before validation (413 above 500)', () => {
    expect(rawRowCount(null)).toBe(0)
    expect(rawRowCount({ since: 0 })).toBe(0)
    expect(
      rawRowCount({ changes: { settings: {}, stack: [1, 2], checks: 'x', products: [3] } }),
    ).toBe(4)
    expect(rawRowCount({ changes: { checks: new Array(501).fill({}) } })).toBe(501)
  })

  it('refuses a declared body over 512 KB before reading it', () => {
    expect(declaredTooLarge(undefined, 512)).toBe(false)
    expect(declaredTooLarge('512', 512)).toBe(false)
    expect(declaredTooLarge('513', 512)).toBe(true)
    expect(declaredTooLarge('abc', 512)).toBe(true)
  })

  it('describes validation errors as path: message, at most 20 lines', () => {
    const parsed = SyncRequest.safeParse({
      since: 0,
      changes: { stack: [{ productId: 'iron', dosesPerDay: 9, addedAt: T, updatedAt: T }] },
    })
    expect(parsed.success).toBe(false)
    expect(describeIssues(parsed.error!.issues)).toEqual([
      'changes.stack.0.dosesPerDay: Too big: expected number to be <=4',
    ])
    const many = SyncRequest.safeParse({ since: 0, changes: { checks: new Array(50).fill({}) } })
    expect(describeIssues(many.error!.issues)).toHaveLength(20)
  })

  it('lists both options of a live-or-tombstone entity when zod cannot tell which was meant', () => {
    const lines = describeIssues([
      {
        code: 'invalid_union',
        path: ['changes', 'checks', 0],
        message: 'Invalid input',
        errors: [
          [{ code: 'invalid_type', path: ['units'], message: 'Required' }],
          [{ code: 'invalid_type', path: ['deletedAt'], message: 'Expected number' }],
        ],
      },
    ])
    expect(lines).toEqual([
      '(live) changes.checks.0.units: Required',
      '(tombstone) changes.checks.0.deletedAt: Expected number',
    ])
  })
})

describe('per-account limits (200 products, 60 stack items)', () => {
  const server = (n: number, deleted = 0): LimitRow[] => [
    ...Array.from({ length: n }, (_, i) => ({ key: `p${i}`, updated_at: T, deleted_at: null })),
    ...Array.from({ length: deleted }, (_, i) => ({ key: `d${i}`, updated_at: T, deleted_at: T })),
  ]
  const live = (key: string, at = T + 1) => ({ key, updatedAt: at, deletedAt: null })
  const gone = (key: string, at = T + 1) => ({ key, updatedAt: at, deletedAt: at })

  it('applies the push by last-write-wins before counting', () => {
    expect(liveCountAfter(server(60), [])).toBe(60)
    expect(liveCountAfter(server(60), [live('new')])).toBe(61)
    expect(liveCountAfter(server(60), [live('p0')])).toBe(60) // an edit
    expect(liveCountAfter(server(60), [gone('p0'), live('new')])).toBe(60)
    expect(liveCountAfter(server(60), [gone('p0', T), live('new')])).toBe(61) // tie: server wins
    expect(liveCountAfter(server(0, 1), [live('d0', T)])).toBe(0) // older than the tombstone
    expect(liveCountAfter(server(0, 1), [live('d0', T + 1)])).toBe(1) // newer: brought back
  })

  it('only checks a table the push adds live rows to', () => {
    expect(tablesToCheck(changes({}))).toEqual([])
    expect(
      tablesToCheck(changes({ stack: [{ productId: 'x', updatedAt: T, deletedAt: T }] })),
    ).toEqual([])
    expect(tablesToCheck(changes({ stack: [stackLive] })).map((t) => t.entity)).toEqual(['stack'])
  })

  it('reports the tables over their limit', () => {
    const push = changes({ stack: [{ ...stackLive, productId: 'new', updatedAt: T + 1 }] })
    const rows = (n: number) =>
      new Map([['stack' as const, server(n).map((r) => ({ ...r, key: `s${r.key}` }))]])
    expect(limitViolations(push, rows(59))).toEqual([])
    expect(limitViolations(push, rows(60))).toEqual(['stack: at most 60 per account'])
  })
})

describe('daily cleanup (§8.6)', () => {
  it('keeps 3 days of check marks before the earliest local date on Earth', () => {
    // 03:00 UTC on Oct 5: it is still Oct 4 at UTC−12, so Oct 1–4 stay in every time zone.
    expect(checksCutoffDay(Date.UTC(2026, 9, 5, 3, 0))).toBe('2026-10-01')
    expect(checksCutoffDay(Date.UTC(2026, 9, 5, 11, 59))).toBe('2026-10-01')
    expect(checksCutoffDay(Date.UTC(2026, 9, 5, 12, 0))).toBe('2026-10-02')
    expect(checksCutoffDay(Date.UTC(2026, 2, 3, 3, 0))).toBe('2026-02-27') // month boundary
  })

  it('deletes old check marks and 30-day-old tombstones in the other synced tables', () => {
    const now = Date.UTC(2026, 9, 5, 3, 0)
    const [checks, ...tombstones] = syncCleanupStatements(now)
    expect(checks).toEqual({
      sql: 'DELETE FROM dose_checks WHERE day < ?1',
      params: ['2026-10-01'],
    })
    expect(tombstones.map((s) => s.sql)).toEqual([
      'DELETE FROM user_products WHERE deleted_at IS NOT NULL AND deleted_at < ?1',
      'DELETE FROM stack_items WHERE deleted_at IS NOT NULL AND deleted_at < ?1',
      'DELETE FROM shopping_items WHERE deleted_at IS NOT NULL AND deleted_at < ?1',
    ])
    for (const s of tombstones) expect(s.params).toEqual([now - 30 * 24 * 3600_000])
  })
})
