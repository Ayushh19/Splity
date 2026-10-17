import { openDb } from './client';

// DATABASE_URL (e.g. Neon) wins over the local PGlite folder, same as the server.
const target = process.env.DATABASE_URL
  ? { url: process.env.DATABASE_URL }
  : { dir: process.env.DATABASE_DIR ?? './.data/pglite' };
const { close } = await openDb(target, { migrate: true });
await close();
console.log(`Migrations applied to ${'url' in target ? new URL(target.url).host : target.dir}`);
