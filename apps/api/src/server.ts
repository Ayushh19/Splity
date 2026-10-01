import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { logMagicLink, resendMagicLink } from './email';

const config = loadConfig();
const { db } = await openDb(config.databaseDir);
const auth = createAuth({
  db,
  baseUrl: config.baseUrl,
  secret: config.authSecret,
  google: config.google,
  sendMagicLink: config.resendApiKey ? resendMagicLink(config.resendApiKey, config.emailFrom) : logMagicLink,
});
const app = createApp({ db, auth, features: { google: config.google !== null } });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Splity API on http://localhost:${port} (public origin ${config.baseUrl})`);
  if (!config.google) console.log('Google sign-in disabled: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  if (!config.resendApiKey) console.log('Magic links are printed here (no RESEND_API_KEY)');
});
