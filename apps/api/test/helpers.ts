import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { openDb } from '../src/db/client';
import type { MagicLinkEmail } from '../src/email';

export const BASE_URL = 'http://localhost:3000';

/** A full app on an in-memory database, with magic-link emails captured instead of sent. */
export async function testApp(options: { google?: { clientId: string; clientSecret: string; redirectUri: string } } = {}) {
  const { db, close } = await openDb();
  const outbox: MagicLinkEmail[] = [];
  const auth = createAuth({
    db,
    baseUrl: BASE_URL,
    secret: 'test-secret-that-is-at-least-32-characters-long',
    google: options.google ?? null,
    sendMagicLink: async (email) => {
      outbox.push(email);
    },
  });
  const app = createApp({ db, auth, features: { google: Boolean(options.google) } });

  const request = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Origin: BASE_URL, ...init.headers } });

  /** Run the magic-link flow for `email` and return the session cookie header. */
  async function signIn(email: string): Promise<string> {
    const res = await request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/' }),
    });
    if (res.status !== 200) throw new Error(`magic link request failed: ${res.status} ${await res.text()}`);
    const link = new URL(outbox.at(-1)!.url);
    const verify = await request(link.pathname + link.search);
    const cookie = verify.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    if (!cookie) throw new Error(`no session cookie (status ${verify.status})`);
    return cookie;
  }

  return { app, db, outbox, request, signIn, close };
}
