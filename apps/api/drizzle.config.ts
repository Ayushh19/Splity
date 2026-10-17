import { defineConfig } from 'drizzle-kit';

// `db:generate` only reads the schema; `db:studio` opens DATABASE_URL (e.g. Neon) or the local PGlite folder.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : { driver: 'pglite', dbCredentials: { url: process.env.DATABASE_DIR ?? './.data/pglite' } }),
});
