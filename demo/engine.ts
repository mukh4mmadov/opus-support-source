import { PGlite, type Transaction } from '@electric-sql/pglite'
import { authEmail, changeOwnPassword, encryptPassword, handleAdminAction } from '../supabase/functions/_shared/admin-users.ts'
import authStub from '../supabase/tests/auth-stub.sql?raw'

const migrations = import.meta.glob('../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const LOCAL = /\/(?!0004_|0009_)\d{4}_[^/]+\.sql$/
const SET_RETURNING = new Set(['transfer_options'])
const JSON_ARGS = new Set(['p_value', 'p_rows'])
const PASSWORD_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

const db = new PGlite()
const tell = (message: unknown) => postMessage(message)
let wrote = false
let lastQr: string | null = null

const sha = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const hashPassword = async (password: string) => {
  const salt = crypto.randomUUID()
  return `${salt}:${await sha(salt + password)}`
}
const checkPassword = async (password: string, stored: string | null) => {
  const [salt, hash] = (stored ?? ':').split(':')
  return Boolean(salt) && (await sha(salt + password)) === hash
}

async function callAs(userId: string | null, fn: string, args: Record<string, unknown> = {}) {
  const names = Object.keys(args)
  if (!/^\w+$/.test(fn) || names.some((n) => !/^\w+$/.test(n))) throw new Error('Bad call')
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ')
  return db.transaction(async (tx: Transaction) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
    await tx.query("select set_config('request.jwt.sub', $1, true)", [userId ?? ''])
    const result = await tx.query<Record<string, unknown>>(`select * from public.${fn}(${params})`, names.map((n) => args[n]))
    const xid = await tx.query<{ x: string | null }>('select pg_current_xact_id_if_assigned()::text as x')
    if (xid.rows[0].x) wrote = true
    if (SET_RETURNING.has(fn)) return result.rows
    const row = result.rows[0]
    if (!row) return null
    const value = fn in row && result.fields.length === 1 ? row[fn] : row
    return value === '' ? null : value
  })
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]

const makeStore = (callerId: string | null): any => ({
  loginExists: async (login: string) => Boolean(await one('select 1 from public.profiles where login = $1', [login])),
  findPeople: async (role: string, year: number | null) =>
    (await db.query(`select id, login, first_name, last_name, is_active from public.profiles
       where role = $1 and birth_year is not distinct from $2::int`, [role, year])).rows,
  async createUser(email: string, password: string, p: any) {
    const { id } = (await one<{ id: string }>('insert into auth.users (email, encrypted_password) values ($1, $2) returning id', [email, await hashPassword(password)]))!
    await db.query(`insert into public.profiles (id, role, login, first_name, last_name, birth_year, bio)
       values ($1, $2, $3, $4, $5, $6, $7)`, [id, p.role, p.login, p.first_name, p.last_name, p.birth_year ?? null, p.bio ?? ''])
    return id
  },
  setPassword: async (id: string, password: string) => { await db.query('update auth.users set encrypted_password = $2 where id = $1', [id, await hashPassword(password)]) },
  loginOf: async (id: string) => (await one<any>('select login from public.profiles where id = $1', [id]))?.login ?? null,
  roleOf: async (id: string) => (await one<any>('select role from public.profiles where id = $1', [id]))?.role ?? null,
  isActive: async (id: string) => (await one<any>('select is_active from public.profiles where id = $1', [id]))?.is_active === true,
  async changeLogin(id: string, login: string) {
    await db.query('update auth.users set email = $2 where id = $1', [id, authEmail(login)])
    await db.query('update public.profiles set login = $2 where id = $1', [id, login])
  },
  sessionToken: async (id: string) => `local-${id}`,
  savePasswordCopy: async (id: string, text: string) => {
    await db.query(`insert into public.account_passwords (user_id, ciphertext) values ($1, $2)
       on conflict (user_id) do update set ciphertext = excluded.ciphertext, updated_at = now()`, [id, text])
  },
  readPasswordCopy: async (id: string) => (await one<any>('select ciphertext from public.account_passwords where user_id = $1', [id]))?.ciphertext ?? null,
  requirePasswordChange: async (id: string) => { await db.query('update public.profiles set must_change_password = true where id = $1', [id]) },
  mustChangePassword: async (id: string) => (await one<any>('select must_change_password from public.profiles where id = $1', [id]))?.must_change_password === true,
  markPasswordChanged: async (id: string) => { await db.query('select public.record_password_change($1)', [id]) },
  releaseUser: (id: string) => callAs(callerId, 'admin_release_user', { p_user: id }),
  deleteUser: async (id: string) => { await db.query('delete from auth.users where id = $1', [id]) },
  audit: async (action: string, id: string, details: unknown) => {
    await db.query(`insert into public.audit_log (actor_id, action, entity, entity_id, details) values ($1, $2, 'user', $3, $4)`,
      [callerId, action, id, JSON.stringify(details)])
  },
})

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const authUser = (u: any) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
function session(u: any) {
  const exp = Math.floor(Date.now() / 1000) + 8 * 3600
  return {
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp })}.bG9jYWw`,
    refresh_token: `refresh-${u.id}`, token_type: 'bearer', expires_in: 8 * 3600, expires_at: exp, user: authUser(u),
  }
}
function callerOf(headers: Record<string, string>) {
  try {
    return JSON.parse(atob(headers.authorization.replace('Bearer ', '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null
  } catch {
    return null
  }
}

async function route(req: { url: string; method: string; headers: Record<string, string>; body: string | null }): Promise<[number, unknown?]> {
  const url = new URL(req.url)
  const path = url.pathname
  const body = req.body ? JSON.parse(req.body) : {}
  const caller = callerOf(req.headers)
  const userBy = (column: 'id' | 'email', value: unknown) => one<any>(`select * from auth.users where ${column}::text = $1`, [String(value)])

  if (path === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password') {
      const u = await userBy('email', body.email)
      if (!u || !(await checkPassword(body.password, u.encrypted_password))) return [400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }]
      return [200, session(u)]
    }
    const u = await userBy('id', String(body.refresh_token).replace('refresh-', ''))
    return u ? [200, session(u)] : [400, { error_code: 'refresh_token_not_found', msg: 'Invalid token' }]
  }
  if (path === '/auth/v1/logout') return [204]
  if (path === '/auth/v1/verify') {
    const u = await userBy('id', String(body.token_hash).replace('local-', ''))
    return u ? [200, session(u)] : [400, { msg: 'Invalid token' }]
  }
  if (path === '/auth/v1/user') {
    const u = await userBy('id', caller)
    if (!u) return [401, { msg: 'Not signed in' }]
    if (req.method === 'PUT' && body.password) {
      const me: any = await callAs(caller, 'get_me').catch(() => null)
      if (me?.role === 'manager') return [403, { msg: 'FORBIDDEN' }]
      await makeStore(caller).setPassword(caller, body.password)
    }
    return [200, authUser(u)]
  }
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path)
  if (rpc) {
    try {
      const args = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, JSON_ARGS.has(k) ? JSON.stringify(v) : v]))
      const data: any = await callAs(caller, rpc[1], args)
      if (rpc[1] === 'checkin_code') lastQr = `https://demo.invalid/checkin?b=${body.p_booking}&c=${data.code}`
      return [200, data]
    } catch (error: any) {
      return [400, { message: error.message, code: error.code }]
    }
  }
  if (path === '/functions/v1/admin-users' || path === '/functions/v1/account') {
    const me: any = await callAs(caller, 'get_me').catch(() => null)
    const staff = me?.role === 'admin' || me?.role === 'manager'
    if (!me || (path.endsWith('admin-users') && !staff)) return [403, { error: 'FORBIDDEN' }]
    try {
      wrote = true
      return [200, path.endsWith('account')
        ? await changeOwnPassword(makeStore(caller), PASSWORD_KEY, caller, body.password)
        : await handleAdminAction(makeStore(caller), PASSWORD_KEY, body, me.role)]
    } catch (error: any) {
      return [400, { error: error.message }]
    }
  }
  if (path === '/__demo/qr') return [200, { qr: lastQr }]
  return [404, { message: `Not part of the demo: ${path}` }]
}

async function seed() {
  const root = makeStore(null)
  const admin = await root.createUser(authEmail('admin'), 'demo-admin', { role: 'admin', login: 'admin', first_name: 'OPUS', last_name: 'Developer' })
  const store = makeStore(admin)
  const add = async (role: string, login: string, first: string, last: string, password: string, bio = '') => {
    const id = await store.createUser(authEmail(login), password, { role, login, first_name: first, last_name: last, birth_year: role === 'student' ? 2008 : null, bio })
    await store.savePasswordCopy(id, await encryptPassword(password, PASSWORD_KEY))
    return id as string
  }
  const teachers: string[] = []
  for (const [login, first, last, bio, from, to] of [
    ['kamila', 'Kamila', 'Yusupova', 'IELTS 8.0. Writing Task 2 and Speaking, step by step.', '00:00', '23:30'],
    ['timur', 'Timur', 'Rashidov', 'Grammar from zero to advanced.', '14:00', '18:00'],
    ['nilufar', 'Nilufar', 'Hamidova', 'Speaking, pronunciation and everyday vocabulary.', '14:00', '17:00'],
    ['bekzod', 'Bekzod', 'Nurmatov', 'Reading and listening strategies.', '15:00', '18:00'],
  ]) {
    const id = await add('support', login, first, last, 'demo-support', bio)
    teachers.push(id)
    const days = login === 'kamila' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6]
    await callAs(admin, 'admin_set_schedule', { p_support: id, p_rows: JSON.stringify(days.map((weekday) => ({ weekday, start_time: from, end_time: to }))) })
      .catch(async (e) => {
        if (login !== 'kamila') throw e
        await callAs(admin, 'admin_set_schedule', { p_support: id, p_rows: JSON.stringify([1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: from, end_time: to }))) })
      })
  }
  const students: string[] = []
  for (const [login, first, last] of [
    ['madina', 'Madina', 'Ergasheva'], ['jahongir', 'Jahongir', 'Qodirov'], ['sevara', 'Sevara', 'Tursunova'], ['diyor', 'Diyor', 'Mahmudov'],
    ['shahnoza', 'Shahnoza', 'Rahimova'], ['otabek', 'Otabek', 'Sobirov'], ['zarina', 'Zarina', 'Alimova'], ['laylo', 'Laylo', 'Karimova'],
  ]) students.push(await add('student', login, first, last, 'demo-student'))

  const topics = ['Present Perfect', 'IELTS Writing Task 2', 'Phrasal verbs', 'Speaking Part 2', 'Reading: True / False / Not Given', 'Conditionals']
  const comments = ['Explained it so clearly. Finally got it!', 'Very patient. Great speaking practice.', '', 'Super helpful before my exam.']
  const lesson = (student: string, teacher: string, start: Date, status: string, topic: string) =>
    one<{ id: string }>(`insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at, topic, status)
      values ($1, $2, ($3::timestamptz at time zone 'Asia/Tashkent')::date, $3::timestamptz, $3::timestamptz + interval '30 minutes', $4, $5::text::public.booking_status) returning id`,
    [student, teacher, start.toISOString(), topic, status])

  const HALF = 30 * 60_000
  const DAY = 86_400_000
  const current = Math.floor(Date.now() / HALF) * HALF
  const tashkentDay = Math.floor((Date.now() + 5 * 3_600_000) / DAY) * DAY
  const at = (daysAgo: number, slot: number) => new Date(tashkentDay - daysAgo * DAY + 9 * 3_600_000 + slot * HALF)
  let n = 0
  for (let ago = 28; ago >= 1; ago--) {
    for (let i = 0; i < 2 + (ago % 3); i++) {
      n++
      const status = n % 11 === 0 ? 'no_show' : n % 15 === 0 ? 'cancelled' : 'attended'
      const student = students[n % students.length]
      const teacher = teachers[i % teachers.length]
      const row = await lesson(student, teacher, at(ago, i), status, topics[n % topics.length])
      if (status === 'attended' && n % 3 !== 0) {
        await db.query(`insert into public.reviews (booking_id, student_id, support_id, rating, comment, created_at) values ($1, $2, $3, $4, $5, $6)`,
          [row!.id, student, teacher, 4 + (n % 4 ? 1 : 0), comments[n % comments.length], at(ago, i + 1).toISOString()])
      }
    }
  }
  await lesson(students[0], teachers[0], new Date(current), 'booked', 'Speaking Part 2: describing a place')
  await lesson(students[4], teachers[0], new Date(current + HALF), 'booked', 'IELTS Writing Task 2').catch(() => null)
  await lesson(students[1], teachers[0], new Date(current + 2 * HALF), 'booked', 'Conditionals').catch(() => null)
  await db.query(`update public.settings set value = '3' where key = 'max_active_bookings'`)
}

async function boot() {
  const t = performance.now()
  await db.waitReady
  tell({ type: 'progress', step: 'migrations' })
  await db.exec(authStub)
  for (const file of Object.keys(migrations).filter((f) => LOCAL.test(f)).sort()) await db.exec(migrations[file])
  tell({ type: 'progress', step: 'people' })
  await seed()
  setInterval(() => { db.query('select public.run_maintenance()').catch(() => {}) }, 60_000)
  tell({ type: 'ready', ms: Math.round(performance.now() - t), migrations: Object.keys(migrations).filter((f) => LOCAL.test(f)).length })
}

onmessage = async ({ data }) => {
  wrote = false
  try {
    const [status, body] = await route(data.req)
    tell({ type: 'reply', id: data.id, status, body: body === undefined ? null : JSON.stringify(body), wrote })
  } catch (error: any) {
    tell({ type: 'reply', id: data.id, status: 500, body: JSON.stringify({ message: error.message }), wrote: false })
  }
}
boot().catch((error) => tell({ type: 'failed', message: String(error?.message ?? error) }))
