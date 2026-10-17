import { sql } from 'drizzle-orm';
import { openDb } from '../src/db/client';

/**
 * A fresh database for one test file: in-memory PGlite, or, with TEST_DATABASE_URL, a real
 * PostgreSQL server that is wiped and re-migrated (run with --no-file-parallelism then).
 */
export async function openTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb();
  const wipe = await openDb({ url }, { migrate: false });
  await wipe.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public`);
  await wipe.close();
  return openDb({ url }, { migrate: true });
}
