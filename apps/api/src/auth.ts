import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { Db } from './db/client';
import { accounts, sessions, users, verifications } from './db/schema';
import type { SendMagicLink } from './email';

export interface AuthOptions {
  db: Db;
  baseUrl: string;
  secret: string;
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
  sendMagicLink: SendMagicLink;
}

/** Sign-in links and codes expire together. */
const SIGN_IN_TTL_SECONDS = 60 * 10;

export function createAuth({ db, baseUrl, secret, google, sendMagicLink }: AuthOptions) {
  const auth = betterAuth({
    appName: 'Splity',
    baseURL: baseUrl,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [new URL(baseUrl).origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    advanced: {
      cookiePrefix: 'splity',
      // Better Auth skips origin/CSRF checks when NODE_ENV=test; keep them on everywhere.
      disableOriginCheck: false,
      database: { generateId: 'uuid' },
    },
    user: {
      // Our `users` table names these columns differently.
      fields: { name: 'displayName', image: 'photoUrl' },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 days: friends shouldn't have to sign in often
      updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    },
    account: {
      // Google verifies emails, so signing in with Google and with a magic link
      // for the same address lands on the same Splity account.
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
            // Used for both the authorization request and the token exchange. When it is not the
            // callback path (e.g. the app root), the web app forwards the response: see
            // apps/web/src/lib/oauth-return.ts.
            redirectURI: google.redirectUri,
            prompt: 'select_account',
          },
        }
      : {},
    // Failed sign-ins (cancelled at Google, expired state, …) land on our sign-in screen with ?error=…
    onAPIError: { errorURL: `${baseUrl}/sign-in` },
    // The email-OTP plugin is only used to check sign-in codes; codes are created and emailed
    // together with the magic link below, so its own send/verify-email/password routes are off.
    disabledPaths: [
      '/email-otp/send-verification-otp',
      '/email-otp/check-verification-otp',
      '/email-otp/verify-email',
      '/email-otp/request-password-reset',
      '/forget-password/email-otp',
      '/email-otp/reset-password',
      '/email-otp/request-email-change',
      '/email-otp/change-email',
    ],
    plugins: [
      magicLink({
        expiresIn: SIGN_IN_TTL_SECONDS,
        storeToken: 'hashed',
        // One email carries both: the link (opens in the default browser) and a 6-digit code to
        // type into the app, e.g. the installed iPhone app, which doesn't share Safari's cookies.
        // A new request replaces the previous code.
        sendMagicLink: async ({ email, url }) => {
          const code = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } });
          await sendMagicLink({ to: email, url, code });
        },
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_TTL_SECONDS,
        storeOTP: 'hashed',
        allowedAttempts: 5,
        sendVerificationOTP: async () => {
          throw new Error('Sign-in codes are sent with the magic link');
        },
      }),
    ],
  });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
