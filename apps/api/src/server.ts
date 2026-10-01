import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { logMagicLink, resendMagicLink, withDevFallback } from './email';
import { createNotifier, webPushSender } from './services/push';
import { createRecurringJob } from './services/recurring';
import { todayIn } from '@splity/shared';

const config = loadConfig();
const { db } = await openDb(config.databaseDir);
const auth = createAuth({
  db,
  baseUrl: config.baseUrl,
  secret: config.authSecret,
  google: config.google,
  sendMagicLink: config.resendApiKey
    ? withDevFallback(resendMagicLink(config.resendApiKey, config.emailFrom), process.env.NODE_ENV === 'production')
    : logMagicLink,
});
const notifier = createNotifier(db, config.vapid ? webPushSender(config.vapid) : null);
const recurring = createRecurringJob(db, notifier);
const today = () => todayIn(config.appTimezone);
const app = createApp({
  db,
  auth,
  baseUrl: config.baseUrl,
  notifier,
  recurring,
  today,
  cronSecret: config.cronSecret,
  features: { google: config.google !== null, vapidPublicKey: config.vapid?.publicKey ?? null },
});

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
  if (!config.google) console.log('Google sign-in disabled: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  if (!config.resendApiKey) console.log('Magic links are printed here (no RESEND_API_KEY)');
  else console.log(`Magic links are emailed from ${config.emailFrom}`);
  if (!config.vapid) console.log('Push notifications disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
});
