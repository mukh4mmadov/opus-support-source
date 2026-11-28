const RELOADED_AT = 'opus-load-failure-reload'
const RELOAD_GAP_MS = 30_000

const LOAD_FAILED = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export const isLoadFailure = (error: unknown) =>
  error instanceof Error && LOAD_FAILED.test(error.message)

export function reloadOnce(storage: Pick<Storage, 'getItem' | 'setItem'>, now: number, reload: () => void) {
  try {
    if (now - Number(storage.getItem(RELOADED_AT)) < RELOAD_GAP_MS) return
    storage.setItem(RELOADED_AT, String(now))
  } catch {
    return
  }
  reload()
}
