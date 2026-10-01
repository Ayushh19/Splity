import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { openDb } from '../src/db/client';
import type { MagicLinkEmail } from '../src/email';
import { createNotifier, type DeviceSubscription } from '../src/services/push';
import type { PushPayload } from '@splity/shared';

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
  /** Every push "delivered", with the endpoint it went to. Endpoints containing "gone" act expired. */
  const pushes: { endpoint: string; payload: PushPayload }[] = [];
  const notifier = createNotifier(db, async (sub: DeviceSubscription, payload: PushPayload) => {
    if (sub.endpoint.includes('gone')) return 'gone';
    pushes.push({ endpoint: sub.endpoint, payload });
    return 'ok';
  });
  const app = createApp({
    db,
    auth,
    baseUrl: BASE_URL,
    notifier,
    features: { google: Boolean(options.google), vapidPublicKey: 'test-vapid-public-key' },
  });

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

  /** A signed-in user with a display name, plus JSON helpers that send their cookie. */
  async function user(name: string) {
    const cookie = await signIn(`${name.toLowerCase().replace(/\W/g, '')}.${outbox.length}@example.com`);
    const call = async (method: string, path: string, json?: unknown) => {
      const res = await request(`/api${path}`, {
        method,
        headers: { Cookie: cookie, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
      const text = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
    };
    await call('PATCH', '/me', { displayName: name });
    return {
      name,
      cookie,
      get: (path: string) => call('GET', path),
      post: (path: string, json: unknown = {}) => call('POST', path, json),
      patch: (path: string, json: unknown) => call('PATCH', path, json),
      put: (path: string, json: unknown) => call('PUT', path, json),
      del: (path: string) => call('DELETE', path),
    };
  }

  return { app, db, outbox, pushes, notifier, request, signIn, user, close };
}
