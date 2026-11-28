import { DEFAULT_STRINGS } from './strings'

export type ProblemKind = 'server' | 'crash' | 'network'

export interface Problem {
  kind: ProblemKind
  message: string
  fn: string
  path: string
  details: Record<string, unknown>
}

export interface QueuedProblem extends Problem {
  at: string
  repeats: number
  uid: string | null
}

export type SendResult = 'ok' | 'retry' | 'drop'

type Store = Pick<Storage, 'getItem' | 'setItem'>

declare const __APP_BUILD__: string

const QUEUE_KEY = 'opus-error-queue'
const MAX_QUEUE = 30
const KEEP_MS = 3 * 24 * 60 * 60 * 1000
const SEND_DELAY_MS = 3000
const SEND_TIMEOUT_MS = 15_000
const OUTAGE_GAP_MS = 10_000
const MAX_OUTAGE_REQUESTS = 20

const RULE_CODE = /^[A-Z][A-Z0-9_]*$/
const SECRET = /pass|token|secret/i
const IGNORED_CRASH = /ResizeObserver loop|^Script error\.?$|dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function apiProblemKind(message: string, network: boolean): ProblemKind | null {
  if (network) return 'network'
  if (RULE_CODE.test(message) && `error.${message}` in DEFAULT_STRINGS) return null
  return 'server'
}

export function cleanArgs(args: unknown): unknown {
  try {
    const text = JSON.stringify(args, (key, value) => {
      if (key && SECRET.test(key)) return '[hidden]'
      if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`
      return value
    })
    if (text === undefined) return null
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : JSON.parse(text)
  } catch {
    return '[could not read]'
  }
}

export function crashMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

const sameProblem = (a: QueuedProblem, b: Problem, uid: string | null) =>
  a.uid === uid && a.kind === b.kind && a.fn === b.fn && a.path === b.path && a.message === b.message

export function createReporter({ send, storage, now = Date.now }: {
  send: (items: Omit<QueuedProblem, 'uid'>[]) => Promise<SendResult>
  storage?: Store
  now?: () => number
}) {
  let uid: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let sending = false
  let leaving = false
  let outage: { lastAt: number; uid: string | null; item: QueuedProblem } | null = null
  let queue = load()

  function load(): QueuedProblem[] {
    try {
      const items = JSON.parse(storage?.getItem(QUEUE_KEY) ?? '[]')
      if (!Array.isArray(items)) return []
      return items.filter((item) => now() - Date.parse(item.at) < KEEP_MS)
    } catch {
      return []
    }
  }

  function save() {
    try {
      storage?.setItem(QUEUE_KEY, JSON.stringify(queue))
    } catch {
    }
  }

  function schedule(delay = SEND_DELAY_MS) {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, delay)
  }

  function sameOutage(problem: Problem, at: number) {
    if (problem.kind !== 'network') return false
    const current = outage
    if (!current || current.uid !== uid || at - current.lastAt >= OUTAGE_GAP_MS) return false
    current.lastAt = at
    if (queue.includes(current.item)) {
      current.item.repeats += 1
      const requests = current.item.details.requests
      if (Array.isArray(requests) && requests.length < MAX_OUTAGE_REQUESTS && !requests.includes(problem.fn)) {
        requests.push(problem.fn)
      }
      save()
    }
    return true
  }

  function add(problem: Problem) {
    if (problem.kind === 'network' && leaving) return
    const at = now()
    if (sameOutage(problem, at)) return
    const same = queue.find((item) => sameProblem(item, problem, uid))
    if (same) {
      same.repeats += 1
      same.details = problem.details
    } else {
      const details = problem.kind === 'network' ? { ...problem.details, requests: [problem.fn] } : problem.details
      const item: QueuedProblem = { ...problem, details, at: new Date(at).toISOString(), repeats: 1, uid }
      queue.push(item)
      queue = queue.slice(-MAX_QUEUE)
      if (problem.kind === 'network') outage = { lastAt: at, uid, item }
    }
    save()
    schedule()
  }

  function setLeaving(value: boolean) {
    leaving = value
  }

  async function flush() {
    if (sending || !uid) return
    const mine = queue.filter((item) => item.uid === uid || item.uid === null)
    if (mine.length === 0) return
    sending = true
    queue = queue.filter((item) => !mine.includes(item))
    save()
    let result: SendResult = 'retry'
    try {
      result = await Promise.race([
        send(mine.map(({ uid: _uid, ...item }) => item)),
        new Promise<SendResult>((resolve) => setTimeout(() => resolve('retry'), SEND_TIMEOUT_MS)),
      ])
    } catch {
      result = 'retry'
    } finally {
      sending = false
    }
    if (result === 'retry') {
      queue = [...mine, ...queue].slice(-MAX_QUEUE)
      save()
    }
  }

  function setUser(id: string | null) {
    uid = id
    if (id) schedule(1000)
  }

  return { add, flush, setUser, setLeaving, pending: () => queue }
}

type Reporter = ReturnType<typeof createReporter>

let active: Reporter | null = null
const reported = new WeakSet<object>()

export function setReporter(reporter: Reporter | null) {
  active = reporter
}

function device(): Record<string, unknown> {
  try {
    return {
      page: location.pathname + location.search,
      online: navigator.onLine,
      installed: matchMedia('(display-mode: standalone)').matches,
      screen: `${innerWidth}x${innerHeight}`,
      browser: navigator.userAgent,
      build: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev',
    }
  } catch {
    return {}
  }
}

export function noteApiError({ fn, args, message, network, extra, error }: {
  fn: string
  args: unknown
  message: string
  network: boolean
  extra?: Record<string, unknown>
  error?: object
}) {
  if (error) reported.add(error)
  if (!active) return
  const kind = apiProblemKind(message, network)
  if (!kind) return
  active.add({
    kind, message, fn, path: location.pathname, details: { args: cleanArgs(args), ...extra, ...device() },
  })
}

export function noteCrash(error: unknown, extra: Record<string, unknown> = {}) {
  if (!active) return
  if (typeof error === 'object' && error !== null && reported.has(error)) return
  if (error instanceof Error && error.name === 'AbortError') return
  const message = crashMessage(error)
  if (IGNORED_CRASH.test(message)) return
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, 4000) : undefined
  active.add({
    kind: 'crash',
    message: message.slice(0, 500),
    fn: '',
    path: location.pathname,
    details: { stack, ...extra, ...device() },
  })
}
