import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminUsers, authEmail, rpc, supabase } from '../lib/api'
import { disablePush } from '../lib/push'
import type { Me } from '../lib/types'

export type SignInResult = 'ok' | 'wrong' | 'busy' | 'network'

interface AuthState {
  me: Me | null
  loading: boolean
  signIn: (login: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const ADMIN_SESSION = 'opus-admin-session'

export const isImpersonating = () => localStorage.getItem(ADMIN_SESSION) !== null

export async function signInAs(userId: string) {
  const { data } = await supabase.auth.getSession()
  const { token } = await adminUsers<{ token: string }>({ action: 'impersonate', user_id: userId })
  localStorage.setItem(ADMIN_SESSION, JSON.stringify({
    access_token: data.session!.access_token,
    refresh_token: data.session!.refresh_token,
  }))
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
  if (error) {
    localStorage.removeItem(ADMIN_SESSION)
    throw error
  }
  location.assign('/')
}

export async function returnToAdmin() {
  const saved = localStorage.getItem(ADMIN_SESSION)
  localStorage.removeItem(ADMIN_SESSION)
  const { error } = saved
    ? await supabase.auth.setSession(JSON.parse(saved))
    : { error: new Error('No admin session') }
  if (error) await supabase.auth.signOut()
  location.assign(error ? '/' : '/admin')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    const fallback = setTimeout(() => setSession((current) => (current === undefined ? null : current)), 8000)
    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(fallback)
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const { data: me, isPending, isSuccess } = useQuery({
    queryKey: ['me', userId],
    queryFn: () => rpc<Me | null>('get_me'),
    enabled: Boolean(userId),
    refetchInterval: 20_000,
  })

  useEffect(() => {
    if (userId && isSuccess && !me) supabase.auth.signOut()
  }, [userId, isSuccess, me])

  const value = useMemo<AuthState>(() => ({
    me: userId ? me ?? null : null,
    loading: session === undefined || (Boolean(userId) && isPending),
    async signIn(login, password) {
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail(login),
          password,
        })
        if (!error) return 'ok'
        if (error.status === 429) return 'busy'
        return error.status === 400 ? 'wrong' : 'network'
      } catch {
        return 'network'
      }
    },
    async signOut() {
      if (isImpersonating()) return returnToAdmin()
      await disablePush()
      await supabase.auth.signOut()
      queryClient.clear()
    },
  }), [me, userId, session, isPending, queryClient])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth needs AuthProvider')
  return value
}

export function useMe() {
  const { me } = useAuth()
  if (!me) throw new Error('useMe needs a signed-in user')
  return me
}
