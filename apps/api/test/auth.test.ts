import type { Profile } from '@splity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

const json = { 'Content-Type': 'application/json' };

describe('health', () => {
  it('responds ok without auth', async () => {
    const res = await t.request('/api/health');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('magic link sign-in', () => {
  it('rejects /me without a session', async () => {
    expect((await t.request('/api/me')).status).toBe(401);
  });

  it('emails a link on the public origin and signs a new user in', async () => {
    const cookie = await t.signIn('priya@example.com');
    const link = new URL(t.outbox.at(-1)!.url);
    expect(link.origin).toBe(BASE_URL);
    expect(link.pathname).toBe('/api/auth/magic-link/verify');

    const res = await t.request('/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: 'priya@example.com',
      displayName: '',
      upiId: null,
      defaultCurrency: 'INR',
    });
  });

  it('signing in again with the same email reuses the account', async () => {
    const me = async () =>
      (await (await t.request('/api/me', { headers: { Cookie: await t.signIn('arjun@example.com') } })).json()) as Profile;
    const first = await me();
    const second = await me();
    expect(second.id).toBe(first.id);
  });

  it('a magic link works only once', async () => {
    await t.signIn('rahul@example.com');
    const link = new URL(t.outbox.at(-1)!.url);
    const reuse = await t.request(link.pathname + link.search);
    expect(reuse.headers.getSetCookie().some((c) => c.startsWith('splity.session_token=') && !c.includes('Max-Age=0'))).toBe(false);
  });

  it('rejects sign-in requests from another origin', async () => {
    const res = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { ...json, Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'victim@example.com', callbackURL: 'https://evil.example/' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('profile', () => {
  it('updates name, UPI ID and default currency', async () => {
    const cookie = await t.signIn('meera@example.com');
    const res = await t.request('/api/me', {
      method: 'PATCH',
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ displayName: '  Meera ', upiId: 'meera@okaxis', defaultCurrency: 'THB' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: 'Meera', upiId: 'meera@okaxis', defaultCurrency: 'THB' });

    const cleared = await t.request('/api/me', {
      method: 'PATCH',
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ upiId: null }),
    });
    expect(await cleared.json()).toMatchObject({ upiId: null, displayName: 'Meera' });
  });

  it('rejects invalid values and unknown fields', async () => {
    const cookie = await t.signIn('kabir@example.com');
    for (const body of [{ upiId: 'not a upi' }, { defaultCurrency: 'XYZ' }, { displayName: '   ' }, { email: 'x@y.z' }]) {
      const res = await t.request('/api/me', { method: 'PATCH', headers: { ...json, Cookie: cookie }, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
