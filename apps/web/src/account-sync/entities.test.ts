import type { SyncResponse } from '@smartstack/shared'
import { describe, expect, it } from 'vitest'
import { accountReducer } from '../state/accountReducer'
import { defaultState, type PersistedState } from '../storage'
import {
  afterSync,
  applyRemote,
  buildChanges,
  buildPushes,
  dropLocalData,
  hasLocalData,
  markChanges,
  queueEverything,
  remoteHasData,
} from './entities'

const T = 1_759_000_000_000
const ROUTINE = {
  wake: '07:00',
  bedtime: '22:00',
  coffee: null,
  breakfast: '08:00',
  lunch: null,
  dinner: '18:00',
  exercise: null,
} as const

function account(): PersistedState {
  const s = defaultState('00000000-0000-4000-8000-000000000000', T)
  return {
    ...s,
    auth: {
      mode: 'account',
      accountId: 'acc-1',
      email: 'a@example.com',
      name: null,
      role: 'user',
      emailVerified: true,
      providers: ['password'],
      consentNeeded: false,
    },
    sync: { ...s.sync, initialized: true },
  }
}

const empty = (rev: number, changes: Partial<SyncResponse['changes']> = {}): SyncResponse => ({
  rev,
  changes: { settings: null, products: [], stack: [], shopping: [], checks: [], ...changes },
})

describe('markChanges', () => {
  it('queues nothing for guests', () => {
    const guest = { ...defaultState(), auth: { ...defaultState().auth, mode: 'guest' as const } }
    const next = accountReducer(guest, { type: 'SET_ROUTINE', routine: ROUTINE })
    expect(next.sync.outbox).toEqual([])
  })

  it('queues settings, stack entries and check marks of an account', () => {
    let s = accountReducer(account(), { type: 'SET_ROUTINE', routine: ROUTINE })
    s = accountReducer(s, {
      type: 'ADD_PRODUCT',
      productId: 'iron-bisglycinate',
      dosesPerDay: 1,
      at: T,
    })
    s = accountReducer(s, {
      type: 'TOGGLE_CHECK',
      date: '2026-09-29',
      productId: 'iron-bisglycinate',
      doseIndex: 0,
      at: T + 5,
    })
    expect(new Set(s.sync.outbox)).toEqual(
      new Set(['settings', 'stack:iron-bisglycinate', 'check:2026-09-29:iron-bisglycinate:0']),
    )
    expect(s.settingsUpdatedAt).toBeGreaterThan(0)
  })

  it('leaves a tombstone for an untick and a removal', () => {
    let s = accountReducer(account(), {
      type: 'ADD_PRODUCT',
      productId: 'multi',
      dosesPerDay: 1,
      at: T,
    })
    const tick = {
      type: 'TOGGLE_CHECK' as const,
      date: '2026-09-29',
      productId: 'multi',
      doseIndex: 0,
      at: T,
    }
    s = accountReducer(accountReducer(s, tick), tick)
    s = accountReducer(s, { type: 'REMOVE_PRODUCT', productId: 'multi' })
    expect(Object.keys(s.tombstones).sort()).toEqual(['check:2026-09-29:multi:0', 'stack:multi'])
    const { changes } = buildChanges(s, s.sync.outbox)
    expect(changes.stack).toEqual([
      {
        productId: 'multi',
        updatedAt: s.tombstones['stack:multi'],
        deletedAt: s.tombstones['stack:multi'],
      },
    ])
    expect(changes.checks?.[0]).toMatchObject({
      day: '2026-09-29',
      productId: 'multi',
      doseIndex: 0,
    })
    expect(changes.checks?.[0]?.deletedAt).not.toBeNull()
  })

  it('makes an edit newer than the copy it came from, even with a clock behind', () => {
    const prev = {
      ...account(),
      stack: [{ productId: 'x', dosesPerDay: 1, addedAt: T, updatedAt: T + 10_000 }],
    }
    const edited = { ...prev, stack: [{ ...prev.stack[0]!, dosesPerDay: 2, updatedAt: T }] }
    const next = markChanges(prev, edited, T)
    expect(next.stack[0]!.updatedAt).toBe(T + 10_001)
  })
})

describe('applyRemote (last write wins)', () => {
  const local = {
    ...account(),
    stack: [{ productId: 'x', dosesPerDay: 1, addedAt: T, updatedAt: T + 10 }],
  }

  it('takes a newer row and ignores an older one', () => {
    const newer = applyRemote(
      local,
      empty(2, {
        stack: [{ productId: 'x', dosesPerDay: 3, addedAt: T, updatedAt: T + 20, deletedAt: null }],
      }).changes,
    )
    expect(newer.stack[0]!.dosesPerDay).toBe(3)
    const older = applyRemote(
      local,
      empty(2, {
        stack: [{ productId: 'x', dosesPerDay: 3, addedAt: T, updatedAt: T + 5, deletedAt: null }],
      }).changes,
    )
    expect(older.stack[0]!.dosesPerDay).toBe(1)
  })

  it('deletes on a newer tombstone, and keeps a local deletion that is newer', () => {
    const deleted = applyRemote(
      local,
      empty(2, { stack: [{ productId: 'x', updatedAt: T + 20, deletedAt: T + 20 }] }).changes,
    )
    expect(deleted.stack).toEqual([])
    const removedHere = { ...local, stack: [], tombstones: { 'stack:x': T + 30 } }
    const stale = applyRemote(
      removedHere,
      empty(2, {
        stack: [{ productId: 'x', dosesPerDay: 3, addedAt: T, updatedAt: T + 20, deletedAt: null }],
      }).changes,
    )
    expect(stale.stack).toEqual([])
    expect(stale.tombstones['stack:x']).toBe(T + 30)
  })

  it('applies settings but keeps the device’s own time zone', () => {
    const s = applyRemote(
      { ...local, tz: 'America/Toronto' },
      empty(2, {
        settings: {
          routine: ROUTINE,
          tz: 'Europe/Paris',
          locale: 'fr',
          theme: 'ice',
          updatedAt: T + 50,
          deletedAt: null,
        },
      }).changes,
    )
    expect([s.routine, s.locale, s.theme, s.tz]).toEqual([ROUTINE, 'fr', 'ice', 'America/Toronto'])
  })
})

describe('afterSync', () => {
  it('clears what was stored as sent, keeps what changed during the request', () => {
    const s = {
      ...account(),
      stack: [
        { productId: 'a', dosesPerDay: 1, addedAt: T, updatedAt: T },
        { productId: 'b', dosesPerDay: 1, addedAt: T, updatedAt: T },
      ],
      sync: { ...account().sync, outbox: ['stack:a', 'stack:b'] },
    }
    const { snapshot } = buildChanges(s, s.sync.outbox)
    // "b" was edited while the request was in flight.
    const during = {
      ...s,
      stack: [s.stack[0]!, { ...s.stack[1]!, dosesPerDay: 2, updatedAt: T + 1 }],
    }
    const done = afterSync(during, snapshot, empty(7), T + 2)
    expect(done.sync.outbox).toEqual(['stack:b'])
    expect(done.sync.rev).toBe(7)
    expect(done.sync.lastSyncAt).toBe(T + 2)
  })

  it('forgets a tombstone once it reached the Worker', () => {
    const s = {
      ...account(),
      tombstones: { 'stack:a': T },
      sync: { ...account().sync, outbox: ['stack:a'] },
    }
    const { snapshot } = buildChanges(s, s.sync.outbox)
    const done = afterSync(s, snapshot, empty(3), T + 1)
    expect(done.tombstones).toEqual({})
    expect(done.sync.outbox).toEqual([])
  })

  it('takes the Worker’s winning copy for a row it refused', () => {
    const s = {
      ...account(),
      stack: [{ productId: 'a', dosesPerDay: 1, addedAt: T, updatedAt: T }],
      sync: { ...account().sync, outbox: ['stack:a'] },
    }
    const { snapshot } = buildChanges(s, s.sync.outbox)
    const lost = empty(4, {
      stack: [{ productId: 'a', dosesPerDay: 4, addedAt: T, updatedAt: T + 100, deletedAt: null }],
    })
    const done = afterSync(s, snapshot, lost, T + 1)
    expect(done.stack[0]!.dosesPerDay).toBe(4)
    expect(done.sync.outbox).toEqual([])
  })
})

describe('pushes and the first sign-in', () => {
  it('splits a big outbox under 500 rows, settings first', () => {
    const stack = Array.from({ length: 620 }, (_, i) => ({
      productId: `p${i}`,
      dosesPerDay: 1,
      addedAt: T,
      updatedAt: T,
    }))
    const s = queueEverything({ ...account(), stack }, T)
    const pushes = buildPushes(s)
    expect(pushes.length).toBe(2)
    expect(pushes[0]!.body.changes?.settings).toBeDefined()
    const rows = pushes.map(
      (p) => (p.body.changes?.stack?.length ?? 0) + (p.body.changes?.settings ? 1 : 0),
    )
    expect(rows.reduce((a, b) => a + b, 0)).toBe(621)
    for (const r of rows) expect(r).toBeLessThanOrEqual(500)
  })

  it('tells an empty account from one with a stack', () => {
    expect(remoteHasData(empty(0))).toBe(false)
    expect(
      remoteHasData(empty(3, { stack: [{ productId: 'x', updatedAt: T, deletedAt: T }] })),
    ).toBe(false)
    expect(
      remoteHasData(
        empty(3, {
          stack: [{ productId: 'x', dosesPerDay: 1, addedAt: T, updatedAt: T, deletedAt: null }],
        }),
      ),
    ).toBe(true)
    expect(hasLocalData(account())).toBe(false)
    expect(hasLocalData({ ...account(), routine: ROUTINE })).toBe(true)
  })

  it('"Use my account’s data" drops the device’s copy but keeps the device', () => {
    const s = {
      ...account(),
      routine: ROUTINE,
      stack: [{ productId: 'x', dosesPerDay: 1, addedAt: T, updatedAt: T }],
    }
    const dropped = dropLocalData(s)
    expect([dropped.routine, dropped.stack, dropped.userId]).toEqual([null, [], s.userId])
  })

  it('starts over when another account signs in on this device', () => {
    const s = { ...account(), sync: { ...account().sync, rev: 9, outbox: ['stack:a'] } }
    const next = accountReducer(s, {
      type: 'SET_ACCOUNT',
      account: {
        id: 'acc-2',
        email: 'b@example.com',
        emailVerified: true,
        name: null,
        locale: 'en',
        role: 'user',
        providers: [],
        hasPassword: true,
        consentNeeded: false,
      },
    })
    expect(next.sync).toMatchObject({ rev: 0, outbox: [], initialized: false })
  })
})
