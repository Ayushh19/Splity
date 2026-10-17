import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema';

/**
 * Typed as the node-postgres flavour. PGlite's drizzle database has the same query API and
 * result shape (`execute()` returns `{ rows }`), so the local/test database is cast to it.
 */
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type DbOrTx = Db | Tx;

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Where the data lives: a PostgreSQL server (production), a PGlite folder (local), or memory (tests). */
export type DbTarget = { url: string } | { dir?: string };

/**
 * Open the database. PGlite is single-process: only one server may open a folder.
 * `migrate` defaults to true for PGlite; a server database is migrated by `pnpm db:migrate`
 * (run at deploy time), not by every serverless cold start.
 */
export async function openDb(
  target: DbTarget = {},
  { migrate = !('url' in target) }: { migrate?: boolean } = {},
): Promise<{ db: Db; close: () => Promise<void> }> {
  if ('url' in target) {
    // Small pool: each serverless instance needs only a few connections, and Neon's pooled
    // endpoint (PgBouncer) multiplexes them.
    const pool = new pg.Pool({ connectionString: target.url, max: 5, idleTimeoutMillis: 10_000 });
    const db = drizzlePg({ client: pool, schema });
    if (migrate) await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  // Loaded lazily so the production bundle (scripts/build-vercel.mjs) can leave PGlite's WASM out.
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate: migratePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  if (target.dir) mkdirSync(target.dir, { recursive: true });
  const client = target.dir ? new PGlite(target.dir) : new PGlite();
  const db = drizzlePglite({ client, schema });
  if (migrate) await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
