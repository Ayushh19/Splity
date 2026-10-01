import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
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

export function createAuth({ db, baseUrl, secret, google, sendMagicLink }: AuthOptions) {
  return betterAuth({
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
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: 'hashed',
        sendMagicLink: ({ email, url }) => sendMagicLink({ to: email, url }),
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
