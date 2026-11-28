import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')

const LOCAL_MIGRATION = /^(?!0004_|0009_)/

const SET_RETURNING = new Set(['transfer_options'])

export async function createDb(dataDir) {
  const db = new PGlite(dataDir)
  await db.waitReady
  const ready = await db.query(
    "select 1 from information_schema.tables where table_name = 'profiles'",
  )
  if (ready.rows.length > 0) return db

  await db.exec(readFileSync(join(root, 'supabase', 'tests', 'auth-stub.sql'), 'utf8'))
  const files = readdirSync(migrationsDir).filter((f) => LOCAL_MIGRATION.test(f)).sort()
  for (const file of files) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
  return db
}

export async function callAs(db, userId, fn, args = {}) {
  const names = Object.keys(args)
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ')
  const role = userId ? 'authenticated' : 'anon'
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`)
    await tx.query("select set_config('request.jwt.sub', $1, true)", [userId ?? ''])
    const result = await tx.query(
      `select * from public.${fn}(${params})`,
      names.map((n) => args[n]),
    )
    if (SET_RETURNING.has(fn)) return result.rows
    const row = result.rows[0]
    if (!row) return null
    const value = fn in row && result.fields.length === 1 ? row[fn] : row
    return value === '' ? null : value
  })
}
