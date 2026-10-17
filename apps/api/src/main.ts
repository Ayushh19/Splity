import { createApp } from './app';
import { createAuth } from './auth';
import type { Config } from './config';
import { openDb } from './db/client';
import { logMagicLink, smtpMagicLink, withDevFallback } from './email';
import { createNotifier, webPushSender } from './services/push';
import { createRecurringJob } from './services/recurring';
import { todayIn } from '@splity/shared';

/** Wire the real app from configuration. Shared by the local server and the Vercel function. */
export async function createMainApp(config: Config) {
  const { db } = await openDb(config.database);
  const auth = createAuth({
    db,
    baseUrl: config.baseUrl,
    secret: config.authSecret,
    google: config.google,
    sendMagicLink: config.smtp
      ? withDevFallback(smtpMagicLink(config.smtp, config.emailFrom), process.env.NODE_ENV === 'production')
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
  return { app, recurring, today };
}
