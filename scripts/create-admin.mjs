import { createClient } from '@supabase/supabase-js'

const [emailArg, password] = process.argv.slice(2)
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!emailArg?.includes('@') || !password || !url || !serviceKey) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-admin.mjs <email> <password>')
  process.exit(1)
}

const email = emailArg.toLowerCase()
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})
if (error) throw error

const { error: profileError } = await supabase.from('profiles').insert({
  id: data.user.id,
  role: 'admin',
  login: email,
  first_name: 'OPUS',
  last_name: 'Developer',
})
if (profileError) throw profileError

console.log(`Admin ${email} created.`)
