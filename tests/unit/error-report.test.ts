import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiProblemKind, cleanArgs, createReporter, type Problem, type SendResult } from '../../src/lib/errorReport'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

const problem = (message = 'relation "x" does not exist'): Problem => ({
  kind: 'server', message, fn: 'book_lesson', path: '/book', details: {},
})

describe('apiProblemKind', () => {
  it('leaves rule answers out', () => {
    expect(apiProblemKind('SLOT_UNAVAILABLE', false)).toBeNull()
    expect(apiProblemKind('FORBIDDEN', false)).toBeNull()
    expect(apiProblemKind('USER_NOT_FOUND', false)).toBeNull()
  })

  it('reports a code the reader saw only as "Something went wrong"', () => {
    expect(apiProblemKind('BOOKING_NOT_FOUND', false)).toBe('server')
  })

  it('reports unexpected answers and lost connections', () => {
    expect(apiProblemKind('JWT expired', false)).toBe('server')
    expect(apiProblemKind('TypeError: Failed to fetch', true)).toBe('network')
  })
})

describe('cleanArgs', () => {
  it('hides passwords and tokens and shortens long values', () => {
    const cleaned = cleanArgs({ password: 'secret1', nested: { access_token: 'abc' }, logo: 'x'.repeat(500) }) as {
      password: string; nested: { access_token: string }; logo: string
    }
    expect(cleaned.password).toBe('[hidden]')
    expect(cleaned.nested.access_token).toBe('[hidden]')
    expect(cleaned.logo).toHaveLength(301)
  })
})

describe('createReporter', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('waits for a signed-in person, then sends repeats as one item', async () => {
    const send = vi.fn(async () => 'ok' as SendResult)
    const reporter = createReporter({ send, storage: memoryStorage() })
    reporter.add(problem())
    reporter.add(problem())
    await reporter.flush()
    expect(send).not.toHaveBeenCalled()

    reporter.setUser('u1')
    await reporter.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual([expect.objectContaining({ repeats: 2, fn: 'book_lesson' })])
    expect(reporter.pending()).toEqual([])
  })

  it('keeps problems while offline and after a reload', async () => {
    const storage = memoryStorage()
    const offline = createReporter({ send: async () => 'retry', storage })
    offline.setUser('u1')
    offline.add(problem())
    await offline.flush()
    expect(offline.pending()).toHaveLength(1)

    const send = vi.fn(async () => 'ok' as SendResult)
    const reloaded = createReporter({ send, storage })
    reloaded.setUser('u1')
    await reloaded.flush()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("never sends one person's problems as someone else's", async () => {
    const send = vi.fn(async () => 'ok' as SendResult)
    const reporter = createReporter({ send, storage: memoryStorage() })
    reporter.setUser('u1')
    reporter.add(problem('first'))
    reporter.setUser('u2')
    await reporter.flush()
    expect(send).not.toHaveBeenCalled()
    reporter.setUser('u1')
    await reporter.flush()
    expect(send).toHaveBeenCalledTimes(1)
  })

  const lost = (fn: string): Problem => ({
    kind: 'network', message: 'TypeError: Failed to fetch', fn, path: '/admin/bookings', details: {},
  })

  it('counts one lost connection once, however many requests it cut off', async () => {
    let clock = 1_000_000
    const send = vi.fn(async () => 'ok' as SendResult)
    const reporter = createReporter({ send, storage: memoryStorage(), now: () => clock })
    reporter.setUser('u1')
    for (const fn of ['admin_bookings', 'admin_error_count', 'get_me', 'get_public_config', 'admin_list_users']) {
      reporter.add(lost(fn))
    }
    expect(reporter.pending()).toHaveLength(1)
    expect(reporter.pending()[0]).toMatchObject({
      fn: 'admin_bookings', repeats: 5,
      details: { requests: ['admin_bookings', 'admin_error_count', 'get_me', 'get_public_config', 'admin_list_users'] },
    })
    await reporter.flush()
    expect(send).toHaveBeenCalledTimes(1)

    clock += 5_000
    reporter.add(lost('admin_bookings'))
    expect(reporter.pending()).toEqual([])

    clock += 60_000
    reporter.add(lost('get_me'))
    expect(reporter.pending()).toHaveLength(1)
  })

  it('leaves out requests cut off by leaving or reloading the page', () => {
    const reporter = createReporter({ send: async () => 'ok', storage: memoryStorage() })
    reporter.setLeaving(true)
    reporter.add(lost('get_me'))
    reporter.add(problem())
    expect(reporter.pending()).toEqual([expect.objectContaining({ kind: 'server' })])

    reporter.setLeaving(false)
    reporter.add(lost('get_me'))
    expect(reporter.pending()).toHaveLength(2)
  })

  it('drops what the server refuses, and keeps at most 30', async () => {
    const reporter = createReporter({ send: async () => 'drop', storage: memoryStorage() })
    for (let i = 0; i < 40; i += 1) reporter.add(problem(`problem ${i}`))
    expect(reporter.pending()).toHaveLength(30)
    reporter.setUser('u1')
    await reporter.flush()
    expect(reporter.pending()).toEqual([])
  })
})
