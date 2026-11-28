import { createClient } from 'npm:@supabase/supabase-js@2'
import { changeOwnPassword } from '../_shared/admin-users.ts'
import { cors, json, supabaseStore } from '../_shared/supabase-store.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: me } = await caller.rpc('get_me')
  if (!me) return json({ error: 'FORBIDDEN' }, 403)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  try {
    const { password } = await req.json()
    const store = supabaseStore(admin, caller, me.id)
    return json(await changeOwnPassword(store, Deno.env.get('PASSWORD_KEY')!, me.id, password))
  } catch (error) {
    return json({ error: (error as Error).message }, 400)
  }
})
