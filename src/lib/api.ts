import { createClient } from '@supabase/supabase-js'
import { noteApiError } from './errorReport'

const url = import.meta.env.VITE_SUPABASE_URL ?? (import.meta.env.DEV ? 'http://localhost:54321' : '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? (import.meta.env.DEV ? 'local' : '')

if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')

export const supabase = createClient(url, anonKey)

export class ApiError extends Error {}

export const NETWORK_ERROR = 'NETWORK'

const REQUEST_TIMEOUT_MS = 25_000

const isConnectionProblem = (message: string) =>
  /failed to fetch|load failed|network|timeout|aborted/i.test(message)

function withTimeout<T>(work: PromiseLike<T>) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(NETWORK_ERROR)), REQUEST_TIMEOUT_MS)
    Promise.resolve(work).then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

function failure(fn: string, args: unknown, raw: string, extra?: Record<string, unknown>) {
  const network = isConnectionProblem(raw)
  const error = new ApiError(network ? NETWORK_ERROR : raw)
  noteApiError({ fn, args, message: raw, network, extra, error })
  return error
}

const timedOut = (fn: string, args: unknown, error: unknown) =>
  error instanceof ApiError && error.message === NETWORK_ERROR
    ? failure(fn, args, 'No answer within 25 seconds (timeout)')
    : error

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await withTimeout(supabase.rpc(fn, args)).catch((problem) => {
    throw timedOut(fn, args, problem)
  })
  if (error) {
    throw failure(fn, args, error.message, { code: error.code, details: error.details, hint: error.hint })
  }
  return data as T
}

async function callFunction<T>(name: string, body: Record<string, unknown>) {
  const fn = `${name}${typeof body.action === 'string' ? `:${body.action}` : ''}`
  const { data, error } = await withTimeout(supabase.functions.invoke(name, { body })).catch((problem) => {
    throw timedOut(fn, body, problem)
  })
  if (error) {
    const response = (error as { context?: Response }).context
    const details = await response?.json?.().catch(() => null)
    throw failure(fn, body, details?.error ?? error.message, { status: response?.status })
  }
  return data as T
}

export const adminUsers = <T>(body: Record<string, unknown>) => callFunction<T>('admin-users', body)

export const changePassword = (password: string) => callFunction('account', { password })

export const authEmail = (login: string) => {
  const value = login.trim().toLowerCase()
  return value.includes('@') ? value : `${value}@opus.internal`
}
