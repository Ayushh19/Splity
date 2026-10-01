import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Open the database. `dataDir` is a folder on disk; omit it for an in-memory
 * database (tests). PGlite is single-process: only one server may open a folder.
 */
export async function openDb(dataDir?: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
