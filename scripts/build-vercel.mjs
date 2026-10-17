// Builds the Vercel deployment as Build Output API v3 (.vercel/output):
//   static/           the web app (apps/web/dist)
//   functions/api.func  the whole API bundled into one Node function
//   config.json       routing (/api/* -> function, SPA fallback) and the daily cron
// Run after `pnpm --filter @splity/web build`. Vercel runs both via `pnpm vercel-build` (vercel.json).
import { execSync } from 'node:child_process';
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api.func`;

// Production deploys upgrade the database schema before the new code goes live. Preview deploys
// skip it (they share the production database on Hobby, so they must not change its schema).
if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set for production deploys');
  execSync('pnpm --filter @splity/api db:migrate', { cwd: root, stdio: 'inherit' });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

cpSync(`${root}apps/web/dist`, `${out}/static`, { recursive: true });

await build({
  entryPoints: [`${root}apps/api/src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // CommonJS dependencies (pg, web-push) call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  // PGlite is only used without DATABASE_URL (local dev); pg-native is an optional pg addon.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator', 'pg-native'],
  logLevel: 'warning',
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true }, null, 2),
);

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Vite's content-hashed files never change.
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        // The service worker must always be re-checked.
        { src: '^/sw\\.js$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
        // The function receives the original URL, so Hono's /api routes match as-is.
        { src: '^/api(/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        // Client-side routes (/groups/…, /invite/…) load the SPA.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
      // Vercel Hobby allows one run a day. 19:00 UTC ≈ 00:30 IST; Vercel sends Bearer $CRON_SECRET.
      crons: [{ path: '/api/cron/recurring', schedule: '0 19 * * *' }],
    },
    null,
    2,
  ),
);

console.log(`Vercel output written to ${out}`);
