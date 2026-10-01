/** Environment configuration, read once at startup. See .env.example. */
export interface Config {
  /** Public origin of the app (the web origin; /api is served from it). */
  baseUrl: string;
  authSecret: string;
  databaseDir: string;
  /** `redirectUri` must exactly match an authorized redirect URI in Google Cloud Console. */
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
  resendApiKey: string | null;
  /** Web Push keys; null disables push notifications. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  emailFrom: string;
  /** "Today" for recurring expenses (IANA zone). */
  appTimezone: string;
  /** Bearer token for POST /api/cron/recurring (Vercel Cron sends it); null disables the endpoint. */
  cronSecret: string | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see apps/api/.env.example)`);
  return value;
}

export function loadConfig(): Config {
  const authSecret = required('BETTER_AUTH_SECRET');
  if (authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

  return {
    baseUrl,
    authSecret,
    databaseDir: process.env.DATABASE_DIR ?? './.data/pglite',
    google:
      clientId && clientSecret
        ? {
            clientId,
            clientSecret,
            redirectUri: process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/callback/google`,
          }
        : null,
    resendApiKey: process.env.RESEND_API_KEY || null,
    vapid:
      process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
        ? {
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY,
            subject: process.env.VAPID_SUBJECT || 'mailto:admin@splity.local',
          }
        : null,
    emailFrom: process.env.EMAIL_FROM || 'Splity <onboarding@resend.dev>',
    appTimezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
    cronSecret: process.env.CRON_SECRET || null,
  };
}
