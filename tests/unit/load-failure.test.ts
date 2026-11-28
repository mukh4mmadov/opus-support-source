import { describe, expect, it, vi } from 'vitest'
import { isLoadFailure, reloadOnce } from '../../src/lib/loadFailure'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe('isLoadFailure', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://site/assets/admin.js',
    'error loading dynamically imported module: https://site/assets/admin.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/admin.css',
  ])('recognises %s', (message) => {
    expect(isLoadFailure(new Error(message))).toBe(true)
  })

  it('leaves ordinary crashes alone', () => {
    expect(isLoadFailure(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isLoadFailure('Failed to fetch dynamically imported module')).toBe(false)
  })
})

describe('reloadOnce', () => {
  it('reloads the first time and not again straight after', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    reloadOnce(storage, 100_000, reload)
    reloadOnce(storage, 110_000, reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads again once enough time has passed', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    reloadOnce(storage, 100_000, reload)
    reloadOnce(storage, 131_000, reload)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload when it cannot remember doing so', () => {
    const reload = vi.fn()
    const blocked = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    reloadOnce(blocked, 100_000, reload)
    expect(reload).not.toHaveBeenCalled()
  })
})
