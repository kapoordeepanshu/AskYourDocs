/**
 * Migration entry point. Ordering matters:
 *   1. extensions   - vector and pg_trgm must exist before any table using them
 *   2. drizzle      - generated schema migrations
 *   3. custom       - triggers and anything Drizzle cannot express
 *
 * Run with: npm run db:migrate
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { migrate } from 'drizzle-orm/postgres-js/migrator'

import { client, db } from './index'

const CUSTOM_DIR = path.join(process.cwd(), 'drizzle', 'custom')
const DRIZZLE_DIR = path.join(process.cwd(), 'drizzle')

async function runSqlFile(file: string) {
  const contents = await readFile(path.join(CUSTOM_DIR, file), 'utf8')
  process.stdout.write(`  applying ${file}\n`)
  await client.unsafe(contents)
}

async function customFiles(match: (name: string) => boolean) {
  if (!existsSync(CUSTOM_DIR)) return []
  const all = await readdir(CUSTOM_DIR)
  return all.filter((f) => f.endsWith('.sql') && match(f)).sort()
}

async function main() {
  process.stdout.write('Enabling extensions\n')
  for (const file of await customFiles((f) => f.startsWith('0000_'))) {
    await runSqlFile(file)
  }

  process.stdout.write('Running schema migrations\n')
  if (existsSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'))) {
    await migrate(db, { migrationsFolder: DRIZZLE_DIR })
  } else {
    process.stdout.write('  no generated migrations yet - run: npm run db:generate\n')
  }

  process.stdout.write('Applying custom SQL\n')
  for (const file of await customFiles((f) => !f.startsWith('0000_'))) {
    await runSqlFile(file)
  }

  process.stdout.write('Migrations complete\n')
  await client.end()
}

main().catch(async (error) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : error}\n`)
  await client.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
