import { describe, expect, it } from 'vitest'
import { defaultState, loadState, saveState, STORAGE_KEY } from './storage'

/** A Storage that lives in a Map, enough for load/save. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

describe('persisted theme', () => {
  const saved = {
    ...defaultState(),
    stack: [{ productId: 'sample-iron', dosesPerDay: 1 }],
    theme: 'bold' as const,
  }

  it('round-trips the chosen theme', () => {
    const storage = memoryStorage()
    saveState(saved, storage)
    expect(loadState(storage).theme).toBe('bold')
  })

  it('gives a state saved before themes existed the default, keeping everything else', () => {
    const { theme: _theme, ...legacy } = saved
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(legacy) })
    const loaded = loadState(storage)
    expect(loaded.theme).toBe('rooted')
    expect(loaded.userId).toBe(saved.userId)
    expect(loaded.stack).toEqual(saved.stack)
  })

  it('falls back to the default for an unknown theme instead of resetting the user', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...saved, theme: 'neon' }) })
    const loaded = loadState(storage)
    expect(loaded.theme).toBe('rooted')
    expect(loaded.userId).toBe(saved.userId)
    expect(loaded.stack).toEqual(saved.stack)
  })
})
