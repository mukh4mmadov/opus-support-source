import { supabase } from '../lib/api'
import { createReporter, noteCrash, setReporter, type SendResult } from '../lib/errorReport'

const storage = (() => {
  try {
    return localStorage
  } catch {
    return undefined
  }
})()

const reporter = createReporter({
  storage,
  send: async (items): Promise<SendResult> => {
    const { error } = await supabase.rpc('report_client_errors', { p_items: items })
    if (!error) return 'ok'
    return /failed to fetch|load failed|network|timeout|aborted|jwt/i.test(error.message) ? 'retry' : 'drop'
  },
})
setReporter(reporter)

supabase.auth.getSession().then(({ data }) => reporter.setUser(data.session?.user.id ?? null))
supabase.auth.onAuthStateChange((_event, session) => reporter.setUser(session?.user.id ?? null))

addEventListener('beforeunload', () => reporter.setLeaving(true))
addEventListener('pagehide', () => reporter.setLeaving(true))
addEventListener('pageshow', () => reporter.setLeaving(false))

addEventListener('online', () => void reporter.flush())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void reporter.flush()
})

addEventListener('error', (event) => {
  if (event.filename && !event.filename.startsWith(location.origin)) return
  noteCrash(event.error ?? event.message, { source: `${event.filename}:${event.lineno}:${event.colno}` })
})
addEventListener('unhandledrejection', (event) => noteCrash(event.reason, { unhandled: true }))
