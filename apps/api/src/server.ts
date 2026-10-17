import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { createMainApp } from './main';

const config = loadConfig();
const { app, recurring, today } = await createMainApp(config);

// Long-running server: run the recurring job at startup and every hour (idempotent, so overlap with
// an external cron is harmless).
const runRecurring = () =>
  recurring
    .runDue(today())
    .then(({ created, paused }) => (created || paused) && console.log(`[recurring] created ${created}, paused ${paused}`))
    .catch((e) => console.error('[recurring]', e));
void runRecurring();
setInterval(runRecurring, 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Splity API on http://localhost:${port} (public origin ${config.baseUrl})`);
  const db = config.database;
  console.log('url' in db ? `Database: PostgreSQL at ${new URL(db.url).host}` : `Database: PGlite in ${db.dir}`);
  if (!config.google) console.log('Google sign-in disabled: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  if (!config.smtp) console.log('Magic links are printed here (no SMTP_USER/SMTP_PASS)');
  else console.log(`Magic links are emailed from ${config.emailFrom} via ${config.smtp.host}`);
  if (!config.vapid) console.log('Push notifications disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
});
