import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Pool } = pg

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for db:migrate')
}

const pool = new Pool({ connectionString: databaseUrl })
const migrationDir = resolve('db/migrations')
const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`)

for (const file of files) {
  const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file])

  if (applied.rowCount) {
    continue
  }

  const sql = await readFile(resolve(migrationDir, file), 'utf8')
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
    await client.query('COMMIT')
    console.log(`applied ${file}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

await pool.end()
